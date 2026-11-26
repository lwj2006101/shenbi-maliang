/* =============================================================
 * story.js —— 个性化分幕与分支故事引擎（V0.7 增强版）
 * 对应第 9 项优化：
 *   1. 支持适龄分段（3-4岁低幼、5-6岁启蒙、7-8岁进阶）与篇幅（3/4/6幕）
 *   2. 将孩子的话（愿望/元素）与画作本地视觉特征贯穿全剧起承转合，不再仅附于首幕括号
 *   3. 关键幕提供交互式剧情分支选择（切换走向并联动后续结局）及逐幕在线编辑能力
 *   4. 云端支持文本模型与可选多模态视觉理解（VLM），未配置时自动无缝回退端侧引擎
 * ============================================================= */
(function (global) {
  'use strict';
  var SBM = global.SBM || (global.SBM = {});
  var Story = SBM.Story = {};

  var KNOWLEDGE = {
    planet: '木星是太阳系里最大的行星，它身上的“大红斑”其实是一场刮了几百年的超级风暴。',
    animal: '小松鼠秋天会把松果埋进泥土里，忘掉的种子春天就会发芽长成小树苗，它是森林的小园丁。',
    share: '把喜欢的东西和好主意分给伙伴，快乐不会少一半，反而会变成双倍的温暖。',
    brave: '真正的勇敢不是一点都不害怕，而是先深呼吸三次，再试着往前迈出一小步。',
    nature: '秋天树叶换上金黄色外衣，是因为绿色的叶绿素去休息了，胡萝卜素出来站岗啦。',
    number: '左边三颗亮晶晶的小星星，加上右边两颗小星星，伸出手指数一数，一共是五颗哟！'
  };
  var GOAL_LABEL = {
    planet: '认识行星', animal: '动物习性', share: '学会分享',
    brave: '勇敢探索', nature: '四季自然', number: '数字认知'
  };
  var AGE_LABEL = {
    '3-4': '3–4岁低幼短句', '5-6': '5–6岁启蒙互动', '7-8': '7–8岁进阶探索'
  };

  var THEMES = {
    space: {
      bg: 'space', nameLabel: '星空', place: '会唱歌的蓝色小行星', thing: '彩虹星光飞船', friend: '月亮婆婆',
      extraBg: 'castle',
      coreActs: [
        { title: '抬头看星星', action: 'nod', emotion: '好奇', props: ['星星', '云'],
          narr34: '天黑啦，亮晶晶！{visualLead}{kind}{name}眨眨眼，对着天空说：“{wishShort}！”',
          narr56: '安静的夜晚，星星在窗外眨眼睛。{visualLead}{kind}{name}趴在窗台上，心里藏着一个愿望——{wishClause}。',
          narr78: '夜幕像一块缀满宝石的绒布，{visualLead}{kind}{name}仰望着银河深处，认真地制定今晚的计划：{wishClause}，去看看宇宙尽头的秘密。',
          dlg: '“今晚就出发，去看看星星上面住着谁！”' },
        { title: '穿过流星桥', action: 'fly', emotion: '期待', props: ['飞船', '星星'],
          narr34: '嗖——飞高高！{name}坐上{thing}，穿过软软的白云，飞向{place}啦！',
          narr56: '呼——{name}驾驶着{thing}冲上云霄，一路追着流星雨，稳稳飞向{place}。一路上还惦记着“{wishShort}”的约定。',
          narr78: '伴随着柔和的推进光芒，{name}驾驶{thing}穿过厚厚的云层进入失重轨道。陨石带在窗外轻轻漂浮，它牢牢记着“{wishShort}”的目标向前巡航。',
          dlg: '“抓稳扶手，前面有一座会发光的星云拱门！”',
          branches: [
            { id: 'aurora', label: '🌈 钻进极光隧道', action: 'fly', emotion: '好奇', bg: 'space',
              narration: '{name}转动方向盘钻进七彩极光隧道，光带像滑梯一样托着飞船加速，一下子就看见了{place}和正在招手的{friend}！',
              dialogue: '“哇，极光滑梯比风还要快！”', endingBoost: '极光送来的星尘徽章还在胸口闪闪发亮' },
            { id: 'comet', label: '☄️ 搭彗星顺风车', action: 'jump', emotion: '兴奋', bg: 'space',
              narration: '{name}轻轻跳上路过的小彗星尾巴，冰晶在身边叮咚作响，顺着星轨滑到了{place}，遇见了热心的{friend}。',
              dialogue: '“谢谢你呀小彗星，你的尾巴凉丝丝的！”', endingBoost: '彗星留下的冰晶铃铛一路叮当作响' },
            { id: 'signal', label: '📡 跟随音乐电波', action: 'nod', emotion: '平静', bg: 'space',
              narration: '{name}竖起耳朵倾听滴答滴答的太空音乐电波，顺着节拍绕开迷雾，平平安安地降落在{place}，找到了{friend}。',
              dialogue: '“原来星星也会用音乐指路呢！”', endingBoost: '那首温柔的太空旋律一直陪着大家' }
          ] },
        { title: '星际小考验', action: 'run', emotion: '紧张', props: ['星星', '飞船'],
          narr34: '哎呀，星星灯暗啦！{name}和{friend}手拉手，一二一，把星星灯拍亮啦！',
          narr56: '刚到{place}，导航灯塔忽然熄灭了。为了完成“{wishShort}”的心愿，{name}和{friend}分工合作，把散落的星光石一颗颗拼回原位。',
          narr78: '降落在{place}后，环形山里的能量灯塔因星尘遮挡停止了运转。为了实现“{wishShort}”，{name}冷静观察纹路，和{friend}一起拂去星尘重启了灯塔。',
          dlg: '“别着急，我们一步一步试，一定能点亮它！”',
          branches: [
            { id: 'teamwork', label: '🤝 和伙伴合力点亮', action: 'cheer', emotion: '开心', bg: 'space',
              narration: '{name}托着底座，{friend}安放星光石，啪嗒一声，整座小行星重新亮起温暖的金光！',
              dialogue: '“两个人一起想办法，难题一下子就解开啦！”', endingBoost: '和伙伴合力点亮灯塔的勇气' },
            { id: 'dance_light', label: '💃 跳起发光热身舞', action: 'dance', emotion: '兴奋', bg: 'space',
              narration: '{name}踩着地面上的音符方砖跳起欢快的舞步，每踩亮一格就飞出一串星火，把整座灯塔唤醒了！',
              dialogue: '“原来快乐的舞步就是打开星光的钥匙！”', endingBoost: '音符方砖上欢快的舞步' }
          ] },
        { title: '云端星堡茶会', action: 'dance', emotion: '开心', props: ['城堡', '星星'],
          narr34: '叮咚！星堡开门啦，{name}转圈圈跳跳舞，好开心呀！',
          narr56: '点亮灯塔后，云端星堡敞开大门。{name}把“{wishShort}”的故事讲给星星们听，大家围成一圈欢快地跳舞。',
          narr78: '受邀来到漂浮在星云上的水晶星堡，{name}把一路上围绕“{wishShort}”的奇遇画成星图分享给众星，赢得了阵阵掌声。',
          dlg: '“把见到的奇妙风景讲给大家听，真是一件幸福的事！”' },
        { title: '银河寻宝记', action: 'wag', emotion: '好奇', props: ['星星', '苹果'],
          narr34: '看呀，一颗甜甜的星星果！{name}分给{friend}一半，真甜呀！',
          narr56: '返航前，{friend}送给{name}一篮会发光的太空果。{name}先挑最大的一颗递给伙伴，大家吃得眉开眼笑。',
          narr78: '返航补给站里结满了晶莹的星露果，{name}按照约定与{friend}平分收获，并仔细记录下小行星的自转周期。',
          dlg: '“好东西要一起尝，味道才会更甜！”' },
        { title: '星空下的约定', action: 'wave', emotion: '温馨', props: ['星星'],
          narr34: '挥挥手，说拜拜！{name}完成了“{wishShort}”，带着亮晶晶的梦飞回家啦。',
          narr56: '{name}站在山丘上朝地球挥挥手，{endingMemory}，今晚关于“{wishShort}”的心愿圆满实现啦。',
          narr78: '返航舱缓缓降落窗台，{endingMemory}。{name}把这次“{wishShort}”的探索写进航海日志，和{friend}约好下次再去更远的星系。',
          dlg: '“原来勇敢试一试，心里的愿望真的会发芽发光！”' }
      ]
    },
    forest: {
      bg: 'forest', nameLabel: '森林', place: '长满发光蘑菇的大森林', thing: '滑翔大树叶', friend: '小松鼠',
      extraBg: 'meadow',
      coreActs: [
        { title: '森林的早晨', action: 'walk', emotion: '好奇', props: ['树', '花'],
          narr34: '太阳出来啦！{visualLead}{kind}{name}走进大森林，大声说：“{wishShort}！”',
          narr56: '清晨的阳光洒在草叶上，{visualLead}{kind}{name}背着小水壶走进{place}，一心想着{wishClause}。',
          narr78: '晨雾在林间缓缓散开，露珠像放大镜一样映出叶脉。{visualLead}{kind}{name}踏上松软的小径走进{place}，准备开启“{wishShort}”的探索之旅。',
          dlg: '“早上好呀，森林里的每一棵大树和小花！”' },
        { title: '林间小岔路', action: 'run', emotion: '紧张', props: ['树', '花'],
          narr34: '咦，草丛沙沙响！原来是{friend}迷路啦，{name}快步跑过去帮忙！',
          narr56: '忽然，蘑菇丛后传来细细的呼救声。原来{friend}在采松果时迷了路，{name}想起“{wishShort}”的初心，立刻上前帮忙。',
          narr78: '行至溪流分岔口，树丛后传来急促的声响——{friend}的松果篮翻倒在泥地里且迷失了方向。{name}停下“{wishShort}”的脚步，主动伸出援手。',
          dlg: '“别害怕，我陪你一起想办法找路！”',
          branches: [
            { id: 'brook', label: '💧 顺着小溪听水声', action: 'walk', emotion: '平静', bg: 'forest',
              narration: '{name}蹲下来听哗啦啦的溪水声，顺着水流下游的方向稳稳前进，很快就看到了熟悉的橡树屋！',
              dialogue: '“小溪就像森林里的指南针，跟着它准没错！”', endingBoost: '清脆的溪水歌声还在耳边回响' },
            { id: 'leaf_glide', label: '🍃 乘大树叶高处眺望', action: 'fly', emotion: '兴奋', bg: 'meadow',
              narration: '{name}借来{thing}迎风轻轻跃上高坡，一眼就望见了花田边的松鼠树洞，带着{friend}欢快地奔过去！',
              dialogue: '“站得高一点，所有的路都看得清清楚楚啦！”', endingBoost: '乘着大树叶俯瞰花田的惊喜画面' }
          ] },
        { title: '搭起彩虹木桥', action: 'jump', emotion: '着急', props: ['树', '云'],
          narr34: '小河挡路啦！{name}搬木头，跳一跳，稳稳当当过小河！',
          narr56: '小溪上的独木桥被风吹歪了，{name}和{friend}一起垫好鹅卵石，拉着手一步一步跳过了溪流。',
          narr78: '昨晚的雨水让溪面变宽，{name}先试探石块的稳固程度，再和{friend}搭起树枝扶手，安全跨过了湍急的浅滩。',
          dlg: '“先看准落脚的石头，一、二、跳！”',
          branches: [
            { id: 'stone_step', label: '🪨 数着石头跳过去', action: 'jump', emotion: '开心', bg: 'forest',
              narration: '{name}大声数着“一、二、三、四、五”，踩着五块圆圆的鹅卵石轻巧地跳到了对岸！',
              dialogue: '“边数数边跳，一点儿都不觉得难啦！”', endingBoost: '五块圆圆鹅卵石搭成的数字小桥' },
            { id: 'vine_help', label: '🌿 请大树爷爷递藤蔓', action: 'wave', emotion: '温馨', bg: 'forest',
              narration: '{name}礼貌地朝大橡树挥挥手，垂下的结实藤蔓稳稳护送两个小伙伴走过了独木桥。',
              dialogue: '“谢谢大树爷爷，礼貌求助真管用！”', endingBoost: '大橡树爷爷温柔垂下的绿藤蔓' }
          ] },
        { title: '草地花环舞', action: 'dance', emotion: '开心', props: ['花', '树'],
          narr34: '花儿开啦，真香呀！{name}戴上小花环，开心地跳起舞！',
          narr56: '穿过树林是一片阳光草地，蝴蝶围着{name}飞舞，庆祝“{wishShort}”的旅途越来越精彩。',
          narr78: '阳光透过树冠洒下金色光斑，林间空地盛开着野花，{name}与林中小伙伴合着鸟鸣节拍翩翩起舞。',
          dlg: '“森林里的音乐会比舞台上还要热闹！”' },
        { title: '松果小仓库', action: 'nod', emotion: '好奇', props: ['树', '苹果'],
          narr34: '一颗、两颗红苹果！大家排排坐，分果果吃喽！',
          narr56: '{friend}打开秘密小仓库，拿出红彤彤的野果招待{name}，还教它分辨不同树叶的形状。',
          narr78: '回到橡树洞旁，{friend}展示了分门别类储藏坚果的树洞仓库，{name}认真观察并记下了大自然的生存智慧。',
          dlg: '“原来每片树叶和每颗果实都有自己的小秘密！”' },
        { title: '满载笑声回家', action: 'cheer', emotion: '温馨', props: ['树', '花', '苹果'],
          narr34: '找到家啦，好耶！{name}实现了“{wishShort}”，捧着红苹果笑得眯眯眼！',
          narr56: '夕阳染红了树梢，{endingMemory}。{name}不仅实现了“{wishShort}”，还收获了最好的森林朋友。',
          narr78: '晚霞为森林披上金纱，{endingMemory}。{name}带着满满的自然笔记和红苹果踏上归途，心里装满了关于“{wishShort}”的温暖回忆。',
          dlg: '“帮助别人、热爱自然，心里就会一直暖洋洋的！”' }
      ]
    },
    ocean: {
      bg: 'ocean', nameLabel: '海底', place: '五彩珊瑚王国', thing: '七彩泡泡潜艇', friend: '小海龟',
      extraBg: 'space',
      coreActs: [
        { title: '潜入蓝大海', action: 'nod', emotion: '好奇', props: ['泡泡', '鱼'],
          narr34: '咕噜咕噜，吹泡泡！{visualLead}{kind}{name}钻进大海里：“{wishShort}！”',
          narr56: '{visualLead}{kind}{name}坐进圆滚滚的{thing}，咕噜噜潜入蔚蓝大海，准备开启“{wishShort}”的海底奇遇。',
          narr78: '海浪轻轻拍打沙滩，{visualLead}{kind}{name}启动透明的{thing}潜入阳光透射的浅海层，朝着{place}出发去实现“{wishShort}”。',
          dlg: '“海底原来藏着一座会发光的彩虹花园呀！”' },
        { title: '摇摆海草林', action: 'fly', emotion: '紧张', props: ['泡泡', '鱼'],
          narr34: '海草摇呀摇，像捉迷藏！{name}牵着{friend}慢慢游过去！',
          narr56: '前面出现了一大片轻轻摇晃的海草迷宫，{name}遇见了{friend}，一边惦记着“{wishShort}”，一边结伴寻找出口。',
          narr78: '洋流推动着高大的海藻林左右摇摆，视线变得朦胧。{name}与熟悉水性的{friend}结成小队，共同探寻通往{place}的航道。',
          dlg: '“我们跟着发光的小鱼游，一定不会迷路！”',
          branches: [
            { id: 'jellyfish', label: '🪼 借水母小灯笼照路', action: 'fly', emotion: '好奇', bg: 'ocean',
              narration: '{name}礼貌地请透明小水母在前面打着粉蓝色的小灯笼，海草迷宫一下子变得亮堂堂！',
              dialogue: '“谢谢水母小灯笼，海底的路亮起来啦！”', endingBoost: '透明小水母温柔点亮的粉蓝灯光' },
            { id: 'current_surf', label: '🌊 顺着暖流滑梯冲浪', action: 'run', emotion: '兴奋', bg: 'ocean',
              narration: '{friend}带{name}找到一条温暖的海底洋流，两个小伙伴像坐水滑梯一样嗖地穿过了海草林！',
              dialogue: '“海底暖流滑梯真刺激呀！”', endingBoost: '乘着海底暖流冲浪的欢笑声' }
          ] },
        { title: '受困的小贝壳', action: 'wave', emotion: '着急', props: ['鱼', '泡泡'],
          narr34: '小贝壳卡住啦！{name}轻轻推一推，小贝壳张嘴笑啦！',
          narr56: '珊瑚礁旁有一只被水草缠住的音乐贝壳，{name}耐心地帮它解开水草，贝壳叮叮咚咚唱起了歌。',
          narr78: '在珊瑚峡谷底部，一只珍贵的留声贝壳被渔网碎线缠住。{name}小心翼翼地拨开缠线，保护了珊瑚礁的整洁与安宁。',
          dlg: '“慢一点、轻一点，马上就能帮你解开啦！”' },
        { title: '珊瑚音乐会', action: 'dance', emotion: '开心', props: ['鱼', '泡泡'],
          narr34: '小鱼排排队，吐泡泡！{name}扭一扭，跳起海底舞！',
          narr56: '获救的音乐贝壳奏响旋律，成群的小丑鱼围着{name}吐出泡泡音符，庆祝“{wishShort}”的奇妙旅程。',
          narr78: '整座{place}在贝壳歌声中苏醒，彩色鱼群变换队形，{name}随着水波律动起舞，感受海洋生态的和谐之美。',
          dlg: '“原来大海深处也有这么美妙的交响乐！”' },
        { title: '深海小课堂', action: 'nod', emotion: '平静', props: ['鱼', '星星'],
          narr34: '看，海底也有小星星！那是海星宝宝在招手呢！',
          narr56: '{friend}带着{name}认识了五角海星和会变色的章鱼，海底的每一个角落都藏着新知识。',
          narr78: '老海龟向{name}讲解了潮汐与珊瑚共生的奥秘，让这次“{wishShort}”的探险多了满满的科学收获。',
          dlg: '“仔细观察，每一朵浪花里都藏着大自然的学问。”' },
        { title: '珍珠的祝福', action: 'cheer', emotion: '温馨', props: ['鱼', '泡泡'],
          narr34: '亮闪闪的小珍珠送给好朋友！{name}完成了“{wishShort}”，浮出水面挥挥手！',
          narr56: '临别时，{endingMemory}。{name}把找到的荧光海螺与{friend}分享，带着“{wishShort}”的美好回忆浮上海面。',
          narr78: '海面洒下金色的余晖，{endingMemory}。{name}与{friend}定下守护海洋的约定，圆满完成了“{wishShort}”的心愿。',
          dlg: '“好朋友一起分享和守护，大海就会永远这么美！”' }
      ]
    },
    castle: {
      bg: 'castle', nameLabel: '城堡', place: '云朵上的糖果城堡', thing: '星光南瓜车', friend: '发条小骑士',
      extraBg: 'meadow',
      coreActs: [
        { title: '飘香的邀请信', action: 'walk', emotion: '期待', props: ['城堡', '花'],
          narr34: '一封香香的信飞来啦！{visualLead}{kind}{name}要去城堡喽：“{wishShort}！”',
          narr56: '微风送来一封草莓味的邀请函：{place}邀请{visualLead}{kind}{name}去做客，正好实现{wishClause}的心愿！',
          narr78: '清晨的窗台落下一封盖着金色火漆印的信笺，{place}向{visualLead}{kind}{name}发出诚挚邀请，一场围绕“{wishShort}”的奇幻旅程就此展开。',
          dlg: '“整理好小背包，我们坐上南瓜车出发吧！”' },
        { title: '花园找钥匙', action: 'run', emotion: '紧张', props: ['城堡', '星星'],
          narr34: '哎呀，大门锁住啦！{name}在花丛里找呀找，找到星星钥匙啦！',
          narr56: '来到{place}门前，守门的{friend}苦恼地说星星钥匙掉进迷宫花园了。{name}立刻挽起袖子帮忙寻找。',
          narr78: '抵达高耸的{place}城门下，{friend}发现开启大门的星形钥匙遗落在玫瑰迷宫中。为了完成“{wishShort}”，{name}按线索展开搜寻。',
          dlg: '“别慌张，我们顺着脚印把每个角落都找一遍！”',
          branches: [
            { id: 'footprint', label: '🔎 顺着糖霜脚印找', action: 'walk', emotion: '好奇', bg: 'castle',
              narration: '{name}低下头仔细观察地面上的亮晶晶糖霜脚印，一步步走到喷泉边，一下子就发现了星星钥匙！',
              dialogue: '“哈哈，细心观察真的能发现线索！”', endingBoost: '顺着糖霜脚印找到钥匙的机智瞬间' },
            { id: 'bird_song', label: '🐦 听画眉鸟唱歌指路', action: 'wave', emotion: '开心', bg: 'meadow',
              narration: '{name}朝树枝上的画眉鸟友好地招招手，小鸟叽叽喳喳飞到花坛下，衔出了闪闪发亮的星星钥匙！',
              dialogue: '“谢谢小画眉，你真是热心的小向导！”', endingBoost: '画眉鸟清脆指路的动听歌声' }
          ] },
        { title: '修好音乐钟楼', action: 'jump', emotion: '着急', props: ['城堡', '云'],
          narr34: '大钟停下啦！{name}跳一跳，帮齿轮转起来，当当当！',
          narr56: '进了城堡，广场上的报时音乐钟少了一颗小齿轮。{name}跳起来把卡住的发条轻轻拨正，钟声重新响彻云霄。',
          narr78: '步入城堡中庭，报时塔楼因齿轮错位停摆。{name}观察大小齿轮咬合规律，与{friend}配合复位发条，清脆乐声再次回荡。',
          dlg: '“小齿轮带动大齿轮，咔哒咔哒转起来啦！”' },
        { title: '厨房做甜点', action: 'nod', emotion: '好奇', props: ['苹果', '花'],
          narr34: '揉面团，放苹果，香喷喷的小派做好啦！',
          narr56: '为了准备晚会，{name}去童话厨房帮忙数苹果、烤甜派，把“{wishShort}”的快乐揉进了每一块点心里。',
          narr78: '在繁忙的城堡烘焙坊里，{name}按比例称量面粉与鲜果，亲手制作出造型精致的星光果派与伙伴们分享。',
          dlg: '“自己动手做出来的点心，闻起来格外香甜！”' },
        { title: '月光圆舞曲', action: 'dance', emotion: '开心', props: ['城堡', '星星'],
          narr34: '音乐响起来，{name}和好朋友拉着手转圈跳舞喽！',
          narr56: '月亮升上尖塔，水晶灯亮起，{name}和{friend}在舞池中央欢快地转圈跳舞，裙摆和笑声一起飞扬。',
          narr78: '夜幕降临，月光洒满露台，悠扬的圆舞曲响起。{name}与新结识的朋友们自信起舞，庆祝“{wishShort}”的美好时刻。',
          dlg: '“坚持不放弃，每一扇紧闭的大门都会为我们打开！”' },
        { title: '带着星光回家', action: 'wave', emotion: '温馨', props: ['城堡', '星星'],
          narr34: '晚安小城堡！{name}完成了“{wishShort}”，带着甜甜的笑回家啦！',
          narr56: '舞会结束时，{endingMemory}。{name}坐上{thing}朝{friend}挥手告别，把“{wishShort}”的温暖故事带回了家。',
          narr78: '星光铺满归途的云梯，{endingMemory}。{name}珍藏好{friend}赠送的友谊勋章，为这场“{wishShort}”的奇遇画上温暖句号。',
          dlg: '“下次我们还要一起创造更多好听的故事！”' }
      ]
    },
    meadow: {
      bg: 'meadow', nameLabel: '草地', place: '开满蒲公英的阳光草地', thing: '彩虹燕子风筝', friend: '长耳小兔',
      extraBg: 'forest',
      coreActs: [
        { title: '微风吹过草地', action: 'walk', emotion: '好奇', props: ['花', '云'],
          narr34: '春风吹，花儿笑！{visualLead}{kind}{name}来到草地上：“{wishShort}！”',
          narr56: '暖洋洋的春风拂过{place}，{visualLead}{kind}{name}牵着{thing}奔跑起来，心里盼望着{wishClause}。',
          narr78: '晴朗的午后，白云像棉花糖般飘过{place}。{visualLead}{kind}{name}迎风展开{thing}，满怀期待地开启“{wishShort}”的户外时光。',
          dlg: '“风儿风儿吹大一点，带我的小风筝去摸摸白云吧！”' },
        { title: '风筝挂上树梢', action: 'jump', emotion: '着急', props: ['树', '花'],
          narr34: '哎呀，风筝挂在树上啦！{name}跳一跳，{friend}跑来帮忙啦！',
          narr56: '一阵调皮的旋风吹过，{thing}轻轻挂在了高高的树枝上。{name}踮脚跳了跳够不着，热心的{friend}推来了小竹梯。',
          narr78: '风向突然偏转，风筝线绕上了樟树梢。{name}没有灰心哭泣，而是与闻声赶来的{friend}商量安全取回风筝的办法。',
          dlg: '“一个人够不着没关系，我们合起来想办法！”',
          branches: [
            { id: 'ladder', label: '🪜 扶稳竹梯轻轻取下', action: 'walk', emotion: '平静', bg: 'meadow',
              narration: '{friend}在树下牢牢扶住小竹梯，{name}小心翼翼解开缠住的丝线，完好无损地抱回了风筝！',
              dialogue: '“你扶梯子我解线，配合得真默契！”', endingBoost: '树下互相扶稳竹梯的默契配合' },
            { id: 'breeze', label: '🌬️ 顺着微风巧拉风筝线', action: 'wave', emotion: '开心', bg: 'meadow',
              narration: '{name}耐心地等下一阵顺风吹来，轻轻一抖线轴，风筝像听话的小鸟一样稳稳飘回手心！',
              dialogue: '“原来顺着风的方向用巧劲，比使蛮力更有效！”', endingBoost: '借着春风巧手收回风筝的聪明办法' }
          ] },
        { title: '阵雨后的彩虹', action: 'run', emotion: '紧张', props: ['云', '花'],
          narr34: '滴答滴答下小雨！躲进大蘑菇伞下，哇，彩虹出来啦！',
          narr56: '一朵云飘来洒下几滴太阳雨，{name}和{friend}钻进大树洞躲雨，转眼间天边架起了一座七彩大桥！',
          narr78: '短暂的阵雨洗净了草叶，阳光穿过水滴折射出绚丽的七色光谱，{name}惊喜地数着彩虹的每一种颜色。',
          dlg: '“红橙黄绿青蓝紫，雨后的天空真像大画板！”' },
        { title: '蒲公英飞行队', action: 'fly', emotion: '开心', props: ['花', '云'],
          narr34: '呼——吹一口蒲公英，白色小伞飞满天喽！',
          narr56: '草地上的蒲公英绒球成熟了，{name}深吸一口气轻轻一吹，洁白的小绒伞带着“{wishShort}”的心愿飞向远方。',
          narr78: '成百上千颗蒲公英种子撑开白色绒毛降落伞乘风远航，{name}好奇地观察植物借风传播种子的奇妙本领。',
          dlg: '“去吧小种子，明年春天开出更多漂亮的小黄花！”' },
        { title: '花田欢庆舞', action: 'dance', emotion: '兴奋', props: ['花', '苹果'],
          narr34: '蝴蝶飞，蜜蜂唱，{name}拍拍手，在花丛里转圈圈！',
          narr56: '风筝重新飞上蓝天，{name}和{friend}在花田里手拉手跳起欢快的圆圈舞。',
          narr78: '微风奏响草叶琴弦，{name}和伙伴们在阳光花海里尽情舒展身姿，欢笑声传遍了整片山坡。',
          dlg: '“有好朋友陪在身边，每一分钟都像过节一样快乐！”' },
        { title: '树荫下的野餐', action: 'cheer', emotion: '温馨', props: ['花', '苹果'],
          narr34: '铺好小餐布，咬一口红苹果，“{wishShort}”完成啦，今天真开心！',
          narr56: '玩累了，大家坐在大树下分享红苹果，{endingMemory}，今天关于“{wishShort}”的愿望圆满达成啦！',
          narr78: '金黄的夕阳铺满草坡，{endingMemory}。{name}和{friend}围坐野餐垫分享果实，约定下个周末还要一起来放风筝。',
          dlg: '“一起动脑筋、一起分享美食，就是最棒的一天！”' }
      ]
    },
    home: {
      bg: 'home', nameLabel: '睡前', place: '暖洋洋的小卧室', thing: '月亮摇篮船', friend: '绒毛小熊',
      extraBg: 'space',
      coreActs: [
        { title: '台灯亮起微光', action: 'idle', emotion: '平静', props: ['云', '星星'],
          narr34: '夜深啦，小灯亮着暖暖的光。{visualLead}{kind}{name}小声说：“{wishShort}。”',
          narr56: '夜色轻轻落下来，{place}里亮着橘色小夜灯。{visualLead}{kind}{name}抱紧{friend}，轻声说起今晚的心愿——{wishClause}。',
          narr78: '时钟指针慢慢走过九点，{place}里弥漫着牛奶与书页的暖香。{visualLead}{kind}{name}靠在软枕边，和{friend}聊起白天的念头：“{wishShort}”。',
          dlg: '“在睡着之前，我们去梦里的云朵上逛一圈好不好？”' },
        { title: '登上月亮船', action: 'fly', emotion: '温柔', props: ['星星', '云'],
          narr34: '摇呀摇，坐上软软的月亮船，飘到云朵上面去喽！',
          narr56: '窗外飘来一艘银白色的{thing}，载着{name}和{friend}轻轻飘进软绵绵的云海，一路寻找“{wishShort}”的梦境。',
          narr78: '月光化作一叶轻柔的{thing}停靠窗前，{name}牵着{friend}踏上船头，伴着晚风在静谧的星云湖面上缓缓漂流。',
          dlg: '“云朵摸起来像晒过太阳的小棉被一样软呢！”',
          branches: [
            { id: 'lullaby', label: '🎵 听风铃星星唱摇篮曲', action: 'nod', emotion: '温柔', bg: 'home',
              narration: '{name}轻轻碰了碰船头的星光风铃，叮咚叮咚的摇篮曲让每一朵小云彩都安静地微笑起来。',
              dialogue: '“嘘——连小星星都听得打哈欠啦。”', endingBoost: '星光风铃叮咚作响的温柔摇篮曲' },
            { id: 'pillow_cloud', label: '☁️ 帮小月亮盖好云朵被', action: 'wave', emotion: '温馨', bg: 'space',
              narration: '{name}拉过一片最蓬松的白云，轻轻盖在打瞌睡的小月亮身上，心里觉得又踏实又温暖。',
              dialogue: '“盖好小被子，就不会着凉啦，晚安小月亮。”', endingBoost: '替小月亮盖上蓬松云朵被的贴心举动' }
          ] },
        { title: '数一数梦里的小羊', action: 'walk', emotion: '平静', props: ['云', '花'],
          narr34: '一只云朵羊，两只云朵羊，慢悠悠地散步呢！',
          narr56: '云朵草地上走来几只软乎乎的棉花小羊，{name}跟着它们慢悠悠地数数，眼皮也变得轻轻柔柔。',
          narr78: '星河岸边飘来朵朵棉花似的小云羊，{name}放慢呼吸，一、二、三地数着它们跳过银色栅栏。',
          dlg: '“一、二、三……慢慢深呼吸，心里真安静呀。”' },
        { title: '收集发光美梦露珠', action: 'nod', emotion: '温馨', props: ['星星', '云'],
          narr34: '摘一颗甜甜的美梦星星，装进小口袋里！',
          narr56: '{name}用小玻璃瓶装起两颗装着“{wishShort}”的星光露珠，放在枕头边守护今晚的好梦。',
          narr78: '夜空中飘落微甜的星光露珠，{name}将白天关于“{wishShort}”的美好想象妥帖珍藏进梦境小匣子。',
          dlg: '“把今天的开心事收好，明天醒来一定更有精神！”' },
        { title: '晚安全世界', action: 'wave', emotion: '温柔', props: ['云', '星星'],
          narr34: '跟小花说晚安，跟小鸟说晚安，跟爸爸妈妈说晚安！',
          narr56: '{thing}缓缓飞回窗前，{name}轻轻挥手向熟睡的大树、小鸟和远处的星空道晚安。',
          narr78: '夜航船穿过薄雾回到熟悉的屋檐下，{name}向窗外安睡的万物轻轻挥手告别。',
          dlg: '“晚安小星星，晚安全世界。”' },
        { title: '甜甜进入梦乡', action: 'sleep', emotion: '温柔', props: ['云'],
          narr34: '打个小哈欠，梦着“{wishShort}”，{name}抱着好朋友睡着啦。',
          narr56: '{thing}把大家送回{place}，{endingMemory}。{name}打了个甜甜的哈欠，抱着{friend}安稳地睡着了。',
          narr78: '橘色夜灯缓缓调暗，{endingMemory}。{name}带着关于“{wishShort}”的浅浅微笑，沉入温暖香甜的梦乡。',
          dlg: '“明天太阳升起来的时候，我们还要一起去探索新世界哦。”' }
      ]
    }
  };

  function pickTheme(cmd, tone) {
    var s = cmd || '';
    var map = [
      [/城堡|宫殿|皇冠|糖果堡|骑士|王子/, 'castle'],
      [/太空|星球|宇宙|宇航|火箭|飞船|外星|银河/, 'space'],
      [/大海|海底|深海|珊瑚|潜水|贝壳|海豚|海龟|鲸|小鱼/, 'ocean'],
      [/森林|大树|蘑菇|松鼠|丛林|恐龙/, 'forest'],
      [/草地|花园|风筝|公园|田野|野餐|蒲公英/, 'meadow'],
      [/睡觉|晚安|美梦|月亮船|卧室/, 'home'],
      [/星星|月亮/, 'space'],
      [/公主|魔法/, 'castle'],
      [/海|鱼|水/, 'ocean'],
      [/草|花|蝴蝶|彩虹/, 'meadow'],
      [/树|动物/, 'forest']
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(s)) return map[i][1];
    if (tone === 'bedtime') return 'home';
    if (tone === 'science') return 'space';
    if (tone === 'friendship') return 'meadow';
    return 'forest';
  }

  /* 提取孩子输入的核心短语，自然嵌入多幕叙事而非生硬打括号 */
  function normalizeWish(cmd, themeKey) {
    var raw = String(cmd || '').replace(/[<>]/g, '').trim();
    if (!raw) {
      var defaults = { space: '去星星上找新朋友', forest: '去大森林寻找秘密宝藏', ocean: '潜入海底看发光珊瑚',
        castle: '去云端糖果城堡赴约', meadow: '在阳光草地上放飞彩虹风筝', home: '坐上月亮船做一个甜甜的好梦' };
      raw = defaults[themeKey] || '开启一场奇妙冒险';
    }
    var clean = raw.replace(/^[，。！？、\s]+|[，。！？、\s]+$/g, '');
    var shortWish = clean.replace(/^(它|他|她|我|小主角|我们)?(想要|想去|希望|打算|准备|想要去|想)\s*/, '');
    if (!shortWish) shortWish = clean;
    if (shortWish.length > 22) shortWish = shortWish.slice(0, 22) + '…';
    var clause = /^(去|到|找|和|看|坐|飞|帮|学|做)/.test(shortWish) ? ('想要' + shortWish) : ('想要实现“' + shortWish + '”');
    return { raw: clean, shortWish: shortWish, clause: clause };
  }

  function fill(t, m) {
    return String(t).replace(/\{(\w+)\}/g, function (_, k) { return m[k] !== undefined ? m[k] : ''; });
  }

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];
  function selectActIndices(sceneCount) {
    if (sceneCount === 6) return [0, 1, 2, 3, 4, 5];
    if (sceneCount === 4) return [0, 1, 2, 5];
    return [0, 1, 5]; // 默认 3 幕：起因 + 分支奇遇 + 圆满结局
  }

  /* ---------- 端侧个性化多幕分支故事引擎 ---------- */
  Story.local = function (opt) {
    opt = opt || {};
    var ageGroup = ['3-4', '5-6', '7-8'].indexOf(opt.ageGroup) >= 0 ? opt.ageGroup : '5-6';
    var sceneCount = [3, 4, 6].indexOf(+opt.sceneCount) >= 0 ? +opt.sceneCount : 3;
    var themeKey = pickTheme(opt.cmd, opt.tone);
    var T = THEMES[themeKey];
    var wish = normalizeWish(opt.cmd, themeKey);
    var visualSummary = String(opt.visualSummary || '').trim();
    var visualLead = visualSummary ? ('身披' + visualSummary + '的') : '';

    var m = {
      name: opt.name || '小奇',
      kind: opt.kind && opt.kind !== '小朋友' ? opt.kind : '',
      place: T.place, thing: T.thing, friend: T.friend,
      wishShort: wish.shortWish, wishClause: wish.clause,
      visualLead: visualLead,
      endingMemory: '回想起一路上的勇敢与欢笑'
    };

    var indices = selectActIndices(sceneCount);
    var narrKey = ageGroup === '3-4' ? 'narr34' : (ageGroup === '7-8' ? 'narr78' : 'narr56');
    var knowledgeIdx = Math.min(indices.length - 2, 1);

    var scenes = indices.map(function (actIdx, idx) {
      var a = T.coreActs[actIdx];
      var sc = {
        title: '第' + CN_NUM[idx] + '幕 · ' + a.title,
        action: a.action,
        emotion: a.emotion,
        bg: (idx === 2 && sceneCount >= 4 && T.extraBg) ? T.extraBg : T.bg,
        narration: fill(a[narrKey] || a.narr56, m),
        dialogue: fill(a.dlg, m),
        props: a.props.slice(),
        knowledge: idx === knowledgeIdx ? (KNOWLEDGE[opt.edu] || '') : ''
      };
      if (Array.isArray(a.branches) && a.branches.length) {
        sc.branches = a.branches.map(function (br) {
          return {
            id: br.id, label: br.label, action: br.action, emotion: br.emotion, bg: br.bg || sc.bg,
            narration: fill(br.narration, m), dialogue: fill(br.dialogue, m),
            endingBoost: br.endingBoost || ''
          };
        });
        sc.selectedBranch = '';
      }
      return sc;
    });

    return {
      title: '《' + m.name + '的' + T.nameLabel + '奇遇：' + wish.shortWish.slice(0, 10) + '》',
      theme: themeKey,
      tone: opt.tone || 'adventure',
      ageGroup: ageGroup,
      goal: GOAL_LABEL[opt.edu] || '快乐成长',
      visualSummary: visualSummary,
      character: { name: m.name, kind: opt.kind || '小朋友' },
      scenes: scenes,
      question: '亲子小互动：当' + m.name + '想要“' + wish.shortWish + '”的时候，如果是你在旁边，你会选哪条路帮它呢？',
      engine: 'local-template'
    };
  };

  /* 应用某一幕的分支选择，并自动把分支记忆织入最后一幕结局 */
  Story.applyBranch = function (story, sceneIndex, branchId) {
    if (!story || !Array.isArray(story.scenes) || !story.scenes[sceneIndex]) return story;
    var sc = story.scenes[sceneIndex];
    if (!Array.isArray(sc.branches)) return story;
    var chosen = null;
    for (var i = 0; i < sc.branches.length; i++) {
      if (sc.branches[i].id === branchId) { chosen = sc.branches[i]; break; }
    }
    if (!chosen) return story;
    sc.selectedBranch = chosen.id;
    sc.narration = chosen.narration;
    sc.dialogue = chosen.dialogue;
    sc.action = chosen.action || sc.action;
    sc.emotion = chosen.emotion || sc.emotion;
    sc.bg = chosen.bg || sc.bg;

    // 联动更新尾幕结局呼应，让分支选择真正改变后续回响
    var last = story.scenes[story.scenes.length - 1];
    if (last && last !== sc && chosen.endingBoost) {
      var cleanBase = last.narration.replace(/（一路上[^）]*）/g, '');
      last.narration = cleanBase + '（一路上' + chosen.endingBoost + '，更成了大家最难忘的回忆。）';
    }
    return story;
  };

  /* ---------- 云端文本/多模态大模型（通过同源服务端代理） ---------- */
  Story.remote = function (opt, cfg) {
    opt = opt || {};
    var ageGroup = ['3-4', '5-6', '7-8'].indexOf(opt.ageGroup) >= 0 ? opt.ageGroup : '5-6';
    var sceneCount = [3, 4, 6].indexOf(+opt.sceneCount) >= 0 ? +opt.sceneCount : 3;
    var prompt = '任务：根据以下儿童画角色特征与儿童想法，为 ' + (AGE_LABEL[ageGroup] || '5-6岁儿童') + ' 创作一个绘本故事。\n' +
      '角色特征：' + (opt.kind && opt.kind !== '小朋友' ? opt.kind : '') + (opt.name || '小奇') + '\n' +
      (opt.visualSummary ? ('画作视觉特征：' + opt.visualSummary + '\n') : '') +
      '儿童创意与指令：' + (opt.cmd || '去探索新世界') + '\n' +
      '教育目标：' + (GOAL_LABEL[opt.edu] || '传递正向价值观') + '\n' +
      '风格：' + (opt.tone || 'adventure') + '\n' +
      '要求：严格输出 ' + sceneCount + ' 个场景，把孩子的想法贯穿起因、经过与结局；每个场景包含 title、narration、dialogue、emotion(好奇/紧张/开心/温馨/平静/期待/着急/温柔/兴奋)、action(walk/run/jump/wave/dance/fly/nod/wag/sleep/roll/cheer/idle)、bg(space/forest/ocean/castle/meadow/home)、props(道具数组，从星星/云/树/花/鱼/泡泡/飞船/城堡/苹果中选)、knowledge(仅第2幕填入简短趣味科普)。\n' +
      '只输出 JSON：{"title":"","scenes":[{...}],"question":""}';

    var payload = { prompt: prompt, model: (cfg && cfg.model) || 'qwen-plus' };
    if (cfg && cfg.vision && opt.imageDataUrl) payload.image_data_url = opt.imageDataUrl;

    return fetch((cfg && cfg.base) || '/api/story', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.detail || j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        var txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
        var a = txt.indexOf('{'), b = txt.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('模型未返回有效 JSON');
        var o = JSON.parse(txt.slice(a, b + 1));
        if (!o || !Array.isArray(o.scenes) || o.scenes.length < 2 || o.scenes.length > 8) throw new Error('故事场景数不合法');
        var actions = ['walk','run','jump','wave','dance','fly','nod','wag','sleep','roll','cheer','idle'];
        var bgs = ['space','forest','ocean','castle','meadow','home'];
        var emos = ['好奇','紧张','开心','温馨','平静','期待','着急','温柔','兴奋','害怕'];
        function clean(v, n) { return String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, n); }
        var scenes = o.scenes.map(function (x, i) {
          x = x || {};
          return {
            title: clean(x.title || ('第' + CN_NUM[i] + '幕'), 50),
            narration: clean(x.narration || x.text, 500),
            dialogue: clean(x.dialogue, 240),
            action: actions.indexOf(x.action) >= 0 ? x.action : 'idle',
            bg: bgs.indexOf(x.bg) >= 0 ? x.bg : 'forest',
            emotion: emos.indexOf(x.emotion) >= 0 ? x.emotion : '平静',
            props: Array.isArray(x.props) ? x.props.slice(0, 6).map(function (v) { return clean(v, 20); }) : [],
            knowledge: clean(x.knowledge, 240)
          };
        });
        if (scenes.some(function (x) { return !x.narration; })) throw new Error('场景旁白不能为空');
        return {
          title: clean(o.title || ('《' + (opt.name || '小奇') + '的故事》'), 80),
          theme: scenes[0].bg,
          tone: opt.tone || 'adventure',
          ageGroup: ageGroup,
          goal: GOAL_LABEL[opt.edu] || '',
          visualSummary: String(opt.visualSummary || '').slice(0, 200),
          character: { name: clean(opt.name || '小奇', 30), kind: clean(opt.kind || '小朋友', 20) },
          scenes: scenes,
          question: clean(o.question || '你最喜欢故事里的哪一段？', 160),
          engine: payload.image_data_url ? 'cloud-vlm' : 'cloud-llm'
        };
      });
  };

  Story.generate = function (opt, cfg) {
    if (cfg && cfg.base) {
      return Story.remote(opt, cfg).catch(function (err) {
        var s = Story.local(opt);
        s.warn = '服务端未开启外部模型，已自动使用端侧个性化引擎';
        return s;
      });
    }
    return Promise.resolve(Story.local(opt));
  };

  Story.themes = THEMES;
  Story.pickTheme = pickTheme;
  Story.GOAL_LABEL = GOAL_LABEL;
  Story.AGE_LABEL = AGE_LABEL;
})(window);
