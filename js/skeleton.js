/* =============================================================
 * skeleton.js —— 关键点检测与骨骼绑定（V0.7 增强版）
 * 支持三种拓扑模板：
 *   - humanoid：直立人形/拟人角色
 *   - quadruped：水平四足动物（狗、恐龙、猫等）
 *   - prop：对称飞行器/器物角色（小火箭、飞船等）
 * 支持传入 bridgedMask 供骨架图连通分离手臂/部件。
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Rig = SBM.Rig = {};

  var HUMANOID_BONES = [
    { name: 'torso', a: 'hip', b: 'neck', parent: null },
    { name: 'head', a: 'neck', b: 'head', parent: 'torso' },
    { name: 'l_upper_arm', a: 'lshoulder', b: 'lelbow', parent: 'torso' },
    { name: 'l_lower_arm', a: 'lelbow', b: 'lhand', parent: 'l_upper_arm' },
    { name: 'r_upper_arm', a: 'rshoulder', b: 'relbow', parent: 'torso' },
    { name: 'r_lower_arm', a: 'relbow', b: 'rhand', parent: 'r_upper_arm' },
    { name: 'l_upper_leg', a: 'lhip', b: 'lknee', parent: null },
    { name: 'l_lower_leg', a: 'lknee', b: 'lfoot', parent: 'l_upper_leg' },
    { name: 'r_upper_leg', a: 'rhip', b: 'rknee', parent: null },
    { name: 'r_lower_leg', a: 'rknee', b: 'rfoot', parent: 'r_upper_leg' },
    { name: 'tail', a: 'hip', b: 'tail1', parent: 'torso' }
  ];
  var QUAD_BONES = [
    { name: 'torso', a: 'hip', b: 'neck', parent: null },
    { name: 'head', a: 'neck', b: 'head', parent: 'torso' },
    { name: 'l_upper_arm', a: 'lshoulder', b: 'lelbow', parent: 'torso' },
    { name: 'l_lower_arm', a: 'lelbow', b: 'lhand', parent: 'l_upper_arm' },
    { name: 'r_upper_arm', a: 'rshoulder', b: 'relbow', parent: 'torso' },
    { name: 'r_lower_arm', a: 'relbow', b: 'rhand', parent: 'r_upper_arm' },
    { name: 'l_upper_leg', a: 'lhip', b: 'lknee', parent: null },
    { name: 'l_lower_leg', a: 'lknee', b: 'lfoot', parent: 'l_upper_leg' },
    { name: 'r_upper_leg', a: 'rhip', b: 'rknee', parent: null },
    { name: 'r_lower_leg', a: 'rknee', b: 'rfoot', parent: 'r_upper_leg' },
    { name: 'tail', a: 'hip', b: 'tail1', parent: 'torso' }
  ];
  /* 飞行器/器物模板：保持必需关节命名兼容，全部侧翼与喷口挂接在刚性主轴 torso 上，避免像人腿一样劈叉 */
  var PROP_BONES = [
    { name: 'torso', a: 'hip', b: 'neck', parent: null },
    { name: 'head', a: 'neck', b: 'head', parent: 'torso' },
    { name: 'l_upper_arm', a: 'lshoulder', b: 'lhand', parent: 'torso' },
    { name: 'r_upper_arm', a: 'rshoulder', b: 'rhand', parent: 'torso' },
    { name: 'l_upper_leg', a: 'lhip', b: 'lfoot', parent: 'torso' },
    { name: 'r_upper_leg', a: 'rhip', b: 'rfoot', parent: 'torso' },
    { name: 'tail', a: 'hip', b: 'tail1', parent: 'torso' }
  ];

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l]; }
  function rot90(a) { return [-a[1], a[0]]; }
  function clampPt(p, w, h) { return [Math.max(1, Math.min(w - 2, p[0])), Math.max(1, Math.min(h - 2, p[1]))]; }

  function snapToMask(filled, w, h, p, R) {
    var x0 = Math.round(p[0]), y0 = Math.round(p[1]);
    if (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h && filled[y0 * w + x0]) return p;
    var best = null, bd = R * R;
    for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
      var x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (!filled[y * w + x]) continue;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best || p;
  }

  function boneAngle(a, b) {
    var d = sub(b, a);
    return Math.atan2(d[0], -d[1]) * 180 / Math.PI;
  }

  function buildGraph(sk, w, h) {
    var idx = new Int32Array(w * h).fill(-1), pts = [], x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (sk[y * w + x]) { idx[y * w + x] = pts.length; pts.push([x, y]); }
    var n = pts.length, adj = new Array(n);
    for (i = 0; i < n; i++) adj[i] = [];
    for (i = 0; i < n; i++) {
      x = pts[i][0]; y = pts[i][1];
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var j = idx[ny * w + nx];
        if (j >= 0) adj[i].push(j);
      }
    }
    return { idx: idx, pts: pts, adj: adj };
  }

  function nearestNode(g, p, w, maxR) {
    var best = -1, bd = maxR * maxR;
    var h = (g.idx.length / Math.max(1, w)) | 0;
    for (var r = 0; r <= maxR; r++) {
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        var x = Math.round(p[0]) + dx, y = Math.round(p[1]) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        var i = g.idx[y * w + x];
        if (i >= 0) {
          var d = (x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]);
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return best;
  }

  function bfsPath(g, s, t) {
    if (s < 0 || t < 0) return null;
    var n = g.pts.length, prev = new Int32Array(n).fill(-2), q = new Int32Array(n), head = 0, tail = 0;
    prev[s] = -1; q[tail++] = s;
    while (head < tail) {
      var u = q[head++];
      if (u === t) break;
      var nb = g.adj[u];
      for (var k = 0; k < nb.length; k++) if (prev[nb[k]] === -2) { prev[nb[k]] = u; q[tail++] = nb[k]; }
    }
    if (prev[t] === -2) return null;
    var path = [], c = t;
    while (c >= 0) { path.push(g.pts[c]); c = prev[c]; }
    path.reverse();
    return path;
  }

  function bendPoint(path, from, to) {
    var chord = sub(to, from), L = len(chord);
    if (L < 1 || !path || path.length < 3) return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    var u = norm(chord), best = null, bd = 0;
    var acc = 0, accs = [0];
    for (var i = 1; i < path.length; i++) { acc += len(sub(path[i], path[i - 1])); accs.push(acc); }
    for (var j = 0; j < path.length; j++) {
      var v = sub(path[j], from), t = dot(v, u);
      if (t < L * 0.2 || t > L * 0.85) continue;
      var d = Math.abs(v[0] * u[1] - v[1] * u[0]) * (1 - 2 * Math.abs(t / L - 0.5));
      if (d > bd) { bd = d; best = path[j]; }
    }
    if (best && bd > L * 0.035) return best;
    var half = acc / 2, k = 0;
    while (k < accs.length && accs[k] < half) k++;
    return path[Math.min(k, path.length - 1)];
  }

  function cornerPoint(path, from, to, tMin, tMax) {
    var chord = sub(to, from), L = len(chord);
    if (L < 2 || !path || path.length < 3) return null;
    var u = norm(chord), best = null, bd = 0;
    for (var j = 0; j < path.length; j++) {
      var v = sub(path[j], from), t = dot(v, u) / L;
      if (t < tMin || t > tMax) continue;
      var d = Math.abs(v[0] * u[1] - v[1] * u[0]);
      if (d > bd) { bd = d; best = path[j]; }
    }
    return bd > Math.max(3, L * 0.05) ? best : null;
  }

  /* 检测是否为竖直锥形/火箭类对称物体（上部尖窄、中下部带对称侧翼、底部实心不劈叉） */
  function detectRocketLike(filled, bb, w, h, kindHint) {
    if (kindHint && /火箭|飞船|飞机|汽车/.test(kindHint)) return true;
    if (bb.h < bb.w * 1.08) return false;
    function rowSpan(y) {
      var lx = w, rx = -1, cnt = 0;
      for (var x = bb.x0; x <= bb.x1; x++) {
        if (filled[y * w + x]) { cnt++; if (x < lx) lx = x; if (x > rx) rx = x; }
      }
      return rx >= lx ? { span: rx - lx + 1, fill: cnt / Math.max(1, rx - lx + 1), mid: (lx + rx) / 2 } : { span: 0, fill: 0, mid: bb.x0 + bb.w / 2 };
    }
    var rTop = rowSpan(Math.min(h - 1, Math.round(bb.y0 + bb.h * 0.12)));
    var rMid = rowSpan(Math.min(h - 1, Math.round(bb.y0 + bb.h * 0.48)));
    var rFin = rowSpan(Math.min(h - 1, Math.round(bb.y0 + bb.h * 0.72)));
    var rBot = rowSpan(Math.min(h - 1, Math.round(bb.y0 + bb.h * 0.88)));
    var cx = bb.x0 + bb.w / 2;
    var sym = Math.abs(rMid.mid - cx) < bb.w * 0.08 && Math.abs(rFin.mid - cx) < bb.w * 0.08;
    // 顶部显著窄于中部（锥形整流罩），翼展处最宽，且中部接近完全实心（无双腿分叉中缝）
    return sym && rTop.span > 0 && rTop.span < rMid.span * 0.62 && rFin.span > rMid.span * 1.18 && rMid.fill > 0.90 && rBot.fill > 0.55;
  }

  Rig.estimate = function (mask, w, h, opts) {
    opts = opts || {};
    var filled = CV.fillHoles(mask, w, h);
    var skSource = opts.bridgedMask ? CV.fillHoles(opts.bridgedMask, w, h) : filled;
    var bb = CV.bbox(filled, w, h);
    if (bb.area < 60) return Rig.fallback(w, h, 'humanoid');

    var dt = CV.distanceInside(filled, w, h);
    var pts = [], step = Math.max(1, Math.floor(Math.sqrt(bb.area / 2500)));
    for (var y = bb.y0; y <= bb.y1; y += step) for (var x = bb.x0; x <= bb.x1; x += step) {
      if (filled[y * w + x]) pts.push([x, y]);
    }
    var pca = CV.pca(pts);
    var ax = pca.axis, mean = pca.mean;
    var tmin = Infinity, tmax = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var t = dot(sub(pts[i], mean), ax);
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
    }
    var L = Math.max(8, tmax - tmin);

    var tmid = (tmax + tmin) / 2, halfL = Math.max(1, L / 2);
    function peakIn(sign) {
      var best = -1, bp = null, bv = 3;
      for (var yy = bb.y0; yy <= bb.y1; yy++) for (var xx = bb.x0; xx <= bb.x1; xx++) {
        var id = yy * w + xx;
        if (!filled[id]) continue;
        var t2 = dot(sub([xx, yy], mean), ax);
        var ok = sign > 0 ? (t2 > tmax - 0.30 * L) : (t2 < tmin + 0.30 * L);
        if (!ok) continue;
        var ext = Math.min(1, Math.abs(t2 - tmid) / halfL);
        var score = dt[id] * (0.35 + 0.65 * ext);
        if (score > best) { best = score; bp = [xx, yy]; bv = dt[id]; }
      }
      return { v: best, p: bp, r: bv };
    }
    var pA = peakIn(1), pB = peakIn(-1);
    var useA = pA.v >= pB.v;
    if (opts.flip) useA = !useA;
    var headC = (useA ? pA.p : pB.p) || [mean[0], mean[1]];
    var headR = Math.max(3, useA ? pA.r : pB.r);

    var up = useA ? [ax[0], ax[1]] : [-ax[0], -ax[1]];
    var down = mul(up, -1);
    var side = rot90(up);
    var gp = sub([0, 1], mul(up, dot([0, 1], up)));
    var gravity = len(gp) > 0.2 ? norm(gp) : [0, 1];
    var horizontal = Math.abs(up[0]) > Math.abs(up[1]) * 1.15;
    var aspect = bb.w / Math.max(1, bb.h);
    var tpl = opts.template || 'auto';
    var template;
    if (tpl === 'auto') {
      if (detectRocketLike(filled, bb, w, h, opts.kind)) template = 'prop';
      else template = (horizontal && aspect >= 1.0) ? 'quadruped' : 'humanoid';
    } else {
      template = tpl;
    }

    // 若判为飞行器且未手工翻转，确保机头朝向画面上方（y 更小的一端）
    if (template === 'prop' && !opts.flip && up[1] > 0) {
      up = mul(up, -1); down = mul(down, -1); side = rot90(up);
      headC = [bb.x0 + bb.w / 2, bb.y0 + bb.h * 0.14];
    }

    var sk = CV.prune(CV.thin(skSource, w, h), w, h, Math.max(4, Math.round(L * 0.03)));
    var g = buildGraph(sk, w, h);
    var ends = CV.skeletonEndpoints(sk, w, h);

    var rig = {
      template: template, w: w, h: h, headR: headR, height: L,
      up: up, down: down, side: side, gravity: gravity,
      bbox: bb, skeleton: sk, dt: dt, filled: filled,
      joints: {}, bones: [], meta: { headPeak: headR, len: L, aspect: aspect }
    };

    if (template === 'quadruped') {
      rig.joints = buildQuadruped(rig, headC, headR, L, up, gravity, side, ends, g, w, h, filled);
    } else if (template === 'prop') {
      rig.joints = buildProp(rig, bb, w, h, filled, opts.flip);
    } else {
      rig.joints = buildHumanoid(rig, headC, headR, L, up, down, side, ends, g, w, h, skSource);
    }
    var J = rig.joints;
    if (!J.head) J.head = headC.slice();

    var boneDefs = template === 'quadruped' ? QUAD_BONES : (template === 'prop' ? PROP_BONES : HUMANOID_BONES);
    rig.bones = boneDefs.map(function (b) {
      return { name: b.name, a: b.a, b: b.b, parent: b.parent };
    });
    rig.bones = rig.bones.filter(function (b) { return b.name !== 'tail' || (J[b.a] && J[b.b]); });
    Rig.refresh(rig);
    return rig;
  };

  function halfWidth(filled, w, h, center, axis, band) {
    var mx = 0, side = rot90(axis);
    var cy = Math.round(center[1]), cx = Math.round(center[0]);
    var R = Math.max(6, Math.round(band));
    for (var y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++) {
      for (var x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
        if (!filled[y * w + x]) continue;
        var d = Math.abs((x - center[0]) * side[0] + (y - center[1]) * side[1]);
        if (d > mx) mx = d;
      }
    }
    return mx;
  }

  function buildHumanoid(rig, headC, headR, L, up, down, side, ends, g, w, h, filled) {
    var J = {};
    J.head = headC.slice();
    J.neck = clampPt(add(headC, mul(down, headR * 1.15)), w, h);
    J.hip = clampPt(add(J.neck, mul(down, L * 0.40)), w, h);

    var hwN = Math.max(halfWidth(filled, w, h, J.neck, up, L * 0.10), headR * 0.75);
    var hwH = Math.max(halfWidth(filled, w, h, J.hip, up, L * 0.10), headR * 0.6) * 0.55;
    J.lshoulder = clampPt(sub(J.neck, mul(side, hwN * 0.9)), w, h);
    J.rshoulder = clampPt(add(J.neck, mul(side, hwN * 0.9)), w, h);
    J.lhip = clampPt(sub(J.hip, mul(side, hwH)), w, h);
    J.rhip = clampPt(add(J.hip, mul(side, hwH)), w, h);

    var hipT = dot(J.hip, up);
    function pickEnd(root, sign, above) {
      var best = null, bd = 0;
      for (var k = 0; k < ends.length; k++) {
        var p = [ends[k].x, ends[k].y];
        var st = dot(sub(p, J.hip), side);
        if (sign * st < L * 0.04) continue;
        var t = dot(p, up);
        if (above ? (t < hipT - L * 0.06) : (t > hipT - L * 0.02)) continue;
        var d = len(sub(p, root));
        if (d > bd) { bd = d; best = p; }
      }
      return bd > L * 0.12 ? best : null;
    }

    function makeLimb(rootName, midName, tipName, anchor, sign, above, defaultDir, rootHint) {
      var tip = pickEnd(anchor, sign, above);
      var root = rootHint, mid = null;
      if (tip) {
        var s = nearestNode(g, anchor, w, Math.round(L * 0.18) + 12);
        var e = nearestNode(g, tip, w, 18);
        var path = bfsPath(g, s, e);
        if (path) {
          var corner = cornerPoint(path, anchor, tip, 0.05, 0.5);
          if (corner) root = corner;
          mid = bendPoint(path, root, tip);
        }
      }
      if (!tip || !mid) {
        var d1 = add(root, add(mul(defaultDir, L * 0.20), mul(side, sign * L * 0.05)));
        var d2 = add(d1, add(mul(defaultDir, L * 0.18), mul(side, sign * L * 0.03)));
        mid = mid || d1; tip = tip || d2;
      }
      J[rootName] = clampPt(snapToMask(filled, w, h, root, 10), w, h);
      J[midName] = clampPt(snapToMask(filled, w, h, mid, 12), w, h);
      J[tipName] = clampPt(snapToMask(filled, w, h, tip, 12), w, h);
    }

    makeLimb('lshoulder', 'lelbow', 'lhand', J.neck, -1, true, down, J.lshoulder);
    makeLimb('rshoulder', 'relbow', 'rhand', J.neck, 1, true, down, J.rshoulder);
    makeLimb('lhip', 'lknee', 'lfoot', J.hip, -1, false, down, J.lhip);
    makeLimb('rhip', 'rknee', 'rfoot', J.hip, 1, false, down, J.rhip);
    return J;
  }

  function buildQuadruped(rig, headC, headR, L, up, gravity, side, ends, g, w, h, filled) {
    var J = {}, back = mul(up, -1);
    var dIn = rig.dt;
    J.head = headC.slice();
    J.neck = clampPt(add(headC, mul(back, headR * 1.05)), w, h);
    J.hip = clampPt(add(headC, mul(back, L * 0.62)), w, h);

    function halfThick(p) {
      var x = Math.round(p[0]), y = Math.round(p[1]);
      if (x < 0 || y < 0 || x >= w || y >= h) return 8;
      return Math.max(6, dIn[y * w + x] || 8);
    }
    function belly(root) { return clampPt(add(root, mul(gravity, halfThick(root) * 0.94)), w, h); }

    function legDown(root) {
      var maxT = 0, limit = Math.round(L * 1.6);
      for (var t = 1; t <= limit; t++) {
        var p = add(root, mul(gravity, t));
        var x = Math.round(p[0]), y = Math.round(p[1]);
        if (x < 0 || y < 0 || x >= w || y >= h) break;
        if (filled[y * w + x]) maxT = t; else if (t > maxT + 8) break;
      }
      return maxT;
    }

    J.rshoulder = belly(add(J.neck, mul(back, L * 0.04)));
    J.lshoulder = belly(add(J.neck, mul(back, L * 0.14)));
    J.rhip = belly(add(J.hip, mul(back, -L * 0.05)));
    J.lhip = belly(add(J.hip, mul(back, L * 0.05)));

    function leg(root, midName, tipName) {
      var l = legDown(root);
      if (l < L * 0.10) l = L * 0.22;
      l = Math.min(l, L * 0.95);
      J[midName] = clampPt(snapToMask(filled, w, h, add(root, mul(gravity, l * 0.5)), 12), w, h);
      J[tipName] = clampPt(snapToMask(filled, w, h, add(root, mul(gravity, l * 0.97)), 14), w, h);
    }
    leg(J.lshoulder, 'lelbow', 'lhand');
    leg(J.rshoulder, 'relbow', 'rhand');
    leg(J.lhip, 'lknee', 'lfoot');
    leg(J.rhip, 'rknee', 'rfoot');

    var tailTip = null, bd = 0;
    for (var k = 0; k < ends.length; k++) {
      var p = [ends[k].x, ends[k].y];
      var t = dot(sub(p, J.hip), back);
      if (t < L * 0.08) continue;
      var d = len(sub(p, J.hip));
      if (d > bd) { bd = d; tailTip = p; }
    }
    if (tailTip && bd > L * 0.10) {
      J.tail1 = clampPt(add(J.hip, mul(norm(sub(tailTip, J.hip)), bd * 0.55)), w, h);
      J.tail2 = clampPt(tailTip, w, h);
    }
    return J;
  }

  /* 飞行器/对称器物骨架：机身主轴刚性连贯，侧翼小幅摆动，底部尾焰摆尾 */
  function buildProp(rig, bb, w, h, filled, flip) {
    var cx = bb.x0 + bb.w / 2;
    var topY = flip ? bb.y1 - bb.h * 0.08 : bb.y0 + bb.h * 0.08;
    var neckY = flip ? bb.y1 - bb.h * 0.30 : bb.y0 + bb.h * 0.30;
    var hipY = flip ? bb.y1 - bb.h * 0.68 : bb.y0 + bb.h * 0.68;
    var finY = flip ? bb.y1 - bb.h * 0.76 : bb.y0 + bb.h * 0.76;
    var botY = flip ? bb.y0 + bb.h * 0.05 : bb.y1 - bb.h * 0.05;
    var J = {
      head: clampPt(snapToMask(filled, w, h, [cx, topY], 16), w, h),
      neck: clampPt(snapToMask(filled, w, h, [cx, neckY], 16), w, h),
      hip: clampPt(snapToMask(filled, w, h, [cx, hipY], 16), w, h),
      lshoulder: clampPt(snapToMask(filled, w, h, [cx - bb.w * 0.18, hipY - (flip ? -1 : 1) * bb.h * 0.06], 16), w, h),
      rshoulder: clampPt(snapToMask(filled, w, h, [cx + bb.w * 0.18, hipY - (flip ? -1 : 1) * bb.h * 0.06], 16), w, h),
      lhand: clampPt(snapToMask(filled, w, h, [bb.x0 + bb.w * 0.08, finY], 18), w, h),
      rhand: clampPt(snapToMask(filled, w, h, [bb.x1 - bb.w * 0.08, finY], 18), w, h),
      lhip: clampPt(snapToMask(filled, w, h, [cx - bb.w * 0.10, hipY], 14), w, h),
      rhip: clampPt(snapToMask(filled, w, h, [cx + bb.w * 0.10, hipY], 14), w, h),
      lfoot: clampPt(snapToMask(filled, w, h, [cx - bb.w * 0.12, botY], 18), w, h),
      rfoot: clampPt(snapToMask(filled, w, h, [cx + bb.w * 0.12, botY], 18), w, h),
      tail1: clampPt(snapToMask(filled, w, h, [cx, botY], 18), w, h)
    };
    return J;
  }

  Rig.fallback = function (w, h, template) {
    var cx = w / 2, H = h * 0.9;
    var J = {
      head: [cx, h * 0.10], neck: [cx, h * 0.26], hip: [cx, h * 0.56],
      lshoulder: [cx - H * 0.09, h * 0.28], rshoulder: [cx + H * 0.09, h * 0.28],
      lelbow: [cx - H * 0.16, h * 0.42], lhand: [cx - H * 0.19, h * 0.55],
      relbow: [cx + H * 0.16, h * 0.42], rhand: [cx + H * 0.19, h * 0.55],
      lhip: [cx - H * 0.06, h * 0.58], rhip: [cx + H * 0.06, h * 0.58],
      lknee: [cx - H * 0.08, h * 0.76], lfoot: [cx - H * 0.09, h * 0.94],
      rknee: [cx + H * 0.08, h * 0.76], rfoot: [cx + H * 0.09, h * 0.94]
    };
    var rig = {
      template: template || 'humanoid', w: w, h: h, headR: h * 0.09, height: H,
      up: [0, -1], down: [0, 1], side: [1, 0], gravity: [0, 1],
      joints: J, bones: [], meta: { fallback: true }
    };
    var defs = template === 'quadruped' ? QUAD_BONES : (template === 'prop' ? PROP_BONES : HUMANOID_BONES);
    rig.bones = defs.map(function (b) {
      return { name: b.name, a: b.a, b: b.b, parent: b.parent };
    }).filter(function (b) { return b.name !== 'tail'; });
    Rig.refresh(rig);
    return rig;
  };

  Rig.refresh = function (rig) {
    for (var i = 0; i < rig.bones.length; i++) {
      var b = rig.bones[i], A = rig.joints[b.a], B = rig.joints[b.b];
      if (!A || !B) { b.len = 0; b.restAngle = 0; continue; }
      b.len = len(sub(B, A));
      b.restAngle = boneAngle(A, B);
    }
    var J = rig.joints, ys = [], xs = [];
    ['head', 'lfoot', 'rfoot', 'lhand', 'rhand', 'hip', 'neck', 'tail1'].forEach(function (k) {
      if (J[k]) { ys.push(J[k][1]); xs.push(J[k][0]); }
    });
    rig.bboxJ = {
      x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
      y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys)
    };
    var spanJ = rig.bboxJ.y1 - rig.bboxJ.y0;
    rig.charHeight = Math.max(20, spanJ > rig.h * 0.28 ? spanJ : rig.h * 0.8);
    return rig;
  };

  Rig.boneAngle = boneAngle;
  Rig.util = { sub: sub, add: add, mul: mul, dot: dot, len: len, norm: norm, rot90: rot90 };
})(window);
