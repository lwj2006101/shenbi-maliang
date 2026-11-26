/* =============================================================
 * voice.js —— 情感化语音合成 + 家长录音特征分析
 * 对应报告 3.2.4：
 *   · 当前实现：浏览器 Web Speech 合成 + 情感韵律参数（语速/音高）
 *   · 录音样本：短时录音 + 自相关基频估计 → 音调/语速偏移；不执行音色克隆
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Voice = SBM.Voice = { sample: null, voiceURI: null, recorder: null, recordTimer: null };
  var recording = false;

  function finiteOr(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  var EMOTION = {
    '好奇': { rate: 1.05, pitch: 1.18 }, '兴奋': { rate: 1.20, pitch: 1.25 },
    '紧张': { rate: 1.25, pitch: 1.12 }, '着急': { rate: 1.28, pitch: 1.15 },
    '开心': { rate: 1.15, pitch: 1.22 }, '期待': { rate: 1.06, pitch: 1.12 },
    '温馨': { rate: 0.90, pitch: 0.98 }, '温柔': { rate: 0.85, pitch: 0.92 },
    '平静': { rate: 0.95, pitch: 1.00 }, '害怕': { rate: 1.10, pitch: 1.20 }
  };
  Voice.EMOTION = EMOTION;

  Voice.emotionParams = function (emo) {
    return EMOTION[emo] || { rate: 1, pitch: 1 };
  };

  Voice.supported = function () { return !!global.speechSynthesis; };

  Voice.list = function () {
    if (!global.speechSynthesis) return [];
    var vs = global.speechSynthesis.getVoices() || [];
    return vs.filter(function (v) { return /zh|CN|Chinese/i.test(v.lang + v.name); });
  };

  Voice.voicesReady = function (cb) {
    if (!global.speechSynthesis) return cb([]);
    var v = Voice.list();
    if (v.length) return cb(v);
    var done = false;
    global.speechSynthesis.onvoiceschanged = function () {
      if (done) return; done = true; cb(Voice.list());
    };
    setTimeout(function () { if (!done) { done = true; cb(Voice.list()); } }, 1200);
  };

  /**
   * 朗读
   * @param opts {text, emotion, rate, pitch, voiceURI, onstart, onend}
   */
  Voice.speak = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!global.speechSynthesis) { if (opts.onend) opts.onend(); return resolve(false); }
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(opts.text);
      var em = Voice.emotionParams(opts.emotion);
      u.lang = 'zh-CN';
      // 未分析成功的录音仍可试听，但不能把缺失的特征传入朗读参数。
      var sample = Voice.sample && Voice.sample.analyzed === true ? Voice.sample : null;
      u.rate = Math.max(0.1, Math.min(2, finiteOr(opts.rate, 1) * em.rate * finiteOr(sample && sample.rateAdj, 1)));
      u.pitch = Math.max(0, Math.min(2, finiteOr(opts.pitch, 1) * em.pitch * finiteOr(sample && sample.pitchAdj, 1)));
      u.volume = 1;
      var vs = global.speechSynthesis.getVoices() || [];
      var want = opts.voiceURI || Voice.voiceURI;
      for (var i = 0; i < vs.length; i++) if (vs[i].voiceURI === want) u.voice = vs[i];
      if (!u.voice) for (var j = 0; j < vs.length; j++) if (/zh/i.test(vs[j].lang)) { u.voice = vs[j]; break; }
      u.onend = function () { if (opts.onend) opts.onend(); resolve(true); };
      u.onerror = function () { if (opts.onend) opts.onend(); resolve(false); };
      global.speechSynthesis.speak(u);
    });
  };

  Voice.stop = function () { if (global.speechSynthesis) global.speechSynthesis.cancel(); };

  Voice.releaseSample = function () {
    if (Voice.sample && Voice.sample.url) { try { URL.revokeObjectURL(Voice.sample.url); } catch (e) { } }
    Voice.sample = null;
  };

  /* ---------- 录音样本采集 ---------- */
  Voice.record = function (seconds) {
    if (recording) return Promise.reject(new Error('录音或分析正在进行，请稍后再试'));
    seconds = Math.max(1, Math.min(60, finiteOr(seconds, 10)));
    if (!global.navigator || !global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('当前环境不支持录音（需 https 或 localhost）'));
    }
    if (!global.MediaRecorder) return Promise.reject(new Error('当前浏览器不支持录音，请更换浏览器'));
    recording = true;
    Voice.releaseSample();
    return global.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mr;
      try { mr = new global.MediaRecorder(stream); }
      catch (err) { stream.getTracks().forEach(function (t) { t.stop(); }); throw err; }
      Voice.recorder = mr;
      var chunks = [], finished = false;
      function cleanup() {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (Voice.recorder === mr) Voice.recorder = null;
        if (Voice.recordTimer) { clearTimeout(Voice.recordTimer); Voice.recordTimer = null; }
      }
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var fail;
      var p = new Promise(function (res, rej) {
        fail = function (err) {
          if (finished) return;
          finished = true;
          try { if (mr.state !== 'inactive') mr.stop(); } catch (e) { }
          cleanup();
          rej(err);
        };
        mr.onerror = function (e) { fail(e.error || new Error('录音设备出错，请重试')); };
        mr.onstop = function () {
          if (finished) return;
          finished = true;
          cleanup();
          var blob, raw;
          try {
            blob = new Blob(chunks, { type: mr.mimeType || (chunks[0] && chunks[0].type) || 'audio/webm' });
            if (!blob.size) throw new Error('没有录到音频，请检查麦克风后重试');
            raw = { url: URL.createObjectURL(blob), blob: blob, analyzed: false };
          } catch (err) { rej(err); return; }
          Voice.sample = raw;
          Voice.analyze(blob).then(function (feat) {
            feat.url = raw.url;
            feat.blob = blob;
            Voice.sample = feat;
            res(feat);
          }).catch(function (err) {
            raw.analysisError = err && err.message ? err.message : String(err);
            rej(new Error('录音已保留，可试听；声音特征未能分析：' + raw.analysisError));
          });
        };
      }).finally(function () {
        recording = false;
      });
      function stop() { try { if (mr.state !== 'inactive') mr.stop(); } catch (err) { fail(err); } }
      try {
        mr.start();
        Voice.recordTimer = setTimeout(stop, seconds * 1000);
      } catch (err) { fail(err); }
      return { promise: p, stop: stop };
    }).catch(function (err) {
      recording = false;
      throw err;
    });
  };

  Voice.analyze = function (blob) {
    if (!blob || blob.size === 0) return Promise.reject(new Error('录音为空，请重新录制'));
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return Promise.reject(new Error('当前浏览器不支持录音分析'));
    var ctx = null;
    return Promise.resolve().then(function () {
      if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = function () { rej(fr.error || new Error('无法读取录音')); };
        fr.readAsArrayBuffer(blob);
      });
    }).then(function (ab) {
      ctx = new AC();
      return ctx.decodeAudioData(ab).then(function (buf) {
        var d = buf.getChannelData(0), sr = buf.sampleRate;
        if (!isFinite(sr) || sr <= 0 || !isFinite(buf.duration) || buf.duration < 0.2 || d.length < sr * 0.2) {
          throw new Error('录音过短，至少需要 0.2 秒清晰声音');
        }
        // 以最响亮的短窗分析音高，避免固定取样落在开头/中间的停顿。
        var voiced = 0, frames = 0, win = Math.min(2048, d.length), bestEnergy = 0, start = 0, rmsSum = 0, rmsCount = 0;
        for (var k = 0; k < d.length; k += 7) { rmsSum += d[k] * d[k]; rmsCount++; }
        for (var p = 0; p + win <= d.length; p += Math.max(1, Math.floor(win / 2))) {
          var energy = 0, count = 0;
          for (var q = 0; q < win; q += 3) { energy += d[p + q] * d[p + q]; count++; }
          energy = Math.sqrt(energy / count);
          if (energy > 0.02) voiced++;
          frames++;
          if (energy > bestEnergy) { bestEnergy = energy; start = p; }
        }
        if (bestEnergy <= 0.02) throw new Error('未检测到清晰声音，请靠近麦克风说话后重试');
        var N = win;
        var seg = new Float32Array(N), mean = 0;
        for (var m = 0; m < N; m++) mean += d[start + m];
        mean /= N;
        for (var n = 0; n < N; n++) seg[n] = d[start + n] - mean;
        var best = 0, bestLag = 0, corr = [];
        var minLag = Math.max(1, Math.floor(sr / 400)), maxLag = Math.min(N - 2, Math.ceil(sr / 70));
        for (var lag = minLag; lag <= maxLag; lag++) {
          var s = 0, e1 = 0, e2 = 0;
          for (var i = 0; i < N - lag; i++) { s += seg[i] * seg[i + lag]; e1 += seg[i] * seg[i]; e2 += seg[i + lag] * seg[i + lag]; }
          corr[lag] = e1 && e2 ? s / Math.sqrt(e1 * e2) : 0;
          if (corr[lag] > best) { best = corr[lag]; bestLag = lag; }
        }
        if (!bestLag || best < 0.65) throw new Error('未能估计稳定音高，请在安静环境重新录制');
        // 选首个可靠局部峰，避免把音高的整数倍周期当作基频。
        for (var l = minLag + 1; l < maxLag; l++) {
          if (corr[l] >= best * 0.93 && corr[l] >= 0.65 && corr[l] >= corr[l - 1] && corr[l] >= corr[l + 1]) { bestLag = l; break; }
        }
        var f0 = sr / bestLag, rms = Math.sqrt(rmsSum / rmsCount);
        // 有声片段占比只作为韵律调整的启发式系数，不是实际语速测量。
        var vr = frames ? voiced / frames : 0;
        var pitchAdj = Math.max(0.7, Math.min(1.35, f0 / 180));
        var rateAdj = Math.max(0.75, Math.min(1.3, 0.72 + vr * 0.7));
        var result = { analyzed: true, f0: Math.round(f0), rms: Math.round(rms * 1000) / 1000, voicedRatio: Math.round(vr * 100) / 100, duration: Math.round(buf.duration * 10) / 10, pitchAdj: Math.round(pitchAdj * 100) / 100, rateAdj: Math.round(rateAdj * 100) / 100 };
        if (!isFinite(f0) || !isFinite(rms) || !isFinite(vr)) throw new Error('录音特征无效，请重新录制');
        return result;
      });
    }).finally(function () {
      if (!ctx || !ctx.close) return;
      try { return Promise.resolve(ctx.close()).catch(function () {}); } catch (e) { }
    });
  };
})(window);
