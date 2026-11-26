/* Project persistence and import (V0.7).
 * Includes zero-dependency RFC 1951 pure-JS Deflate fallback for Node 18 / legacy WebViews,
 * GBK filename fallback for legacy non-UTF8 ZIPs, and V0.5.1 / V0.6 / V0.7 compatibility.
 * No network, credentials, room codes or recordings are stored. */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {}), Project = SBM.Project = {};
  var MAX_ARCHIVE = 24 * 1024 * 1024, MAX_ENTRY = 8 * 1024 * 1024, MAX_ENTRIES = 64;
  var ACTIONS = ['walk','run','jump','wave','dance','fly','nod','wag','sleep','roll','cheer','idle'];
  var BACKGROUNDS = ['space','forest','ocean','castle','meadow','home'];
  var TONES = ['adventure','bedtime','science','friendship'];
  var GOALS = ['planet','animal','share','brave','nature','number'];
  var AGES = ['3-4','5-6','7-8'];
  var TEMPLATES = ['humanoid','quadruped','prop'];
  var PNG = [137,80,78,71,13,10,26,10];
  var own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '格式不正确');
    return value;
  }
  function text(value, max, label, fallback) {
    if (value == null && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || value.length > max) fail(label + '过长或格式不正确');
    return value;
  }
  function number(value, lo, hi, label, fallback) {
    if (value == null && fallback !== undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) fail(label + '超出允许范围');
    return value;
  }
  function integer(value, lo, hi, label, fallback) {
    var n = number(value, lo, hi, label, fallback);
    if (!Number.isInteger(n)) fail(label + '必须为整数');
    return n;
  }
  function choice(value, list, label, fallback) {
    if (value == null && fallback !== undefined) return fallback;
    if (list.indexOf(value) < 0) fail(label + '不受支持');
    return value;
  }
  function bool(value, label, fallback) {
    if (value == null) return fallback;
    if (typeof value !== 'boolean') fail(label + '格式不正确');
    return value;
  }
  function identifier(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) || /^(?:constructor|prototype|__proto__)$/.test(value)) fail(label + '名称不合法');
    return value;
  }
  function bounds(value) {
    object(value, '角色裁剪范围');
    var out = { x0: integer(value.x0, 0, 759, '裁剪 x0'), y0: integer(value.y0, 0, 539, '裁剪 y0'),
      x1: integer(value.x1, 0, 759, '裁剪 x1'), y1: integer(value.y1, 0, 539, '裁剪 y1') };
    if (out.x1 < out.x0 || out.y1 < out.y0) fail('角色裁剪范围倒置');
    return out;
  }
  function rgb(value, label) {
    if (!Array.isArray(value) || value.length !== 3) fail(label + '格式不正确');
    return value.map(function (v) { return number(v, 0, 255, label); });
  }
  function cleanStyle(value) {
    if (value == null) return null;
    object(value, '画作风格');
    if (!Array.isArray(value.palette) || !value.palette.length || value.palette.length > 12) fail('调色板格式不正确');
    var palette = value.palette.map(function (c) { return rgb(c, '调色板颜色'); });
    var sorted = palette.slice().sort(function (a,b) { return (a[0]*299+a[1]*587+a[2]*114)-(b[0]*299+b[1]*587+b[2]*114); });
    var out = { palette: palette, ink: rgb(value.ink, '墨线颜色'), lineWidth: number(value.lineWidth, 0.1, 100, '线宽'),
      dark: sorted[0].slice(), light: sorted[sorted.length-1].slice(), mid: sorted[Math.floor(sorted.length/2)].slice() };
    if (value.visualDesc != null) out.visualDesc = text(value.visualDesc, 300, '视觉特征描述', '');
    return out;
  }
  function cleanCharacter(value) {
    if (value == null) return null;
    object(value, '角色'); object(value.texture, '角色纹理尺寸'); object(value.joints, '角色关节');
    var w = integer(value.texture.w, 8, 760, '纹理宽度'), h = integer(value.texture.h, 8, 540, '纹理高度');
    var keys = Object.keys(value.joints);
    if (keys.length < 3 || keys.length > 40) fail('关节数量不正确');
    var joints = {};
    keys.forEach(function (key) {
      identifier(key, '关节'); var point = value.joints[key];
      if (!Array.isArray(point) || point.length !== 2) fail('关节坐标格式不正确');
      joints[key] = [number(point[0], 0, w, '关节 x'), number(point[1], 0, h, '关节 y')];
    });
    ['hip','head','neck','lhand','rhand','lfoot','rfoot'].forEach(function (key) { if (!own(joints,key)) fail('角色缺少必需关节：' + key); });
    if (!Array.isArray(value.bones) || !value.bones.length || value.bones.length > 40) fail('骨骼数量不正确');
    var seen = {}, bones = value.bones.map(function (bone) {
      object(bone, '骨骼'); var name = identifier(bone.name, '骨骼'), a = identifier(bone.a, '骨骼起点'), b = identifier(bone.b, '骨骼终点');
      if (own(seen,name) || !own(joints,a) || !own(joints,b) || a === b) fail('骨骼重复或引用无效关节');
      seen[name] = true;
      return { name: name, a: a, b: b, parent: bone.parent == null ? null : identifier(bone.parent, '父骨骼') };
    });
    var parents = {};
    bones.forEach(function (bone) { if (bone.parent && !own(seen,bone.parent)) fail('父骨骼不存在'); parents[bone.name]=bone.parent; });
    bones.forEach(function (bone) { var visited = {}, key = bone.name; while (key) { if (own(visited,key)) fail('骨骼层级存在循环'); visited[key]=true; key=parents[key]; } });
    var res = { name: text(value.name,80,'角色名字','小奇'), kind: text(value.kind,80,'角色类别','小朋友'), texture: {w:w,h:h},
      sourceBounds: bounds(value.sourceBounds), joints: joints, bones: bones,
      template: choice(value.template,TEMPLATES,'骨骼模板','humanoid'),
      charHeight: number(value.charHeight,1,1200,'角色高度',h) };
    if (value.manualRig != null) res.manualRig = bool(value.manualRig, '手动骨骼标记', false);
    return res;
  }
  function cleanStory(value) {
    if (value == null) return null;
    object(value, '故事');
    if (!Array.isArray(value.scenes) || value.scenes.length < 2 || value.scenes.length > 8) fail('故事场景数量须在 2 至 8 幕之间');
    var scenes = value.scenes.map(function (scene) {
      object(scene, '故事场景');
      var sc = { title: text(scene.title,120,'场景标题',''), narration: text(scene.narration,2500,'场景旁白',''),
        dialogue: text(scene.dialogue,1500,'角色对话',''), emotion: text(scene.emotion,30,'情感','平静'),
        action: choice(scene.action,ACTIONS,'场景动作','idle'), bg: choice(scene.bg,BACKGROUNDS,'场景背景','forest'),
        props: (function () { if (scene.props == null) return []; if (!Array.isArray(scene.props) || scene.props.length > 12) fail('场景道具不正确'); return scene.props.map(function (p) { return text(p,80,'道具'); }); })(),
        knowledge: text(scene.knowledge,1500,'知识说明','') };
      if (Array.isArray(scene.branches)) {
        sc.branches = scene.branches.slice(0, 4).map(function (br) {
          object(br, '剧情分支');
          return { id: text(br.id, 40, '分支ID', ''), label: text(br.label, 80, '分支标题', ''),
            narration: text(br.narration, 2500, '分支旁白', ''), dialogue: text(br.dialogue, 1500, '分支对话', ''),
            action: choice(br.action, ACTIONS, '分支动作', sc.action), emotion: text(br.emotion, 30, '分支情感', sc.emotion),
            bg: choice(br.bg, BACKGROUNDS, '分支背景', sc.bg) };
        });
      }
      if (scene.selectedBranch != null) sc.selectedBranch = text(scene.selectedBranch, 40, '已选分支', '');
      return sc;
    });
    var character = value.character == null ? {} : object(value.character, '故事角色');
    var result = { title: text(value.title,200,'故事标题','未命名故事'), theme: choice(value.theme,BACKGROUNDS,'故事主题',scenes[0].bg),
      tone: choice(value.tone,TONES,'故事类型','adventure'), goal: text(value.goal,100,'故事教育目标',''),
      character: { name: text(character.name,80,'故事角色名','小奇'), kind: text(character.kind,80,'故事角色类别','小朋友') },
      scenes: scenes, question: text(value.question,800,'启发问题',''),
      engine: choice(value.engine,['local-template','cloud-llm','cloud-vlm'],'故事来源','local-template') };
    if (value.ageGroup != null) result.ageGroup = choice(value.ageGroup, AGES, '适龄阶段', '5-6');
    if (value.visualSummary != null) result.visualSummary = text(value.visualSummary, 400, '视觉特征摘要', '');
    if (value.warn != null) result.warn = text(value.warn,1200,'故事提示');
    return result;
  }
  function cleanEditor(value, character, story) {
    value = value == null ? {} : object(value,'编辑状态');
    var motion = value.motion == null ? {} : object(value.motion,'动作状态');
    var voice = value.voice == null ? {} : object(value.voice,'朗读设置');
    var maxPage = story && Array.isArray(story.scenes) ? Math.max(0, story.scenes.length - 1) : 7;
    var out = { charName: text(value.charName,80,'角色名字',character ? character.name : '小奇'),
      charKind: text(value.charKind,80,'角色类别',character ? character.kind : '小朋友'),
      cmd: text(value.cmd,6000,'创作想法',''), tone: choice(value.tone,TONES,'故事类型','adventure'),
      edu: choice(value.edu,GOALS,'教育目标','planet'), rigTemplate: choice(value.rigTemplate,['auto','humanoid','quadruped','prop'],'模板选项','auto'),
      flip: bool(value.flip,'头顶方向',false),
      motion: { key: choice(motion.key,ACTIONS,'动作','walk'), speed: number(motion.speed,0.3,2,'动作速度',1),
        amp: number(motion.amp,0.4,1.8,'动作幅度',1), phase: number(motion.phase,0,1,'动作相位',0) },
      quality: number(value.quality,0.3,1,'渲染精度',0.75), emotions: text(value.emotions,30,'朗读情感','auto'),
      voice: { rate: number(voice.rate,0.5,1.8,'朗读语速',1), pitch: number(voice.pitch,0.5,1.8,'朗读音高',1), voiceURI: text(voice.voiceURI,1000,'朗读音色','') },
      bookPage: Math.min(maxPage, integer(value.bookPage,0,7,'绘本页码',0)), step: integer(value.step,1,6,'创作步骤',1) };
    if (value.ageGroup != null) out.ageGroup = choice(value.ageGroup, AGES, '适龄阶段', '5-6');
    if (value.sceneCount != null) out.sceneCount = choice(value.sceneCount, [3, 4, 6], '故事幕数', 3);
    if (value.uiMode != null) out.uiMode = choice(value.uiMode, ['child', 'parent'], '界面模式', 'child');
    return out;
  }
  function bytesToUrl(bytes) {
    var chunks = [];
    for (var i=0;i<bytes.length;i+=32768) chunks.push(String.fromCharCode.apply(null,bytes.subarray(i,i+32768)));
    return 'data:image/png;base64,' + global.btoa(chunks.join(''));
  }
  function pngInfo(bytes, label) {
    if (bytes.length < 33 || bytes.length > MAX_ENTRY) fail(label+'大小不正确');
    for (var i=0;i<8;i++) if (bytes[i]!==PNG[i]) fail(label+'不是有效 PNG');
    var view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if (view.getUint32(8)!==13 || view.getUint32(12)!==0x49484452) fail(label+'缺少 PNG 图像头');
    var w=view.getUint32(16),h=view.getUint32(20);
    if (!w || !h || w>1600 || h>1600 || w*h>1600*1600) fail(label+'图像尺寸过大');
    return {w:w,h:h};
  }
  function imageUrl(value, label) {
    if (typeof value!=='string' || value.length>MAX_ENTRY*1.4+32 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(label+'必须为 PNG 数据');
    var raw;
    try { raw=global.atob(value.slice(22)); } catch(e) { fail(label+'编码不正确'); }
    var bytes=new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    return {url:value,info:pngInfo(bytes,label)};
  }
  Project.validate = function (snapshot) {
    object(snapshot,'工程状态');
    if (snapshot.format!=='shenbi-maliang-state' || snapshot.version!==1) fail('不支持的工程状态版本，请使用匹配版本的软件');
    var art=imageUrl(snapshot.artwork,'原始画布');
    if (art.info.w!==760 || art.info.h!==540) fail('原始画布尺寸必须为 760×540');
    var character=cleanCharacter(snapshot.character), texture=null,mask=null,meta=null;
    if (character) {
      texture=imageUrl(snapshot.texture,'角色纹理'); mask=imageUrl(snapshot.mask,'角色掩码');
      if (texture.info.w!==character.texture.w || texture.info.h!==character.texture.h || mask.info.w!==character.texture.w || mask.info.h!==character.texture.h) fail('角色纹理、掩码与骨骼尺寸不一致');
      var bb=character.sourceBounds, cw=bb.x1-bb.x0+1,ch=bb.y1-bb.y0+1;
      var source=snapshot.segMeta==null?{}:object(snapshot.segMeta,'分割状态');
      if (source.bb && JSON.stringify(bounds(source.bb))!==JSON.stringify(bb)) fail('分割裁剪范围与角色不一致');
      if ((source.cw!=null&&source.cw!==cw)||(source.ch!=null&&source.ch!==ch)||(source.outW!=null&&source.outW!==character.texture.w)||(source.outH!=null&&source.outH!==character.texture.h)) fail('分割尺寸与角色不一致');
      meta={bb:bb,cw:cw,ch:ch,outW:character.texture.w,outH:character.texture.h,
        confidence:number(source.confidence,0,1,'分割评分',0), area:integer(source.area,0,760*540,'分割面积',0),
        comps:integer(source.comps,0,760*540,'连通域数量',1)};
    } else if (snapshot.texture!=null || snapshot.mask!=null || snapshot.segMeta!=null) fail('角色资源不完整');
    var sourceMask=null;
    if(snapshot.sourceMask!=null){
      var sourceImage=imageUrl(snapshot.sourceMask,'全尺寸角色掩码');
      if(sourceImage.info.w!==760||sourceImage.info.h!==540)fail('全尺寸角色掩码尺寸必须为 760×540');
      if(!character)fail('全尺寸掩码缺少角色');
      sourceMask=sourceImage.url;
    }
    var story=cleanStory(snapshot.story),editor=cleanEditor(snapshot.editor,character,story),style=cleanStyle(snapshot.style);
    if (character && !style) fail('角色缺少画作风格');
    var result={format:'shenbi-maliang-state',version:1,artwork:art.url,character:character,
      texture:texture?texture.url:null,mask:mask?mask.url:null,sourceMask:sourceMask,story:story,style:style,editor:editor,segMeta:meta};
    if (JSON.stringify(result).length>MAX_ARCHIVE*1.4) fail('工程状态过大');
    return result;
  };

  var crcTable;
  function crc32(bytes) {
    if (!crcTable) { crcTable=new Uint32Array(256); for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;} }
    var crc=0xffffffff;for(var i=0;i<bytes.length;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);return(crc^0xffffffff)>>>0;
  }
  function bufferOf(input) {
    if (input && typeof input.arrayBuffer==='function') return input.arrayBuffer();
    if (input && Object.prototype.toString.call(input)==='[object ArrayBuffer]') return Promise.resolve(input);
    if (ArrayBuffer.isView(input)) return Promise.resolve(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength));
    if (typeof global.FileReader==='function' && input instanceof global.Blob) return new Promise(function(resolve,reject){var reader=new global.FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(new Error('无法读取工程文件'));};reader.readAsArrayBuffer(input);});
    return Promise.reject(new Error('请选择一个 ZIP 工程文件'));
  }

  /* ---------- 无外部依赖的纯 JS RFC 1951 (deflate-raw) 解压兜底 ---------- */
  var FIXED_LIT = null, FIXED_DIST = null;
  var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLEN_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function buildHuffman(lengths) {
    var maxBits = 0, blCount = new Int32Array(16), nextCode = new Int32Array(16), i;
    for (i = 0; i < lengths.length; i++) {
      if (lengths[i] > maxBits) maxBits = lengths[i];
      if (lengths[i] > 0) blCount[lengths[i]]++;
    }
    if (!maxBits) return { table: {}, maxBits: 1 };
    var code = 0;
    for (var bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    var map = Object.create(null);
    for (i = 0; i < lengths.length; i++) {
      var l = lengths[i];
      if (!l) continue;
      var c = nextCode[l]++, rev = 0;
      for (var b = 0; b < l; b++) rev = (rev << 1) | ((c >>> b) & 1);
      map[(l << 16) | rev] = i;
    }
    return { map: map, maxBits: maxBits };
  }

  function inflateRawJS(src, expected) {
    if (!FIXED_LIT) {
      var ll = new Uint8Array(288), dl = new Uint8Array(32), idx;
      for (idx = 0; idx <= 143; idx++) ll[idx] = 8;
      for (idx = 144; idx <= 255; idx++) ll[idx] = 9;
      for (idx = 256; idx <= 279; idx++) ll[idx] = 7;
      for (idx = 280; idx <= 287; idx++) ll[idx] = 8;
      for (idx = 0; idx < 32; idx++) dl[idx] = 5;
      FIXED_LIT = buildHuffman(ll); FIXED_DIST = buildHuffman(dl);
    }
    var cap = Math.min(MAX_ENTRY, Math.max(expected || 0, 256));
    var out = new Uint8Array(cap), outPos = 0, bitPos = 0, totalBits = src.length * 8;
    function ensure(n) {
      if (outPos + n > MAX_ENTRY || (expected !== undefined && outPos + n > expected)) fail('ZIP 解压大小与记录不一致');
      if (outPos + n <= out.length) return;
      var next = new Uint8Array(Math.min(MAX_ENTRY, Math.max(out.length * 2, outPos + n)));
      next.set(out.subarray(0, outPos)); out = next;
    }
    function bits(n) {
      if (bitPos + n > totalBits) fail('ZIP Deflate 数据不完整');
      var v = 0;
      for (var i = 0; i < n; i++) {
        v |= ((src[bitPos >>> 3] >>> (bitPos & 7)) & 1) << i;
        bitPos++;
      }
      return v;
    }
    function sym(tree) {
      var code = 0;
      for (var l = 1; l <= tree.maxBits; l++) {
        if (bitPos >= totalBits) fail('ZIP Deflate 编码截断');
        code |= ((src[bitPos >>> 3] >>> (bitPos & 7)) & 1) << (l - 1);
        bitPos++;
        var k = (l << 16) | code;
        if (tree.map[k] !== undefined) return tree.map[k];
      }
      fail('ZIP Deflate 霍夫曼码无效');
    }
    var bfinal = 0;
    while (!bfinal) {
      bfinal = bits(1);
      var btype = bits(2);
      if (btype === 0) {
        bitPos = (bitPos + 7) & ~7;
        var bytePos = bitPos >>> 3;
        if (bytePos + 4 > src.length) fail('ZIP 未压缩块损坏');
        var len = src[bytePos] | (src[bytePos + 1] << 8);
        var nlen = src[bytePos + 2] | (src[bytePos + 3] << 8);
        if ((len ^ 0xffff) !== nlen) fail('ZIP 未压缩块校验不一致');
        bytePos += 4;
        if (bytePos + len > src.length) fail('ZIP 未压缩块越界');
        ensure(len);
        out.set(src.subarray(bytePos, bytePos + len), outPos);
        outPos += len; bitPos = (bytePos + len) * 8;
      } else if (btype === 1 || btype === 2) {
        var litTree = FIXED_LIT, distTree = FIXED_DIST;
        if (btype === 2) {
          var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          var clens = new Uint8Array(19);
          for (var ci = 0; ci < hclen; ci++) clens[CLEN_ORDER[ci]] = bits(3);
          var ctree = buildHuffman(clens);
          var unpacked = new Uint8Array(hlit + hdist), up = 0;
          while (up < hlit + hdist) {
            var s = sym(ctree);
            if (s < 16) unpacked[up++] = s;
            else if (s === 16) {
              if (!up) fail('ZIP 动态码表非法重复');
              var prev = unpacked[up - 1], rep = bits(2) + 3;
              while (rep-- > 0 && up < unpacked.length) unpacked[up++] = prev;
            } else if (s === 17) {
              var z1 = bits(3) + 3;
              while (z1-- > 0 && up < unpacked.length) unpacked[up++] = 0;
            } else {
              var z2 = bits(7) + 11;
              while (z2-- > 0 && up < unpacked.length) unpacked[up++] = 0;
            }
          }
          litTree = buildHuffman(unpacked.subarray(0, hlit));
          distTree = buildHuffman(unpacked.subarray(hlit));
        }
        while (true) {
          var v = sym(litTree);
          if (v === 256) break;
          if (v < 256) { ensure(1); out[outPos++] = v; }
          else {
            var li = v - 257;
            if (li < 0 || li >= LEN_BASE.length) fail('ZIP 长度码越界');
            var copyLen = LEN_BASE[li] + (LEN_EXTRA[li] ? bits(LEN_EXTRA[li]) : 0);
            var di = sym(distTree);
            if (di < 0 || di >= DIST_BASE.length) fail('ZIP 距离码越界');
            var dist = DIST_BASE[di] + (DIST_EXTRA[di] ? bits(DIST_EXTRA[di]) : 0);
            if (dist > outPos) fail('ZIP 回溯距离越界');
            ensure(copyLen);
            for (var cpy = 0; cpy < copyLen; cpy++) { out[outPos] = out[outPos - dist]; outPos++; }
          }
        }
      } else fail('ZIP 包含无效的 Deflate 块类型');
    }
    return out.subarray(0, outPos);
  }

  async function inflate(bytes, expected) {
    if (typeof global.DecompressionStream === 'function') {
      var stream = null;
      try { stream = new global.Blob([bytes]).stream().pipeThrough(new global.DecompressionStream('deflate-raw')); }
      catch (e) { stream = null; }
      if (stream) {
        var reader = stream.getReader(), parts = [], size = 0;
        try {
          while (true) {
            var item = await reader.read();
            if (item.done) break;
            size += item.value.length;
            if (size > expected || size > MAX_ENTRY) { await reader.cancel(); fail('ZIP 解压大小与记录不一致'); }
            parts.push(item.value);
          }
        } finally { reader.releaseLock(); }
        var out = new Uint8Array(size), offset = 0;
        parts.forEach(function (part) { out.set(part, offset); offset += part.length; });
        return out;
      }
    }
    return inflateRawJS(bytes, expected);
  }

  function decodeEntryName(nameBytes, flags, utf8Decoder) {
    if (flags & 0x800) {
      try { return utf8Decoder.decode(nameBytes); } catch (e) { fail('ZIP 文件名编码不正确'); }
    }
    var hasHigh = nameBytes.some(function (x) { return x > 127; });
    if (!hasHigh) return utf8Decoder.decode(nameBytes);
    // 兼容 Windows 等未标记 0x800 的 UTF-8 或 GBK 条目名
    try { return utf8Decoder.decode(nameBytes); } catch (e) {
      try { return new TextDecoder('gbk', { fatal: true }).decode(nameBytes); }
      catch (e2) { fail('ZIP 中文文件名编码无法识别，请使用标准 UTF-8 打包'); }
    }
  }

  async function unzip(input) {
    if (input && typeof input.size==='number' && input.size>MAX_ARCHIVE) fail('ZIP 工程不能超过 24MB');
    var raw=new Uint8Array(await bufferOf(input)),length=raw.length;
    if (length<22 || length>MAX_ARCHIVE) fail('ZIP 工程大小不正确');
    var v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),end=-1;
    for(var p=length-22;p>=Math.max(0,length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===length){end=p;break;}
    if(end<0)fail('ZIP 文件不完整或格式不正确');
    var count=v.getUint16(end+10,true),centralSize=v.getUint32(end+12,true),centralOffset=v.getUint32(end+16,true);
    if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||!count||count>MAX_ENTRIES||centralOffset+centralSize!==end)fail('不支持分卷、ZIP64 或过多文件的工程包');
    var decoder=new TextDecoder('utf-8',{fatal:true}),files=Object.create(null),ranges=[],total=0,at=centralOffset;
    for(var index=0;index<count;index++){
      if(at+46>end||v.getUint32(at,true)!==0x02014b50)fail('ZIP 文件目录损坏');
      var flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),crc=v.getUint32(at+16,true),compressed=v.getUint32(at+20,true),expanded=v.getUint32(at+24,true);
      var nameLength=v.getUint16(at+28,true),extraLength=v.getUint16(at+30,true),commentLength=v.getUint16(at+32,true),disk=v.getUint16(at+34,true),external=v.getUint32(at+38,true),local=v.getUint32(at+42,true);
      if(!nameLength||nameLength>512||at+46+nameLength+extraLength+commentLength>end||disk||(flags&0x41)||(method!==0&&method!==8)||expanded>MAX_ENTRY||compressed>MAX_ENTRY||((external>>>16)&0xf000)===0xa000)fail('ZIP 含不支持、加密或过大的条目');
      var nameBytes=raw.subarray(at+46,at+46+nameLength);
      var name=decodeEntryName(nameBytes,flags,decoder);
      if(name.indexOf('\\')>=0||name.indexOf('\0')>=0||name[0]==='/'||/^[A-Za-z]:/.test(name)||name.split('/').some(function(x){return x==='.'||x==='..';})||name.indexOf('//')>=0)fail('ZIP 文件路径不合法');
      if(own(files,name))fail('ZIP 包含重名文件：'+name);
      if(local+30>centralOffset||v.getUint32(local,true)!==0x04034b50)fail('ZIP 文件头损坏');
      var localName=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true),start=local+30+localName+localExtra,stop=start+compressed;
      if(localName!==nameLength||v.getUint16(local+6,true)!==flags||v.getUint16(local+8,true)!==method||stop>centralOffset||start<local||raw.subarray(local+30,local+30+localName).some(function(x,i){return x!==nameBytes[i];}))fail('ZIP 文件头与目录不一致');
      if(!(flags&8)&&(v.getUint32(local+14,true)!==crc||v.getUint32(local+18,true)!==compressed||v.getUint32(local+22,true)!==expanded))fail('ZIP 文件校验记录不一致');
      if(ranges.some(function(r){return local<r[1]&&stop>r[0];}))fail('ZIP 条目范围重叠');ranges.push([local,stop]);
      total+=expanded;if(total>MAX_ARCHIVE)fail('ZIP 解压后的工程过大');
      var data=raw.subarray(start,stop);if(method===8)data=await inflate(data,expanded);
      if(data.length!==expanded||crc32(data)!==crc)fail('ZIP 文件校验失败：'+name);
      files[name]=data.slice();at+=46+nameLength+extraLength+commentLength;
    }
    if(at!==end)fail('ZIP 文件目录长度不正确');
    return files;
  }
  function jsonFile(files,name,required){
    if(!own(files,name)){if(required)fail('工程缺少文件：'+name);return null;}
    if(files[name].length>2*1024*1024)fail('工程 JSON 过大：'+name);
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files[name]));}catch(e){fail('工程 JSON 无法解析：'+name);}
  }
  Project.fromZip = async function (input) {
    var files=await unzip(input),manifest=jsonFile(files,'manifest.json',true);
    object(manifest,'工程清单');
    if(manifest.format!=='shenbi-maliang-project'||['0.5.1','0.6','0.6.0','0.7','0.7.0'].indexOf(manifest.version)<0)fail('不支持的工程包版本，请使用匹配版本的软件');
    var required=['artwork.png','character/texture.png','character/mask.png','character/rig.json','motion/clip.json','story/story.json','style/style.json'];
    required.forEach(function(name){if(!own(files,name))fail('工程缺少文件：'+name);});
    if(!Array.isArray(manifest.files)||required.some(function(name){return manifest.files.indexOf(name)<0;}))fail('工程资源清单不完整');
    var metadata=jsonFile(files,'state/project.json',false);
    if(metadata&&(metadata.format!=='shenbi-maliang-state'||metadata.version!==1))fail('不支持的工程编辑状态版本');
    var character=jsonFile(files,'character/rig.json',true),story=jsonFile(files,'story/story.json',true),style=jsonFile(files,'style/style.json',true),clip=jsonFile(files,'motion/clip.json',true);
    var editor=metadata&&metadata.editor;
    if(!editor){editor={};if(clip&&clip.meta&&ACTIONS.indexOf(clip.meta.motion)>=0)editor.motion={key:clip.meta.motion};if(story&&TONES.indexOf(story.tone)>=0)editor.tone=story.tone;}
    return Project.validate({format:'shenbi-maliang-state',version:1,artwork:bytesToUrl(files['artwork.png']),
      character:character,texture:bytesToUrl(files['character/texture.png']),mask:bytesToUrl(files['character/mask.png']),
      sourceMask:own(files,'character/source-mask.png')?bytesToUrl(files['character/source-mask.png']):null,
      story:story,style:style,editor:editor,segMeta:metadata?metadata.segMeta:null});
  };

  var validationMatch=global.location&&/[?&]validation=([A-Za-z0-9_-]{1,48})(?:&|$)/.exec(global.location.search||'');
  var databaseName='shenbi-maliang-projects'+(validationMatch?'-validation-'+validationMatch[1]:'');
  var databasePromise=null,writeQueue=Promise.resolve();
  function database(){
    if(databasePromise)return databasePromise;
    databasePromise=new Promise(function(resolve,reject){
      if(!global.indexedDB){reject(new Error('当前环境不支持本地草稿，请使用工程 ZIP 保存'));return;}
      var request;
      try{request=global.indexedDB.open(databaseName,1);}catch(e){reject(new Error('无法打开本地草稿存储'));return;}
      request.onupgradeneeded=function(){var db=request.result;if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts');};
      request.onerror=function(){reject(new Error('无法打开本地草稿存储，请检查浏览器权限或磁盘空间'));};
      request.onblocked=function(){reject(new Error('本地草稿存储被其他页面占用，请关闭旧版本页面后重试'));};
      request.onsuccess=function(){var db=request.result;db.onversionchange=function(){db.close();databasePromise=null;};resolve(db);};
    });
    databasePromise=databasePromise.catch(function(error){databasePromise=null;throw error;});return databasePromise;
  }
  function transaction(mode,action){
    return database().then(function(db){return new Promise(function(resolve,reject){
      var tx,out;
      try{tx=db.transaction('drafts',mode);out=action(tx.objectStore('drafts'));}
      catch(e){databasePromise=null;reject(new Error('无法访问本地草稿存储'));return;}
      tx.oncomplete=function(){resolve(out?out.result:undefined);};
      tx.onerror=function(){reject(new Error('本地草稿保存失败，原草稿未受影响'));};
      tx.onabort=function(){reject(new Error('本地草稿写入中止，原草稿已保留'));};
    });});
  }
  function enqueueWrite(task){
    var next=writeQueue.then(task,task);
    writeQueue=next.catch(function(){});
    return next;
  }
  Project.saveDraft=function(snapshot){
    var clean;
    try{clean=Project.validate(snapshot);}catch(e){return Promise.reject(e);}
    var record={format:'shenbi-maliang-draft',version:1,savedAt:new Date().toISOString(),snapshot:clean};
    return enqueueWrite(function(){return transaction('readwrite',function(store){store.put(record,'active');}).then(function(){return record;});});
  };
  Project.loadDraft=function(){
    return writeQueue.then(function(){return transaction('readonly',function(store){return store.get('active');});}).then(function(record){
      if(!record)return null;
      object(record,'本地草稿');
      if(record.format!=='shenbi-maliang-draft'||record.version!==1||typeof record.savedAt!=='string')fail('本地草稿版本不兼容');
      return{savedAt:record.savedAt,snapshot:Project.validate(record.snapshot)};
    });
  };
  Project.clearDraft=function(){
    return enqueueWrite(function(){return transaction('readwrite',function(store){store.delete('active');}).then(function(){return true;});});
  };
})(window);
