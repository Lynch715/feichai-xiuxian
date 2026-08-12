export const SAVE_VERSION = "3.2.0";

/** 主角镜头的哨兵值。刻意不与任何 NPC id 冲突。 */
export const PLAYER_FOCUS_ID = "player";

export const TIME_SLOTS = ["清晨", "上午", "午后", "傍晚", "夜间"];

export const LOCATIONS = {
  gate: {
    id: "gate",
    name: "山门试心阶",
    short: "山门",
    description: "青石长阶没入云雾，十年一度的收徒试正在这里举行。",
  },
  residence: {
    id: "residence",
    name: "外门居所",
    short: "居所",
    description: "旧木窗临着竹林，屋里只有两张窄榻与一盏灵火灯。",
  },
  training: {
    id: "training",
    name: "传功坪",
    short: "传功坪",
    description: "石坪上剑痕纵横，外门弟子在晨钟与暮鼓间反复吐纳。",
  },
  herbHill: {
    id: "herbHill",
    name: "百草坡",
    short: "百草坡",
    description: "潮湿山风裹着药草清苦，雾后偶尔传来灵兽低鸣。",
  },
  chores: {
    id: "chores",
    name: "杂役院",
    short: "杂役院",
    description: "柴垛、药篓与旧符纸堆在灰墙下，消息也像尘土一样积在这里。",
  },
  alchemy: {
    id: "alchemy",
    name: "回春丹房",
    short: "丹房",
    description: "木格药柜沿墙排开，铜炉里浮着清苦药香，晒药架一直伸到檐下。",
  },
  archive: {
    id: "archive",
    name: "听雨藏经阁",
    short: "藏经阁",
    description: "旧竹简与阵图收在高阁里，檐角雨铃一响，满室纸页便像同时醒来。",
  },
  arena: {
    id: "arena",
    name: "外门小比擂台",
    short: "擂台",
    description: "朱线圈起三丈方台，外门弟子与执事已经围在四周。",
  },
};

export const NPCS = {
  lu: {
    id: "lu",
    name: "陆青禾",
    role: "同住弟子",
    home: "residence",
    age: 17,
    personality: ["谨慎", "热心"],
    publicGoal: "通过月末复核，不让家里失望",
    voice: "说话轻而克制，关心别人时常先停顿半拍；少说大道理，会用具体的小事表达担忧。",
    portrait: "assets/portraits/lu-qinghe.jpg",
    initialFavor: 38,
    known: true,
  },
  han: {
    id: "han",
    name: "韩照",
    role: "同辈弟子",
    home: "training",
    age: 18,
    personality: ["好胜", "直率"],
    publicGoal: "在小比前改掉右肩先动的旧习",
    voice: "句子短，直来直去，胜负心强但不刻薄；认可别人时很少明说，常用邀战或指点代替。",
    portrait: "assets/portraits/han-zhao.jpg",
    initialFavor: 14,
    known: true,
  },
  steward: {
    id: "steward",
    name: "周执事",
    role: "外门执事",
    home: "gate",
    age: 46,
    personality: ["审慎", "守规"],
    publicGoal: "让本届弟子按规矩完成复核",
    voice: "措辞简洁守规，先讲依据再下判断；不轻易安慰，也不会用羞辱性的称呼。",
    portrait: "assets/portraits/zhou-steward.jpg",
    initialFavor: 30,
    known: true,
  },
  apprentice: {
    id: "apprentice",
    name: "许棠",
    role: "丹房学徒",
    home: "alchemy",
    age: 19,
    personality: ["细致", "寡言"],
    publicGoal: "补全丹房缺页的旧医簿",
    voice: "寡言而准确，习惯以药性、脉象和操作细节说话；情绪多藏在递药、收手等动作里。",
    portrait: "assets/portraits/xu-tang.jpg",
    initialFavor: 30,
    known: false,
  },
  laborer: {
    id: "laborer",
    name: "莫七",
    role: "沉默杂役",
    home: "chores",
    age: 29,
    personality: ["冷淡", "敏锐"],
    publicGoal: "弄清每月回收旧符的真正用途",
    voice: "话少，语气偏冷，回答前常先观察对方；不主动倾诉，只用半句提醒或实际行动表示信任。",
    portrait: "assets/portraits/mo-qi.jpg",
    initialFavor: 22,
    known: false,
  },
  guest: {
    id: "guest",
    name: "闻鹤客卿",
    role: "来历不明的客卿",
    home: "archive",
    age: 63,
    personality: ["疏离", "洞察"],
    publicGoal: "校完藏经阁残缺的三瓣阵图",
    voice: "语速从容，善用简短比喻点破关键；不故作玄虚，不把已知之事说成天机。",
    portrait: "assets/portraits/wen-he.jpg",
    initialFavor: 25,
    known: false,
  },
};

