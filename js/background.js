/* =============================================================
 * background.js —— 风格同源的全域视觉协调与画作视觉特征描述（V0.7）
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var BG = SBM.BG = {};

  function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function rng(seed) { var s = (seed || 7) * 9301 + 49297; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  BG.rng = rng;

  BG.extractStyle = function (imgData, w, h, inkMask) {
    var bins = {}, i, r, g, b, key, o;
    for (i = 0; i < w * h; i++) {
      o = i * 4; r = imgData[o]; g = imgData[o + 1]; b = imgData[o + 2];
      if (imgData[o + 3] < 40) continue;
      if (r > 243 && g > 243 && b > 243) continue;
      if (r < 26 && g < 26 && b < 26) {
        key = 'ink';
      } else {
        key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      }
      if (!bins[key]) bins[key] = { n: 0, r: 0, g: 0, b: 0 };
      bins[key].n++; bins[key].r += r; bins[key].g += g; bins[key].b += b;
    }
    var list = [];
    for (var k in bins) if (k !== 'ink') list.push(bins[k]);
    list.sort(function (a, b2) { return b2.n - a.n; });
    var palette = [], minD = 46;
    for (i = 0; i < list.length && palette.length < 6; i++) {
      var c = [list[i].r / list[i].n, list[i].g / list[i].n, list[i].b / list[i].n];
      var ok = true;
      for (var j = 0; j < palette.length; j++) {
        var d = Math.abs(c[0] - palette[j][0]) + Math.abs(c[1] - palette[j][1]) + Math.abs(c[2] - palette[j][2]);
        if (d < minD) { ok = false; break; }
      }
      if (ok) palette.push(c);
    }
    if (!palette.length) palette = [[255, 214, 120], [140, 200, 240], [250, 170, 90]];
    var lineWidth = 4;
    if (inkMask) {
      var dt = CV.distanceInside(inkMask, w, h), sum = 0, n = 0;
      for (i = 0; i < w * h; i++) if (inkMask[i]) { sum += dt[i]; n++; }
      if (n > 30) lineWidth = Math.max(1.5, Math.min(14, (sum / n) * 2));
    }
    var ink = bins.ink ? [bins.ink.r / bins.ink.n, bins.ink.g / bins.ink.n, bins.ink.b / bins.ink.n] : [60, 50, 45];
    if (lum(ink) > 150) ink = [60, 50, 45];
    var sorted = palette.slice().sort(function (a, b2) { return lum(a) - lum(b2); });
    return {
      palette: palette, ink: ink, lineWidth: lineWidth,
      dark: sorted[0], light: sorted[sorted.length - 1],
      mid: sorted[Math.floor(sorted.length / 2)]
    };
  };

  /* 将提取到的主色调与笔触特征转化为儿童友好的视觉描述短语，供个性化故事叙事与云端 Prompt 使用 */
  function colorName(c) {
    var r = c[0], g = c[1], b = c[2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn;
    if (mx < 65) return '浓黑墨线';
    if (sat < 26) return mx > 200 ? '洁白银灰' : '暖灰';
    var hue = 0;
    if (mx === r) hue = ((g - b) / sat) * 60;
    else if (mx === g) hue = (2 + (b - r) / sat) * 60;
    else hue = (4 + (r - g) / sat) * 60;
    if (hue < 0) hue += 360;
    if (hue < 18 || hue >= 342) return r > 215 && g > 140 ? '蜜桃粉红' : '热情鲜红';
    if (hue < 45) return '暖阳橙色';
    if (hue < 72) return '向日葵金黄';
    if (hue < 162) return '嫩芽翠绿';
    if (hue < 205) return '清澈天蓝';
    if (hue < 255) return '星空蔚蓝';
    if (hue < 305) return '梦幻薰衣草紫';
    return '糖果粉红';
  }

  BG.describeVisuals = function (style) {
    if (!style || !Array.isArray(style.palette) || !style.palette.length) return '';
    var names = [];
    for (var i = 0; i < Math.min(2, style.palette.length); i++) {
      var nm = colorName(style.palette[i]);
      if (names.indexOf(nm) < 0) names.push(nm);
    }
    var colorText = names.join('与');
    var strokeText = style.lineWidth >= 7.5 ? '饱满蜡笔色彩' : (style.lineWidth <= 3.2 ? '纤细彩铅线条' : '圆润画笔色彩');
    return colorText ? (colorText + strokeText) : strokeText;
  };

  /* ---------- 道具绘制 ---------- */
  function star(ctx, x, y, s, st) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? s * 0.42 : s;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fillStyle = rgb(mix(st.light, [255, 240, 150], .6)); ctx.fill();
    ctx.lineWidth = Math.max(1, st.lineWidth * .7); ctx.strokeStyle = rgb(st.ink); ctx.stroke();
  }
  function cloud(ctx, x, y, s, st) {
    ctx.beginPath();
    ctx.arc(x - s * .5, y, s * .45, 0, 6.3); ctx.arc(x, y - s * .25, s * .6, 0, 6.3);
    ctx.arc(x + s * .55, y, s * .42, 0, 6.3); ctx.rect(x - s * .9, y, s * 1.85, s * .45);
    ctx.fillStyle = rgb(mix(st.light, [255, 255, 255], .55)); ctx.fill();
    ctx.lineWidth = Math.max(1, st.lineWidth * .7); ctx.strokeStyle = rgb(st.ink); ctx.stroke();
  }
  function tree(ctx, x, y, s, st) {
    ctx.fillStyle = rgb(mix(st.dark, [92, 150, 78], .55));
    ctx.strokeStyle = rgb(st.ink); ctx.lineWidth = Math.max(1, st.lineWidth);
    ctx.beginPath(); ctx.rect(x - s * .12, y - s * .55, s * .24, s * .6); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - s * .78, s * .42, 0, 6.3);
    ctx.arc(x - s * .36, y - s * .55, s * .32, 0, 6.3);
    ctx.arc(x + s * .36, y - s * .55, s * .32, 0, 6.3);
    ctx.fillStyle = rgb(mix(st.dark, [110, 180, 95], .6)); ctx.fill(); ctx.stroke();
  }
  function flower(ctx, x, y, s, st) {
    ctx.strokeStyle = rgb(st.ink); ctx.lineWidth = Math.max(1, st.lineWidth * .6);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s); ctx.stroke();
    for (var i = 0; i < 5; i++) {
      var a = i * 1.2566;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * s * .28, y - s + Math.sin(a) * s * .28, s * .26, 0, 6.3);
      ctx.fillStyle = rgb(mix(st.light, [255, 170, 190], .5)); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y - s, s * .2, 0, 6.3); ctx.fillStyle = rgb(mix(st.light, [255, 230, 120], .6)); ctx.fill(); ctx.stroke();
  }
  function fish(ctx, x, y, s, st) {
    ctx.fillStyle = rgb(mix(st.light, [255, 160, 90], .45)); ctx.strokeStyle = rgb(st.ink);
    ctx.lineWidth = Math.max(1, st.lineWidth * .8);
    ctx.beginPath(); ctx.ellipse(x, y, s * .55, s * .32, 0, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s * .5, y); ctx.lineTo(x + s * .95, y - s * .3); ctx.lineTo(x + s * .95, y + s * .3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - s * .28, y - s * .06, s * .07, 0, 6.3); ctx.fillStyle = rgb(st.ink); ctx.fill();
  }
  function bubble(ctx, x, y, s, st) {
    ctx.beginPath(); ctx.arc(x, y, s * .5, 0, 6.3);
    ctx.fillStyle = rgb(mix(st.light, [200, 240, 255], .6), .75); ctx.fill();
    ctx.lineWidth = Math.max(1, st.lineWidth * .6); ctx.strokeStyle = rgb(st.ink); ctx.stroke();
  }
  function ship(ctx, x, y, s, st) {
    ctx.fillStyle = rgb(mix(st.light, [230, 240, 255], .5)); ctx.strokeStyle = rgb(st.ink);
    ctx.lineWidth = Math.max(1, st.lineWidth);
    ctx.beginPath(); ctx.ellipse(x, y, s * .35, s * .75, 0, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - s * .15, s * .18, 0, 6.3); ctx.fillStyle = rgb(mix(st.light, [140, 210, 250], .6)); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * .2, y + s * .7); ctx.lineTo(x, y + s * 1.15); ctx.lineTo(x + s * .2, y + s * .7); ctx.closePath();
    ctx.fillStyle = 'rgba(255,180,60,.85)'; ctx.fill();
  }
  function castleProp(ctx, x, y, s, st) {
    ctx.fillStyle = rgb(mix(st.light, [255, 220, 235], .5)); ctx.strokeStyle = rgb(st.ink);
    ctx.lineWidth = Math.max(1, st.lineWidth);
    ctx.beginPath(); ctx.rect(x - s * .45, y - s * .6, s * .9, s * .65); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * .52, y - s * .6); ctx.lineTo(x, y - s * 1.1); ctx.lineTo(x + s * .52, y - s * .6); ctx.closePath();
    ctx.fillStyle = rgb(mix(st.dark, [220, 110, 150], .55)); ctx.fill(); ctx.stroke();
  }
  function apple(ctx, x, y, s, st) {
    ctx.fillStyle = rgb(mix(st.light, [240, 90, 80], .65)); ctx.strokeStyle = rgb(st.ink);
    ctx.lineWidth = Math.max(1, st.lineWidth * .75);
    ctx.beginPath(); ctx.arc(x, y, s * .38, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - s * .36); ctx.lineTo(x + s * .08, y - s * .54); ctx.stroke();
  }

  var PROPS = { '星星': star, '云': cloud, '树': tree, '花': flower, '鱼': fish, '泡泡': bubble, '飞船': ship, '城堡': castleProp, '苹果': apple };
  BG.PROPS = PROPS;
  BG.drawProp = function (ctx, name, x, y, s, st) {
    var fn = PROPS[name]; if (!fn) return false;
    ctx.save(); fn(ctx, x, y, s, st || { light: [240, 220, 180], dark: [90, 80, 70], ink: [60, 50, 45], lineWidth: 2 }); ctx.restore();
    return true;
  };

  BG.draw = function (ctx, scene, st, W, H, seed) {
    st = st || { palette: [[240, 210, 150]], light: [245, 230, 200], mid: [180, 170, 150], dark: [90, 80, 70], ink: [60, 50, 45], lineWidth: 3 };
    var rnd = rng(seed || 3), kind = (scene && scene.bg) || 'forest', i, skyTop, skyBot;
    ctx.save();
    if (kind === 'space') {
      skyTop = mix(st.dark, [22, 28, 68], .72); skyBot = mix(st.mid, [52, 42, 98], .68);
      grad(ctx, W, H, skyTop, skyBot);
      for (i = 0; i < 28; i++) star(ctx, rnd() * W, rnd() * H * .68, 4 + rnd() * 7, { light: [255, 245, 180], ink: [255, 240, 190], lineWidth: 0.6 });
      ctx.beginPath(); ctx.arc(W * .80, H * .22, H * .11, 0, 6.3);
      ctx.fillStyle = rgb(mix(st.light, [255, 232, 150], .65)); ctx.fill();
      ctx.lineWidth = Math.max(1.5, st.lineWidth); ctx.strokeStyle = rgb(st.ink, .6); ctx.stroke();
      hills(ctx, W, H, mix(st.mid, [110, 95, 165], .55), H * .80, rnd, st);
    } else if (kind === 'ocean') {
      skyTop = mix(st.light, [120, 210, 245], .65); skyBot = mix(st.dark, [28, 95, 155], .65);
      grad(ctx, W, H, skyTop, skyBot);
      for (i = 0; i < 18; i++) bubble(ctx, rnd() * W, rnd() * H * .82, 10 + rnd() * 18, st);
      ctx.fillStyle = rgb(mix(st.light, [242, 218, 168], .6));
      ctx.beginPath(); ctx.moveTo(0, H * .84); ctx.quadraticCurveTo(W * .5, H * .78, W, H * .85); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgb(mix(st.dark, [60, 160, 110], .6)); ctx.lineWidth = Math.max(4, st.lineWidth * 1.8);
      for (i = 0; i < 12; i++) {
        var sx = W * (.05 + i * .082);
        ctx.beginPath(); ctx.moveTo(sx, H); ctx.quadraticCurveTo(sx - 14, H * .84, sx + 8, H * .70 - rnd() * 34); ctx.stroke();
      }
    } else if (kind === 'castle') {
      skyTop = mix(st.light, [245, 210, 235], .55); skyBot = mix(st.light, [255, 245, 225], .55);
      grad(ctx, W, H, skyTop, skyBot);
      cloud(ctx, W * .18, H * .18, H * .11, st); cloud(ctx, W * .78, H * .16, H * .10, st);
      castleProp(ctx, W * .82, H * .74, H * .26, st);
      hills(ctx, W, H, mix(st.mid, [195, 165, 215], .45), H * .78, rnd, st);
    } else if (kind === 'home') {
      skyTop = mix(st.light, [255, 238, 210], .65); skyBot = mix(st.mid, [242, 212, 172], .55);
      grad(ctx, W, H, skyTop, skyBot);
      ctx.fillStyle = rgb(mix(st.light, [255, 255, 255], .6));
      ctx.strokeStyle = rgb(st.ink); ctx.lineWidth = Math.max(2, st.lineWidth * 1.4);
      roundRect(ctx, W * .62, H * .10, W * .30, H * .40, 14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgb(mix(st.dark, [70, 90, 160], .55));
      ctx.fillRect(W * .635, H * .115, W * .27, H * .37);
      for (i = 0; i < 14; i++) star(ctx, W * (.65 + rnd() * .24), H * (.14 + rnd() * .31), 3 + rnd() * 3, { light: [255, 250, 220], ink: st.ink, lineWidth: 0.5 });
      ctx.fillStyle = rgb(mix(st.mid, [220, 180, 140], .5));
      ctx.beginPath(); ctx.moveTo(0, H * .84); ctx.lineTo(W, H * .78); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgb(st.ink); ctx.lineWidth = Math.max(1.5, st.lineWidth); ctx.stroke();
    } else if (kind === 'meadow') {
      skyTop = mix(st.light, [175, 225, 255], .5); skyBot = mix(st.light, [255, 250, 225], .5);
      grad(ctx, W, H, skyTop, skyBot);
      ctx.beginPath(); ctx.arc(W * .82, H * .18, H * .09, 0, 6.3);
      ctx.fillStyle = rgb(mix(st.light, [255, 230, 120], .6)); ctx.fill();
      ctx.lineWidth = Math.max(1.5, st.lineWidth); ctx.strokeStyle = rgb(st.ink); ctx.stroke();
      cloud(ctx, W * .22, H * .18, H * .11, st); cloud(ctx, W * .52, H * .12, H * .09, st);
      hills(ctx, W, H, mix(st.mid, [140, 195, 130], .45), H * .72, rnd, st);
      hills(ctx, W, H, mix(st.dark, [95, 165, 95], .45), H * .84, rnd, st);
      for (i = 0; i < 14; i++) flower(ctx, rnd() * W, H * (.86 + rnd() * .13), H * (.06 + rnd() * .04), st);
    } else {
      skyTop = mix(st.light, [205, 235, 255], .5); skyBot = mix(st.light, [255, 250, 230], .5);
      grad(ctx, W, H, skyTop, skyBot);
      cloud(ctx, W * .25, H * .16, H * .10, st);
      hills(ctx, W, H, mix(st.mid, [150, 190, 160], .5), H * .60, rnd, st);
      for (i = 0; i < 7; i++) tree(ctx, W * (.06 + i * .145 + rnd() * .03), H * (.72 + rnd() * .05), H * (.20 + rnd() * .10), st);
      ctx.strokeStyle = rgb(mix(st.dark, [90, 160, 90], .45)); ctx.lineWidth = Math.max(2, st.lineWidth * 1.4);
      for (i = 0; i < 40; i++) {
        var bx = rnd() * W, by = H * (.88 + rnd() * .14);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 6, by - 14, bx + (rnd() - .5) * 16, by - 26 - rnd() * 14); ctx.stroke();
      }
    }
    ctx.restore();
  };

  function grad(ctx, W, H, a, b) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(a)); g.addColorStop(1, rgb(b));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function hills(ctx, W, H, color, baseY, rnd, st) {
    ctx.beginPath(); ctx.moveTo(0, H);
    ctx.lineTo(0, baseY);
    var steps = 6;
    for (var i = 0; i <= steps; i++) {
      var x = W * i / steps;
      var y = baseY - Math.sin(i * 1.1 + rnd()) * H * .05;
      if (i === 0) ctx.lineTo(x, y); else ctx.quadraticCurveTo(x - W / steps / 2, y - H * .06, x, y);
    }
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = rgb(color); ctx.fill();
    if (st && st.lineWidth > 0) {
      ctx.lineWidth = Math.max(2.5, st.lineWidth * 1.1);
      ctx.strokeStyle = rgb(st.ink, .9); ctx.stroke();
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  BG.roundRect = roundRect;
})(window);
