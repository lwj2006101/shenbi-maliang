/* =============================================================
 * exporter.js —— 动态有声成品导出模块（V0.7 新增 · 对应第 11 项优化）
 * 提供两类面向家长保存与分享的动态有声成品导出：
 *   1. 可离线独立播放的单文件动态有声绘本（.html）：
 *      内嵌多相位动画帧序列、分幕字幕/对话/科普卡、家长录音（如有）
 *      以及内置八音盒轻伴奏 + 离线浏览器语音朗读，双击即可播放。
 *   2. 浏览器端动态有声视频导出（.webm / .mp4）：
 *      基于 Canvas.captureStream + WebAudio 伴奏音轨 + MediaRecorder 合成。
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Exporter = SBM.Exporter = {};

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      if (!blob || !global.FileReader) { resolve(null); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(typeof fr.result === 'string' ? fr.result : null); };
      fr.onerror = function () { resolve(null); };
      fr.readAsDataURL(blob);
    });
  }

  /* 渲染每一幕的多相位关键帧（默认 6 帧循环，640×455 JPEG），兼顾流畅度与单文件体积 */
  Exporter.renderAnimatedFrames = function (opts) {
    var story = opts.story, style = opts.style, skinner = opts.skinner, rig = opts.rig;
    var fw = opts.width || 640, fh = opts.height || 455, phases = opts.phases || 6;
    var off = document.createElement('canvas'); off.width = fw; off.height = fh;
    var ctx = off.getContext('2d');
    var scaleRatio = fw / 760;

    return story.scenes.map(function (scn, idx) {
      var frames = [];
      for (var p = 0; p < phases; p++) {
        var phase = p / phases;
        ctx.save();
        ctx.clearRect(0, 0, fw, fh);
        ctx.scale(scaleRatio, scaleRatio);
        SBM.Book.compose(ctx, {
          scene: scn, style: style, skinner: skinner, rig: rig,
          phase: phase, motion: scn.action || 'walk', amp: 1, speed: 1,
          W: 760, H: 540, quality: opts.quality || 0.8, propsSeed: 7 + idx * 13,
          caption: '' // 离线 HTML 播放器使用高清晰度交互字幕卡，画面留足完整舞台
        });
        ctx.restore();
        frames.push(off.toDataURL('image/jpeg', 0.84));
      }
      return {
        title: scn.title || ('第 ' + (idx + 1) + ' 幕'),
        narration: scn.narration || '',
        dialogue: scn.dialogue || '',
        emotion: scn.emotion || '温馨',
        action: scn.action || 'walk',
        actionLabel: (SBM.Motion && SBM.Motion.defs[scn.action] ? SBM.Motion.defs[scn.action].label : scn.action),
        knowledge: scn.knowledge || '',
        cycle: (SBM.Motion && SBM.Motion.defs[scn.action] ? SBM.Motion.defs[scn.action].cycle : 1.2),
        frames: frames
      };
    });
  };

  /* 构建零外部依赖、双击即可离线播放的动态有声绘本 HTML 字符串 */
  Exporter.buildStandaloneHTML = function (payload) {
    var safeTitle = escHtml(payload.title || '神笔马良动态绘本');
    var dataJson = JSON.stringify({
      title: payload.title,
      authorRole: payload.characterName + '（' + payload.characterKind + '）',
      goal: payload.goal || '',
      question: payload.question || '',
      voiceRate: payload.voiceRate || 1,
      voicePitch: payload.voicePitch || 1,
      recordedAudio: payload.recordedAudio || null,
      scenes: payload.scenes
    }).replace(/<\//g, '<\\/');

    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<title>' + safeTitle + ' · 神笔马良离线有声绘本</title>\n<style>\n' +
      '*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:"YouYuan","PingFang SC","Microsoft YaHei",sans-serif;' +
      'background:linear-gradient(180deg,#FFF9EC 0%,#FFEED2 100%);color:#4A3728;display:flex;flex-direction:column;align-items:center;padding:16px}\n' +
      '.shell{width:min(860px,100%);background:#FFFDF7;border:4px solid #4A3728;border-radius:28px;padding:18px 20px;' +
      'box-shadow:0 8px 0 rgba(74,55,40,.15),0 18px 36px rgba(150,110,60,.16)}\n' +
      '.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}\n' +
      '.head h1{font-size:22px;margin:0;color:#4A3728}.badge{background:#FFE8CB;border:2.5px solid #4A3728;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:800;color:#D96B12}\n' +
      '.stage{position:relative;border:4px solid #4A3728;border-radius:22px;overflow:hidden;background:#EAF6FF;aspect-ratio:760/540;display:grid;place-items:center}\n' +
      '.stage img{width:100%;height:100%;object-fit:contain;display:block}\n' +
      '.page-pill{position:absolute;top:12px;left:12px;background:rgba(255,253,246,.92);border:2.5px solid #4A3728;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:800}\n' +
      '.caption-card{margin-top:14px;background:#FFFFFF;border:3px solid #E3C79E;border-radius:18px;padding:14px 18px;line-height:1.85}\n' +
      '.caption-card h2{margin:0 0 6px;font-size:17px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n' +
      '.tag{font-size:11.5px;background:#DCF0FF;color:#2C93DB;border:2px solid #54B9F7;border-radius:8px;padding:2px 8px}\n' +
      '.dlg{color:#7B4AE2;font-weight:700;margin:6px 0 0}.know{margin-top:8px;background:#DCF7E4;border:2px solid #5FD37E;color:#248A46;padding:6px 10px;border-radius:10px;font-size:13px;font-weight:700}\n' +
      '.controls{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:14px}\n' +
      'button{font-family:inherit;border:3px solid #4A3728;background:#FFA03F;color:#fff;border-radius:14px;padding:10px 16px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 0 #EE7C14}\n' +
      'button.sec{background:#fff;color:#4A3728;border-color:#E3C79E;box-shadow:0 4px 0 #E3C79E}\n' +
      'button:active{transform:translateY(3px);box-shadow:none}\n' +
      '.qbox{margin-top:12px;background:#FFF3CC;border:2.5px dashed #E3C79E;border-radius:14px;padding:10px 14px;font-size:13px}\n' +
      '.foot{margin-top:10px;font-size:12px;color:#9A8877;text-align:center}\n' +
      '</style>\n</head>\n<body>\n<div class="shell">\n' +
      '  <div class="head"><h1 id="bkTitle">' + safeTitle + '</h1><span class="badge" id="bkMeta">离线有声动态绘本</span></div>\n' +
      '  <div class="stage"><span class="page-pill" id="pageIndicator">1 / 1</span><img id="frameImg" alt="绘本动画画面"></div>\n' +
      '  <div class="caption-card"><h2 id="scTitle"></h2><div id="scNarr"></div><div class="dlg" id="scDlg"></div><div class="know" id="scKnow" hidden></div></div>\n' +
      '  <div class="controls">\n' +
      '    <button class="sec" id="prevBtn">⏮ 上一幕</button>\n' +
      '    <button id="playBtn">▶ 自动连播有声绘本</button>\n' +
      '    <button class="sec" id="nextBtn">⏭ 下一幕</button>\n' +
      '    <button class="sec" id="musicBtn">🎵 伴奏：开</button>\n' +
      '    <button class="sec" id="voiceBtn" hidden>👨‍👩‍👧 播放家长录音</button>\n' +
      '  </div>\n' +
      '  <div class="qbox" id="qBox"></div>\n' +
      '  <div class="foot">由「神笔马良 V0.7」生成 · 单文件离线可播放，无需联网</div>\n' +
      '</div>\n<script>\n' +
      'var BOOK = ' + dataJson + ';\n' +
      'var page = 0, frameIdx = 0, playing = false, musicOn = true, animTimer = 0, pageTimer = 0, audioCtx = null, chimeTimer = 0;\n' +
      'var $ = function(id){ return document.getElementById(id); };\n' +
      'if (BOOK.recordedAudio) { $("voiceBtn").hidden = false; $("voiceBtn").onclick = function(){ new Audio(BOOK.recordedAudio).play(); }; }\n' +
      '$("bkMeta").textContent = BOOK.authorRole + (BOOK.goal ? " · " + BOOK.goal : "");\n' +
      '$("qBox").textContent = BOOK.question || "";\n' +
      'function showPage(i){\n' +
      '  page = Math.max(0, Math.min(BOOK.scenes.length - 1, i)); frameIdx = 0;\n' +
      '  var s = BOOK.scenes[page];\n' +
      '  $("pageIndicator").textContent = "第 " + (page + 1) + " / " + BOOK.scenes.length + " 幕";\n' +
      '  $("frameImg").src = s.frames[0];\n' +
      '  $("scTitle").innerHTML = s.title + " <span class=\\"tag\\">" + s.emotion + " · " + s.actionLabel + "</span>";\n' +
      '  $("scNarr").textContent = s.narration;\n' +
      '  $("scDlg").textContent = s.dialogue || "";\n' +
      '  $("scKnow").hidden = !s.knowledge; $("scKnow").textContent = s.knowledge ? ("💡 " + s.knowledge) : "";\n' +
      '}\n' +
      'function startAnim(){\n' +
      '  clearInterval(animTimer);\n' +
      '  animTimer = setInterval(function(){\n' +
      '    var s = BOOK.scenes[page]; if (!s || !s.frames.length) return;\n' +
      '    frameIdx = (frameIdx + 1) % s.frames.length;\n' +
      '    $("frameImg").src = s.frames[frameIdx];\n' +
      '  }, 160);\n' +
      '}\n' +
      'function playChime(){\n' +
      '  if (!musicOn) return;\n' +
      '  var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;\n' +
      '  if (!audioCtx) audioCtx = new AC();\n' +
      '  if (audioCtx.state === "suspended") audioCtx.resume();\n' +
      '  var notes = [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 523.25], step = 0;\n' +
      '  clearInterval(chimeTimer);\n' +
      '  chimeTimer = setInterval(function(){\n' +
      '    if (!playing || !musicOn) return;\n' +
      '    var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();\n' +
      '    osc.type = "sine"; osc.frequency.value = notes[step++ % notes.length];\n' +
      '    gain.gain.setValueAtTime(0.035, audioCtx.currentTime);\n' +
      '    gain.gain.exponentialRampToValueAtTime(0.0008, audioCtx.currentTime + 0.55);\n' +
      '    osc.connect(gain); gain.connect(audioCtx.destination);\n' +
      '    osc.start(); osc.stop(audioCtx.currentTime + 0.58);\n' +
      '  }, 650);\n' +
      '}\n' +
      'function speakScene(s, done){\n' +
      '  clearTimeout(pageTimer);\n' +
      '  var txt = (s.narration || "") + " " + (s.dialogue || "");\n' +
      '  if (window.speechSynthesis && txt.trim()) {\n' +
      '    window.speechSynthesis.cancel();\n' +
      '    var u = new SpeechSynthesisUtterance(txt); u.lang = "zh-CN";\n' +
      '    u.rate = BOOK.voiceRate || 1; u.pitch = BOOK.voicePitch || 1;\n' +
      '    var finished = false; function fin(){ if(finished) return; finished = true; pageTimer = setTimeout(done, 600); }\n' +
      '    u.onend = fin; u.onerror = fin;\n' +
      '    pageTimer = setTimeout(fin, Math.max(4500, txt.length * 280));\n' +
      '    window.speechSynthesis.speak(u);\n' +
      '  } else { pageTimer = setTimeout(done, 4200); }\n' +
      '}\n' +
      'function stopAll(){\n' +
      '  playing = false; clearTimeout(pageTimer); clearInterval(chimeTimer);\n' +
      '  if (window.speechSynthesis) window.speechSynthesis.cancel();\n' +
      '  $("playBtn").textContent = "▶ 自动连播有声绘本";\n' +
      '}\n' +
      'function autoStep(){\n' +
      '  if (!playing) return;\n' +
      '  speakScene(BOOK.scenes[page], function(){\n' +
      '    if (!playing) return;\n' +
      '    if (page < BOOK.scenes.length - 1) { showPage(page + 1); autoStep(); }\n' +
      '    else stopAll();\n' +
      '  });\n' +
      '}\n' +
      '$("prevBtn").onclick = function(){ stopAll(); showPage(page - 1); };\n' +
      '$("nextBtn").onclick = function(){ stopAll(); showPage(page + 1); };\n' +
      '$("musicBtn").onclick = function(){ musicOn = !musicOn; this.textContent = musicOn ? "🎵 伴奏：开" : "🔇 伴奏：关"; if (playing && musicOn) playChime(); };\n' +
      '$("playBtn").onclick = function(){\n' +
      '  if (playing) { stopAll(); return; }\n' +
      '  playing = true; this.textContent = "⏸ 暂停连播"; playChime(); autoStep();\n' +
      '};\n' +
      'showPage(0); startAnim();\n' +
      '<' + '/script>\n<' + '/body>\n<' + '/html>\n';
  };

  Exporter.exportOfflineBook = async function (opts) {
    var scenes = Exporter.renderAnimatedFrames(opts);
    var recDataUrl = (opts.voiceSample && opts.voiceSample.blob) ? await blobToDataUrl(opts.voiceSample.blob) : null;
    var html = Exporter.buildStandaloneHTML({
      title: opts.story.title,
      characterName: opts.characterName || '小奇',
      characterKind: opts.characterKind || '小朋友',
      goal: opts.story.goal || '',
      question: opts.story.question || '',
      voiceRate: opts.voiceRate || 1,
      voicePitch: opts.voicePitch || 1,
      recordedAudio: recDataUrl,
      scenes: scenes
    });
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  };

  Exporter.canRecordVideo = function () {
    if (!global.MediaRecorder || typeof HTMLCanvasElement === 'undefined') return false;
    return typeof HTMLCanvasElement.prototype.captureStream === 'function';
  };

  Exporter.pickVideoMime = function () {
    if (!global.MediaRecorder || typeof global.MediaRecorder.isTypeSupported !== 'function') return '';
    var candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (global.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  };

  /* 浏览器合成导出有声动态视频（WebM / MP4），带八音盒轻柔伴奏音轨与分幕动画字幕 */
  Exporter.exportVideo = function (opts) {
    return new Promise(function (resolve, reject) {
      if (!Exporter.canRecordVideo()) {
        reject(new Error('当前浏览器不支持视频流录制，请使用「导出离线有声绘本(.html)」保存分享'));
        return;
      }
      var story = opts.story;
      var W = 760, H = 540, fps = opts.fps || 24;
      var secPerScene = opts.secondsPerScene || 2.6;
      var totalScenes = story.scenes.length;
      var totalFrames = Math.max(12, Math.round(totalScenes * secPerScene * fps));

      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var stream = cv.captureStream(fps);

      // 合成轻柔八音盒背景音轨写入视频流
      var AC = global.AudioContext || global.webkitAudioContext;
      var actx = null, noteTimer = 0;
      if (AC) {
        try {
          actx = new AC();
          if (actx.createMediaStreamDestination) {
            var dest = actx.createMediaStreamDestination();
            var audioTracks = dest.stream.getAudioTracks();
            if (audioTracks.length) stream.addTrack(audioTracks[0]);
            var melody = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33], ni = 0;
            noteTimer = setInterval(function () {
              if (!actx || actx.state === 'closed') return;
              try {
                var osc = actx.createOscillator(), g = actx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = melody[ni++ % melody.length];
                g.gain.setValueAtTime(0.05, actx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.36);
                osc.connect(g); g.connect(dest);
                osc.start(); osc.stop(actx.currentTime + 0.38);
              } catch (e) { }
            }, 400);
          }
        } catch (e) { actx = null; }
      }

      var mime = Exporter.pickVideoMime();
      var recorder;
      try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2200000 }) : new MediaRecorder(stream); }
      catch (err) {
        if (noteTimer) clearInterval(noteTimer);
        if (actx && actx.close) try { actx.close(); } catch (e) { }
        reject(new Error('无法初始化视频编码器：' + err.message));
        return;
      }

      var chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
      function cleanup() {
        if (noteTimer) clearInterval(noteTimer);
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
        if (actx && actx.close) try { actx.close(); } catch (e) { }
      }
      recorder.onerror = function (e) { cleanup(); reject(e.error || new Error('视频录制中断')); };
      recorder.onstop = function () {
        cleanup();
        var actualMime = recorder.mimeType || mime || 'video/webm';
        var ext = actualMime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
        var blob = new Blob(chunks, { type: actualMime });
        if (!blob.size) { reject(new Error('录制的视频内容为空')); return; }
        resolve({ blob: blob, ext: ext, mime: actualMime });
      };

      recorder.start(200);
      var f = 0;
      var intervalMs = Math.round(1000 / fps);
      var tick = setInterval(function () {
        if (f >= totalFrames) {
          clearInterval(tick);
          try { recorder.stop(); } catch (err) { cleanup(); reject(err); }
          return;
        }
        var tSec = f / fps;
        var sIdx = Math.min(totalScenes - 1, Math.floor(tSec / secPerScene));
        var scn = story.scenes[sIdx];
        var cyc = (SBM.Motion.defs[scn.action] || SBM.Motion.defs.walk).cycle;
        var phase = ((tSec % secPerScene) / cyc) % 1;
        var cap = scn.narration || '';
        if (scn.dialogue && (cap.length + scn.dialogue.length <= 46)) cap += '“' + scn.dialogue + '”';
        SBM.Book.compose(ctx, {
          scene: scn, style: opts.style, skinner: opts.skinner, rig: opts.rig,
          phase: phase, motion: scn.action, amp: 1, speed: 1,
          W: W, H: H, quality: opts.quality || 0.8, propsSeed: 7 + sIdx * 13,
          caption: cap
        });
        // 左上角页标角标
        ctx.save();
        ctx.fillStyle = 'rgba(255,253,246,0.9)';
        ctx.strokeStyle = '#4A3728'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(16, 14, 152, 32, 16) : ctx.rect(16, 14, 152, 32);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#4A3728'; ctx.font = 'bold 14px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(story.title.slice(0, 8) + ' · ' + (sIdx + 1) + '/' + totalScenes, 28, 35);
        ctx.restore();

        if (opts.onProgress && f % 6 === 0) opts.onProgress(Math.min(99, Math.round((f / totalFrames) * 100)), sIdx + 1, totalScenes);
        f++;
      }, intervalMs);
    });
  };
})(window);
