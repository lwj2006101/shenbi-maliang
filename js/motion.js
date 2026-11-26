/* =============================================================
 * motion.js —— 文本驱动动作生成与长词优先中文语义解析（V0.7 增强版）
 * 修复“跳舞”被单字“跳”抢先匹配为“跳跃”的缺陷，支持长词优先、
 * 否定停止词识别与速度/幅度副词组合。
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Motion = SBM.Motion = {};
  var TAU = Math.PI * 2;
  function S(t, f) { return Math.sin(TAU * (f === undefined ? t : t * f)); }
  function C(t, f) { return Math.cos(TAU * (f === undefined ? t : t * f)); }

  var DEFS = {
    idle: {
      label: '待机呼吸', cycle: 4.0, fn: function (t, a) {
        var s = S(t);
        return { d: { torso: 1.2 * s * a, head: -1.0 * s * a, l_upper_arm: 2.0 * s * a, r_upper_arm: -2.0 * s * a, l_lower_arm: 1.5 * a, r_lower_arm: -1.5 * a }, root: { dy: -0.004 * s * a } };
      }
    },
    walk: {
      label: '走路', cycle: 1.1, fn: function (t, a) {
        var s = S(t), c = C(t);
        return {
          d: {
            torso: 3 * s * a, head: -2 * s * a,
            l_upper_leg: 26 * s * a, r_upper_leg: -26 * s * a,
            l_lower_leg: -34 * (0.5 - 0.5 * C(t - 0.15)) * a, r_lower_leg: -34 * (0.5 - 0.5 * C(t + 0.35)) * a,
            l_upper_arm: -22 * s * a, r_upper_arm: 22 * s * a,
            l_lower_arm: -12 - 8 * c * a, r_lower_arm: -12 + 8 * c * a,
            tail: 8 * s * a
          },
          root: { dy: -0.018 * C(t, 2) * a, rot: 1.2 * s * a }
        };
      }
    },
    run: {
      label: '跑步', cycle: 0.72, fn: function (t, a) {
        var s = S(t);
        return {
          d: {
            torso: -12 * a + 4 * s * a, head: 6 * a - 3 * s * a,
            l_upper_leg: 42 * s * a, r_upper_leg: -42 * s * a,
            l_lower_leg: -62 * (0.5 - 0.5 * C(t - 0.2)) * a, r_lower_leg: -62 * (0.5 - 0.5 * C(t + 0.3)) * a,
            l_upper_arm: -50 * s * a, r_upper_arm: 50 * s * a,
            l_lower_arm: -70 * a, r_lower_arm: -70 * a,
            tail: -14 * s * a
          },
          root: { dy: -0.035 * C(t, 2) * a, rot: -4 * a }
        };
      }
    },
    jump: {
      label: '跳跃', cycle: 1.3, fn: function (t, a) {
        var d = { torso: 0, head: 0, l_upper_arm: 0, r_upper_arm: 0, l_lower_arm: 0, r_lower_arm: 0, l_upper_leg: 0, r_upper_leg: 0, l_lower_leg: 0, r_lower_leg: 0, tail: 0 };
        var rt = { dx: 0, dy: 0, rot: 0 };
        if (t < 0.22) {
          var k = t / 0.22;
          d.l_upper_leg = d.r_upper_leg = 26 * k * a;
          d.l_lower_leg = d.r_lower_leg = -46 * k * a;
          d.l_upper_arm = d.r_upper_arm = -46 * k * a;
          d.torso = 14 * k * a; rt.dy = 0.05 * k * a;
        } else if (t < 0.62) {
          var k2 = (t - 0.22) / 0.40, sn = Math.sin(Math.PI * k2);
          rt.dy = -0.34 * sn * a;
          d.l_upper_leg = -34 * sn * a; d.r_upper_leg = -18 * sn * a;
          d.l_lower_leg = -30 * sn * a; d.r_lower_leg = -46 * sn * a;
          d.l_upper_arm = d.r_upper_arm = -128 * sn * a;
          d.torso = -8 * sn * a; d.head = 6 * sn * a;
        } else if (t < 0.86) {
          var k3 = (t - 0.62) / 0.24;
          d.l_upper_leg = d.r_upper_leg = 30 * k3 * a;
          d.l_lower_leg = d.r_lower_leg = -50 * k3 * a;
          d.l_upper_arm = d.r_upper_arm = 40 * k3 * a;
          d.torso = 12 * k3 * a; rt.dy = 0.03 * k3 * a;
        } else {
          var k4 = (t - 0.86) / 0.14;
          d.l_upper_leg = d.r_upper_leg = 30 * (1 - k4) * a;
          d.l_lower_leg = d.r_lower_leg = -50 * (1 - k4) * a;
          d.torso = 12 * (1 - k4) * a; rt.dy = 0.03 * (1 - k4) * a;
        }
        return { d: d, root: rt };
      }
    },
    wave: {
      label: '挥手', cycle: 1.6, fn: function (t, a) {
        var s = S(t, 2);
        return {
          d: {
            torso: 1.4 * S(t) * a, head: -3 * a,
            r_upper_arm: -142 * a + 6 * s * a, r_lower_arm: 18 * a + 16 * s * a,
            l_upper_arm: 6 * a, l_lower_arm: -8 * a,
            l_upper_leg: 2 * a, r_upper_leg: -2 * a
          },
          root: { dy: -0.006 * S(t) * a }
        };
      }
    },
    dance: {
      label: '跳舞', cycle: 1.0, fn: function (t, a) {
        var s = S(t);
        return {
          d: {
            torso: 11 * s * a, head: -9 * s * a,
            l_upper_arm: -78 * a + 46 * s * a, r_upper_arm: -78 * a - 46 * s * a,
            l_lower_arm: -34 * a - 18 * s * a, r_lower_arm: -34 * a + 18 * s * a,
            l_upper_leg: 16 * s * a, r_upper_leg: -16 * s * a,
            l_lower_leg: -18 * a, r_lower_leg: -18 * a,
            tail: 18 * s * a
          },
          root: { dy: -0.032 * Math.abs(S(t)) * a, rot: 5 * s * a }
        };
      }
    },
    fly: {
      label: '飞翔', cycle: 1.4, fn: function (t, a) {
        var s = S(t);
        return {
          d: {
            torso: -10 * a, head: 8 * a,
            l_upper_arm: -104 * a + 44 * s * a, r_upper_arm: -104 * a - 44 * s * a,
            l_lower_arm: -16 * a, r_lower_arm: -16 * a,
            l_upper_leg: 16 * a + 12 * s * a, r_upper_leg: 16 * a - 12 * s * a,
            l_lower_leg: -26 * a, r_lower_leg: -26 * a,
            tail: 12 * s * a
          },
          root: { dy: -0.10 * a + 0.035 * s * a, rot: -6 * a }
        };
      }
    },
    nod: {
      label: '点头', cycle: 1.8, fn: function (t, a) {
        return { d: { head: 13 * S(t) * a, torso: 1.5 * S(t) * a, l_upper_arm: 2 * a, r_upper_arm: -2 * a }, root: {} };
      }
    },
    wag: {
      label: '摇尾巴', cycle: 1.1, fn: function (t, a) {
        var s = S(t, 2);
        return { d: { tail: 38 * s * a, head: -6 * s * a, torso: 3 * s * a, l_upper_leg: 2 * a, r_upper_leg: -2 * a }, root: { dy: -0.005 * s * a } };
      }
    },
    sleep: {
      label: '睡觉', cycle: 5.0, fn: function (t, a) {
        var s = S(t);
        return { d: { head: 16 * a + 1.6 * s * a, torso: 5 * a + 1.6 * s * a, l_upper_arm: 12 * a, r_upper_arm: -12 * a, l_lower_arm: -30 * a, r_lower_arm: -30 * a, l_upper_leg: 6 * a, r_upper_leg: -6 * a, l_lower_leg: -20 * a, r_lower_leg: -20 * a, tail: 4 * s * a }, root: { dy: 0.02 * a } };
      }
    },
    roll: {
      label: '打滚', cycle: 1.6, fn: function (t, a) {
        var s = S(t);
        return {
          d: { torso: 8 * a, l_upper_arm: -60 * a, r_upper_arm: -60 * a, l_lower_arm: -50 * a, r_lower_arm: -50 * a, l_upper_leg: 40 * a, r_upper_leg: 40 * a, l_lower_leg: -60 * a, r_lower_leg: -60 * a, head: 4 * s * a },
          root: { rot: 360 * t, dy: 0.01 * s * a }
        };
      }
    },
    cheer: {
      label: '欢呼', cycle: 1.0, fn: function (t, a) {
        var s = S(t), up = Math.max(0, S(t));
        return {
          d: {
            torso: -4 * a + 2 * s * a, head: -6 * a,
            l_upper_arm: -152 * a + 10 * s * a, r_upper_arm: -152 * a - 10 * s * a,
            l_lower_arm: -18 * a, r_lower_arm: -18 * a,
            l_upper_leg: 10 * up * a, r_upper_leg: 10 * up * a,
            l_lower_leg: -16 * up * a, r_lower_leg: -16 * up * a
          },
          root: { dy: -0.05 * up * a }
        };
      }
    }
  };
  Motion.defs = DEFS;

  /* ---------- 中文指令解析（长词优先 + 副词与主动作解耦） ---------- */
  var LEXICON = [
    ['idle', ['不要动', '别乱动', '站好', '立正', '停下来', '停下', '待机', '不动', '安静站着', '站着', '发呆', '暂停']],
    ['dance', ['手舞足蹈', '翩翩起舞', '跳支舞', '跳个舞', '跳起舞', '跳芭蕾', '扭屁股', '转圈圈', '跳舞', '舞蹈', '芭蕾', '街舞', '扭一扭', '转圈', '摇摆', '蹦迪', 'dance']],
    ['wag', ['摇摇尾巴', '摇尾巴', '摆尾巴', '晃尾巴', '摇尾', '摆尾', '尾巴', 'wag']],
    ['wave', ['挥挥手', '招招手', '打个招呼', '打招呼', '挥手', '招手', '摆手', '说你好', '说再见', '拜拜', '再见', '你好', '哈喽', 'wave']],
    ['roll', ['翻个跟头', '滚来滚去', '翻跟头', '打个滚', '打滚儿', '打滚', '翻滚', '前滚翻', 'roll']],
    ['sleep', ['睡大觉', '打呼噜', '闭眼睡', '睡觉', '睡着', '打呼', '打盹', '午睡', '休息', '困了', '晚安', 'sleep']],
    ['nod', ['点头答应', '点点头', '摇摇头', '点头', '摇头', '同意', '答应', 'nod']],
    ['fly', ['冲上云霄', '发射升空', '飞上太空', '飞上天', '展翅高飞', '飞起来', '飞翔', '飞行', '起飞', '升空', '发射', '滑翔', '太空', '翅膀', '飞', 'fly']],
    ['jump', ['蹦蹦跳跳', '跳起来', '往上跳', '高高跳', '跳一跳', '蹦一蹦', '跳跃', '跳高', '蹦跳', '跳过', '跳', '蹦', '跃', 'jump']],
    ['run', ['飞快地跑', '撒腿就跑', '奔跑', '快跑', '赛跑', '冲刺', '狂奔', '飞奔', '追赶', '跑', '奔', 'run']],
    ['walk', ['散散步', '往前走', '走一走', '走路', '散步', '溜达', '踱步', '慢走', '行走', '迈步', '走', 'walk']],
    ['cheer', ['拍手欢呼', '举手欢呼', '太棒了', '欢呼', '庆祝', '好耶', '比耶', '胜利', '鼓掌', '棒极了', '真棒', 'cheer']]
  ];

  // 展平并按词长降序排列，杜绝“跳舞”被单字“跳”截胡，同时保留“高兴地走路”中主动作词优先于情绪修饰词
  var SORTED_RULES = [];
  for (var li = 0; li < LEXICON.length; li++) {
    var actionKey = LEXICON[li][0], words = LEXICON[li][1];
    for (var wi = 0; wi < words.length; wi++) {
      SORTED_RULES.push({ key: actionKey, word: words[wi], len: words[wi].length, priority: li });
    }
  }
  SORTED_RULES.sort(function (a, b) {
    return (b.len - a.len) || (a.priority - b.priority);
  });

  // 纯情绪词仅在未匹配任何具体动作词时兜底映射为欢呼
  var EMOTION_FALLBACK = ['高高兴兴', '开开心心', '欢快', '开心', '高兴', '快乐', '兴奋'];

  Motion.parse = function (text) {
    var raw = String(text || '').trim();
    var s = raw.toLowerCase();
    var key = 'walk', hit = false, matchedWord = '';

    // 1. 优先识别“别跳/不要跑/停下不动”否定静止句式
    if (/^(?:不要|别|停止|停下)/.test(s) && !/停不下来/.test(s)) {
      key = 'idle'; hit = true; matchedWord = '停止';
    } else {
      // 2. 长词优先扫描全部动作词库；若句子出现“跳…舞”（如“跳一段好看的舞”），优先归为 dance
      if (/跳.{0,6}舞/.test(s)) {
        key = 'dance'; hit = true; matchedWord = '跳…舞';
      } else {
        for (var i = 0; i < SORTED_RULES.length; i++) {
          var r = SORTED_RULES[i];
          if (s.indexOf(r.word) >= 0) {
            key = r.key; hit = true; matchedWord = r.word; break;
          }
        }
      }
      // 3. 若无明确动作词但含强烈开心词汇，映射为欢呼
      if (!hit) {
        for (var e = 0; e < EMOTION_FALLBACK.length; e++) {
          if (s.indexOf(EMOTION_FALLBACK[e]) >= 0) {
            key = 'cheer'; hit = true; matchedWord = EMOTION_FALLBACK[e]; break;
          }
        }
      }
    }

    var speed = 1, amp = 1;
    if (/飞快|极速|很快|快速|急速|快快|飞奔|冲刺|赶紧/.test(s)) speed = 1.6;
    else if (/快点|加快|欢快|活泼/.test(s)) speed = 1.25;
    else if (/慢慢|缓慢|轻轻|慢点|悄悄|悠闲|慢吞吞/.test(s)) speed = 0.62;

    if (/用力|大大|夸张|使劲|超级|高高|大步|尽情|欢快/.test(s)) amp = 1.35;
    else if (/轻轻|小小|微微|一点|小步|悄悄/.test(s)) amp = 0.7;

    return { key: key, label: DEFS[key].label, speed: speed, amp: amp, hit: hit, matched: matchedWord };
  };

  Motion.poseAt = function (key, t, amp, speed) {
    var def = DEFS[key] || DEFS.idle;
    amp = amp === undefined ? 1 : amp;
    t = ((t % 1) + 1) % 1;
    var r = def.fn(t, amp);
    var d = {};
    for (var k in r.d) if (r.d.hasOwnProperty(k)) d[k] = Math.max(-85, Math.min(85, r.d[k]));
    return { deltas: d, dx: (r.root && r.root.dx) || 0, dy: (r.root && r.root.dy) || 0, rot: (r.root && r.root.rot) || 0, cycle: def.cycle / (speed || 1), label: def.label };
  };

  Motion.clip = function (rig, key, opts) {
    opts = opts || {};
    var fps = opts.fps || 30, cycles = opts.cycles || 2, amp = opts.amp || 1, speed = opts.speed || 1;
    var def = DEFS[key] || DEFS.idle;
    var dur = def.cycle / speed * cycles;
    var frames = Math.max(1, Math.round(dur * fps));
    var sk = { bones: rig.bones, rig: rig, w: rig.w, h: rig.h };
    var out = [];
    for (var f = 0; f < frames; f++) {
      var t = (f / fps) / (def.cycle / speed) % 1;
      var p = Motion.poseAt(key, t, amp, speed);
      var M = SBM.Skin.matrices(sk, { deltas: p.deltas, dx: p.dx, dy: p.dy, rot: p.rot });
      var orients = {};
      for (var b = 0; b < rig.bones.length; b++) {
        var bone = rig.bones[b], A = rig.joints[bone.a], B = rig.joints[bone.b], m = M.glob[b];
        var ax = m[0] * A[0] + m[2] * A[1] + m[4], ay = m[1] * A[0] + m[3] * A[1] + m[5];
        var bx = m[0] * B[0] + m[2] * B[1] + m[4], by = m[1] * B[0] + m[3] * B[1] + m[5];
        var vx = bx - ax, vy = by - ay;
        orients[bone.name] = Math.round(Math.atan2(vx, -vy) * 180 / Math.PI * 10) / 10;
      }
      out.push({ idx: f, time: Math.round(f / fps * 1000) / 1000, orients: orients, root: [Math.round(p.dx * 1000) / 1000, Math.round(p.dy * 1000) / 1000, Math.round(p.rot * 10) / 10] });
    }
    return { meta: { fps: fps, root: { unit: 'normalized' }, motion: key, label: def.label, frames: frames, duration: Math.round(dur * 100) / 100 }, frames: out };
  };

  Motion.list = function () {
    return Object.keys(DEFS).map(function (k) { return { key: k, label: DEFS[k].label }; });
  };
})(window);
