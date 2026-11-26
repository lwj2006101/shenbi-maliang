/* =============================================================
 * cv.js —— 儿童画图像处理算法库（V0.7 增强版）
 * 对应技术研究报告 4.2.1 / 6.2.1：
 *  1. 灰度化 + 拍照光照背景归一化 + 色彩显著度融合 + 自适应阈值
 *  2. 形态学闭运算 / 膨胀（可分离滑窗）
 *  3. 图像边缘漫水填充 + 反转
 *  4. 主连通域提取 + 邻近分离肢体归并 + 断线骨架桥接 + 孔洞填充
 *  5. 轮廓跟踪（Marching Squares）+ Douglas-Peucker 简化
 *  6. Zhang-Suen 细化 + 毛刺修剪
 *  7. 倒角距离变换（头部定位 / 线宽估计 / 邻近部件距离度量）
 *  8. PCA 主轴分析（躯干朝向判断 / 模板选择）
 * ============================================================= */
(function (global) {
  'use strict';
  var CV = {};

  /* ---------- 基础 ---------- */
  CV.rgbaToGray = function (data, w, h) {
    var g = new Uint8ClampedArray(w * h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) {
      var a = data[p + 3];
      if (a < 16) { g[i] = 255; continue; }
      var lum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
      g[i] = a < 255 ? Math.round(lum * (a / 255) + 255 * (1 - a / 255)) : lum;
    }
    return g;
  };

  /* 拍照纸面阴影与渐变光照归一化：大窗口积分图估计局部纸底亮度 */
  CV.normalizeIllumination = function (gray, w, h, block) {
    block = Math.max(31, (block || 85) | 1);
    var r = block >> 1;
    var I = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var rowSum = 0, o1 = (y + 1) * (w + 1), o0 = y * (w + 1);
      for (var x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        I[o1 + x + 1] = I[o0 + x + 1] + rowSum;
      }
    }
    var out = new Uint8ClampedArray(w * h);
    for (var yy = 0; yy < h; yy++) {
      var y0 = Math.max(0, yy - r), y1 = Math.min(h - 1, yy + r);
      var r0 = y0 * (w + 1), r1 = (y1 + 1) * (w + 1);
      for (var xx = 0; xx < w; xx++) {
        var x0 = Math.max(0, xx - r), x1 = Math.min(w - 1, xx + r);
        var area = (y1 - y0 + 1) * (x1 - x0 + 1);
        var bg = Math.max(64, (I[r1 + x1 + 1] - I[r0 + x1 + 1] - I[r1 + x0] + I[r0 + x0]) / area);
        var v = gray[yy * w + xx];
        out[yy * w + xx] = Math.min(255, Math.round((v / bg) * 248));
      }
    }
    return out;
  };

  /* 彩色浅笔触显著度（捕获浅黄、浅粉、天蓝等高明度彩色蜡笔/水彩笔画） */
  CV.colorSalience = function (data, w, h, satThresh) {
    satThresh = satThresh || 34;
    var out = new Uint8Array(w * h);
    // 估计四角纸底色偏，避免暖黄灯光被整体当成彩色前景
    var samples = [], coords = [[4, 4], [w - 5, 4], [4, h - 5], [w - 5, h - 5], [(w >> 1), 4], [(w >> 1), h - 5]];
    for (var k = 0; k < coords.length; k++) {
      var cx = Math.max(0, Math.min(w - 1, coords[k][0])), cy = Math.max(0, Math.min(h - 1, coords[k][1]));
      var idx = (cy * w + cx) * 4;
      if (data[idx + 3] > 200) samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    var bgR = 250, bgG = 250, bgB = 250;
    if (samples.length) {
      samples.sort(function (a, b) { return (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]); });
      var top = samples[0];
      bgR = top[0]; bgG = top[1]; bgB = top[2];
    }
    for (var i = 0, p = 0; i < w * h; i++, p += 4) {
      if (data[p + 3] < 40) continue;
      var r = data[p], g = data[p + 1], b = data[p + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx - mn;
      var diffBg = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
      if (sat >= satThresh && diffBg >= satThresh * 1.45) out[i] = 1;
    }
    return out;
  };

  CV.bbox = function (bin, w, h) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (bin[y * w + x]) {
          n++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return { x0: 0, y0: 0, x1: -1, y1: -1, w: 0, h: 0, area: 0 };
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area: n };
  };

  CV.crop = function (bin, w, h, bb) {
    var cw = bb.x1 - bb.x0 + 1, ch = bb.y1 - bb.y0 + 1;
    var out = new Uint8Array(cw * ch);
    for (var y = 0; y < ch; y++) {
      for (var x = 0; x < cw; x++) out[y * cw + x] = bin[(y + bb.y0) * w + (x + bb.x0)];
    }
    return out;
  };

  /* ---------- 1. 自适应阈值（Sauvola 简化版：局部均值 - C） ---------- */
  CV.adaptiveThreshold = function (gray, w, h, block, C) {
    block = Math.max(3, block | 1);
    var r = block >> 1;
    var I = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var rowSum = 0, o1 = (y + 1) * (w + 1), o0 = y * (w + 1);
      for (var x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        I[o1 + x + 1] = I[o0 + x + 1] + rowSum;
      }
    }
    var bin = new Uint8Array(w * h);
    for (var yy = 0; yy < h; yy++) {
      var y0 = Math.max(0, yy - r), y1 = Math.min(h - 1, yy + r);
      var r0 = y0 * (w + 1), r1 = (y1 + 1) * (w + 1);
      for (var xx = 0; xx < w; xx++) {
        var x0 = Math.max(0, xx - r), x1 = Math.min(w - 1, xx + r);
        var area = (y1 - y0 + 1) * (x1 - x0 + 1);
        var sum = I[r1 + x1 + 1] - I[r0 + x1 + 1] - I[r1 + x0] + I[r0 + x0];
        bin[yy * w + xx] = gray[yy * w + xx] < (sum / area) - C ? 1 : 0;
      }
    }
    return bin;
  };

  /* ---------- 2. 形态学（可分离，O(n·r)） ---------- */
  function pass(src, w, h, radius, isMax, horizontal) {
    var out = new Uint8Array(w * h);
    if (horizontal) {
      for (var y = 0; y < h; y++) {
        var o = y * w;
        for (var x = 0; x < w; x++) {
          var v = isMax ? 0 : 1;
          for (var k = -radius; k <= radius; k++) {
            var xx = x + k; if (xx < 0 || xx >= w) continue;
            var s = src[o + xx];
            v = isMax ? (s > v ? s : v) : (s < v ? s : v);
          }
          out[o + x] = v;
        }
      }
    } else {
      for (var y2 = 0; y2 < h; y2++) {
        for (var x2 = 0; x2 < w; x2++) {
          var v2 = isMax ? 0 : 1;
          for (var k2 = -radius; k2 <= radius; k2++) {
            var yy = y2 + k2; if (yy < 0 || yy >= h) continue;
            var s2 = src[yy * w + x2];
            v2 = isMax ? (s2 > v2 ? s2 : v2) : (s2 < v2 ? s2 : v2);
          }
          out[y2 * w + x2] = v2;
        }
      }
    }
    return out;
  }
  CV.dilate = function (bin, w, h, r) { return pass(pass(bin, w, h, r, true, true), w, h, r, true, false); };
  CV.erode = function (bin, w, h, r) { return pass(pass(bin, w, h, r, false, true), w, h, r, false, false); };
  CV.close = function (bin, w, h, r) { return CV.erode(CV.dilate(bin, w, h, r), w, h, r); };
  CV.open = function (bin, w, h, r) { return CV.dilate(CV.erode(bin, w, h, r), w, h, r); };

  /* ---------- 3. 从边界漫水填充背景（非递归 BFS） ---------- */
  CV.reachFromBorder = function (bin, w, h) {
    var vis = new Uint8Array(w * h);
    var stack = new Int32Array(w * h), sp = 0;
    function push(i) { if (!vis[i]) { vis[i] = 1; stack[sp++] = i; } }
    for (var x = 0; x < w; x++) { if (!bin[x]) push(x); if (!bin[(h - 1) * w + x]) push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { if (!bin[y * w]) push(y * w); if (!bin[y * w + w - 1]) push(y * w + w - 1); }
    while (sp > 0) {
      var i = stack[--sp], cx = i % w, cy = (i / w) | 0;
      if (cx > 0 && !bin[i - 1]) push(i - 1);
      if (cx < w - 1 && !bin[i + 1]) push(i + 1);
      if (cy > 0 && !bin[i - w]) push(i - w);
      if (cy < h - 1 && !bin[i + w]) push(i + w);
    }
    return vis;
  };

  CV.enclosed = function (bin, w, h) {
    var reach = CV.reachFromBorder(bin, w, h);
    var out = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) out[i] = (bin[i] || !reach[i]) ? 1 : 0;
    return out;
  };

  /* ---------- 4. 连通域提取与分离肢体归并（8 邻域） ---------- */
  CV.connectedComponents = function (bin, w, h) {
    var lab = new Int32Array(w * h).fill(-1);
    var stack = new Int32Array(w * h);
    var comps = [], cur = 0;
    for (var i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i] >= 0) continue;
      var sp = 0; stack[sp++] = i; lab[i] = cur;
      var size = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, touchesBorder = false;
      while (sp > 0) {
        var p = stack[--sp]; size++;
        var x = p % w, y = (p / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) touchesBorder = true;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            var q = ny * w + nx;
            if (bin[q] && lab[q] < 0) { lab[q] = cur; stack[sp++] = q; }
          }
        }
      }
      comps.push({ id: cur, area: size, x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1, touchesBorder: touchesBorder });
      cur++;
    }
    return { labels: lab, comps: comps, count: cur };
  };

  CV.largestComponent = function (bin, w, h) {
    var cc = CV.connectedComponents(bin, w, h);
    if (!cc.comps.length) return { mask: new Uint8Array(w * h), area: 0, count: 0 };
    // 优先选择不贴满外边框的主体连通域，避免拍照黑框抢占角色
    var best = null, bestScore = -1;
    for (var i = 0; i < cc.comps.length; i++) {
      var c = cc.comps[i];
      var frameLike = c.touchesBorder && (c.w > w * 0.92 || c.h > h * 0.92) && (c.area / Math.max(1, c.w * c.h) < 0.16);
      var score = frameLike ? c.area * 0.05 : c.area;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    var out = new Uint8Array(w * h);
    for (var j = 0; j < w * h; j++) out[j] = cc.labels[j] === best.id ? 1 : 0;
    return { mask: out, area: best.area, count: cc.count };
  };

  function drawLineMask(mask, w, h, ax, ay, bx, by, radius) {
    var steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    var r = Math.max(1, radius | 0);
    for (var s = 0; s <= steps; s++) {
      var cx = Math.round(ax + (bx - ax) * (s / steps));
      var cy = Math.round(ay + (by - ay) * (s / steps));
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          var nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) mask[ny * w + nx] = 1;
        }
      }
    }
  }

  /* 归并靠近角色主体的分离肢体/头饰/火焰（同时保留干净视觉掩码与供骨架提取的桥接掩码） */
  CV.mergeNearbyComponents = function (bin, w, h, opts) {
    opts = opts || {};
    var cc = CV.connectedComponents(bin, w, h);
    if (!cc.comps.length) return { mask: new Uint8Array(w * h), bridged: new Uint8Array(w * h), area: 0, count: 0, merged: 0 };
    var best = null, bestScore = -1;
    for (var i = 0; i < cc.comps.length; i++) {
      var c = cc.comps[i];
      var frameLike = c.touchesBorder && (c.w > w * 0.92 || c.h > h * 0.92) && (c.area / Math.max(1, c.w * c.h) < 0.16);
      var score = frameLike ? c.area * 0.05 : c.area;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    var mainMask = new Uint8Array(w * h);
    var invMain = new Uint8Array(w * h);
    for (var p = 0; p < w * h; p++) {
      var isMain = cc.labels[p] === best.id ? 1 : 0;
      mainMask[p] = isMain;
      invMain[p] = isMain ? 0 : 1;
    }
    var diag = Math.hypot(best.w, best.h);
    var maxGap = opts.maxGap || Math.max(14, Math.min(30, Math.round(diag * 0.085)));
    var minPartArea = opts.minArea || Math.max(28, Math.round(best.area * 0.006));
    var distToMain = CV.distanceTransform(invMain, w, h);

    // 统计每个候选次连通域到主连通域的最短距离与最近点
    var stats = {};
    for (var k = 0; k < cc.comps.length; k++) {
      var ck = cc.comps[k];
      if (ck.id === best.id || ck.touchesBorder || ck.area < minPartArea || ck.area > best.area * 0.55) continue;
      // 过滤细长杂乱涂鸦：面积密度极低且跨度超过主体 75% 的背景乱线不归并
      var fillRatio = ck.area / Math.max(1, ck.w * ck.h);
      var span = Math.hypot(ck.w, ck.h);
      if (span > diag * 0.72 && fillRatio < 0.08) continue;
      stats[ck.id] = { comp: ck, minDist: 1e9, px: 0, py: 0 };
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x, lid = cc.labels[idx];
        var st = stats[lid];
        if (!st) continue;
        var d = distToMain[idx];
        if (d < st.minDist) { st.minDist = d; st.px = x; st.py = y; }
      }
    }

    var mergedIds = {}, mergedCount = 0, totalArea = best.area;
    for (var idKey in stats) {
      if (stats[idKey].minDist <= maxGap) {
        mergedIds[idKey] = stats[idKey];
        mergedCount++;
        totalArea += stats[idKey].comp.area;
      }
    }
    var out = Uint8Array.from(mainMask);
    var bridged = Uint8Array.from(mainMask);
    if (mergedCount > 0) {
      for (var m = 0; m < w * h; m++) {
        if (mergedIds[cc.labels[m]]) { out[m] = 1; bridged[m] = 1; }
      }
      // 为每个归并部件沿距离场梯度下降找到主体最近点，画一条 2px 骨架桥供细化图连通
      for (var mid in mergedIds) {
        var info = mergedIds[mid], cx = info.px, cy = info.py, guard = 0;
        var sx = cx, sy = cy;
        while (guard++ < 64 && !mainMask[cy * w + cx]) {
          var bestNx = cx, bestNy = cy, bd = distToMain[cy * w + cx];
          for (var dy2 = -1; dy2 <= 1; dy2++) {
            for (var dx2 = -1; dx2 <= 1; dx2++) {
              if (!dx2 && !dy2) continue;
              var nx2 = cx + dx2, ny2 = cy + dy2;
              if (nx2 < 0 || ny2 < 0 || nx2 >= w || ny2 >= h) continue;
              if (distToMain[ny2 * w + nx2] < bd) { bd = distToMain[ny2 * w + nx2]; bestNx = nx2; bestNy = ny2; }
            }
          }
          if (bestNx === cx && bestNy === cy) break;
          cx = bestNx; cy = bestNy;
        }
        drawLineMask(bridged, w, h, sx, sy, cx, cy, 2);
      }
    }
    return { mask: out, bridged: bridged, area: totalArea, count: cc.count, merged: mergedCount };
  };

  /* 孔洞填充：从边界漫水填充"背景"(bin==0)，未被到达的背景即为孔洞 */
  CV.fillHoles = function (bin, w, h) {
    var reach = CV.reachFromBorder(bin, w, h);
    var out = new Uint8Array(w * h);
    for (var j = 0; j < w * h; j++) out[j] = (bin[j] || !reach[j]) ? 1 : 0;
    return out;
  };

  /* ---------- 5. 轮廓跟踪（Marching Squares + 段连接） ---------- */
  CV.contours = function (bin, w, h) {
    var segs = [], map = {};
    function key(t, x, y) { return t + x + ',' + y; }
    function add(t1, x1, y1, t2, x2, y2) {
      var k1 = key(t1, x1, y1), k2 = key(t2, x2, y2);
      var s = { a: k1, b: k2, pa: [x1, y1], pb: [x2, y2], used: false };
      segs.push(s);
      (map[k1] || (map[k1] = [])).push(s);
      (map[k2] || (map[k2] = [])).push(s);
    }
    for (var y = 0; y < h - 1; y++) {
      for (var x = 0; x < w - 1; x++) {
        var a = bin[y * w + x], b = bin[y * w + x + 1], c = bin[(y + 1) * w + x + 1], d = bin[(y + 1) * w + x];
        var idx = a | (b << 1) | (c << 2) | (d << 3);
        if (idx === 0 || idx === 15) continue;
        switch (idx) {
          case 1: case 14: add('v', x, y, 'h', x, y); break;
          case 2: case 13: add('h', x, y, 'v', x + 1, y); break;
          case 3: case 12: add('v', x, y, 'v', x + 1, y); break;
          case 4: case 11: add('h', x, y, 'v', x + 1, y); break;
          case 6: case 9: add('h', x, y, 'h', x, y + 1); break;
          case 7: case 8: add('v', x, y, 'h', x, y + 1); break;
          case 5: add('v', x, y, 'h', x, y); add('h', x, y, 'v', x + 1, y); break;
          case 10: add('h', x, y, 'v', x + 1, y); add('v', x, y, 'h', x, y + 1); break;
        }
      }
    }
    var polys = [];
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].used) continue;
      var pts = [], s = segs[i], startKey = s.a, cur = s, from = s.a;
      var guard = 0;
      while (cur && guard++ < 200000) {
        cur.used = true;
        pts.push(cur.a === from ? cur.pa : cur.pb);
        var nk = cur.a === from ? cur.b : cur.a;
        if (nk === startKey) break;
        var cand = map[nk] || [];
        var next = null;
        for (var k = 0; k < cand.length; k++) if (!cand[k].used) { next = cand[k]; break; }
        from = nk; cur = next;
      }
      if (pts.length > 6) polys.push(pts);
    }
    polys.sort(function (p, q) { return q.length - p.length; });
    return polys;
  };

  CV.simplify = function (pts, eps) {
    if (pts.length < 3) return pts;
    function dist(p, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var t = dx === 0 && dy === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
      var px = a[0] + t * dx - p[0], py = a[1] + t * dy - p[1];
      return Math.sqrt(px * px + py * py);
    }
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var rg = stack.pop(), i0 = rg[0], i1 = rg[1];
      var maxD = -1, mi = -1;
      for (var i = i0 + 1; i < i1; i++) {
        var d = dist(pts[i], pts[i0], pts[i1]);
        if (d > maxD) { maxD = d; mi = i; }
      }
      if (maxD > eps && mi > 0) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
    }
    var out = [];
    for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
    return out;
  };

  /* ---------- 6. Zhang-Suen 细化 + 毛刺修剪 ---------- */
  CV.thin = function (bin, w, h) {
    var img = Uint8Array.from(bin);
    var changed = true, guard = 0;
    while (changed && guard++ < 60) {
      changed = false;
      for (var step = 0; step < 2; step++) {
        var rem = [];
        for (var y = 1; y < h - 1; y++) {
          for (var x = 1; x < w - 1; x++) {
            var i = y * w + x; if (!img[i]) continue;
            var p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1],
              p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
            var A = (p2 === 0 && p3 === 1) + (p3 === 0 && p4 === 1) + (p4 === 0 && p5 === 1) + (p5 === 0 && p6 === 1) +
              (p6 === 0 && p7 === 1) + (p7 === 0 && p8 === 1) + (p8 === 0 && p9 === 1) + (p9 === 0 && p2 === 1);
            var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            var m1 = step === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
            var m2 = step === 0 ? p4 * p6 * p8 : p2 * p6 * p8;
            if (B >= 2 && B <= 6 && A === 1 && m1 === 0 && m2 === 0) rem.push(i);
          }
        }
        if (rem.length) { changed = true; for (var k = 0; k < rem.length; k++) img[rem[k]] = 0; }
      }
    }
    return img;
  };

  CV.prune = function (sk, w, h, iters) {
    var img = Uint8Array.from(sk);
    for (var t = 0; t < iters; t++) {
      var rem = [];
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          var i = y * w + x; if (!img[i]) continue;
          var n = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue; n += img[i + dy * w + dx];
          }
          if (n <= 1) rem.push(i);
        }
      }
      if (!rem.length) break;
      for (var k = 0; k < rem.length; k++) img[rem[k]] = 0;
    }
    return img;
  };

  CV.skeletonEndpoints = function (sk, w, h) {
    var out = [];
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x; if (!sk[i]) continue;
        var n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; n += img[i + dy * w + dx]; // wait: fix bug below -> sk[...]
        }
      }
    }
    return out;
  };
  // Correct implementation using sk:
  CV.skeletonEndpoints = function (sk, w, h) {
    var out = [];
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x; if (!sk[i]) continue;
        var n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; n += sk[i + dy * w + dx];
        }
        if (n <= 1) out.push({ x: x, y: y, i: i });
      }
    }
    return out;
  };

  /* ---------- 7. 倒角距离变换 ---------- */
  CV.distanceTransform = function (bin, w, h) {
    var INF = 1e9, d = new Float32Array(w * h), i, x, y, v;
    for (i = 0; i < w * h; i++) d[i] = bin[i] ? INF : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) v = Math.min(v, d[i - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + 1.414);
      d[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x; v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) v = Math.min(v, d[i + w] + 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + 1.414);
      d[i] = v;
    }
    return d;
  };

  CV.distanceInside = function (mask, w, h) {
    var fg = new Uint8Array(w * h), i;
    for (i = 0; i < w * h; i++) fg[i] = mask[i] ? 1 : 0;
    var d = CV.distanceTransform(fg, w, h);
    for (i = 0; i < w * h; i++) if (!mask[i]) d[i] = 0;
    return d;
  };

  /* ---------- 8. PCA ---------- */
  CV.pca = function (pts) {
    var n = pts.length; if (!n) return { mean: [0, 0], axis: [1, 0], perp: [0, 1], len: 0 };
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= n; my /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) {
      var dx = pts[i][0] - mx, dy = pts[i][1] - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ax = Math.cos(theta), ay = Math.sin(theta);
    var l1 = sxx * ax * ax + 2 * sxy * ax * ay + syy * ay * ay;
    var l2 = sxx + syy - l1;
    if (l2 > l1) { ax = -ay; ay = Math.cos(theta); }
    return { mean: [mx, my], axis: [ax, ay], perp: [-ay, ax], len: 2 * Math.sqrt(Math.max(l1, l2)) };
  };

  CV.maskToRGBA = function (bin, w, h, rgb, alpha) {
    var out = new Uint8ClampedArray(w * h * 4);
    for (var i = 0; i < w * h; i++) {
      if (bin[i]) { out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = alpha; }
    }
    return out;
  };

  global.CV = CV;
})(window);
