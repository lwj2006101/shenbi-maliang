/* =============================================================
 * app.js —— 神笔马良 V0.7 主程序（儿童/家长双模式 / 全画幅掩码修补 /
 * 个性化分支故事与逐幕编辑 / 离线有声绘本与视频导出 / 跨屏与草稿保护）
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM;
  var W = 760, H = 540;

  var S = {
    step: 1,
    uiMode: 'child',
    tool: 'pen', color: '#2b2b2b', size: 9,
    undo: [], maskUndo: [],
    flip: false, fixing: false, manualRig: false,
    seg: null, rig: null, skinner: null,
    motion: { key: 'walk', speed: 1, amp: 1, playing: false, phase: 0, raf: 0, last: 0 },
    story: null, style: null, editingScene: -1,
    book: { page: 0, playing: false, phase: 0, raf: 0, last: 0, props: {} },
    cfg: { base: '', serverBase: '/api/story', key: '', model: 'qwen-plus', vision: false, latency: 0, quality: 0.75, prefetch: true },
    segView: 'overlay', fixMode: 'off', fixSize: 16,
    emotions: 'auto', reading: false
  };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, kind, ms) {
    var box = $('toasts'); if (!box) return;
    for (var i = 0; i < box.children.length; i++) {
      var c = box.children[i];
      if (c.dataset.msg === msg) {
        var n = (+c.dataset.n || 1) + 1;
        c.dataset.n = n;
        c.textContent = n > 1 ? msg + ' ×' + n : msg;
        armToast(c, ms); return;
      }
    }
    while (box.children.length >= 3) box.removeChild(box.firstChild);
    var d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.dataset.msg = msg; d.dataset.n = 1;
    d.textContent = msg;
    box.appendChild(d);
    armToast(d, ms);
  }
  function armToast(d, ms) {
    if (d.dataset.timer) clearTimeout(+d.dataset.timer);
    d.classList.remove('out');
    d.dataset.timer = setTimeout(function () {
      d.classList.add('out');
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 300);
    }, ms || 2600);
  }
  function markOn(nodes, el, cls) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].classList) nodes[i].classList.remove(cls || 'on');
    if (el && el.classList) el.classList.add(cls || 'on');
  }

  /* ================= 画布基础 ================= */
  var dc = $('drawCanvas'), dctx = dc.getContext('2d');
  var sc = $('segCanvas'), sctx = sc.getContext('2d');
  var ac = $('animCanvas'), actx = ac.getContext('2d');
  var bc = $('bookCanvas'), bctx = bc.getContext('2d');

  function clearCanvas(ctx, c) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  }

  function fitCanvases() {
    var list = [dc, sc, ac, bc];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c) continue;
      var wrap = c.parentNode;
      if (!wrap) continue;
      var cs = getComputedStyle(wrap);
      var availW = wrap.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      var availH = wrap.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
      if (availW <= 20) continue;
      var k = availH > 60 ? Math.min(availW / c.width, availH / c.height) : (availW / c.width);
      k = Math.min(k, 1.35);
      c.style.width = Math.max(60, Math.floor(c.width * k)) + 'px';
      c.style.height = Math.max(45, Math.floor(c.height * k)) + 'px';
    }
  }
  function canvasPos(cv, e) {
    var r = cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * cv.width / Math.max(1, r.width),
      y: (e.clientY - r.top) * cv.height / Math.max(1, r.height)
    };
  }
  function saveUndo() {
    try { S.undo.push(dctx.getImageData(0, 0, W, H)); } catch (e) { }
    if (S.undo.length > 12) S.undo.shift();
  }
  function status(msg) { if ($('statusMsg')) $('statusMsg').textContent = msg; }
  function tip(msg) { if ($('tipBox')) $('tipBox').innerHTML = msg; }
  function warn(msg) { status(msg); toast(msg, 'err', 4200); }

  /* ================= 儿童模式 / 家长工坊切换 ================= */
  function setUIMode(mode, silent) {
    S.uiMode = mode === 'parent' ? 'parent' : 'child';
    if (document.body && document.body.classList) {
      document.body.classList.toggle('mode-child', S.uiMode === 'child');
      document.body.classList.toggle('mode-parent', S.uiMode === 'parent');
    }
    if ($('btnModeChild')) $('btnModeChild').classList.toggle('on', S.uiMode === 'child');
    if ($('btnModeParent')) $('btnModeParent').classList.toggle('on', S.uiMode === 'parent');
    document.querySelectorAll('[data-child][data-parent]').forEach(function (el) {
      el.textContent = S.uiMode === 'child' ? el.dataset.child : el.dataset.parent;
    });
    // 若切回儿童模式且停在家长专属步骤(2/4/5)，平滑落到最邻近儿童步骤
    if (S.uiMode === 'child' && (S.step === 2 || S.step === 4 || S.step === 5)) {
      setStep(S.step === 2 ? 3 : 6);
    } else {
      fitCanvases();
    }
    if (!silent) status(S.uiMode === 'child' ? '已切换至「儿童模式」：聚焦画、动、听' : '已切换至「家长工坊」：可精修骨架、故事分支与配音设置');
  }

  /* ================= 示例画作 ================= */
  var SAMPLES = {
    stick: function (c) {
      c.strokeStyle = '#2b2b2b'; c.lineWidth = 13; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.arc(380, 110, 46, 0, 6.3); c.stroke();
      c.beginPath(); c.moveTo(380, 156); c.lineTo(380, 320); c.stroke();
      c.beginPath(); c.moveTo(380, 200); c.lineTo(300, 262); c.stroke();
      c.beginPath(); c.moveTo(380, 200); c.lineTo(460, 262); c.stroke();
      c.beginPath(); c.moveTo(380, 320); c.lineTo(320, 452); c.stroke();
      c.beginPath(); c.moveTo(380, 320); c.lineTo(440, 452); c.stroke();
      c.fillStyle = '#2b2b2b';
      c.beginPath(); c.arc(364, 100, 6, 0, 6.3); c.arc(396, 100, 6, 0, 6.3); c.fill();
      c.beginPath(); c.arc(380, 122, 15, 0.15, Math.PI - 0.15); c.lineWidth = 6; c.stroke();
    },
    dog: function (c) {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 10; c.strokeStyle = '#4a3520'; c.fillStyle = '#e8b06a';
      c.beginPath(); c.ellipse(400, 300, 125, 72, 0, 0, 6.3); c.fill(); c.stroke();
      c.beginPath(); c.rect(320, 355, 34, 90); c.fill(); c.stroke();
      c.beginPath(); c.rect(380, 355, 34, 90); c.fill(); c.stroke();
      c.beginPath(); c.rect(440, 355, 34, 90); c.fill(); c.stroke();
      c.beginPath(); c.rect(494, 355, 34, 90); c.fill(); c.stroke();
      c.beginPath(); c.arc(250, 232, 62, 0, 6.3); c.fillStyle = '#f0c184'; c.fill(); c.stroke();
      c.beginPath(); c.ellipse(300, 240, 46, 30, 0.1, 0, 6.3); c.fillStyle = '#f7dcb0'; c.fill(); c.stroke();
      c.beginPath(); c.arc(276, 248, 8, 0, 6.3); c.fillStyle = '#3a2a18'; c.fill();
      c.beginPath(); c.arc(212, 200, 30, 0.6, 3.0); c.fillStyle = '#d99a55'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(520, 270); c.quadraticCurveTo(608, 236, 586, 176); c.lineWidth = 16; c.strokeStyle = '#4a3520'; c.stroke();
      c.lineWidth = 10;
      c.beginPath(); c.arc(250, 258, 26, 0.2, Math.PI - 0.2); c.strokeStyle = '#4a3520'; c.stroke();
    },
    dino: function (c) {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 11;
      c.strokeStyle = '#2f6b3a'; c.fillStyle = '#8ed08a';
      function thickStroke(path, width) {
        c.lineWidth = width + 11; c.strokeStyle = '#2f6b3a';
        c.beginPath(); path(); c.stroke();
        c.lineWidth = width; c.strokeStyle = '#8ed08a';
        c.beginPath(); path(); c.stroke();
        c.lineWidth = 11; c.strokeStyle = '#2f6b3a';
      }
      thickStroke(function () { c.moveTo(268, 318); c.quadraticCurveTo(196, 306, 150, 250); }, 30);
      c.fillStyle = '#8ed08a';
      c.beginPath(); c.ellipse(392, 312, 128, 71, 0, 0, 6.3); c.fill(); c.stroke();
      thickStroke(function () { c.moveTo(492, 282); c.quadraticCurveTo(536, 232, 552, 196); }, 32);
      c.fillStyle = '#8ed08a';
      c.beginPath(); c.ellipse(566, 180, 52, 38, -0.18, 0, 6.3); c.fill(); c.stroke();
      c.beginPath(); c.arc(584, 168, 8, 0, 6.3); c.fillStyle = '#2f6b3a'; c.fill();
      c.fillStyle = '#f5e07a';
      for (var i = 0; i < 3; i++) {
        var bx = 356 + i * 52;
        c.beginPath(); c.moveTo(bx - 14, 250); c.lineTo(bx, 218); c.lineTo(bx + 14, 250); c.closePath();
        c.fill(); c.stroke();
      }
      c.fillStyle = '#8ed08a';
      var legs = [300, 356, 424, 480];
      for (var j = 0; j < legs.length; j++) {
        c.beginPath(); c.rect(legs[j], 368, 38, 96); c.fill(); c.stroke();
      }
    },
    cat: function (c) {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 10; c.strokeStyle = '#8a4a1e'; c.fillStyle = '#f5a25d';
      c.beginPath(); c.ellipse(370, 350, 108, 82, 0, 0, 6.3); c.fill(); c.stroke();
      c.beginPath(); c.arc(370, 210, 82, 0, 6.3); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(310, 156); c.lineTo(288, 88); c.lineTo(352, 132); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(430, 156); c.lineTo(452, 88); c.lineTo(388, 132); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(344, 202, 15, 0, 6.3); c.arc(398, 202, 15, 0, 6.3); c.fill(); c.stroke();
      c.fillStyle = '#3a2a18';
      c.beginPath(); c.arc(344, 202, 7, 0, 6.3); c.arc(398, 202, 7, 0, 6.3); c.fill();
      c.strokeStyle = '#8a4a1e'; c.lineWidth = 6;
      c.beginPath(); c.moveTo(370, 226); c.lineTo(356, 240); c.moveTo(370, 226); c.lineTo(384, 240); c.stroke();
      c.lineWidth = 10;
      c.beginPath(); c.moveTo(470, 350); c.quadraticCurveTo(560, 330, 540, 240); c.stroke();
      c.beginPath(); c.rect(310, 420, 40, 70); c.fillStyle = '#f5a25d'; c.fill(); c.stroke();
      c.beginPath(); c.rect(402, 420, 40, 70); c.fill(); c.stroke();
    },
    girl: function (c) {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 11; c.strokeStyle = '#7a3f5c'; c.fillStyle = '#ffd9e6';
      c.beginPath(); c.moveTo(380, 210); c.lineTo(300, 380); c.lineTo(460, 380); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.arc(380, 150, 62, 0, 6.3); c.fillStyle = '#ffe4c9'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(318, 140); c.quadraticCurveTo(380, 60, 442, 140); c.quadraticCurveTo(430, 96, 380, 104); c.quadraticCurveTo(330, 96, 318, 140); c.fillStyle = '#5a3a2a'; c.fill(); c.stroke();
      c.fillStyle = '#3a2a18';
      c.beginPath(); c.arc(360, 152, 7, 0, 6.3); c.arc(400, 152, 7, 0, 6.3); c.fill();
      c.strokeStyle = '#e2708a'; c.lineWidth = 6;
      c.beginPath(); c.arc(380, 176, 14, 0.3, Math.PI - 0.3); c.stroke();
      c.strokeStyle = '#7a3f5c'; c.lineWidth = 11;
      c.beginPath(); c.moveTo(330, 250); c.lineTo(276, 330); c.stroke();
      c.beginPath(); c.moveTo(430, 250); c.lineTo(484, 330); c.stroke();
      c.beginPath(); c.moveTo(348, 380); c.lineTo(340, 470); c.stroke();
      c.beginPath(); c.moveTo(412, 380); c.lineTo(420, 470); c.stroke();
    },
    rocket: function (c) {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 11; c.strokeStyle = '#8a2b2b'; c.fillStyle = '#f2f2f2';
      c.beginPath(); c.moveTo(380, 90); c.quadraticCurveTo(452, 240, 452, 340); c.lineTo(308, 340); c.quadraticCurveTo(308, 240, 380, 90); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(308, 300); c.lineTo(236, 400); c.lineTo(308, 372); c.closePath(); c.fillStyle = '#e05a4a'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(452, 300); c.lineTo(524, 400); c.lineTo(452, 372); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.arc(380, 218, 40, 0, 6.3); c.fillStyle = '#9fd8f2'; c.fill(); c.stroke();
      c.beginPath(); c.rect(344, 340, 72, 34); c.fillStyle = '#e05a4a'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(346, 380); c.quadraticCurveTo(380, 470, 414, 380); c.closePath(); c.fillStyle = '#ffcb45'; c.fill(); c.stroke();
    }
  };

  function loadSample(key, chip, isInit) {
    if (!isInit) {
      saveUndo();
      if (SBM.Sync && SBM.Sync.connected) SBM.Sync.markLocalChange();
    }
    clearCanvas(dctx, dc);
    if (SAMPLES[key]) SAMPLES[key](dctx);
    if (chip) {
      markOn(document.querySelectorAll('#sampleChips .chip'), chip);
      if (chip.dataset.kind) $('charKind').value = chip.dataset.kind;
      if (chip.dataset.name) $('charName').value = chip.dataset.name;
    }
    if (key === 'dog' || key === 'dino' || key === 'cat') { $('rigTemplate').value = 'quadruped'; S.flip = false; }
    else if (key === 'rocket') { $('rigTemplate').value = 'prop'; S.flip = false; }
    else $('rigTemplate').value = 'auto';
    S.seg = null; S.rig = null; S.skinner = null; S.manualRig = false; S.maskUndo = [];
    schedulePrefetch();
  }

  /* ================= 步骤1：绘制 ================= */
  var drawing = false, lastPt = null;
  var syncInitialArtwork = null, syncSharedArtwork = null, syncConnectRequest = 0, syncArtworkToken = 0, syncConflictPanel = null;
  function broadcastCanvasIfReady() {
    if (SBM.Sync && SBM.Sync.connected && SBM.Sync.ready && !SBM.Sync.conflict && SBM.Sync.awaitingVersion === null) {
      SBM.Sync.send('artwork', { data: dc.toDataURL('image/jpeg', 0.55) });
    }
  }
  function bindCanvas() {
    dc.addEventListener('pointerdown', function (e) {
      if (SBM.Workspace) SBM.Workspace.editStarted();
      if (SBM.Sync) SBM.Sync.markLocalChange();
      dc.setPointerCapture(e.pointerId); saveUndo(); drawing = true;
      var p = canvasPos(dc, e); lastPt = p; stroke(p, p);
    });
    dc.addEventListener('pointermove', function (e) {
      if (!drawing) return; var p = canvasPos(dc, e);
      dctx.lineCap = 'round'; dctx.lineJoin = 'round';
      dctx.strokeStyle = S.tool === 'eraser' ? '#fff' : S.color;
      dctx.lineWidth = S.tool === 'eraser' ? S.size * 2.2 : S.size;
      dctx.beginPath(); dctx.moveTo(lastPt.x, lastPt.y); dctx.lineTo(p.x, p.y); dctx.stroke();
      lastPt = p;
    });
    dc.addEventListener('pointerup', function () {
      drawing = false; schedulePrefetch();
      if (SBM.Sync && SBM.Sync.connected) SBM.Sync.send('artwork', { data: dc.toDataURL('image/jpeg', 0.55) });
    });
    dc.addEventListener('pointercancel', function () { drawing = false; });
  }
  function stroke(a, b) {
    dctx.lineCap = 'round'; dctx.strokeStyle = S.tool === 'eraser' ? '#fff' : S.color;
    dctx.lineWidth = S.tool === 'eraser' ? S.size * 2.2 : S.size;
    dctx.beginPath(); dctx.moveTo(a.x, a.y); dctx.lineTo(b.x + 0.01, b.y); dctx.stroke();
  }

  var prefetchTimer = null, drawingRevision = 0, bookPageTimer = null;
  function schedulePrefetch() {
    drawingRevision += 1;
    var revision = drawingRevision;
    clearTimeout(prefetchTimer);
    S.seg = null; S.rig = null; S.skinner = null; S.style = null; S.manualRig = false; S.maskUndo = [];
    if (SBM.Workspace) SBM.Workspace.changed();
    if (!S.cfg.prefetch) return;
    prefetchTimer = setTimeout(function () {
      if (S.step !== 1 || revision !== drawingRevision) return;
      SBM.Pipe.wrap('capture', function () { return 'ok'; }, { noNet: true })
        .then(function () { if (revision !== drawingRevision || S.step !== 1) return null; return SBM.Pipe.wrap('segment', function () { return runSegmentation(true); }); })
        .then(function (r) { if (revision !== drawingRevision || S.step !== 1) return null; if (r) return SBM.Pipe.wrap('pose', function () { buildRig(); return S.rig; }); })
        .catch(function () { });
    }, 1100);
  }

  /* ================= 步骤2：增强分割 + 全画幅掩码修补 + 骨骼 ================= */
  function grab() { return dctx.getImageData(0, 0, W, H); }

  function segmentCore(img, normGray, colorSal, block, C, closeR) {
    var ink = CV.adaptiveThreshold(normGray, W, H, block, C);
    if (colorSal) {
      for (var i = 0; i < ink.length; i++) if (colorSal[i]) ink[i] = 1;
    }
    var inkC = closeR > 0 ? CV.close(ink, W, H, closeR) : ink;
    var reg = CV.enclosed(inkC, W, H);
    var merged = CV.mergeNearbyComponents(reg, W, H);
    var mask = CV.fillHoles(merged.mask, W, H);
    var bridged = CV.fillHoles(merged.bridged, W, H);
    var bb = CV.bbox(mask, W, H);
    return { ink: ink, mask: mask, bridged: bridged, bb: bb, comps: merged.count, mergedParts: merged.merged, area: bb.area };
  }

  function scoreSeg(r) {
    if (!r || r.bb.area < 160) return -1;
    // 排除误把整张纸当成前景的过曝候选
    if (r.bb.w > W * 0.96 && r.bb.h > H * 0.96 && r.area > W * H * 0.72) return -1;
    var ratio = r.area / Math.max(1, r.bb.w * r.bb.h);
    var s = ratio > 0.08 && ratio < 0.88 ? 1 - Math.abs(ratio - 0.40) / 0.44 : 0.22;
    if (r.comps === 1 || r.mergedParts > 0) s += 0.22;
    return s;
  }

  /* 从 760×540 全尺寸掩码重建裁剪纹理、裁剪掩码及可选保留手动关节 */
  function materializeSeg(img, fullMask, bridgedMask, inkFull, comps, area, preserveManualRig) {
    var rawBb = CV.bbox(fullMask, W, H);
    if (rawBb.area < 24) return false;
    var pad = 8;
    var bb = {
      x0: Math.max(0, rawBb.x0 - pad), y0: Math.max(0, rawBb.y0 - pad),
      x1: Math.min(W - 1, rawBb.x1 + pad), y1: Math.min(H - 1, rawBb.y1 + pad)
    };
    var cw = bb.x1 - bb.x0 + 1, ch = bb.y1 - bb.y0 + 1;
    var maxDim = 420, k = Math.min(1, maxDim / Math.max(cw, ch));
    var outW = Math.max(8, Math.round(cw * k)), outH = Math.max(8, Math.round(ch * k));

    var tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch;
    tmp.getContext('2d').putImageData(img, -bb.x0, -bb.y0);
    var texCv = document.createElement('canvas'); texCv.width = outW; texCv.height = outH;
    var tcx = texCv.getContext('2d');
    tcx.imageSmoothingEnabled = true; tcx.drawImage(tmp, 0, 0, cw, ch, 0, 0, outW, outH);
    var texData = tcx.getImageData(0, 0, outW, outH);

    function cropMaskToOut(srcBin) {
      var mc = document.createElement('canvas'); mc.width = cw; mc.height = ch;
      var rgba = CV.maskToRGBA(srcBin, W, H, [255, 255, 255], 255);
      mc.getContext('2d').putImageData(new ImageData(rgba, W, H), -bb.x0, -bb.y0);
      var m2 = document.createElement('canvas'); m2.width = outW; m2.height = outH;
      var m2c = m2.getContext('2d'); m2c.drawImage(mc, 0, 0, cw, ch, 0, 0, outW, outH);
      var md = m2c.getImageData(0, 0, outW, outH).data, out = new Uint8Array(outW * outH);
      for (var p = 0; p < outW * outH; p++) out[p] = md[p * 4 + 3] > 110 ? 1 : 0;
      return out;
    }

    var charMask = cropMaskToOut(fullMask);
    var charBridged = cropMaskToOut(bridgedMask || fullMask);
    var inkMask = cropMaskToOut(inkFull);

    var oldSeg = S.seg, oldRig = S.rig;
    var ratio = rawBb.area / Math.max(1, rawBb.w * rawBb.h);
    var conf = Math.max(0.2, Math.min(0.97, 0.36 + ratio * 1.02));

    S.seg = {
      src: img, bb: bb, cw: cw, ch: ch, outW: outW, outH: outH,
      mask: fullMask, bridged: bridgedMask || Uint8Array.from(fullMask),
      ink: inkFull, charMask: charMask, charBridged: charBridged, inkMask: inkMask,
      texData: texData, texCanvas: texCv, scale: k,
      confidence: conf, area: area || rawBb.area, comps: comps || 1
    };
    S.style = SBM.BG.extractStyle(img.data, W, H, inkFull);

    if (preserveManualRig && oldSeg && oldRig && oldRig.joints) {
      // 将人工校正的关节点从旧裁剪框精确映射到新裁剪框，不重新估计覆盖
      var remapped = {};
      Object.keys(oldRig.joints).forEach(function (jName) {
        var pt = oldRig.joints[jName];
        var fullX = oldSeg.bb.x0 + pt[0] * oldSeg.cw / Math.max(1, oldSeg.outW);
        var fullY = oldSeg.bb.y0 + pt[1] * oldSeg.ch / Math.max(1, oldSeg.outH);
        var nx = (fullX - bb.x0) * outW / Math.max(1, cw);
        var ny = (fullY - bb.y0) * outH / Math.max(1, ch);
        remapped[jName] = [Math.max(1, Math.min(outW - 2, nx)), Math.max(1, Math.min(outH - 2, ny))];
      });
      S.rig = {
        template: oldRig.template, w: outW, h: outH,
        joints: remapped, bones: oldRig.bones.map(function (b) { return { name: b.name, a: b.a, b: b.b, parent: b.parent }; })
      };
      rebindRig();
    } else {
      buildRig();
    }
    updateSegUI();
    return S.seg;
  }

  function runSegmentation(silent) {
    var img = grab();
    var rawGray = CV.rgbaToGray(img.data, W, H);
    var normGray = CV.normalizeIllumination(rawGray, W, H, 85);
    var colorSal = CV.colorSalience(img.data, W, H, 38);

    var best = segmentCore(img, normGray, colorSal, 35, 9, 2);
    var bs = scoreSeg(best);
    var variants = [[19, 6, 3], [51, 11, 2], [27, 7, 2], [43, 8, 3], [31, 4, 4]];
    for (var i = 0; i < variants.length; i++) {
      var v = segmentCore(img, normGray, colorSal, variants[i][0], variants[i][1], variants[i][2]);
      var s = scoreSeg(v);
      if (s > bs + 0.02) { bs = s; best = v; }
    }
    if (!best || best.bb.area < 140) {
      if (!silent) status('没找到小主角，请画得更清晰或连贯一些～');
      return null;
    }
    S.manualRig = false;
    S.maskUndo = [];
    return materializeSeg(img, best.mask, best.bridged, best.ink, best.comps, best.bb.area, false);
  }

  function buildRig() {
    if (!S.seg) return;
    var tpl = $('rigTemplate').value;
    var kindHint = $('charKind') ? $('charKind').value : '';
    try {
      S.rig = SBM.Rig.estimate(S.seg.charMask, S.seg.outW, S.seg.outH, {
        template: tpl, flip: !!S.flip, kind: kindHint, bridgedMask: S.seg.charBridged
      });
    } catch (e) { S.rig = SBM.Rig.fallback(S.seg.outW, S.seg.outH, 'humanoid'); }
    if (!S.rig || !S.rig.joints || !S.rig.joints.hip) S.rig = SBM.Rig.fallback(S.seg.outW, S.seg.outH, 'humanoid');
    rebindRig();
  }

  function rebindRig() {
    if (!S.seg || !S.rig) return;
    SBM.Rig.refresh(S.rig);
    S.skinner = SBM.Skin.build(S.seg.texData.data, S.seg.charMask, S.seg.outW, S.seg.outH, S.rig);
    updateInfo();
    if (SBM.Workspace) SBM.Workspace.changed();
  }

  function updateSegUI() {
    if (!S.seg) return;
    var c = S.seg.confidence;
    $('confBar').style.width = Math.round(c * 100) + '%';
    $('confVal').textContent = Math.round(c * 100) + '%';
    $('confNote').textContent = c >= 0.78 ? '轮廓清晰 → 可直接看动画' : '建议用补上/擦掉或拖黄点微调';
    var tplMap = { humanoid: '人形', quadruped: '四足', prop: '飞行器/器物' };
    $('segFoot').innerHTML = '掩码面积 <b>' + S.seg.area + '</b> px · 连通域 <b>' + S.seg.comps +
      '</b> · 裁剪 <b>' + S.seg.outW + '×' + S.seg.outH + '</b> · 模板 <b>' + (S.rig ? (tplMap[S.rig.template] || S.rig.template) : '—') +
      '</b> · 主色 <span style="display:inline-block;width:13px;height:13px;background:rgb(' +
      S.style.palette[0].map(Math.round).join(',') + ');border:2px solid #4A3728;border-radius:50%;vertical-align:-2px"></span>';
    drawSeg();
  }

  function updateInfo() {
    if (!S.rig) {
      ['iRole', 'iSize', 'iJoints', 'iBones'].forEach(function (id) { if ($(id)) $(id).textContent = '—'; });
      if ($('iMotion')) $('iMotion').textContent = SBM.Motion.defs[S.motion.key] ? SBM.Motion.defs[S.motion.key].label : '—';
      if ($('iStory')) $('iStory').textContent = S.story ? S.story.scenes.length + ' 幕' : '—';
      return;
    }
    var tplLabel = { humanoid: '人形', quadruped: '四足', prop: '器物' }[S.rig.template] || S.rig.template;
    if ($('iRole')) $('iRole').textContent = ($('charKind').value || '角色') + ' · ' + tplLabel + (S.manualRig ? ' (已手调)' : '');
    if ($('iSize')) $('iSize').textContent = S.seg ? (S.seg.outW + '×' + S.seg.outH) : '—';
    if ($('iJoints')) $('iJoints').textContent = Object.keys(S.rig.joints).length + ' 个';
    if ($('iBones')) $('iBones').textContent = S.rig.bones.length + ' 根';
    if ($('iMotion')) $('iMotion').textContent = SBM.Motion.defs[S.motion.key] ? SBM.Motion.defs[S.motion.key].label : '—';
    if ($('iStory')) $('iStory').textContent = S.story ? S.story.scenes.length + ' 幕' : '—';
  }

  var INFO_ZERO = ['iRole', 'iSize', 'iJoints', 'iBones'];
  function resetPanels() {
    $('confBar').style.width = '0%';
    $('confVal').textContent = '0%';
    $('confNote').textContent = '还没认识你的小主角';
    $('segFoot').innerHTML = '画好之后点「🔄 重新自动识别」，我就能找到它啦';
    $('storyHint').textContent = '先画一个小主角';
    for (var i = 0; i < INFO_ZERO.length; i++) if ($(INFO_ZERO[i])) $(INFO_ZERO[i]).textContent = '—';
  }

  function isBlank() {
    try {
      var d = dctx.getImageData(0, 0, W, H).data, n = 0;
      for (var i = 0; i < d.length; i += 4 * 53) {
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { n++; if (n > 5) return false; }
      }
      return true;
    } catch (e) { return false; }
  }

  function gentleGuide() {
    status('先在画纸上画一个小主角吧～');
    tip('<b>小提示：</b>画一个有<b>头、身体、手脚</b>的小角色，或者点左侧示例小主角马上体验！');
  }

  function busy(on, msg) {
    var b = $('btnDetect');
    if (b) { b.disabled = !!on; b.textContent = on ? '🔍 识别中…' : '🔄 重新自动识别'; }
    if (on && msg) status(msg);
  }

  function drawSeg(cursorPt) {
    if (!S.seg) return;
    clearCanvas(sctx, sc);
    var bb = S.seg.bb;
    sctx.globalAlpha = S.segView === 'src' ? 1 : 0.34;
    sctx.drawImage(dc, 0, 0);
    sctx.globalAlpha = 1;
    if (S.segView === 'src') return;

    var tmpc = document.createElement('canvas'); tmpc.width = W; tmpc.height = H;
    var t2 = tmpc.getContext('2d');
    var rgba = CV.maskToRGBA(S.seg.mask, W, H, [255, 168, 60], S.segView === 'mask' ? 255 : 120);
    t2.putImageData(new ImageData(rgba, W, H), 0, 0);
    sctx.drawImage(tmpc, 0, 0);

    if (S.segView !== 'mask') {
      var polys = CV.contours(S.seg.mask, W, H);
      sctx.strokeStyle = 'rgba(226,112,58,.95)'; sctx.lineWidth = 2;
      for (var i = 0; i < Math.min(4, polys.length); i++) {
        var pts = CV.simplify(polys[i], 1.6);
        sctx.beginPath();
        for (var j = 0; j < pts.length; j++) sctx[j ? 'lineTo' : 'moveTo'](pts[j][0], pts[j][1]);
        sctx.closePath(); sctx.stroke();
      }
    }

    if (S.rig && (S.segView === 'skeleton' || S.segView === 'overlay')) {
      var ox = bb.x0, oy = bb.y0, kx = S.seg.outW / S.seg.cw, ky = S.seg.outH / S.seg.ch;
      var P = function (pt) { return [ox + pt[0] / kx, oy + pt[1] / ky]; };
      sctx.strokeStyle = '#9a7bf0'; sctx.lineWidth = 5; sctx.lineCap = 'round';
      for (var b = 0; b < S.rig.bones.length; b++) {
        var bo = S.rig.bones[b], A = S.rig.joints[bo.a], B = S.rig.joints[bo.b];
        if (!A || !B) continue;
        var pa = P(A), pb = P(B);
        sctx.beginPath(); sctx.moveTo(pa[0], pa[1]); sctx.lineTo(pb[0], pb[1]); sctx.stroke();
      }
      var names = Object.keys(S.rig.joints);
      for (var n = 0; n < names.length; n++) {
        var p = P(S.rig.joints[names[n]]);
        sctx.beginPath(); sctx.arc(p[0], p[1], 6.5, 0, 6.3);
        sctx.fillStyle = S.manualRig ? '#ff9f1c' : '#ffc93c'; sctx.fill();
        sctx.strokeStyle = '#fff'; sctx.lineWidth = 2; sctx.stroke();
      }
      if (S.rig.joints.head) {
        var hp = P(S.rig.joints.head);
        sctx.fillStyle = '#2fa352'; sctx.font = 'bold 13px sans-serif';
        sctx.fillText(S.rig.template === 'prop' ? '机头' : '头顶', hp[0] + 9, hp[1] - 9);
      }
    }

    // 实时显示掩码修补笔刷圆环
    if (cursorPt && S.fixMode !== 'off') {
      sctx.save();
      sctx.strokeStyle = S.fixMode === 'add' ? '#2fa352' : '#ee4f95';
      sctx.lineWidth = 2;
      sctx.setLineDash([4, 3]);
      sctx.beginPath();
      sctx.arc(cursorPt.x, cursorPt.y, S.fixSize / 2, 0, 6.3);
      sctx.stroke();
      sctx.restore();
    }
  }

  /* 关节拖拽 + 全画幅掩码修补（支持裁剪框外补画与即时视觉反馈） */
  var dragJoint = null;
  function bindSegCanvas() {
    function findJoint(p) {
      if (!S.rig || !S.seg) return null;
      var ox = S.seg.bb.x0, oy = S.seg.bb.y0, kx = S.seg.outW / S.seg.cw, ky = S.seg.outH / S.seg.ch;
      var best = null, bd = 18;
      for (var k in S.rig.joints) {
        var j = S.rig.joints[k];
        var x = ox + j[0] / kx, y = oy + j[1] / ky;
        var d = Math.hypot(x - p.x, y - p.y);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    }
    sc.addEventListener('pointerdown', function (e) {
      if (!S.seg) return;
      if (SBM.Workspace) SBM.Workspace.editStarted();
      var p = canvasPos(sc, e);
      if (S.fixMode !== 'off') {
        S.maskUndo.push(Uint8Array.from(S.seg.mask));
        if (S.maskUndo.length > 8) S.maskUndo.shift();
        S.fixing = true;
        sc.setPointerCapture(e.pointerId);
        fixPaint(p);
        return;
      }
      var j = findJoint(p);
      if (j) { dragJoint = j; sc.setPointerCapture(e.pointerId); }
    });
    sc.addEventListener('pointermove', function (e) {
      var p = canvasPos(sc, e);
      if (S.fixing) { fixPaint(p); return; }
      if (!dragJoint || !S.rig || !S.seg) {
        if (S.fixMode !== 'off') drawSeg(p);
        return;
      }
      var ox = S.seg.bb.x0, oy = S.seg.bb.y0, kx = S.seg.outW / S.seg.cw, ky = S.seg.outH / S.seg.ch;
      var x = (p.x - ox) * kx, y = (p.y - oy) * ky;
      S.rig.joints[dragJoint] = [Math.max(1, Math.min(S.seg.outW - 2, x)), Math.max(1, Math.min(S.seg.outH - 2, y))];
      SBM.Rig.refresh(S.rig); drawSeg();
    });
    function end() {
      if (dragJoint) {
        dragJoint = null;
        S.manualRig = true;
        rebindRig();
        drawSeg();
      }
      if (S.fixing) {
        S.fixing = false;
        commitMaskFix();
      }
    }
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
  }

  /* 直接在 760×540 全尺寸掩码上绘制，突破初始裁剪边界，即时刷新画面 */
  function fixPaint(p) {
    if (!S.seg || !S.seg.mask) return;
    var cx = p.x, cy = p.y, r = Math.max(2, S.fixSize / 2);
    var val = S.fixMode === 'add' ? 1 : 0;
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) {
          S.seg.mask[y * W + x] = val;
        }
      }
    }
    drawSeg(p);
  }

  function commitMaskFix() {
    if (!S.seg) return;
    var check = CV.bbox(S.seg.mask, W, H);
    if (check.area < 24) {
      if (S.maskUndo.length) S.seg.mask = S.maskUndo.pop();
      warn('不能把角色全部擦空哦，已恢复上一步掩码');
      drawSeg();
      return;
    }
    var merged = CV.mergeNearbyComponents(S.seg.mask, W, H, { maxGap: 26, minArea: 16 });
    // 保留用户涂抹的全部前景像素，并生成桥接掩码供骨架连通
    var bridged = Uint8Array.from(S.seg.mask);
    for (var i = 0; i < bridged.length; i++) if (merged.bridged[i]) bridged[i] = 1;
    var cc = CV.connectedComponents(S.seg.mask, W, H);
    materializeSeg(S.seg.src, S.seg.mask, bridged, S.seg.ink, cc.count, check.area, S.manualRig);
    status('掩码已更新' + (S.manualRig ? '（已保留手动校正关节）' : '并重算骨架'));
  }

  /* ================= 步骤3：动画 ================= */
  function outlineColor() {
    var c = S.style && S.style.ink;
    if (!c) return [74, 55, 40];
    return [Math.max(0, c[0] - 25) | 0, Math.max(0, c[1] - 25) | 0, Math.max(0, c[2] - 25) | 0];
  }
  function animScale() {
    var bw = S.seg ? S.seg.outW : 200, bh = S.seg ? S.seg.outH : 200;
    var s = Math.min((H * 0.68) / Math.max(20, bh), (W * 0.82) / Math.max(20, bw));
    return Math.max(0.12, Math.min(2.0, s));
  }
  function drawAnim() {
    clearCanvas(actx, ac);
    if (!S.skinner || !S.rig) return;
    var pose = SBM.Motion.poseAt(S.motion.key, S.motion.phase, S.motion.amp, S.motion.speed);
    var height = S.rig.charHeight || 200;
    var scale = animScale();
    var groundY = 470, cx = 380;
    if ($('showGround').checked) {
      actx.strokeStyle = 'rgba(120,110,100,.35)'; actx.lineWidth = 3;
      actx.beginPath(); actx.moveTo(80, groundY + 6); actx.lineTo(680, groundY + 6); actx.stroke();
      actx.fillStyle = 'rgba(120,110,100,.10)';
      actx.beginPath(); actx.ellipse(cx, groundY + 6, 90 * scale * 1.6, 12, 0, 0, 6.3); actx.fill();
    }
    var anchorX = (S.rig.bboxJ.x0 + S.rig.bboxJ.x1) / 2, anchorY = S.rig.bboxJ.y1;
    actx.save();
    actx.translate(cx, groundY); actx.scale(scale, scale); actx.translate(-anchorX, -anchorY);
    SBM.Skin.render(S.skinner, actx, { deltas: pose.deltas, dx: pose.dx * height, dy: pose.dy * height, rot: pose.rot },
      { quality: S.cfg.quality, outline: { color: outlineColor(), width: 3.2 } });
    actx.restore();
    if ($('motionFoot')) {
      $('motionFoot').innerHTML = '动作 <b>' + pose.label + '</b> · 相位 ' + (S.motion.phase % 1).toFixed(2) +
        ' · 单帧骨骼角：' + S.rig.bones.slice(0, 4).map(function (b) { return b.name + ' ' + b.restAngle.toFixed(0) + '°'; }).join(' / ');
    }
  }

  function animLoop() {
    if (!S.motion.playing) return;
    var now = performance.now();
    var dt = Math.min(0.1, (now - S.motion.last) / 1000); S.motion.last = now;
    var cyc = (SBM.Motion.defs[S.motion.key].cycle) / S.motion.speed;
    S.motion.phase = (S.motion.phase + dt / cyc) % 1;
    drawAnim();
    S.motion.raf = requestAnimationFrame(animLoop);
  }
  function playMotion(on) {
    S.motion.playing = on;
    if (on) { S.motion.last = performance.now(); cancelAnimationFrame(S.motion.raf); animLoop(); }
    else cancelAnimationFrame(S.motion.raf);
    if ($('btnPlay')) $('btnPlay').textContent = on ? '⏸ 暂停' : '▶ 播放';
  }

  /* ================= 步骤4/5：故事分支、逐幕编辑与配音 ================= */
  var BG_LABELS = { space: '星空太空', forest: '奇幻森林', ocean: '蔚蓝海底', castle: '云端城堡', meadow: '阳光草地', home: '温馨卧室' };
  var EMO_LIST = ['好奇', '期待', '开心', '兴奋', '紧张', '着急', '平静', '温柔', '温馨'];

  function renderStory() {
    var st = S.story; if (!st) return;
    var engineTxt = st.engine === 'cloud-vlm' ? '云端多模态视觉+文本模型' : (st.engine === 'cloud-llm' ? '云端文本模型' : '端侧个性化分支引擎');
    var ageTxt = (SBM.Story.AGE_LABEL && st.ageGroup && SBM.Story.AGE_LABEL[st.ageGroup]) ? (' · ' + SBM.Story.AGE_LABEL[st.ageGroup]) : '';
    var visTxt = st.visualSummary ? (' · 画作视觉：' + esc(st.visualSummary)) : '';
    var h = '<h2 class="story-title">' + esc(st.title) + '</h2>' +
      '<div class="story-sub">篇幅：' + st.scenes.length + ' 幕' + ageTxt + ' · 教育目标：' + esc(st.goal) + ' · ' + engineTxt + visTxt +
      (st.warn ? ' <b style="color:#e2703a">（' + esc(st.warn) + '）</b>' : '') + '</div>';

    st.scenes.forEach(function (s, idx) {
      var actLabel = SBM.Motion.defs[s.action] ? SBM.Motion.defs[s.action].label : s.action;
      h += '<div class="scene" data-scene="' + idx + '">' +
        '<div class="scene-top"><h4>' + esc(s.title) + '</h4>' +
        '<button type="button" class="scene-edit-btn" data-edit-scene="' + idx + '">' + (S.editingScene === idx ? '收起编辑' : '✏ 逐幕修改') + '</button></div>' +
        '<span class="tag">场景：' + esc(BG_LABELS[s.bg] || s.bg) + '</span>' +
        '<span class="tag e">情感：' + esc(s.emotion) + '</span>' +
        '<span class="tag">动作：' + esc(actLabel) + '</span>' +
        '<p>' + esc(s.narration) + '</p>' +
        (s.dialogue ? '<p class="dlg">' + esc(s.dialogue) + '</p>' : '') +
        (s.knowledge ? '<p><span class="tag k">趣味小知识</span>' + esc(s.knowledge) + '</p>' : '');

      if (Array.isArray(s.branches) && s.branches.length) {
        h += '<div class="branch-box"><div class="b-title">🔀 选择剧情走向（点击立即切换本幕与结局呼应）：</div><div class="branch-list">';
        s.branches.forEach(function (br) {
          var isOn = s.selectedBranch === br.id ? ' on' : '';
          h += '<button type="button" class="branch-pill' + isOn + '" data-branch-scene="' + idx + '" data-branch-id="' + esc(br.id) + '">' + esc(br.label) + '</button>';
        });
        h += '</div></div>';
      }

      if (S.editingScene === idx) {
        var bgOpts = Object.keys(BG_LABELS).map(function (k) {
          return '<option value="' + k + '"' + (s.bg === k ? ' selected' : '') + '>' + BG_LABELS[k] + '</option>';
        }).join('');
        var actOpts = SBM.Motion.list().map(function (m) {
          return '<option value="' + m.key + '"' + (s.action === m.key ? ' selected' : '') + '>' + m.label + '</option>';
        }).join('');
        var emoOpts = EMO_LIST.map(function (em) {
          return '<option value="' + em + '"' + (s.emotion === em ? ' selected' : '') + '>' + em + '</option>';
        }).join('');
        h += '<div class="scene-editor">' +
          '<label class="row"><span>本幕标题</span><input type="text" id="edTitle_' + idx + '" value="' + esc(s.title) + '"></label>' +
          '<div class="ed-grid">' +
          '<label class="row col"><span>背景</span><select id="edBg_' + idx + '">' + bgOpts + '</select></label>' +
          '<label class="row col"><span>动作</span><select id="edAct_' + idx + '">' + actOpts + '</select></label>' +
          '<label class="row col"><span>情感</span><select id="edEmo_' + idx + '">' + emoOpts + '</select></label>' +
          '</div>' +
          '<label class="row col"><span>旁白内容</span><textarea id="edNarr_' + idx + '" rows="2">' + esc(s.narration) + '</textarea></label>' +
          '<label class="row col"><span>角色台词</span><input type="text" id="edDlg_' + idx + '" value="' + esc(s.dialogue) + '"></label>' +
          '<div class="btn-line right"><button type="button" class="btn ghost" data-cancel-scene="' + idx + '">取消</button>' +
          '<button type="button" class="btn" data-save-scene="' + idx + '">💾 保存本幕修改</button></div>' +
          '</div>';
      }
      h += '</div>';
    });
    h += '<div class="question"><b>💡 亲子互动提问</b><br>' + esc(st.question) + '</div>';
    $('storyWrap').innerHTML = h;
    renderNarration();
    updateInfo();
    if (SBM.Workspace) SBM.Workspace.changed();
  }

  function buildStoryOptions() {
    var vis = (S.style && SBM.BG.describeVisuals) ? SBM.BG.describeVisuals(S.style) : '';
    var opt = {
      name: $('charName').value || '小奇',
      kind: $('charKind').value,
      cmd: $('childCmd').value,
      tone: $('storyTone').value,
      edu: $('eduGoal').value,
      ageGroup: $('ageGroup') ? $('ageGroup').value : '5-6',
      sceneCount: $('sceneCount') ? (+$('sceneCount').value || 3) : 3,
      visualSummary: vis
    };
    if (S.cfg.vision && dc) {
      try { opt.imageDataUrl = dc.toDataURL('image/jpeg', 0.6); } catch (e) { }
    }
    return opt;
  }

  function generateStoryPromise() {
    var opt = buildStoryOptions();
    return SBM.Pipe.wrap('story', function () {
      return SBM.Story.generate(opt, S.cfg);
    }, { side: S.cfg.base ? 'cloud' : 'edge' }).then(function (st) {
      if (st.engine === 'local-template') SBM.Pipe.mark('story', 'ok', st.warn || '端侧个性化引擎', 'edge');
      S.story = st;
      S.editingScene = -1;
      S.book.page = 0;
      if ($('childQuickCmd')) $('childQuickCmd').value = $('childCmd').value;
      renderStory();
      $('storyHint').textContent = st.title + ' · ' + st.scenes.length + ' 幕 · 教育目标：' + st.goal;
      return st;
    });
  }

  function narrationList() {
    if (!S.story) return [];
    var out = [];
    S.story.scenes.forEach(function (s, i) {
      out.push({ text: s.narration, emotion: s.emotion, scene: i });
      if (s.dialogue) out.push({ text: s.dialogue, emotion: s.emotion, scene: i });
    });
    return out;
  }

  function renderNarration() {
    var list = narrationList();
    if (!list.length) { $('narrationWrap').innerHTML = '<div class="empty">还没有旁白</div>'; return; }
    var h = '';
    list.forEach(function (n, i) {
      h += '<div class="narr-row" data-i="' + i + '"><span class="idx">' + (i + 1) + '</span>' +
        '<span class="txt">' + esc(n.text) + '<br><span class="emo">情感 ' + esc(n.emotion) + ' · 第 ' + (n.scene + 1) + ' 幕</span></span></div>';
    });
    if (S.story.question) h += '<div class="question">' + esc(S.story.question) + '</div>';
    $('narrationWrap').innerHTML = h;
  }

  function readAll(onRow) {
    var list = narrationList(); if (!list.length) return Promise.resolve();
    S.reading = true;
    var i = 0;
    function next() {
      if (!S.reading || i >= list.length) { S.reading = false; markRow(-1); return Promise.resolve(); }
      var n = list[i]; markRow(i); if (onRow) onRow(n, i);
      i++;
      return SBM.Voice.speak({
        text: n.text, emotion: S.emotions === 'auto' ? n.emotion : S.emotions,
        rate: +$('vRate').value / 100, pitch: +$('vPitch').value / 100, voiceURI: $('voiceSel').value
      }).then(next);
    }
    return SBM.Pipe.wrap('tts', function () { return next(); }, { note: '浏览器 Web Speech 合成' });
  }
  function markRow(i) {
    var rows = document.querySelectorAll('#narrationWrap .narr-row');
    for (var k = 0; k < rows.length; k++) rows[k].classList.toggle('on', k === i);
  }

  /* ================= 步骤6：绘本与成品导出 ================= */
  function bookScene(i) { return S.story ? S.story.scenes[i] : null; }
  function captionText(scn) {
    var n = scn.narration || '', d = scn.dialogue || '';
    if (!d) return n;
    return (n.length + d.length > 48) ? n : n + ' ' + d;
  }
  function drawEmptyBook(title, sub) {
    var g = bctx;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#FFF7E8'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.85)';
    var clouds = [[150, 130, 1], [600, 100, .8], [660, 300, .6]];
    for (var i = 0; i < clouds.length; i++) {
      var cx = clouds[i][0], cy = clouds[i][1], r = 26 * clouds[i][2];
      g.beginPath();
      g.arc(cx - r, cy, r, 0, 6.3); g.arc(cx, cy - r * .5, r * 1.15, 0, 6.3);
      g.arc(cx + r, cy, r * .9, 0, 6.3); g.rect(cx - r, cy, r * 2, r); g.fill();
    }
    var bx = W / 2, by = H * 0.42, bw = 168, bh = 112;
    g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#4A3728';
    g.fillStyle = '#FFE1A8';
    g.beginPath();
    g.moveTo(bx - bw, by - bh * .5); g.lineTo(bx, by - bh * .5 + 16);
    g.lineTo(bx + bw, by - bh * .5); g.lineTo(bx + bw, by + bh * .5);
    g.lineTo(bx, by + bh * .5 + 16); g.lineTo(bx - bw, by + bh * .5);
    g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(bx, by - bh * .5 + 16); g.lineTo(bx, by + bh * .5 + 16); g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#4A3728';
    g.font = '800 28px "YouYuan","幼圆","PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(title, W / 2, H * 0.74);
    g.font = '600 18px "YouYuan","幼圆","PingFang SC","Microsoft YaHei",sans-serif';
    g.fillStyle = '#A8977F';
    g.fillText(sub, W / 2, H * 0.74 + 36);
    g.restore();
  }

  function drawBookPage() {
    var scn = bookScene(S.book.page);
    if (!scn) {
      $('bookCaption').innerHTML = '<b>正在准备故事绘本～</b><br>点左侧「🔄 换一个新故事」或在家长工坊「④ 讲故事」中生成吧！';
      drawEmptyBook('还没有故事呢～', '点左侧生成故事，马上合成动态绘本！');
      return;
    }
    if (!S.style || !S.skinner || !S.rig) {
      $('bookCaption').innerHTML = '<b>还没认出小主角～</b><br>请先在画纸上画一个小角色！';
      drawEmptyBook('还没认出小主角～', '回到画纸画一个小角色吧！');
      return;
    }
    SBM.Book.compose(bctx, {
      scene: scn, style: S.style, skinner: S.skinner, rig: S.rig,
      phase: S.book.phase, motion: scn.action, amp: 1, speed: 1,
      W: W, H: H, quality: S.cfg.quality, propsSeed: 7 + S.book.page * 13,
      caption: captionText(scn)
    });
    if ($('bookHint')) $('bookHint').textContent = S.story.title + ' · 第 ' + (S.book.page + 1) + '/' + S.story.scenes.length + ' 页';
    $('bookCaption').innerHTML = '<b>第 ' + (S.book.page + 1) + ' / ' + S.story.scenes.length + ' 页 · ' + esc(scn.title) +
      '</b>　情感：' + esc(scn.emotion) + '　动作：' + esc(SBM.Motion.defs[scn.action] ? SBM.Motion.defs[scn.action].label : scn.action) +
      '<br>' + esc(scn.narration) + (scn.dialogue ? ' <span style="color:#7B4AE2;font-weight:700">' + esc(scn.dialogue) + '</span>' : '') +
      (scn.knowledge ? '<br><span style="color:#2FA352">💡 ' + esc(scn.knowledge) + '</span>' : '');
  }

  function bookLoop() {
    if (!S.book.playing) return;
    var now = performance.now();
    var dt = Math.min(0.1, (now - S.book.last) / 1000); S.book.last = now;
    var scn = bookScene(S.book.page);
    var cyc = (SBM.Motion.defs[scn && scn.action] || SBM.Motion.defs.walk).cycle;
    S.book.phase = (S.book.phase + dt / cyc) % 1;
    drawBookPage();
    S.book.raf = requestAnimationFrame(bookLoop);
  }
  function bookGoto(i) {
    if (!S.story) return;
    S.book.page = Math.max(0, Math.min(S.story.scenes.length - 1, i));
    S.book.phase = 0; drawBookPage();
  }
  function bookAutoPlay() {
    if (!S.story || S.book.playing) return;
    S.book.playing = true; S.book.last = performance.now();
    cancelAnimationFrame(S.book.raf); bookLoop();
    setBkPlayBtn();
    scheduleBookPage();
  }
  function bookStop() {
    S.book.playing = false;
    cancelAnimationFrame(S.book.raf); S.book.raf = 0;
    clearTimeout(bookPageTimer);
    SBM.Voice.stop();
    setBkPlayBtn();
  }
  function scheduleBookPage() {
    clearTimeout(bookPageTimer);
    var scn = bookScene(S.book.page);
    if (!scn) return;
    var text = (scn.narration || '') + (scn.dialogue || '');
    var go = function () {
      if (!S.book.playing || !S.story) return;
      if (S.book.page < S.story.scenes.length - 1) { bookGoto(S.book.page + 1); scheduleBookPage(); }
      else { S.book.playing = false; setBkPlayBtn(); }
    };
    if ($('bkRead').checked && text) {
      SBM.Voice.speak({ text: text, emotion: scn.emotion, rate: +$('vRate').value / 100, pitch: +$('vPitch').value / 100, voiceURI: $('voiceSel').value })
        .then(function () { bookPageTimer = setTimeout(go, 500); });
    } else bookPageTimer = setTimeout(go, 3800);
  }
  function setBkPlayBtn() {
    var b = $('bkPlay');
    if (b) b.textContent = S.book.playing ? '⏸ 停止' : '▶ 自动播放';
  }

  /* ================= 本机工程工作区 ================= */
  function projectSnapshot() {
    var editor = {
      charName: $('charName').value, charKind: $('charKind').value,
      cmd: $('childCmd').value, tone: $('storyTone').value, edu: $('eduGoal').value,
      rigTemplate: $('rigTemplate').value, flip: !!S.flip,
      motion: { key: S.motion.key, speed: S.motion.speed, amp: S.motion.amp, phase: S.motion.phase },
      quality: S.cfg.quality, emotions: S.emotions,
      voice: { rate: +$('vRate').value / 100, pitch: +$('vPitch').value / 100, voiceURI: $('voiceSel').value },
      bookPage: S.book.page, step: S.step
    };
    if ($('ageGroup') && $('ageGroup').value !== '5-6') editor.ageGroup = $('ageGroup').value;
    if ($('sceneCount') && +$('sceneCount').value !== 3) editor.sceneCount = +$('sceneCount').value;
    if (S.uiMode === 'parent') editor.uiMode = 'parent';
    return SBM.Workspace.capture(S, dc, editor);
  }

  function commitPreparedProject(prepared) {
    var clean = prepared.clean, editor = clean.editor;
    playMotion(false); bookStop(); S.reading = false; SBM.Voice.stop();
    if (SBM.Sync) { syncConnectRequest++; SBM.Sync.disconnect(); }
    clearTimeout(prefetchTimer); drawingRevision++; syncArtworkToken++;
    drawing = false; dragJoint = null; S.fixing = false; S.fixMode = 'off'; S.undo = []; S.maskUndo = [];
    clearCanvas(dctx, dc); dctx.drawImage(prepared.artwork, 0, 0);
    S.seg = prepared.seg; S.rig = prepared.rig; S.skinner = prepared.skinner; S.manualRig = !!prepared.manualRig;
    S.style = clean.style; S.story = clean.story; S.flip = editor.flip; S.editingScene = -1;
    S.motion.key = editor.motion.key; S.motion.speed = editor.motion.speed;
    S.motion.amp = editor.motion.amp; S.motion.phase = editor.motion.phase;
    S.cfg.quality = editor.quality; S.emotions = editor.emotions;
    S.book.page = editor.bookPage; S.book.phase = 0; S.book.props = {};
    $('charName').value = editor.charName; $('charKind').value = editor.charKind;
    if ($('charKind').value !== editor.charKind) {
      var option = document.createElement('option'); option.value = editor.charKind;
      option.textContent = editor.charKind; $('charKind').appendChild(option); $('charKind').value = editor.charKind;
    }
    $('childCmd').value = editor.cmd;
    if ($('childQuickCmd')) $('childQuickCmd').value = editor.cmd;
    $('storyTone').value = editor.tone; $('eduGoal').value = editor.edu;
    if ($('ageGroup')) $('ageGroup').value = editor.ageGroup || (clean.story && clean.story.ageGroup) || '5-6';
    if ($('sceneCount')) $('sceneCount').value = String(editor.sceneCount || (clean.story && [3,4,6].indexOf(clean.story.scenes.length) >= 0 ? clean.story.scenes.length : 3));
    $('rigTemplate').value = editor.rigTemplate; $('cfgQuality').value = String(editor.quality);
    $('mSpeed').value = Math.round(editor.motion.speed * 100); $('mSpeedVal').textContent = editor.motion.speed.toFixed(1) + '×';
    $('mAmp').value = Math.round(editor.motion.amp * 100); $('mAmpVal').textContent = editor.motion.amp.toFixed(1) + '×';
    $('motionText').value = SBM.Motion.defs[editor.motion.key].label;
    $('motionHint').textContent = '已恢复动作：' + SBM.Motion.defs[editor.motion.key].label + '（暂停）';
    $('vRate').value = Math.round(editor.voice.rate * 100); $('vRateVal').textContent = editor.voice.rate.toFixed(1) + '×';
    $('vPitch').value = Math.round(editor.voice.pitch * 100); $('vPitchVal').textContent = editor.voice.pitch.toFixed(1) + '×';
    if (editor.voice.voiceURI) { $('voiceSel').value = editor.voice.voiceURI; SBM.Voice.voiceURI = editor.voice.voiceURI; }
    SBM.Voice.releaseSample(); $('vocalBar').style.width = '0%'; $('vocalVal').textContent = '未采集';
    document.querySelectorAll('#motionChips .chip').forEach(function (x) { x.classList.toggle('on', x.dataset.m === editor.motion.key); });
    document.querySelectorAll('#emoChips .chip').forEach(function (x) { x.classList.toggle('on', x.dataset.e === editor.emotions); });
    document.querySelectorAll('#sampleChips .chip').forEach(function (x) { x.classList.remove('on'); });
    ['fixAdd','fixDel','fixOff'].forEach(function (id) { if ($(id)) $(id).classList.toggle('on', id === 'fixOff'); });
    clearCanvas(sctx, sc); clearCanvas(actx, ac); clearCanvas(bctx, bc);
    SBM.Pipe.reset();
    if (S.story) { renderStory(); $('storyHint').textContent = S.story.title + ' · 已恢复'; }
    else {
      $('storyWrap').innerHTML = '<div class="empty">还没有故事。在左侧填好角色与想法，点「✨ 生成个性化故事」。</div>';
      $('narrationWrap').innerHTML = '<div class="empty">还没有旁白。请先生成故事。</div>';
      $('storyHint').textContent = '先生成故事';
    }
    if (S.seg) updateSegUI(); else resetPanels();
    updateInfo(); syncSharedArtwork = dc.toDataURL('image/png');
    var targetMode = editor.uiMode || ((editor.step === 2 || editor.step === 4 || editor.step === 5) ? 'parent' : S.uiMode);
    setUIMode(targetMode, true);
    setStep(editor.step, { paused: true });
    status('工程已恢复 · 播放已暂停，跨屏按需重新连接');
  }
  function restoreProject(snapshot) { return SBM.Workspace.restore(snapshot); }

  /* ================= 导出（动作JSON / 图片ZIP / 工程ZIP / 离线有声绘本HTML / 动态视频WebM） ================= */
  function exportMotion() {
    if (!S.rig) { warn('请先完成角色识别'); return; }
    var clip = SBM.Motion.clip(S.rig, S.motion.key, { fps: 30, cycles: 2, amp: S.motion.amp, speed: S.motion.speed });
    SBM.Book.download('motion_' + S.motion.key + '.json', JSON.stringify(clip, null, 2), 'application/json');
    status('已导出动作 JSON（' + clip.frames.length + ' 帧 / 30fps）');
  }
  var Archive = SBM.Archive;
  function renderProjectPreview(scene, index) {
    var off = document.createElement('canvas'); off.width = W; off.height = H;
    SBM.Book.compose(off.getContext('2d'), {
      scene: scene, style: S.style, skinner: S.skinner, rig: S.rig,
      phase: 0.18 + index * 0.17, motion: scene.action, amp: 1, speed: 1,
      W: W, H: H, quality: S.cfg.quality, propsSeed: 7 + index * 13,
      caption: captionText(scene)
    });
    return Archive.dataUrlBytes(off.toDataURL('image/png'));
  }
  function exportProject() {
    if (!S.rig || !S.seg) { warn('请先完成角色识别'); return; }
    if (!S.story || !Array.isArray(S.story.scenes)) { warn('请先生成故事，再导出完整绘本工程'); return; }
    status('正在打包完整工程与绘本预览…');
    try {
      var clip = SBM.Motion.clip(S.rig, S.motion.key, { fps: 30, cycles: 2, amp: S.motion.amp, speed: S.motion.speed });
      var maskCanvas = document.createElement('canvas'); maskCanvas.width = S.seg.outW; maskCanvas.height = S.seg.outH;
      var maskCtx = maskCanvas.getContext('2d'), maskImg = maskCtx.createImageData(S.seg.outW, S.seg.outH);
      for (var mi = 0; mi < S.seg.charMask.length; mi++) { var mv = S.seg.charMask[mi] ? 255 : 0; var mo = mi * 4; maskImg.data[mo] = maskImg.data[mo+1] = maskImg.data[mo+2] = 255; maskImg.data[mo+3] = mv; }
      maskCtx.putImageData(maskImg, 0, 0);
      var snapshot = projectSnapshot();
      var style = snapshot.style;
      var character = snapshot.character;
      var manifest = { format: 'shenbi-maliang-project', version: '0.7.0', created: new Date().toISOString(),
        files: ['artwork.png','character/texture.png','character/mask.png','character/source-mask.png','character/rig.json','motion/clip.json','story/story.json','style/style.json','state/project.json'],
        previews: S.story.scenes.map(function (_, i) { return 'preview/page-' + String(i + 1).padStart(2, '0') + '.png'; }),
        note: '自包含可编辑工程（V0.7）。支持导入、恢复和继续编辑；不含录音、密钥或跨屏房间码。' };
      var entries = [
        { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
        { name: 'artwork.png', data: Archive.dataUrlBytes(dc.toDataURL('image/png')) },
        { name: 'character/texture.png', data: Archive.dataUrlBytes(S.seg.texCanvas.toDataURL('image/png')) },
        { name: 'character/mask.png', data: Archive.dataUrlBytes(maskCanvas.toDataURL('image/png')) },
        { name: 'character/source-mask.png', data: Archive.dataUrlBytes(snapshot.sourceMask) },
        { name: 'character/rig.json', data: JSON.stringify(character, null, 2) },
        { name: 'motion/clip.json', data: JSON.stringify(clip, null, 2) },
        { name: 'story/story.json', data: JSON.stringify(S.story, null, 2) },
        { name: 'style/style.json', data: JSON.stringify(style, null, 2) },
        { name: 'state/project.json', data: JSON.stringify({ format: snapshot.format, version: snapshot.version, editor: snapshot.editor, segMeta: snapshot.segMeta }, null, 2) }
      ];
      S.story.scenes.forEach(function (scene, i) {
        entries.push({ name: 'preview/page-' + String(i + 1).padStart(2, '0') + '.png', data: renderProjectPreview(scene, i) });
      });
      var zip = Archive.zip(entries);
      SBM.Book.download('shenbi_project_' + new Date().toISOString().slice(0, 10) + '.zip', zip, 'application/zip');
      status('完整工程 ZIP 已导出（' + entries.length + ' 个文件）');
      toast('工程打包完成，支持随时导入继续创作', 'ok', 3600);
    } catch (e) { warn('工程打包失败：' + (e && e.message ? e.message : e)); }
  }

  function exportPages() {
    if (!S.story) { warn('请先生成故事'); return; }
    status('正在打包绘本页面…');
    try {
      var entries = [];
      S.story.scenes.forEach(function (scn, i) {
        entries.push({ name: '绘本_第' + String(i + 1).padStart(2, '0') + '页.png', data: renderProjectPreview(scn, i) });
      });
      var zip = Archive.zip(entries);
      SBM.Book.download('神笔马良_绘本全页.zip', zip, 'application/zip');
      status('已导出 ' + entries.length + ' 页绘本图片 ZIP');
      toast('绘本图片已打包为一个 ZIP 文件', 'ok');
    } catch (e) { warn('绘本打包失败：' + (e && e.message ? e.message : e)); }
  }

  function ensureBookReady(cb) {
    ensureRig(function () {
      if (!S.skinner || !S.rig) { warn('请先在画纸上画一个小角色'); return; }
      if (S.story && Array.isArray(S.story.scenes) && S.story.scenes.length) { cb(); return; }
      generateStoryPromise().then(function () { drawBookPage(); cb(); }).catch(function (e) { warn('故事准备失败：' + e.message); });
    });
  }

  function exportOfflineHTMLBook() {
    if (!SBM.Exporter) { warn('导出模块未加载'); return; }
    ensureBookReady(function () {
      var btn = $('btnExportHTMLBook');
      if (btn) btn.disabled = true;
      status('正在渲染各幕动态角色帧并封装离线有声绘本…');
      SBM.Exporter.exportOfflineBook({
        story: S.story, style: S.style, skinner: S.skinner, rig: S.rig,
        characterName: $('charName').value || '小奇',
        characterKind: $('charKind').value || '小朋友',
        quality: S.cfg.quality,
        voiceRate: +$('vRate').value / 100,
        voicePitch: +$('vPitch').value / 100,
        voiceSample: SBM.Voice.sample
      }).then(function (blob) {
        var safeName = ($('charName').value || '小奇').replace(/[\\/:*?"<>|]/g, '_');
        SBM.Book.download('神笔马良_离线有声绘本_' + safeName + '.html', blob, 'text/html;charset=utf-8');
        status('已导出离线动态有声绘本（双击 HTML 即可离线播放分享）');
        toast('离线有声绘本已生成！发给家人直接打开就能看动画听故事', 'ok', 4200);
      }).catch(function (e) {
        warn('离线绘本导出失败：' + (e && e.message ? e.message : e));
      }).finally(function () { if (btn) btn.disabled = false; });
    });
  }

  function exportAnimatedVideo() {
    if (!SBM.Exporter) { warn('导出模块未加载'); return; }
    ensureBookReady(function () {
      var btn = $('btnExportVideo');
      if (btn) { btn.disabled = true; btn.textContent = '🎬 正在录制视频…'; }
      bookStop();
      status('正在录制动态有声绘本视频，请稍候…');
      SBM.Exporter.exportVideo({
        story: S.story, style: S.style, skinner: S.skinner, rig: S.rig,
        quality: S.cfg.quality, fps: 24, secondsPerScene: 2.5,
        onProgress: function (pct, cur, total) {
          status('正在合成有声视频 ' + pct + '%（第 ' + cur + '/' + total + ' 幕）…');
        }
      }).then(function (res) {
        var safeName = ($('charName').value || '小奇').replace(/[\\/:*?"<>|]/g, '_');
        SBM.Book.download('神笔马良_有声动画_' + safeName + '.' + res.ext, res.blob, res.mime);
        status('动态有声视频已导出（.' + res.ext + '）');
        toast('动态有声视频录制完成，可直接保存或分享！', 'ok', 4200);
      }).catch(function (e) {
        warn(e && e.message ? e.message : String(e));
      }).finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = '🎬 导出有声动画视频 (.webm)'; }
      });
    });
  }

  /* ================= 步骤切换 ================= */
  var TIPS = {
    1: '画一个有<b>头、身体、四肢</b>的小主角，涂上漂亮颜色也会被融合进绘本背景和故事里哦！',
    2: '拖动<b>黄点</b>可校正关节点（松手保留人工坐标）；漏掉的手臂可用「➕ 补上」在框外直接涂抹补齐。',
    3: '试试输入「开心地跳舞」「慢慢挥手」「发射升空」，长词优先语义解析会准确驱动角色。',
    4: '支持 3/4/6 幕篇幅与适龄语言，点击紫色的<b>剧情分支胶囊</b>或<b>逐幕修改</b>可深度定制专属故事。',
    5: '录制家长 10 秒声音样本可提取音高与节奏特征调节朗读韵律，并可随离线有声绘本一起保存。',
    6: '不仅能在线自动翻页朗读，还能一键导出<b>离线动态有声绘本 (.html)</b>或<b>有声动画视频</b>分享给家人！'
  };
  function setStep(n, options) {
    S.step = n;
    document.querySelectorAll('.step').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.step === n);
      if (+b.dataset.step < n) b.classList.add('done'); else b.classList.remove('done');
    });
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = +v.dataset.view !== n; });
    document.querySelectorAll('.toolblock').forEach(function (t) { t.hidden = +t.dataset.tool !== n; });
    tip(TIPS[n] || '');
    fitCanvases();
    if (n === 2) { if (!S.seg) { if (isBlank()) gentleGuide(); else doDetect(); } else drawSeg(); }
    if (n === 3) { ensureRig(function () { drawAnim(); playMotion(!(options && options.paused)); }); }
    if (n === 5) { SBM.Voice.voicesReady(populateVoices); }
    if (n === 6) {
      if (S.uiMode === 'child' && !(options && options.paused) && !S.story && !isBlank()) {
        ensureBookReady(function () { drawBookPage(); });
      } else {
        drawBookPage();
      }
    }
  }

  function ensureRig(cb) {
    if (S.skinner && S.rig) { cb(); return; }
    if (isBlank()) { gentleGuide(); cb(); return; }
    SBM.Pipe.wrap('capture', function () { return grab(); })
      .then(function () { return SBM.Pipe.wrap('segment', function () { return runSegmentation(true); }); })
      .then(function (r) {
        if (!r) throw new Error('没看清楚');
        return SBM.Pipe.wrap('pose', function () { if (!S.rig) buildRig(); return S.rig; });
      })
      .then(function () { cb(); })
      .catch(function () { cb(); });
  }

  function doDetect() {
    drawingRevision += 1; clearTimeout(prefetchTimer);
    if (isBlank()) { gentleGuide(); return; }
    busy(true, '正在认真看你的画…');
    var revision = drawingRevision;
    setTimeout(function () { if (revision !== drawingRevision) return; doDetectCore(); }, 40);
  }
  function doDetectCore() {
    SBM.Pipe.wrap('capture', function () { return grab(); })
      .then(function () { return SBM.Pipe.wrap('segment', function () { return runSegmentation(false); }); })
      .then(function (r) {
        if (!r) throw new Error('没找到小主角，再画清楚一点～');
        return SBM.Pipe.wrap('pose', function () { return S.rig; });
      })
      .then(function () { busy(false); status('认出来啦！'); })
      .catch(function (e) { busy(false); warn('还没认出来：' + e.message); });
  }

  /* ================= 事件绑定 ================= */
  function buildSwatches() {
    var cols = ['#2b2b2b', '#e05a4a', '#ff8a3d', '#ffc93c', '#5ec26a', '#4c9aff', '#9a7bf0', '#f472b6', '#8b5a2b', '#7f8c8d'];
    var box = $('swatches'); if (!box) return;
    cols.forEach(function (c, i) {
      var d = document.createElement('div');
      d.className = 'swatch' + (i === 0 ? ' on' : '');
      d.style.background = c;
      d.onclick = function () {
        S.color = c; S.tool = 'pen';
        box.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('on'); });
        d.classList.add('on');
      };
      box.appendChild(d);
    });
  }

  function populateVoices() {
    var vs = SBM.Voice.list(), sel = $('voiceSel'); if (!sel) return;
    if (!vs.length) { sel.innerHTML = '<option value="">（系统默认语音）</option>'; return; }
    var selected = vs.some(function (v) { return v.voiceURI === SBM.Voice.voiceURI; }) ? SBM.Voice.voiceURI : vs[0].voiceURI;
    sel.innerHTML = vs.map(function (v) { return '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === selected ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
    SBM.Voice.voiceURI = selected;
  }

  function startSpeechInput(onText) {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) { status('当前浏览器不支持语音识别，请直接输入文字'); toast('请直接输入文字指令', 'warn'); return; }
    var r = new SR(); r.lang = 'zh-CN'; r.interimResults = false;
    status('请对着麦克风说话…');
    r.onresult = function (e) {
      var txt = e.results[0][0].transcript;
      onText(txt);
      if (SBM.Workspace) SBM.Workspace.changed();
      status('语音已识别：' + txt);
    };
    r.onerror = function () { status('语音识别未能完成，请直接输入文字'); };
    r.start();
  }

  var activeRecHandle = null, samplePlayer = null;

  function bindUI() {
    // 模式切换
    if ($('btnModeChild')) $('btnModeChild').onclick = function () { setUIMode('child'); };
    if ($('btnModeParent')) $('btnModeParent').onclick = function () { setUIMode('parent'); };

    // 儿童模式一键引导按钮
    if ($('btnNextToAnim')) $('btnNextToAnim').onclick = function () { setStep(3); };
    if ($('btnBackToDraw')) $('btnBackToDraw').onclick = function () { playMotion(false); setStep(1); };
    if ($('btnNextToBook')) $('btnNextToBook').onclick = function () {
      playMotion(false);
      ensureBookReady(function () { setStep(6); bookAutoPlay(); });
    };
    if ($('btnChildRemakeStory')) $('btnChildRemakeStory').onclick = function () {
      if ($('childQuickCmd')) $('childCmd').value = $('childQuickCmd').value;
      bookStop();
      generateStoryPromise().then(function () { setStep(6); drawBookPage(); status('新故事绘本已生成！'); });
    };

    // 顶部步骤条
    document.querySelectorAll('.step').forEach(function (b) { b.onclick = function () { setStep(+b.dataset.step); }; });

    // 步骤1：绘制
    var penBtn = $('toolPen'), eraBtn = $('toolEraser');
    penBtn.onclick = function () { S.tool = 'pen'; penBtn.classList.add('on'); penBtn.classList.remove('ghost'); eraBtn.classList.remove('on'); eraBtn.classList.add('ghost'); };
    eraBtn.onclick = function () { S.tool = 'eraser'; eraBtn.classList.add('on'); eraBtn.classList.remove('ghost'); penBtn.classList.remove('on'); penBtn.classList.add('ghost'); };
    $('brushSize').oninput = function () { S.size = +this.value; $('brushSizeVal').textContent = this.value; };
    $('btnUndo').onclick = function () {
      if (S.undo.length) {
        if (SBM.Sync && SBM.Sync.connected) SBM.Sync.markLocalChange();
        dctx.putImageData(S.undo.pop(), 0, 0);
        schedulePrefetch();
        broadcastCanvasIfReady();
      }
    };
    $('btnClear').onclick = function () {
      drawingRevision++; clearTimeout(prefetchTimer);
      if (SBM.Sync && SBM.Sync.connected) SBM.Sync.markLocalChange();
      saveUndo(); clearCanvas(dctx, dc);
      S.seg = null; S.rig = null; S.skinner = null; S.story = null; S.style = null; S.manualRig = false; S.maskUndo = [];
      S.book.page = 0; S.book.phase = 0;
      bookStop(); playMotion(false); S.reading = false; SBM.Voice.stop();
      clearCanvas(sctx, sc); clearCanvas(actx, ac); clearCanvas(bctx, bc);
      $('storyWrap').innerHTML = '<div class="empty">还没有故事。在左侧填好角色与想法，点「✨ 生成个性化故事」。</div>';
      $('narrationWrap').innerHTML = '<div class="empty">还没有旁白。请先生成故事。</div>';
      resetPanels(); updateInfo(); status('画纸擦干净啦，重新画一个吧');
      broadcastCanvasIfReady();
    };
    $('btnUpload').onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var im = new Image();
        im.onload = function () {
          if (SBM.Sync && SBM.Sync.connected) SBM.Sync.markLocalChange();
          saveUndo(); clearCanvas(dctx, dc);
          var k = Math.min(W / im.width, H / im.height);
          dctx.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k);
          schedulePrefetch();
          broadcastCanvasIfReady();
          status('画作已载入，自动执行光照校正与主体提取');
        };
        im.src = r.result;
      };
      r.readAsDataURL(f);
    };
    $('btnNoise').onclick = function () {
      if (SBM.Sync && SBM.Sync.connected) SBM.Sync.markLocalChange();
      saveUndo();
      var c = dctx, cols = ['#cfd8dc', '#b0bec5', '#eceff1'];
      for (var i = 0; i < 26; i++) {
        c.strokeStyle = cols[i % 3]; c.lineWidth = 2 + Math.random() * 4; c.beginPath();
        var x = Math.random() * W, y = Math.random() * H;
        c.moveTo(x, y);
        for (var j = 0; j < 4; j++) c.lineTo(x + (Math.random() - .5) * 160, y + (Math.random() - .5) * 120);
        c.stroke();
      }
      schedulePrefetch();
      broadcastCanvasIfReady();
    };
    document.querySelectorAll('#sampleChips .chip').forEach(function (b) {
      b.onclick = function () { loadSample(b.dataset.sample, b, false); };
    });

    // 步骤2：分割与掩码精修
    document.querySelectorAll('input[name=segview]').forEach(function (r) { r.onchange = function () { S.segView = this.value; drawSeg(); }; });
    $('rigTemplate').onchange = function () { S.manualRig = false; buildRig(); drawSeg(); };
    $('btnDetect').onclick = function () { S.manualRig = false; doDetect(); };
    $('btnFlipUp').onclick = function () { S.flip = !S.flip; S.manualRig = false; buildRig(); drawSeg(); };
    var fixBtns = [$('fixAdd'), $('fixDel'), $('fixOff')];
    fixBtns.forEach(function (b) {
      if (!b) return;
      b.onclick = function () {
        S.fixMode = { fixAdd: 'add', fixDel: 'del', fixOff: 'off' }[b.id];
        fixBtns.forEach(function (x) { if (x) x.classList.toggle('on', x === b); });
        drawSeg();
      };
    });
    if ($('btnMaskUndo')) $('btnMaskUndo').onclick = function () {
      if (!S.seg || !S.maskUndo.length) { toast('没有可撤销的掩码修改', 'warn'); return; }
      S.seg.mask = S.maskUndo.pop();
      commitMaskFix();
      toast('已恢复上一步掩码', 'ok');
    };
    $('fixSize').oninput = function () { S.fixSize = +this.value; $('fixSizeVal').textContent = this.value; };

    // 步骤3：动作
    $('motionText').oninput = function () { applyMotionText(this.value); };
    if ($('btnMotionASR')) $('btnMotionASR').onclick = function () {
      startSpeechInput(function (txt) { $('motionText').value = txt; applyMotionText(txt); });
    };
    document.querySelectorAll('#motionChips .chip').forEach(function (b) {
      b.onclick = function () {
        S.motion.key = b.dataset.m; S.motion.phase = 0;
        var label = SBM.Motion.defs[b.dataset.m] ? SBM.Motion.defs[b.dataset.m].label : b.dataset.m;
        $('motionText').value = label;
        $('motionHint').textContent = '当前动作：' + label;
        document.querySelectorAll('#motionChips .chip').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); drawAnim(); updateInfo();
      };
    });
    $('mSpeed').oninput = function () { S.motion.speed = +this.value / 100; $('mSpeedVal').textContent = (this.value / 100).toFixed(1) + '×'; };
    $('mAmp').oninput = function () { S.motion.amp = +this.value / 100; $('mAmpVal').textContent = (this.value / 100).toFixed(1) + '×'; };
    $('btnPlay').onclick = function () { playMotion(!S.motion.playing); };
    $('btnStop').onclick = function () { playMotion(false); S.motion.phase = 0; drawAnim(); };
    $('btnExportMotion').onclick = exportMotion;

    // 步骤4：个性化分支故事与逐幕编辑
    $('btnASR').onclick = function () {
      startSpeechInput(function (txt) { $('childCmd').value = txt; if ($('childQuickCmd')) $('childQuickCmd').value = txt; });
    };
    $('btnStory').onclick = function () {
      status('正在生成个性化故事…');
      generateStoryPromise().then(function (st) {
        setStep(4);
        status('故事生成完成（' + st.scenes.length + ' 幕）');
      }).catch(function (e) { warn('故事生成失败：' + e.message); });
    };
    $('storyWrap').addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !S.story) return;
      var branchBtn = target.closest ? target.closest('[data-branch-scene]') : null;
      if (branchBtn) {
        var sIdx = +branchBtn.dataset.branchScene;
        var bId = branchBtn.dataset.branchId;
        SBM.Story.applyBranch(S.story, sIdx, bId);
        renderStory();
        status('已切换第 ' + (sIdx + 1) + ' 幕剧情走向，结局已联动更新');
        toast('剧情走向已更新！去绘本看看新变化吧', 'ok');
        return;
      }
      var editBtn = target.closest ? target.closest('[data-edit-scene]') : null;
      if (editBtn) {
        var idx = +editBtn.dataset.editScene;
        S.editingScene = S.editingScene === idx ? -1 : idx;
        renderStory();
        return;
      }
      var cancelBtn = target.closest ? target.closest('[data-cancel-scene]') : null;
      if (cancelBtn) {
        S.editingScene = -1;
        renderStory();
        return;
      }
      var saveBtn = target.closest ? target.closest('[data-save-scene]') : null;
      if (saveBtn) {
        var k = +saveBtn.dataset.saveScene;
        var scn = S.story.scenes[k];
        if (scn) {
          var newNarr = ($('edNarr_' + k).value || '').trim();
          if (!newNarr) { warn('场景旁白不能为空'); return; }
          scn.title = ($('edTitle_' + k).value || scn.title).trim().slice(0, 80);
          scn.bg = $('edBg_' + k).value;
          scn.action = $('edAct_' + k).value;
          scn.emotion = $('edEmo_' + k).value;
          scn.narration = newNarr.slice(0, 1200);
          scn.dialogue = ($('edDlg_' + k).value || '').trim().slice(0, 600);
          S.editingScene = -1;
          renderStory();
          status('第 ' + (k + 1) + ' 幕修改已保存，绘本与配音已同步更新');
          toast('本幕内容已更新', 'ok');
        }
      }
    });

    // 步骤5：配音与录音分析（支持提前停止录制与单实例试听）
    document.querySelectorAll('#emoChips .chip').forEach(function (b) {
      b.onclick = function () {
        S.emotions = b.dataset.e;
        document.querySelectorAll('#emoChips .chip').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
    });
    $('vRate').oninput = function () { $('vRateVal').textContent = (this.value / 100).toFixed(1) + '×'; };
    $('vPitch').oninput = function () { $('vPitchVal').textContent = (this.value / 100).toFixed(1) + '×'; };
    $('btnRec').onclick = function () {
      if (activeRecHandle) {
        activeRecHandle.stop();
        return;
      }
      $('vocalBar').style.width = '0%';
      $('vocalVal').textContent = '正在采集…';
      $('btnRec').textContent = '⏹ 完成采集';
      status('请对着麦克风朗读一句话（可随时点按钮结束）…');
      SBM.Voice.record(10).then(function (h) {
        activeRecHandle = h;
        return h.promise;
      }).then(function (f) {
        $('vocalBar').style.width = '100%';
        $('vocalVal').textContent = '基频 ' + f.f0 + 'Hz · 节奏系数 ' + f.rateAdj + ' · 音高系数 ' + f.pitchAdj;
        status('家长声音特征分析完成（用于调整朗读韵律，不克隆音色）');
      }).catch(function (e) {
        $('vocalVal').textContent = SBM.Voice.sample && SBM.Voice.sample.analyzed === false ? '已保留原声录音，特征未能分析' : '未采集';
        warn('录音分析提示：' + (e && e.message ? e.message : e));
      }).finally(function () {
        activeRecHandle = null;
        $('btnRec').textContent = '🔴 录制样本（10秒）';
      });
    };
    $('btnRecPlay').onclick = function () {
      if (SBM.Voice.sample && SBM.Voice.sample.url) {
        if (samplePlayer) { try { samplePlayer.pause(); } catch (e) { } }
        samplePlayer = new Audio(SBM.Voice.sample.url);
        samplePlayer.play().catch(function (err) { warn('无法播放录音样本：' + err.message); });
      } else {
        toast('还没有录音样本，请先点击录制按钮', 'warn');
      }
    };
    $('btnNarrate').onclick = function () { status('正在朗读故事…'); readAll().then(function () { status('朗读结束'); }); };
    $('btnStopRead').onclick = function () { S.reading = false; SBM.Voice.stop(); status('已停止朗读'); };

    // 步骤6：绘本与成品导出
    $('bkPrev').onclick = function () { bookGoto(S.book.page - 1); };
    $('bkNext').onclick = function () { bookGoto(S.book.page + 1); };
    $('bkPlay').onclick = function () {
      if (!S.story) { ensureBookReady(function () { bookAutoPlay(); }); return; }
      if (S.book.playing) bookStop(); else bookAutoPlay();
    };
    $('btnExportPng').onclick = function () { SBM.Book.downloadCanvas('绘本_第' + (S.book.page + 1) + '页.png', bc); };
    $('btnExportAll').onclick = exportPages;
    $('btnExportProj').onclick = exportProject;
    if ($('btnExportHTMLBook')) $('btnExportHTMLBook').onclick = exportOfflineHTMLBook;
    if ($('btnExportVideo')) $('btnExportVideo').onclick = exportAnimatedVideo;

    // 设置与跨屏协作
    $('btnSettings').onclick = function () { $('settingsModal').hidden = false; };
    $('btnSyncConnect').onclick = function () {
      var room = $('syncRoom').value.trim();
      if (!room) { warn('请先输入家庭协作房间码'); return; }
      var request = ++syncConnectRequest;
      var preserveLocal = syncInitialArtwork !== null && dc.toDataURL('image/png') !== syncInitialArtwork;
      $('syncState').textContent = '正在取得房间画作…';
      SBM.Sync.connect(room, { preserveLocal: preserveLocal }).then(function (info) {
        if (request !== syncConnectRequest) return;
        if (!info.hasArtwork) {
          status('新房间已创建，正在发送本机画作');
          SBM.Sync.send('artwork', { data: dc.toDataURL('image/jpeg', 0.55) });
        } else if (info.conflict) status('本机与房间均有画作，请在设置中选择同步方向');
        else status('已加入现有房间，接收房间画作');
      }).catch(function (e) {
        if (request !== syncConnectRequest) return;
        $('syncState').textContent = '连接失败：' + e.message; warn('跨屏连接失败：' + e.message);
      });
    };
    $('btnSyncDisconnect').onclick = function () { syncConnectRequest++; SBM.Sync.disconnect(); $('syncState').textContent = '未连接'; };
    $('btnCfgCancel').onclick = function () { $('settingsModal').hidden = true; };
    $('btnCfgSave').onclick = function () {
      S.cfg.base = /^https?:$/.test(location.protocol || '') ? S.cfg.serverBase : '';
      S.cfg.key = '';
      S.cfg.model = $('cfgModel').value.trim() || 'qwen-plus';
      S.cfg.vision = !!($('cfgVision') && $('cfgVision').checked);
      S.cfg.quality = +$('cfgQuality').value;
      S.cfg.prefetch = $('cfgPrefetch').checked;
      SBM.Pipe.render();
      $('settingsModal').hidden = true;
      status('设置已保存');
    };
  }

  function applyMotionText(t) {
    var r = SBM.Motion.parse(t);
    S.motion.key = r.key;
    $('mSpeed').value = Math.round(r.speed * 100); $('mSpeedVal').textContent = r.speed.toFixed(1) + '×';
    $('mAmp').value = Math.round(r.amp * 100); $('mAmpVal').textContent = r.amp.toFixed(1) + '×';
    S.motion.speed = r.speed; S.motion.amp = r.amp;
    $('motionHint').textContent = '动作：' + r.label + '（速度 ' + r.speed.toFixed(1) + '×，幅度 ' + r.amp.toFixed(1) + '×）' + (r.hit ? '' : '（默认走路）');
    document.querySelectorAll('#motionChips .chip').forEach(function (x) { x.classList.toggle('on', x.dataset.m === r.key); });
    if (S.step === 3) drawAnim();
    updateInfo();
  }

  /* ================= 自检（?selftest=1） ================= */
  function inkPixels(cv) {
    var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = 0;
    for (var i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++;
    return n;
  }
  function selftest() {
    var steps = [
      function () { setUIMode('parent', true); setStep(2); },
      function () { setStep(3); playMotion(false); drawAnim(); },
      function () { $('btnStory').click(); },
      function () { setStep(5); },
      function () { setStep(6); bookGoto(0); }
    ];
    steps.forEach(function (f, i) { setTimeout(f, 300 + i * 1400); });
    setTimeout(function () {
      var r = {
        seg: !!S.seg, conf: S.seg ? Math.round(S.seg.confidence * 100) : 0,
        maskArea: S.seg ? S.seg.area : 0,
        joints: S.rig ? Object.keys(S.rig.joints).length : 0,
        bones: S.rig ? S.rig.bones.length : 0,
        template: S.rig ? S.rig.template : '',
        story: S.story ? S.story.scenes.length : 0,
        palette: S.style ? S.style.palette.length : 0,
        animPix: inkPixels(ac), bookPix: inkPixels(bc), segPix: inkPixels(sc), drawPix: inkPixels(dc),
        errors: (S.errors || []).slice(0, 5)
      };
      var d = document.createElement('div');
      d.id = 'selftest';
      d.textContent = 'SELFTEST_RESULT ' + JSON.stringify(r);
      document.body.appendChild(d);
      document.title = 'SELFTEST_RESULT';
    }, 300 + steps.length * 1400 + 1500);
  }

  /* ================= 初始化 ================= */
  function init() {
    clearCanvas(dctx, dc); clearCanvas(sctx, sc); clearCanvas(actx, ac); clearCanvas(bctx, bc);
    fitCanvases();
    var rt = null;
    global.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(fitCanvases, 120); });
    buildSwatches(); bindCanvas(); bindSegCanvas(); bindUI();
    global.addEventListener('sbm:sync-artwork', function (e) {
      var detail = e.detail, token = ++syncArtworkToken, localRevision = SBM.Sync.editRevision, localDrawingRevision = drawingRevision;
      function current() { return token === syncArtworkToken && detail.epoch === SBM.Sync.epoch && detail.room === SBM.Sync.room && detail.version === SBM.Sync.version; }
      if (!current()) return;
      if (SBM.Workspace && (SBM.Workspace.restoring || !SBM.Workspace.ready)) { SBM.Sync.deferArtwork(detail, dc.toDataURL('image/jpeg', 0.55), 'project-workspace-busy'); return; }
      if (drawing || SBM.Sync.localDirty || (detail.reason !== 'resolve-remote' && syncSharedArtwork !== null && dc.toDataURL('image/png') !== syncSharedArtwork)) {
        SBM.Sync.deferArtwork(detail, dc.toDataURL('image/jpeg', 0.55)); return;
      }
      var img = new Image();
      img.onload = function () {
        if (!current()) return;
        if (drawing || localRevision !== SBM.Sync.editRevision || localDrawingRevision !== drawingRevision || SBM.Sync.localDirty) {
          SBM.Sync.deferArtwork(detail, dc.toDataURL('image/jpeg', 0.55)); return;
        }
        var before = new CustomEvent('sbm:sync-before-replace', { cancelable: true, detail: {
          artwork: dc.toDataURL('image/png'), room: detail.room, version: detail.version, epoch: detail.epoch, reason: detail.reason
        } });
        if (!global.dispatchEvent(before)) { SBM.Sync.deferArtwork(detail, dc.toDataURL('image/jpeg', 0.55), 'backup-unavailable'); return; }
        saveUndo(); clearCanvas(dctx, dc); dctx.drawImage(img, 0, 0, W, H);
        syncSharedArtwork = dc.toDataURL('image/png');
        SBM.Sync.confirmArtwork(detail);
        schedulePrefetch(); status('已接收家庭协作画作 · 版本 ' + detail.version + '（原画可撤销）');
      };
      img.onerror = function () {
        if (!current()) return;
        SBM.Sync.deferArtwork(detail, dc.toDataURL('image/jpeg', 0.55), 'invalid-image');
        warn('房间图片无法显示，本机画作已保留');
      };
      img.src = detail.data;
    });
    global.addEventListener('sbm:sync-conflict', function (e) {
      if (!syncConflictPanel) {
        syncConflictPanel = document.createElement('div');
        syncConflictPanel.className = 'tipbox';
        var label = document.createElement('p');
        label.textContent = '本机画作已保留，尚未覆盖房间。请选择接下来使用哪份画作：';
        syncConflictPanel.appendChild(label);
        var local = document.createElement('button'), remote = document.createElement('button');
        local.className = remote.className = 'btn ghost';
        local.textContent = '保留本机并发送'; remote.textContent = '接收房间画作';
        local.onclick = function () { if (!SBM.Sync.resolveConflict('local', { data: dc.toDataURL('image/jpeg', 0.55) })) warn(SBM.Sync.lastError || '请稍后再选择'); };
        remote.onclick = function () { if (!SBM.Sync.resolveConflict('remote')) warn(SBM.Sync.lastError || '房间当前没有可接收的画作'); };
        syncConflictPanel.appendChild(local); syncConflictPanel.appendChild(remote);
        $('syncState').parentNode.insertBefore(syncConflictPanel, $('syncState').nextSibling);
      }
      syncConflictPanel.hidden = !e.detail.conflict;
      if (e.detail.conflict) {
        $('settingsModal').hidden = false;
        status('同步画作冲突：本机画作已保留，请选择同步方向');
      }
    });
    global.addEventListener('sbm:sync-error', function (e) { warn(e.detail.message); });
    global.addEventListener('sbm:sync-ack', function () {
      if (!SBM.Sync.localDirty && !SBM.Sync.conflict) syncSharedArtwork = dc.toDataURL('image/png');
    });
    global.addEventListener('sbm:sync-state', function (e) {
      var el = $('syncState'); if (!el) return;
      el.textContent = e.detail.connected ? ('已连接 · 房间 ' + e.detail.room + ' · 版本 ' + e.detail.version) : '未连接';
    });
    SBM.Pipe.render();
    if (/^https?:$/.test(location.protocol || '') && !/\.github\.io$/i.test(location.hostname || '') && typeof fetch === 'function') {
      fetch('/health').then(function (r) { return r.json(); }).then(function (h) {
        if (h && h.llm === 'configured') {
          S.cfg.base = S.cfg.serverBase;
          if ($('netBadge')) { $('netBadge').textContent = '云端已就绪'; $('netBadge').className = 'badge badge-cloud parent-only'; }
        }
      }).catch(function () {});
    }
    SBM.Voice.voicesReady(populateVoices);
    loadSample('stick', document.querySelector('#sampleChips .chip[data-sample="stick"]'), true);
    syncInitialArtwork = dc.toDataURL('image/png');
    syncSharedArtwork = syncInitialArtwork;
    applyMotionText($('motionText').value);
    var initMode = /[?&]mode=parent/.test(location.search || '') ? 'parent' : 'child';
    setUIMode(initMode, true);
    setStep(1);
    status('就绪 · 画好后直接点「✨ 让它动起来」体验吧');
    if (SBM.Workspace) SBM.Workspace.initialize({
      capture: projectSnapshot, commit: commitPreparedProject,
      cancelPending: function () { drawingRevision++; clearTimeout(prefetchTimer); syncArtworkToken++; },
      notify: function (message, error) { if (error) warn(message); else { status(message); toast(message, 'ok'); } }
    });
    if (/selftest/.test(location.search)) setTimeout(selftest, 200);
  }

  SBM.App = {
    state: S,
    setUIMode: setUIMode,
    applyMotionText: applyMotionText,
    fixPaint: fixPaint,
    commitMaskFix: commitMaskFix,
    renderAnim: function (phase, key) {
      if (key) S.motion.key = key;
      S.motion.phase = phase;
      drawAnim();
      return true;
    },
    debug: function () {
      return {
        step: S.step, uiMode: S.uiMode, drawingRevision: drawingRevision, manualRig: S.manualRig,
        seg: S.seg ? { w: S.seg.outW, h: S.seg.outH, conf: Math.round(S.seg.confidence * 100), area: S.seg.area, bb: S.seg.bb } : null,
        rig: S.rig ? { template: S.rig.template, joints: Object.keys(S.rig.joints).length, bones: S.rig.bones.length, charHeight: Math.round(S.rig.charHeight) } : null,
        skin: !!S.skinner,
        skinAlpha: !!(S.skinner && S.skinner.alpha),
        motion: S.motion.key,
        story: S.story ? { title: S.story.title, scenes: S.story.scenes.length, engine: S.story.engine, ageGroup: S.story.ageGroup } : null,
        page: S.book.page,
        palette: S.style ? S.style.palette.length : 0,
        errors: (S.errors || []).slice(0, 5)
      };
    }
  };

  S.errors = [];
  window.addEventListener('error', function (e) {
    var m = (e.message || 'error') + ' @' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0);
    S.errors.push(m);
    toast('出错了：' + (e.message || 'error'), 'err', 5000);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    toast('异步出错：' + ((r && r.message) || r || 'unknown'), 'err', 5000);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
