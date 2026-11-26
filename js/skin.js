/* Continuous source mesh forward LBS. Shared vertices, one affine texture map per
 * triangle, premultiplied alpha. Limb Gaussian radius clamped against thick torsos. */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {}),
    Skin = (SBM.Skin = {});
  function mul2(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }
  function rotAbout(p, d) {
    var r = (d * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r);
    return [c, s, -s, c, p[0] - c * p[0] + s * p[1], p[1] - s * p[0] - c * p[1]];
  }
  function inv(m) {
    var d = m[0] * m[3] - m[1] * m[2],
      v = 1 / (d || 1e-6);
    return [
      m[3] * v,
      -m[1] * v,
      -m[2] * v,
      m[0] * v,
      (m[2] * m[5] - m[3] * m[4]) * v,
      (m[1] * m[4] - m[0] * m[5]) * v,
    ];
  }
  function boneSegments(mask, w, h, rig, bones) {
    var inside = CV.distanceInside(mask, w, h);
    return bones.map(function (b) {
      var A = rig.joints[b.a],
        B = rig.joints[b.b],
        dx = B[0] - A[0],
        dy = B[1] - A[1],
        l2 = Math.max(1, dx * dx + dy * dy),
        len = Math.sqrt(l2);
      function thickAt(x, y) {
        var xi = Math.round(x),
          yi = Math.round(y),
          v;
        if (xi >= 0 && yi >= 0 && xi < w && yi < h && (v = inside[yi * w + xi]) > 0) return v;
        for (var r = 1; r <= 7; r++) {
          var best = 0;
          for (var yy = -r; yy <= r; yy++)
            for (var xx = -r; xx <= r; xx++) {
              if (Math.abs(xx) !== r && Math.abs(yy) !== r) continue;
              var nx = xi + xx,
                ny = yi + yy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h) best = Math.max(best, inside[ny * w + nx]);
            }
          if (best > 0) return best;
        }
        return 0;
      }
      var isCore = b.name === 'torso' || b.name === 'head';
      var startStep = isCore ? 0 : 3;
      var samples = [];
      for (var i = startStep; i <= 10; i++) {
        var t = thickAt(A[0] + (dx * i) / 10, A[1] + (dy * i) / 10);
        if (t > 0) samples.push(t);
      }
      samples.sort(function (x, y) { return x - y; });
      var medThick = samples.length ? samples[Math.floor(samples.length * 0.5)] : 0;
      // 对四肢骨骼限制最大高斯影响半径，防止四足动物粗躯干被短腿骨骼拽变形
      var rawSig = Math.max(6, medThick * 1.15, len * 0.32);
      var maxLimbSig = isCore ? Math.max(w, h) : Math.max(14, len * 0.62);
      return {
        ax: A[0],
        ay: A[1],
        dx: dx,
        dy: dy,
        l2: l2,
        sig: Math.min(rawSig, maxLimbSig),
      };
    });
  }
  function weightsAt(segs, x, y, out, offset) {
    var sum = 0,
      nearest = 0,
      best = Infinity;
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k],
        vx = x - s.ax,
        vy = y - s.ay,
        t = Math.max(0, Math.min(1, (vx * s.dx + vy * s.dy) / s.l2));
      var px = vx - s.dx * t,
        py = vy - s.dy * t,
        dd = px * px + py * py;
      if (dd < best) {
        best = dd;
        nearest = k;
      }
      var q = dd / (s.sig * s.sig),
        v = q > 12 ? 0 : Math.exp(-q);
      out[offset + k] = v;
      sum += v;
    }
    if (sum > 1e-20) {
      for (var i = 0; i < segs.length; i++) out[offset + i] /= sum;
    } else if (segs.length) out[offset + nearest] = 1;
  }
  function buildMesh(alpha, w, h, segs) {
    var step = Math.min(w, h) < 40 ? 3 : 6,
      nx = Math.ceil(w / step),
      ny = Math.ceil(h / step),
      columns = nx + 1,
      count = columns * (ny + 1);
    var xy = new Float64Array(count * 2),
      weights = new Float32Array(count * segs.length),
      used = new Uint8Array(count),
      triangles = [];
    var stride = w + 1,
      integral = new Uint32Array(stride * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) {
        row += alpha[y * w + x] > 0 ? 1 : 0;
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
      }
    }
    for (var gy = 0; gy <= ny; gy++)
      for (var gx = 0; gx <= nx; gx++) {
        var id = gy * columns + gx,
          sx = Math.min(w, gx * step),
          sy = Math.min(h, gy * step);
        xy[id * 2] = sx;
        xy[id * 2 + 1] = sy;
        weightsAt(segs, sx, sy, weights, id * segs.length);
      }
    for (var cy = 0; cy < ny; cy++)
      for (var cx = 0; cx < nx; cx++) {
        var x0 = Math.max(0, cx * step - 1),
          y0 = Math.max(0, cy * step - 1),
          x1 = Math.min(w, (cx + 1) * step + 1),
          y1 = Math.min(h, (cy + 1) * step + 1);
        if (
          !(
            integral[y1 * stride + x1] -
            integral[y0 * stride + x1] -
            integral[y1 * stride + x0] +
            integral[y0 * stride + x0]
          )
        )
          continue;
        var a = cy * columns + cx,
          b = a + 1,
          d = a + columns,
          c = d + 1;
        triangles.push(a, b, c, a, c, d);
        used[a] = used[b] = used[c] = used[d] = 1;
      }
    var active = [];
    for (var v = 0; v < count; v++) if (used[v]) active.push(v);
    return {
      xy: xy,
      weights: weights,
      triangles: new Uint32Array(triangles),
      active: new Uint32Array(active),
      deformed: new Float64Array(xy.length),
      step: step,
    };
  }
  Skin.build = function (tex, mask, w, h, rig) {
    if (!(w > 0 && h > 0) || tex.length < w * h * 4 || mask.length < w * h)
      throw new Error('蒙皮纹理或掩码尺寸不匹配');
    var bones = rig.bones
        .filter(function (b) {
          return rig.joints[b.a] && rig.joints[b.b];
        })
        .slice(),
      inverse = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) inverse[i] = mask[i] ? 0 : 1;
    var distance = CV.distanceTransform(inverse, w, h),
      alpha = new Float32Array(w * h),
      premul = new Float32Array(w * h * 4);
    for (var p = 0; p < w * h; p++) {
      var edge = mask[p] ? 1 : Math.max(0, 1 - distance[p] * 0.55),
        a = (edge * tex[p * 4 + 3]) / 255;
      alpha[p] = a;
      premul[p * 4] = tex[p * 4] * a;
      premul[p * 4 + 1] = tex[p * 4 + 1] * a;
      premul[p * 4 + 2] = tex[p * 4 + 2] * a;
      premul[p * 4 + 3] = a * 255;
    }
    var segs = boneSegments(mask, w, h, rig, bones);
    return {
      w: w,
      h: h,
      n: bones.length,
      bones: bones,
      segs: segs,
      tex: tex,
      mask: mask,
      alpha: alpha,
      premul: premul,
      bbox: CV.bbox(alpha, w, h),
      rig: rig,
      mesh: buildMesh(alpha, w, h, segs),
      canvas: null,
      ctx: null,
      _id: null,
    };
  };
  Skin.matrices = function (sk, pose) {
    pose = pose || {};
    var bones = sk.bones,
      n = bones.length,
      hip = sk.rig.joints.hip || [sk.w / 2, sk.h / 2],
      base = rotAbout(hip, pose.rot || 0);
    base[4] += pose.dx || 0;
    base[5] += pose.dy || 0;
    var cum = new Array(n),
      glob = new Array(n),
      invs = new Array(n),
      state = new Uint8Array(n),
      names = Object.create(null);
    for (var i = 0; i < n; i++) names[bones[i].name] = i;
    function resolve(index) {
      if (state[index] === 2) return cum[index];
      if (state[index] === 1) throw new Error('骨骼父级包含循环依赖');
      state[index] = 1;
      var b = bones[index],
        delta = (pose.deltas && pose.deltas[b.name]) || 0;
      // 对飞行器/对称器物模板（prop），限制四肢翼片摆角以保持刚性机身美观
      if (sk.rig && sk.rig.template === 'prop' && b.name !== 'torso' && b.name !== 'tail') {
        delta *= 0.22;
      }
      var local = rotAbout(sk.rig.joints[b.a], delta),
        parent = b.parent == null ? undefined : names[b.parent];
      var current = parent === undefined ? local : mul2(resolve(parent), local);
      cum[index] = current;
      glob[index] = mul2(base, current);
      invs[index] = inv(glob[index]);
      state[index] = 2;
      return current;
    }
    for (var k = 0; k < n; k++) resolve(k);
    return { glob: glob, inv: invs, base: base };
  };
  function deformMesh(sk, M) {
    var mesh = sk.mesh,
      xy = mesh.xy,
      dst = mesh.deformed,
      W = mesh.weights,
      n = sk.n,
      minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (var i = 0; i < mesh.active.length; i++) {
      var id = mesh.active[i],
        x = xy[id * 2],
        y = xy[id * 2 + 1],
        dx = 0,
        dy = 0;
      for (var k = 0; k < n; k++) {
        var weight = W[id * n + k],
          m = M.glob[k];
        if (!weight) continue;
        dx += weight * (m[0] * x + m[2] * y + m[4]);
        dy += weight * (m[1] * x + m[3] * y + m[5]);
      }
      if (!n) {
        var b = M.base;
        dx = b[0] * x + b[2] * y + b[4];
        dy = b[1] * x + b[3] * y + b[5];
      }
      dst[id * 2] = dx;
      dst[id * 2 + 1] = dy;
      minX = Math.min(minX, dx);
      maxX = Math.max(maxX, dx);
      minY = Math.min(minY, dy);
      maxY = Math.max(maxY, dy);
    }
    return { x0: minX, y0: minY, x1: maxX, y1: maxY };
  }
  function topLeft(ax, ay, bx, by) {
    return by < ay || (by === ay && bx > ax);
  }
  function inside(e, included) {
    return e > 1e-7 || (e >= -1e-7 && included);
  }
  function rasterize(sk, out, dw, dh, dest) {
    var mesh = sk.mesh,
      P = mesh.deformed,
      U = mesh.xy,
      T = mesh.triangles,
      sx = dw / dest.w,
      sy = dh / dest.h,
      tex = sk.premul,
      tw = sk.w,
      th = sk.h;
    for (var i = 0; i < T.length; i += 3) {
      var ia = T[i],
        ib = T[i + 1],
        ic = T[i + 2],
        ax = (P[ia * 2] - dest.x) * sx,
        ay = (P[ia * 2 + 1] - dest.y) * sy,
        bx = (P[ib * 2] - dest.x) * sx,
        by = (P[ib * 2 + 1] - dest.y) * sy,
        cx = (P[ic * 2] - dest.x) * sx,
        cy = (P[ic * 2 + 1] - dest.y) * sy;
      var area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-8) continue;
      if (area < 0) {
        var tmp = ib;
        ib = ic;
        ic = tmp;
        tmp = bx;
        bx = cx;
        cx = tmp;
        tmp = by;
        by = cy;
        cy = tmp;
        area = -area;
      }
      var minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)),
        maxX = Math.min(dw - 1, Math.floor(Math.max(ax, bx, cx) - 0.5)),
        minY = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)),
        maxY = Math.min(dh - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
      var eA = topLeft(bx, by, cx, cy),
        eB = topLeft(cx, cy, ax, ay),
        eC = topLeft(ax, ay, bx, by),
        ua = U[ia * 2],
        va = U[ia * 2 + 1],
        ub = U[ib * 2],
        vb = U[ib * 2 + 1],
        uc = U[ic * 2],
        vc = U[ic * 2 + 1],
        inverseArea = 1 / area;
      for (var y = minY; y <= maxY; y++) {
        var px = minX + 0.5,
          py = y + 0.5,
          wa = (cx - bx) * (py - by) - (cy - by) * (px - bx),
          wb = (ax - cx) * (py - cy) - (ay - cy) * (px - cx),
          wc = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        for (var x = minX; x <= maxX; x++, wa -= cy - by, wb -= ay - cy, wc -= by - ay) {
          if (!inside(wa, eA) || !inside(wb, eB) || !inside(wc, eC)) continue;
          var u = Math.max(0, Math.min(tw - 1, (wa * ua + wb * ub + wc * uc) * inverseArea - 0.5)),
            v = Math.max(0, Math.min(th - 1, (wa * va + wb * vb + wc * vc) * inverseArea - 0.5));
          var ix = Math.floor(u),
            iy = Math.floor(v),
            tx = u - ix,
            ty = v - iy,
            p00 = (iy * tw + ix) * 4,
            p10 = (iy * tw + Math.min(tw - 1, ix + 1)) * 4,
            p01 = (Math.min(th - 1, iy + 1) * tw + ix) * 4,
            p11 = (Math.min(th - 1, iy + 1) * tw + Math.min(tw - 1, ix + 1)) * 4;
          var a0 = tex[p00 + 3] * (1 - tx) + tex[p10 + 3] * tx,
            a1 = tex[p01 + 3] * (1 - tx) + tex[p11 + 3] * tx,
            alpha = (a0 * (1 - ty) + a1 * ty) / 255;
          if (alpha < 1 / 510) continue;
          var o = (y * dw + x) * 4,
            retained = (out[o + 3] / 255) * (1 - alpha),
            total = alpha + retained;
          for (var ch = 0; ch < 3; ch++) {
            var c0 = tex[p00 + ch] * (1 - tx) + tex[p10 + ch] * tx,
              c1 = tex[p01 + ch] * (1 - tx) + tex[p11 + ch] * tx;
            out[o + ch] = (c0 * (1 - ty) + c1 * ty + out[o + ch] * retained) / total;
          }
          out[o + 3] = total * 255;
        }
      }
    }
  }
  function outline(sk, out, dw, dh, opts, q) {
    if (!opts || !(opts.width > 0)) return;
    var size = dw * dh,
      radius = Math.max(1, Math.round(opts.width * q)),
      color = opts.color || [74, 55, 40];
    if (!sk._outlineA || sk._outlineA.length !== size) {
      sk._outlineA = new Uint8Array(size);
      sk._outlineH = new Uint8Array(size);
    }
    var A = sk._outlineA,
      H = sk._outlineH;
    for (var p = 0; p < size; p++) A[p] = out[p * 4 + 3];
    for (var y = 0; y < dh; y++)
      for (var x = 0; x < dw; x++) {
        var maximum = 0;
        for (var k = Math.max(0, x - radius); k <= Math.min(dw - 1, x + radius); k++)
          maximum = Math.max(maximum, A[y * dw + k]);
        H[y * dw + x] = maximum;
      }
    for (var yy = 0; yy < dh; yy++)
      for (var xx = 0; xx < dw; xx++) {
        var expanded = 0;
        for (var j = Math.max(0, yy - radius); j <= Math.min(dh - 1, yy + radius); j++)
          expanded = Math.max(expanded, H[j * dw + xx]);
        var o = (yy * dw + xx) * 4;
        if (expanded > 82 && out[o + 3] < 118) {
          out[o] = color[0];
          out[o + 1] = color[1];
          out[o + 2] = color[2];
          out[o + 3] = Math.min(255, expanded + 30);
        }
      }
  }
  Skin.render = function (sk, ctx, pose, opts) {
    opts = opts || {};
    var M = Skin.matrices(sk, pose),
      bounds = deformMesh(sk, M),
      margin = Math.max(2, opts.outline && opts.outline.width > 0 ? opts.outline.width + 2 : 2);
    if (!sk.mesh.active.length) bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };
    var x0 = Math.floor(bounds.x0 - margin),
      y0 = Math.floor(bounds.y0 - margin),
      width = Math.max(1, Math.ceil(bounds.x1 + margin) - x0),
      height = Math.max(1, Math.ceil(bounds.y1 + margin) - y0);
    var q = Number(opts.quality) || 1;
    q = Math.min(Math.max(0.2, Math.min(2, q)), 2200 / width, 2200 / height);
    var dw = Math.max(1, Math.ceil(width * q)),
      dh = Math.max(1, Math.ceil(height * q));
    if (!sk.canvas) {
      sk.canvas = document.createElement('canvas');
      sk.ctx = sk.canvas.getContext('2d');
    }
    if (sk.canvas.width !== dw || sk.canvas.height !== dh) {
      sk.canvas.width = dw;
      sk.canvas.height = dh;
      sk._id = null;
    }
    if (!sk._id) sk._id = sk.ctx.createImageData(dw, dh);
    var out = sk._id.data,
      dest = { x: x0, y: y0, w: width, h: height };
    out.fill(0);
    rasterize(sk, out, dw, dh, dest);
    outline(sk, out, dw, dh, opts.outline, q);
    sk.ctx.putImageData(sk._id, 0, 0);
    if (opts.draw !== false)
      ctx.drawImage(
        sk.canvas,
        0,
        0,
        dw,
        dh,
        dest.x + (opts.ox || 0),
        dest.y + (opts.oy || 0),
        dest.w,
        dest.h
      );
    return { img: sk.canvas, dest: dest, glob: M.glob };
  };
  Skin.rotAbout = rotAbout;
  Skin.mul2 = mul2;
})(window);