export const TRUTH_ROUTES = {
  damaged: {
    id: "damaged",
    title: "先天灵脉受损",
    shortTruth: "你的经脉并非天生孱弱，而是幼年遭过一次未被妥善医治的灵息灼伤。",
    clues: [
      { id: "meridian_sting", title: "逆行刺痛", text: "每次引气至右臂曲池穴，都会出现并非疲劳造成的锐痛。" },
      { id: "herb_reaction", title: "药草异应", text: "凝露草贴近手腕时迅速枯黄，像是被旧伤中残留的火息灼过。" },
      { id: "old_record", title: "旧医簿残页", text: "丹房旧簿记着你幼年曾因灵息灼伤求医，却没有完成后续疗程。" },
      { id: "pulse_diagnosis", title: "许棠诊脉", text: "许棠确认旧火息仍堵在右臂经脉，只要循序疏导，并非无药可治。" },
    ],
    resolution: {
      title: "旧伤得治",
      text: "许棠用凝露草压住旧火息，替你疏开最危险的那处郁结。经脉仍需休养，但灵气第一次完整走完了周天。",
    },
  },
  sealed: {
    id: "sealed",
    title: "天资被封印",
    shortTruth: "一道隐蔽封灵印压住了你的灵根表现，封印来源仍未查明。",
    clues: [
      { id: "seal_pulse", title: "封印脉动", text: "修炼将成时，丹田外总会浮出一圈规律得过分的阻力。" },
      { id: "array_mark", title: "阵纹共鸣", text: "百草坡残阵亮起时，你腕骨下闪过同样的三瓣纹路。" },
      { id: "guest_warning", title: "客卿警语", text: "闻鹤客卿断言，那不是伤，而是一道有意留下的封灵印。" },
      { id: "seal_name", title: "三瓣封灵印", text: "闻鹤辨出阵印名目，并确认它已年久松动，可以在不追查来历的情况下先行解开。" },
    ],
    resolution: {
      title: "封印松解",
      text: "闻鹤按住最后一道阵眼，你亲手引灵冲开三瓣封灵印。束缚没有尽数消散，却已不能再遮住你的真正资质。",
    },
  },
  drained: {
    id: "drained",
    title: "修炼成果被抽离",
    shortTruth: "你修出的灵气正在被某种隐秘联系持续抽走，源头藏在宗门日常之中。",
    clues: [
      { id: "missing_gain", title: "消失的修为", text: "吐纳结束时明明完成了周天，入体灵气却凭空少了近一半。" },
      { id: "reverse_trace", title: "逆行灵痕", text: "百草坡石缝中的灵气不向地脉汇聚，反而朝宗门深处逆流。" },
      { id: "chores_talisman", title: "杂役院旧符", text: "一张废弃转灵符上的气息，与你每次修炼后残留的空洞感完全相同。" },
      { id: "talisman_anchor", title: "转灵符锚点", text: "莫七找出埋在传功坪旧石下的符脚；只要毁去锚点，抽离便会停止。" },
    ],
    resolution: {
      title: "灵路斩断",
      text: "旧符在火中蜷曲成灰，传功坪下那股若有若无的牵引终于断了。过去失去的修为无法追回，往后的每一缕灵气却都将属于你。",
    },
  },
  ordinary: {
    id: "ordinary",
    title: "天赋确实平凡",
    shortTruth: "没有旧伤、封印或外力作祟。你的天赋确实远逊同辈，但悟性、根基与选择仍能改变能走多远。",
    clues: [
      { id: "steady_meridian", title: "经脉无损", text: "数次吐纳虽然进境缓慢，经脉运转却始终平稳，没有受损或受制的迹象。" },
      { id: "herb_silence", title: "药草无异", text: "凝露草贴近腕脉没有任何异常，身体里也不存在会灼伤草叶的异息。" },
      { id: "plain_record", title: "寻常灵根记录", text: "旧册上的历次测试结果彼此吻合：没有人篡改，也没有一次突兀衰退。" },
      { id: "han_method", title: "韩照的笨办法", text: "韩照替你拆开剑势，证明资质决定速度，却不决定一个人能否找到适合自己的练法。" },
    ],
    resolution: {
      title: "另辟缓途",
      text: "你不再等待某个隐藏天赋突然归来，而是把吐纳、步法与剑势重新拆开。道路比旁人慢，却终于是一条能够积累、能够重复的路。",
    },
  },
};

export const STARTING_ITEMS = [
  { id: "healing_powder", name: "止血散", type: "consumable", count: 2, description: "恢复少量体力，缓解轻伤。" },
  { id: "qi_manual", name: "《引气诀》残页", type: "manual", count: 1, description: "青崖宗外门通用吐纳法。" },
];

export const DEFAULT_PROFILE = {
  name: "沈砚",
  gender: "男",
  age: 17,
  race: "人族",
  origin: "山下寒门",
  mainPath: "剑修",
  appearance: 67,
  visibleTalent: 12,
  morality: 46,
  traits: ["隐忍", "执拗"],
  portrait: "assets/portraits/shen-yan.jpg",
};

export function favorStage(value) {
  if (value < -50) return "仇视";
  if (value < 0) return "厌恶";
  if (value < 25) return "冷淡";
  if (value < 45) return "中立";
  if (value < 65) return "亲近";
  if (value < 81) return "信赖";
  return "倾心";
}
