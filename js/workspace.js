/* Local project workspace: capture, atomic image preparation, drafts and import UI (V0.7). */
(function (global) {
  'use strict';
  var SBM = global.SBM, Workspace = SBM.Workspace = { revision: 0, ready: false, restoring: false };
  var hooks = null, timer = null, pending = null, generation = 0, dirty = false, lastSaveWarning = false;
  var $ = function (id) { return document.getElementById(id); };
  function label(text) { var el = $('draftStatus'); if (el) el.textContent = text; }
  function notify(text, error) { if (hooks && hooks.notify) hooks.notify(text, error); }
  function editable(on) { var main = document.querySelector('main'); if (main) main.inert = !on; }
  function hideChoice() { pending = null; var el = $('draftRecovery'); if (el) el.hidden = true; editable(true); }
  function maskUrl(mask, width, height) {
    var c = document.createElement('canvas'); c.width = width; c.height = height;
    var ctx = c.getContext('2d'), image = ctx.createImageData(width, height);
    for (var i = 0; i < mask.length; i++) {
      var at = i * 4; image.data[at] = image.data[at + 1] = image.data[at + 2] = 255;
      image.data[at + 3] = mask[i] ? 255 : 0;
    }
    ctx.putImageData(image, 0, 0); return c.toDataURL('image/png');
  }
  Workspace.capture = function (state, canvas, editor) {
    var seg = state.seg, rig = state.rig;
    var chObj = null;
    if (seg && rig) {
      chObj = {
        name: editor.charName, kind: editor.charKind,
        texture: { w: seg.outW, h: seg.outH }, sourceBounds: seg.bb,
        joints: rig.joints, bones: rig.bones, template: rig.template, charHeight: rig.charHeight
      };
      if (state.manualRig) chObj.manualRig = true;
    }
    return SBM.Project.validate({
      format: 'shenbi-maliang-state', version: 1, artwork: canvas.toDataURL('image/png'),
      character: chObj,
      texture: seg && rig ? seg.texCanvas.toDataURL('image/png') : null,
      mask: seg && rig ? maskUrl(seg.charMask, seg.outW, seg.outH) : null,
      sourceMask: seg && rig ? maskUrl(seg.mask, 760, 540) : null,
      segMeta: seg && rig ? { bb: seg.bb, cw: seg.cw, ch: seg.ch, outW: seg.outW, outH: seg.outH,
        confidence: seg.confidence, area: seg.area, comps: seg.comps } : null,
      story: state.story, style: state.style, editor: editor
    });
  };
  function image(url, width, height, name) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), timeout = setTimeout(function () { finish(new Error(name + '解码超时')); }, 12000), settled = false;
      function finish(error) {
        if (settled) return; settled = true; clearTimeout(timeout); img.onload = img.onerror = null;
        if (error) reject(error); else resolve(img);
      }
      img.onerror = function () { finish(new Error(name + '损坏，当前作品未被替换')); };
      img.onload = function () {
        if ((img.naturalWidth || img.width) !== width || (img.naturalHeight || img.height) !== height) finish(new Error(name + '解码后的尺寸不匹配'));
        else finish();
      };
      try { img.src = url; } catch (e) { finish(new Error(name + '无法解码，当前作品未被替换')); }
    });
  }
  function imageCanvas(img, w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0); return c; }
  function readMask(c) {
    var data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height);
    for (var i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    return out;
  }
  Workspace.prepare = async function (snapshot) {
    var clean = SBM.Project.validate(snapshot), ch = clean.character;
    var images = [image(clean.artwork, 760, 540, '原始画布')];
    if (ch) {
      images.push(image(clean.texture, ch.texture.w, ch.texture.h, '角色纹理'));
      images.push(image(clean.mask, ch.texture.w, ch.texture.h, '角色掩码'));
      if (clean.sourceMask) images.push(image(clean.sourceMask, 760, 540, '全尺寸掩码'));
    }
    var decoded = await Promise.all(images), art = imageCanvas(decoded[0], 760, 540);
    var result = { clean: clean, artwork: art, seg: null, rig: null, skinner: null, manualRig: !!(ch && ch.manualRig) };
    if (!ch) return result;
    var w = ch.texture.w, h = ch.texture.h, tex = imageCanvas(decoded[1], w, h), mask = readMask(imageCanvas(decoded[2], w, h));
    if (!mask.some(function (v) { return v !== 0; })) throw new Error('角色掩码为空，当前作品未被替换');
    var full;
    if (clean.sourceMask) {
      full = readMask(imageCanvas(decoded[3], 760, 540));
      if (!full.some(function (v) { return v !== 0; })) throw new Error('全尺寸角色掩码为空，当前作品未被替换');
    } else {
      full = new Uint8Array(760 * 540);
      var bb = ch.sourceBounds, cw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1;
      for (var y = bb.y0; y <= bb.y1; y++) for (var x = bb.x0; x <= bb.x1; x++) {
        full[y * 760 + x] = mask[Math.min(h - 1, Math.floor((y - bb.y0) * h / bh)) * w + Math.min(w - 1, Math.floor((x - bb.x0) * w / cw))];
      }
    }
    var meta = clean.segMeta, source = art.getContext('2d').getImageData(0, 0, 760, 540);
    result.seg = { src: source, bb: meta.bb, cw: meta.cw, ch: meta.ch, outW: w, outH: h,
      mask: full, bridged: Uint8Array.from(full),
      ink: CV.adaptiveThreshold(CV.rgbaToGray(source.data, 760, 540), 760, 540, 35, 10),
      charMask: mask, texData: tex.getContext('2d').getImageData(0, 0, w, h), texCanvas: tex,
      scale: w / meta.cw, confidence: meta.confidence, area: meta.area, comps: meta.comps };
    result.rig = { template: ch.template, w: w, h: h, joints: ch.joints, bones: ch.bones };
    SBM.Rig.refresh(result.rig);
    result.skinner = SBM.Skin.build(result.seg.texData.data, mask, w, h, result.rig);
    return result;
  };
  Workspace.editStarted = function () { Workspace.revision++; };
  Workspace.changed = function () {
    Workspace.revision++; dirty = true;
    if (!hooks || !Workspace.ready || Workspace.restoring) return;
    label('有更改，正在保存…'); clearTimeout(timer);
    timer = setTimeout(function () { Workspace.save(false); }, 750);
  };
  Workspace.save = function (manual) {
    clearTimeout(timer);
    if (!hooks || !Workspace.ready || Workspace.restoring) {
      if (manual) notify('请先完成草稿恢复选择或等待工程读取完成', true);
      return Promise.resolve(false);
    }
    var snapshot, revision = Workspace.revision;
    try { snapshot = hooks.capture(); }
    catch (e) { label('草稿未保存：' + e.message); if (manual) notify(e.message, true); return Promise.resolve(false); }
    label('正在保存草稿…');
    return SBM.Project.saveDraft(snapshot).then(function (record) {
      if (Workspace.revision === revision) {
        dirty = false; label('已保存草稿 · ' + new Date(record.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
      lastSaveWarning = false; if (manual) notify('草稿已保存在本机浏览器'); return true;
    }).catch(function (e) {
      label('草稿保存失败，请导出工程');
      if (manual || !lastSaveWarning) notify(e.message, true);
      lastSaveWarning = true; return false;
    });
  };
  Workspace.restore = async function (snapshot, options) {
    options = options || {};
    var revision = options.revision == null ? Workspace.revision : options.revision, token = ++generation, committed = false;
    clearTimeout(timer); Workspace.restoring = true;
    if (hooks && hooks.cancelPending) hooks.cancelPending();
    try {
      var prepared = await Workspace.prepare(snapshot);
      if (token !== generation || revision !== Workspace.revision) throw new Error('读取期间作品有新修改，已取消恢复；当前作品保留');
      if (!hooks) throw new Error('工作区尚未初始化');
      hooks.commit(prepared); committed = true; Workspace.ready = true; hideChoice();
      notify(options.message || '作品已恢复，可继续编辑');
      return prepared.clean;
    } finally {
      if (token === generation) {
        Workspace.restoring = false;
        if (committed) Workspace.changed();
        else if (dirty && Workspace.ready) timer = setTimeout(function () { Workspace.save(false); }, 750);
      }
    }
  };
  Workspace.initialize = function (callbacks) {
    hooks = callbacks;
    $('btnSaveDraft').onclick = function () { Workspace.save(true); };
    $('btnImportProject').onclick = function () { $('projectFileInput').click(); };
    $('projectFileInput').onchange = async function () {
      var file = this.files[0]; this.value = ''; if (!file) return;
      var revision = Workspace.revision;
      label('正在检查工程文件…'); $('btnImportProject').disabled = true;
      try { var snapshot = await SBM.Project.fromZip(file); await Workspace.restore(snapshot, { revision: revision, message: '工程已导入，可继续编辑和导出' }); }
      catch (e) { label('导入失败，当前作品保留'); notify(e.message, true); }
      finally { $('btnImportProject').disabled = false; }
    };
    $('btnRestoreDraft').onclick = function () {
      if (!pending) return;
      Workspace.restore(pending.snapshot).catch(function (e) { label('恢复失败，原草稿保留'); notify(e.message, true); });
    };
    $('btnStartFresh').onclick = function () { hideChoice(); Workspace.ready = true; Workspace.changed(); notify('已开始新作品，之后的修改会更新本机草稿'); };
    var tracked = ['charName','charKind','childCmd','storyTone','eduGoal','ageGroup','sceneCount','mSpeed','mAmp','motionText','vRate','vPitch','rigTemplate','cfgQuality'];
    function input(e) { if (e.target && tracked.indexOf(e.target.id) >= 0) Workspace.changed(); }
    document.addEventListener('input', input); document.addEventListener('change', input);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (b && (b.dataset.step || ['btnUndo','btnClear','btnFlipUp','btnCfgSave','bkNext','bkPrev','btnModeChild','btnModeParent'].indexOf(b.id) >= 0 || (b.parentNode && ['motionChips','emoChips','sampleChips'].indexOf(b.parentNode.id) >= 0))) Workspace.changed();
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && dirty) Workspace.save(false); });
    global.addEventListener('pagehide', function () { if (dirty) Workspace.save(false); });
    label('正在检查本机草稿…'); editable(false); $('btnImportProject').disabled = true;
    var startupGeneration = generation;
    return SBM.Project.loadDraft().then(function (record) {
      if (generation !== startupGeneration || Workspace.ready) return;
      if (record) {
        pending = record; $('draftRecovery').hidden = false; $('btnRestoreDraft').disabled = false;
        $('draftRecoveryText').textContent = '发现上次作品（' + new Date(record.savedAt).toLocaleString() + '）。恢复后继续创作，或开始新作品并替换这份草稿。';
        label('请选择恢复草稿或开始新作品');
      } else { Workspace.ready = true; editable(true); Workspace.changed(); }
    }).catch(function (e) {
      if (generation !== startupGeneration || Workspace.ready) return;
      pending = null; Workspace.ready = false; $('draftRecovery').hidden = false; $('btnRestoreDraft').disabled = true;
      $('draftRecoveryText').textContent = '本机草稿暂时无法读取，原记录已保留。可以导入工程，或选择开始新作品后替换旧草稿。';
      label('原草稿已保护，请选择如何继续'); notify(e.message, true);
    }).finally(function () { $('btnImportProject').disabled = false; });
  };
})(window);
