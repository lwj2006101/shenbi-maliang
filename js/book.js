/* =============================================================
 * book.js —— 绘本合成渲染 / 页面排版 / 导出
 * 对应报告 1.2.2「故事+场景」与 3.2.6「分层渲染与动态融合」：
 *   远景背景 → 中景道具 → 角色（骨骼动画） → 近景道具 → 字幕
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Book = SBM.Book = {};

  /* 文本换行 */
  Book.wrapText = function (ctx, text, maxW) {
    var lines = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  /* 道具布局：远景小、近景大，避让角色 */
  Book.layoutProps = function (scene, W, H, seed) {
    var rnd = SBM.BG.rng(seed || 11), out = [];
    var names = (scene.props || []).slice(0, 6);
    for (var i = 0; i < names.length; i++) {
      var far = i % 2 === 0;
      var x = W * (0.08 + 0.84 * ((i + 0.5) / names.length)) + (rnd() - 0.5) * W * 0.07;
      var y = far ? H * (0.24 + rnd() * 0.18) : H * (0.78 + rnd() * 0.14);
      var s = far ? H * (0.09 + rnd() * 0.04) : H * (0.13 + rnd() * 0.05);
      out.push({ name: names[i], x: x, y: y, s: s, far: far });
    }
    return out;
  };

  /**
   * 合成一页
   * opts: { scene, style, skinner, rig, phase, motion, amp, W, H, caption, quality, propsSeed }
   */
  Book.compose = function (ctx, o) {
    var W = o.W, H = o.H;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    // 1. 背景（分层）
    SBM.BG.draw(ctx, { bg: o.scene.bg }, o.style, W, H, o.propsSeed || 5);
    // 2. 远景道具
    var props = o.props || Book.layoutProps(o.scene, W, H, o.propsSeed);
    for (var i = 0; i < props.length; i++) {
      if (props[i].far) Book.drawPropSticker(ctx, props[i].name, props[i].x, props[i].y, props[i].s, o.style);
    }
    // 3. 先为字幕排版，角色放在气泡上方（避免被字幕压住）
    var cap = o.caption ? Book.captionLayout(ctx, o.caption, W, H) : null;
    var charBottom = cap ? Math.max(H * 0.34, cap.by - 14) : H * 0.88;

    // 4. 角色
    if (o.skinner && o.rig) {
      var pose = SBM.Motion.poseAt(o.motion || 'walk', o.phase || 0, o.amp || 1, o.speed || 1);
      // 缩放必须按「整幅角色纹理尺寸」算。按骨架跨度算时，一旦关节估歪（如恐龙的关节全挤在
      // 腿部一小段，charHeight 只有 78），scale 会飙到 4×，角色糊成一团还被裁掉。
      var bodyW = o.skinner.w || 200, bodyH = o.skinner.h || 200;
      var height = o.rig.charHeight || bodyH * 0.8;
      var scale = o.charScale
        ? o.charScale / Math.max(20, bodyH)
        : Math.min((H * 0.46) / Math.max(20, bodyH), (W * 0.58) / Math.max(20, bodyW));
      scale = Math.max(0.10, Math.min(2.0, scale));
      var cx = o.charX === undefined ? W * 0.40 : o.charX;
      var cy = o.charY === undefined ? charBottom : o.charY;

      // 背景偏暗时改用"白色贴纸边"，否则角色黑线会被暗背景吞掉
      var sig = (o.style && o.style.palette && o.style.palette[0])
        ? Math.round(o.style.palette[0][0]) + '-' + Math.round(o.style.palette[0][1]) + '-' + Math.round(o.style.palette[0][2])
        : 'x';
      var luma = Book.bgLuma(ctx, o.scene.bg + '|' + (o.propsSeed || 5) + '|' + sig, W, H);
      var outline = o.outline;
      if (!outline) {
        outline = luma < 138
          ? { color: [255, 251, 240], width: 5.6 }
          : { color: [74, 55, 40], width: 3.4 };
      }
      // 影子
      ctx.save();
      ctx.globalAlpha = luma < 138 ? 0.30 : 0.16;
      ctx.fillStyle = '#4A3728';
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, height * scale * 0.30, height * scale * 0.055, 0, 0, 6.3); ctx.fill();
      ctx.restore();
      // 蒙皮坐标以纹理左上角为原点，必须补偿到"脚底中点"锚点，否则角色会画到画布外
      var bj = o.rig.bboxJ || { x0: 0, x1: o.skinner.w, y0: 0, y1: height };
      var anchorX = (bj.x0 + bj.x1) / 2, anchorY = bj.y1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-anchorX, -anchorY);
      var pp = { deltas: pose.deltas, dx: pose.dx * height, dy: pose.dy * height, rot: pose.rot };
      SBM.Skin.render(o.skinner, ctx, pp, { quality: o.quality || 0.8, draw: true, outline: outline });
      ctx.restore();
    }
    // 5. 近景道具（贴纸效果）
    for (var j = 0; j < props.length; j++) {
      if (!props[j].far) Book.drawPropSticker(ctx, props[j].name, props[j].x, props[j].y, props[j].s, o.style);
    }
    // 6. 卡通字幕气泡
    if (cap) Book.paintBubble(ctx, cap);
    ctx.restore();
    return props;
  };

  /* 背景平均亮度（结果按场景缓存，避免逐帧 readback） */
  Book._lumaCache = {};
  Book.bgLuma = function (ctx, key, W, H) {
    if (Book._lumaCache[key] !== undefined) return Book._lumaCache[key];
    var v = 210;
    var keys = Object.keys(Book._lumaCache);
    if (keys.length > 24) for (var q = 0; q < keys.length; q++) delete Book._lumaCache[keys[q]];
    try {
      var y0 = Math.round(H * 0.30), hh = Math.round(H * 0.55);
      var d = ctx.getImageData(0, y0, W, hh).data;
      var s = 0, n = 0;
      for (var i = 0; i < d.length; i += 4 * 41) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
      if (n) v = s / n;
    } catch (e) { }
    Book._lumaCache[key] = v;
    return v;
  };

  /* 道具贴纸效果：先画一圈白边再画本体，卡通感更强 */
  Book.drawPropSticker = function (ctx, name, x, y, s, st) {
    if (!SBM.BG.PROPS[name]) return false;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(74,55,40,.22)';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = Math.max(2, s * 0.05);
    SBM.BG.drawProp(ctx, name, x, y, s, st);
    ctx.restore();
    return true;
  };

  /* 字幕排版：先算好尺寸，角色摆放与气泡绘制共用同一份布局 */
  Book.CAP_FONT = '700 19px "YouYuan","幼圆","PingFang SC","Microsoft YaHei",sans-serif';
  Book.CAP_LH = 30;
  Book.captionLayout = function (ctx, text, W, H) {
    var padX = 24, padY = 16, maxW = W - 110, maxLines = 3;
    ctx.save();
    ctx.font = Book.CAP_FONT;
    var lines = Book.wrapText(ctx, text, maxW);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      // 用省略号收尾，不要生硬截断
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    var bw = 0;
    for (var i = 0; i < lines.length; i++) bw = Math.max(bw, ctx.measureText(lines[i]).width);
    ctx.restore();
    bw = Math.min(maxW, bw) + padX * 2;
    var bh = lines.length * Book.CAP_LH + padY * 2 - 6;
    return { lines: lines, bw: bw, bh: bh, bx: (W - bw) / 2, by: H - bh - 22, padX: padX, padY: padY };
  };

  /* 卡通对话气泡字幕：粗描边 + 圆角 + 小尾巴
     尾巴必须和气泡画成同一条路径再统一描边。分两次画、再用同色块抹接缝，
     抹掉的位置会连描边一起抹掉，看起来就是气泡左下角破了个口。 */
  Book.paintBubble = function (ctx, cap) {
    var bx = cap.bx, by = cap.by, bw = cap.bw, bh = cap.bh;
    var r = 20, LW = 4.5, FILL = '#FFFDF6', LINE = '#4A3728';
    var tL = bx + bw * 0.34, tR = bx + bw * 0.22, tipX = bx + bw * 0.16, tipY = by + bh + 18;
    function path() {
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.lineTo(bx + bw - r, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
      ctx.lineTo(bx + bw, by + bh - r);
      ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
      ctx.lineTo(tL, by + bh);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tR, by + bh);
      ctx.lineTo(bx + r, by + bh);
      ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
      ctx.lineTo(bx, by + r);
      ctx.arcTo(bx, by, bx + r, by, r);
      ctx.closePath();
    }
    ctx.save();
    ctx.lineJoin = 'round';
    // 影子：整条气泡路径下移几像素填一层半透明
    ctx.save(); ctx.translate(0, 6);
    path(); ctx.fillStyle = 'rgba(74,55,40,.18)'; ctx.fill();
    ctx.restore();
    // 本体
    path();
    ctx.fillStyle = FILL; ctx.fill();
    ctx.lineWidth = LW; ctx.strokeStyle = LINE; ctx.stroke();
    // 文字
    ctx.font = Book.CAP_FONT;
    ctx.fillStyle = '#4A3728';
    ctx.textBaseline = 'top';
    for (var k = 0; k < cap.lines.length; k++) {
      ctx.fillText(cap.lines[k], bx + cap.padX, by + cap.padY - 2 + k * Book.CAP_LH);
    }
    ctx.restore();
  };

  /* ---------- 下载工具 ---------- */
  Book.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 200);
  };

  Book.downloadCanvas = function (filename, canvas) {
    canvas.toBlob(function (b) { Book.download(filename, b, 'image/png'); });
  };
})(window);
