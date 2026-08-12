import {
  DEFAULT_PROFILE,
  LOCATIONS,
  NPCS,
  PLAYER_FOCUS_ID,
  SAVE_VERSION,
  STARTING_ITEMS,
  TIME_SLOTS,
  TRUTH_ROUTES,
  favorStage,
} from "./game-data.js";
import { SLOTS_PER_DAY, canAfford, describeTimeCost, displaySlotIndex, spendTime, timeCostOf } from "./day-cycle.js";
import { random01 } from "./rng.js";
import { applyDeltas } from "./adjudicator.js";

const ROUTE_IDS = Object.keys(TRUTH_ROUTES);
const LOCATION_ORDER = ["residence", "training", "herbHill", "chores", "alchemy", "archive", "gate"];
const CULTIVATION_MAJOR_REALMS = ["练气期", "筑基期", "金丹期", "元婴期", "化神期", "炼虚期", "合体期", "大乘期", "真仙境"];
const MINOR_STAGE_NAMES = ["初期", "中期", "后期", "圆满"];
const QI_BASE_BY_MAJOR = [40, 400, 4000, 40000, 400000, 4000000, 40000000, 400000000, 4000000000];

function cultivationStageForRank(rank = 0) {
  const safeRank = Math.max(0, Math.min(37, Number(rank) || 0));
  if (safeRank < 9) {
    const layerNames = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
    return { rank: safeRank, majorIndex: 0, name: `练气${layerNames[safeRank]}层`, cultivationMax: 100, qiMax: 40 + safeRank * 8 };
  }
  if (safeRank === 37) return { rank: safeRank, majorIndex: 8, name: "真仙境", cultivationMax: 900, qiMax: QI_BASE_BY_MAJOR[8] };
  const offset = safeRank - 9;
  const majorIndex = 1 + Math.floor(offset / 4);
  const minorIndex = offset % 4;
  return {
    rank: safeRank,
    majorIndex,
    name: `${CULTIVATION_MAJOR_REALMS[majorIndex].replace("期", "")}${MINOR_STAGE_NAMES[minorIndex]}`,
    cultivationMax: 100 * (majorIndex + 1),
    qiMax: Math.round(QI_BASE_BY_MAJOR[majorIndex] * (1 + minorIndex * 0.2)),
  };
}

function withTimeHints(actions) {
  return actions.map((action) => {
    const timeCost = timeCostOf(action.id);
    // end_day 重置整日而非消耗时段，标注「不推进时辰」会误导，故不加耗时后缀
    if (action.id === "end_day") return { ...action, timeCost };
    const timeText = describeTimeCost(timeCost);
    return { ...action, timeCost, hint: action.hint ? `${action.hint} · ${timeText}` : timeText };
  });
}

function clone(value) {
  return structuredClone(value);
}

function migrateLegacyPlayerAddress(text, player) {
  if (typeof text !== "string" || !player?.name || player.name === DEFAULT_PROFILE.name) return text;
  const honorific = player.gender === "女" ? "师姐" : player.gender === "男" ? "师兄" : "道友";
  return text
    .replace(/沈(?:师兄|师弟|师姐|师妹|道友)/g, `${player.name}${honorific}`)
    .replaceAll(DEFAULT_PROFILE.name, player.name);
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeNpcStates() {
  return Object.fromEntries(
    Object.values(NPCS).map((npc) => [
      npc.id,
      {
        id: npc.id,
        favor: npc.initialFavor,
        known: npc.known,
        notes: [],
      },
    ]),
  );
}

export function createNewGame({ seed = Date.now(), profile = {} } = {}) {
  const mergedProfile = { ...DEFAULT_PROFILE, ...profile };
  const routeId = ROUTE_IDS[Math.floor(random01(seed, 0, "truth") * ROUTE_IDS.length)];
  const realTalent = routeId === "ordinary"
    ? 18 + Math.floor(random01(seed, 0, "talent") * 15)
    : 74 + Math.floor(random01(seed, 0, "talent") * 17);
  return {
    saveVersion: SAVE_VERSION,
    gameId: globalThis.crypto?.randomUUID?.() ?? `game-${seed}`,
    seed,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    turn: 0,
    day: 1,
    slot: 0,
    phase: "intro",
    locationId: "gate",
    locationIntro: false,
    focusCharacterId: "steward",
    sceneMood: "solemn",
    worldTruth: {
      routeId,
      realTalent,
    },
    player: {
      ...mergedProfile,
      realm: "练气一层",
      realmRank: 0,
      cultivation: 8,
      cultivationMax: 100,
      qi: 32,
      qiMax: 40,
      stamina: 92,
      staminaMax: 100,
      foundation: 44,
      fatigue: 4,
      injury: 0,
      spiritStones: 6,
      reputation: 0,
      daysRemainingEstimate: 30280,
    },
    npcStates: makeNpcStates(),
    knowledge: {
      clueIds: [],
      suspicions: [],
      truthRevealed: false,
      routeResolved: false,
    },
    questStates: {
      entryReview: "active",
      anomaly: "undiscovered",
      tournament: "locked",
    },
    storyFlags: {
      luSupper: false,
      hanSpar: false,
      stewardReview: false,
      apprenticeHelp: false,
      laborerHelp: false,
      guestConsulted: false,
    },
    inventory: clone(STARTING_ITEMS),
    counters: {
      training: 0,
      herbExplore: 0,
      chores: 0,
      luTalk: 0,
      hanObserve: 0,
      hanSpar: 0,
      apprenticeTalk: 0,
      laborerTalk: 0,
      guestTalk: 0,
    },
    battle: null,
    stageEnding: null,
    eventLog: [
      {
        turn: 0,
        day: 1,
        slot: 0,
        title: "山门试心",
        text: "十年一度的收徒试上，你的灵光只亮起微弱一线。",
        factsText: "十年一度的收徒试上，你的灵光只亮起微弱一线。",
        kind: "story",
        source: "system",
      },
    ],
    worldPulse: [],
    recentTurns: [],
    dialogueMemory: [],
    longTermSummary: `${mergedProfile.name}参加青崖宗收徒试，可见天赋低下，尚未确定能否留下。`,
  };
}

function getRoute(state) {
  return TRUTH_ROUTES[state.worldTruth.routeId];
}

function addItem(state, item) {
  const existing = state.inventory.find((entry) => entry.id === item.id);
  if (existing) existing.count += item.count ?? 1;
  else state.inventory.push({ ...item, count: item.count ?? 1 });
}

function addClue(state, index, publicEffects, facts) {
  const clue = getRoute(state).clues[index];
  if (!clue || state.knowledge.clueIds.includes(clue.id)) return;
  state.knowledge.clueIds.push(clue.id);
  publicEffects.push(`获得线索：${clue.title}`);
  facts.push(clue.text);
  state.eventLog.unshift({
    turn: state.turn + 1,
    day: state.day,
    slot: state.slot,
    title: clue.title,
    text: clue.text,
    factsText: clue.text,
    kind: "clue",
    source: "system",
  });
  if (state.knowledge.clueIds.length === 2) {
    state.questStates.anomaly = "investigating";
    state.knowledge.suspicions = state.worldTruth.routeId === "ordinary"
      ? ["多次检查都没有发现外力痕迹，也许答案比奇遇更朴素。"]
      : ["你的废柴表现可能不只是单纯天赋不足。"];
  }
  if (state.knowledge.clueIds.length >= 3) {
    state.knowledge.truthRevealed = true;
    state.questStates.anomaly = "truth_known";
    state.knowledge.suspicions = [`已确认：${getRoute(state).title}。还需要亲手处理这一问题。`];
  }
}

function changeFavor(state, npcId, delta, publicEffects) {
  const npcState = state.npcStates[npcId];
  if (!npcState) return;
  const before = favorStage(npcState.favor);
  npcState.favor += delta;
  const after = favorStage(npcState.favor);
  if (before !== after) publicEffects.push(`${NPCS[npcId].name}的态度变为“${after}”`);
}

function introActions() {
  return [
    { id: "accept_entry", label: "接过外门木牌，先留下再说", hint: "稳妥" },
    { id: "question_result", label: "询问周执事：测试是否可能出错", hint: "可能引人注意" },
    { id: "observe_peers", label: "暂不出声，观察其他弟子的反应", hint: "获得信息" },
    { id: "inspect_spirit_tablet", label: "俯身查看验灵石与灵牌是否有异样", hint: "谨慎查验" },
  ];
}

function battleActions(state) {
  if (state.battle?.finished) return [{ id: "finish_stage", label: "走下擂台，接受小比结果", hint: "阶段结局" }];
  return [
    { id: "battle_attack", label: "运起引气诀，正面抢攻", hint: `灵气 ${state.player.qi}/40` },
    { id: "battle_defend", label: "稳住下盘，护住经脉", hint: "降低伤害" },
    { id: "battle_observe", label: "暂避锋芒，观察韩照出手习惯", hint: "下回合优势" },
    { id: "battle_feint", label: "贴着朱线绕步，佯攻韩照左侧", hint: "低耗扰敌" },
  ];
}

export function getAvailableActions(state) {
  if (state.phase === "intro") return withTimeHints(introActions());
  if (state.phase === "battle") return withTimeHints(battleActions(state));

  const actions = [];
  if (state.locationId === "residence") {
    actions.push(
      { id: "rest", label: "休息并整理今日所得", hint: "恢复体力与灵气" },
      { id: "talk_lu", label: "和陆青禾聊聊近来的异常", hint: "关系／线索" },
    );
    if (state.day >= 2 && !state.storyFlags.luSupper) actions.push({ id: "share_supper", label: "和陆青禾分一碗晚粥", hint: "人物剧情" });
  }
  if (state.locationId === "training") {
    actions.push(
      { id: "train", label: "依照《引气诀》完成一个周天", hint: "修为／疲劳" },
      { id: "observe_han", label: "观察韩照练剑的节奏", hint: "小比优势" },
    );
    if (state.counters.hanObserve >= 1 && !state.storyFlags.hanSpar) actions.push({ id: "spar_han", label: "请韩照用木剑陪你拆三招", hint: "人物剧情／小比优势" });
    if (state.worldTruth.routeId === "ordinary" && state.knowledge.truthRevealed && !state.knowledge.routeResolved) {
      actions.push({ id: "rebuild_method", label: "放下奇遇幻想，重拆自己的练法", hint: "处理真因" });
    }
    if ((state.player.realmRank || 0) < 37 && state.player.cultivation >= state.player.cultivationMax) {
      actions.unshift({ id: "attempt_breakthrough", label: `稳固气机，尝试突破${cultivationStageForRank((state.player.realmRank || 0) + 1).name}`, hint: "境界突破" });
    }
  }
  if (state.locationId === "herbHill") {
    actions.push(
      { id: "explore_herbs", label: "沿着灵气紊乱处搜寻药草", hint: "探索／可能受伤" },
      { id: "gather_herbs", label: "只采集认识的凝露草", hint: "稳妥收益" },
    );
  }
  if (state.locationId === "chores") {
    actions.push(
      { id: "work_chores", label: "接下半日分拣药篓的杂务", hint: "灵石／疲劳" },
      { id: "talk_laborer", label: "向沉默杂役打听旧符纸来源", hint: "情报" },
    );
    if (state.npcStates.laborer.known && !state.storyFlags.laborerHelp) actions.push({ id: "help_laborer", label: "替莫七完成一轮焚符杂务", hint: "人物剧情" });
    if (state.worldTruth.routeId === "drained" && state.knowledge.truthRevealed && !state.knowledge.routeResolved) {
      actions.push({ id: "sever_talisman", label: "与莫七一起毁去转灵符锚点", hint: "处理真因" });
    }
  }
  if (state.locationId === "gate") {
    actions.push({ id: "meditate_gate", label: "在试心阶旁静坐调息", hint: "少量恢复" });
    if (state.day >= 3 && !state.storyFlags.stewardReview) actions.push({ id: "steward_review", label: "把整理好的异常记录交给周执事", hint: "主线复核" });
    if (state.questStates.tournament === "complete") actions.push({ id: "sect_patrol", label: "领取一趟外门巡山差事", hint: "长期历练／灵石" });
  }
  if (state.locationId === "alchemy") {
    actions.push({ id: "talk_apprentice", label: state.npcStates.apprentice.known ? "请许棠查看伤势与灵脉记录" : "请丹房学徒查看伤势与灵脉记录", hint: "药理／线索" });
    if (!state.storyFlags.apprenticeHelp) {
      actions.push({ id: "help_apprentice", label: state.npcStates.apprentice.known ? "帮许棠整理晒药架" : "替丹房学徒整理晒药架", hint: "人物剧情／药材" });
    }
    if (state.worldTruth.routeId === "damaged" && state.knowledge.truthRevealed && !state.knowledge.routeResolved) {
      actions.push({ id: "treat_meridian", label: "请许棠按旧方疏导灵脉", hint: "处理真因" });
    }
  }
  if (state.locationId === "archive") {
    actions.push({ id: "read_records", label: "查阅历年入门测试与阵图", hint: "记录／线索" });
    if (state.npcStates.guest.known) {
      actions.push({ id: "consult_guest", label: "请闻鹤客卿辨认腕下阵痕", hint: "阵印／线索" });
    }
    if (state.worldTruth.routeId === "sealed" && state.knowledge.truthRevealed && !state.knowledge.routeResolved) {
      actions.push({ id: "break_seal", label: "在闻鹤指点下亲手冲开封灵印", hint: "处理真因" });
    }
  }

  if (state.day >= 7 && !state.battle) {
    actions.unshift({ id: "start_tournament", label: "前往外门小比，登上擂台", hint: "阶段挑战" });
  }

  if (state.slot >= SLOTS_PER_DAY - 2) {
    actions.unshift({ id: "end_day", label: "结束今日，返回居所休息", hint: "由你确认进入次日" });
  }

  actions.push({ id: "free_action", label: "自由输入行动", hint: "由系统判断可行性", freeInput: true });
  return withTimeHints(actions.filter((action) => canAfford(state, action.id)));
}

export function moveTo(state, locationId) {
  if (state.phase !== "explore" || !LOCATIONS[locationId] || !LOCATION_ORDER.includes(locationId)) {
    throw new Error("现在无法前往那里。 ");
  }
  if (state.locationId === locationId) throw new Error("你已经在这里了。 ");
  const next = clone(state);
  next.locationId = locationId;
  next.locationIntro = true;
  // 走开就是离开上一幕：镜头交还主角，否则上一个对话对象会跟着玩家满山跑。
  next.focusCharacterId = PLAYER_FOCUS_ID;
  return next;
}

export function getMoveDestinations(state) {
  return LOCATION_ORDER.filter((id) => id !== state.locationId).map((id) => ({
    id,
    name: LOCATIONS[id].name,
    description: LOCATIONS[id].description,
  }));
}

function resolveIntro(state, actionId, publicEffects, facts) {
  state.phase = "explore";
  state.locationId = "residence";
  state.focusCharacterId = actionId === "observe_peers" ? "han" : "steward";
  if (actionId === "question_result") {
    changeFavor(state, "steward", 2, publicEffects);
    state.player.reputation += 1;
    facts.push("周执事重新验过灵牌，结果依旧微弱，却允许你留到月末复核。", "你的坚持让少数人记住了你。 ");
  } else if (actionId === "observe_peers") {
    state.counters.hanObserve += 1;
    facts.push("韩照的灵光耀眼，却在收势时习惯先落右脚。", "你没有争辩，只把同辈的神情逐一记下。 ");
  } else if (actionId === "inspect_spirit_tablet") {
    facts.push("验灵石表面无裂，木牌上的引灵纹也完整如初。", "你暂时排除了器具明显损坏，却更确信那一线微光另有原因。 ");
    publicEffects.push("排除：验灵器具明显故障");
  } else {
    facts.push("外门木牌粗糙冰凉，至少给了你一个月的机会。", "陆青禾替你腾出靠窗的那张窄榻。 ");
  }
  publicEffects.push("获得身份：青崖宗外门弟子");
}

function resolveTraining(state, publicEffects, facts) {
  state.counters.training += 1;
  const rawGain = 6 + Math.floor(random01(state.seed, state.turn, "train") * 5);
  const fatiguePenalty = Math.floor(state.player.fatigue / 25);
  const visibleGain = Math.max(2, rawGain - fatiguePenalty);
  const routeLoss = state.worldTruth.routeId === "drained" ? 3 : 1;
  const gain = Math.max(1, visibleGain - routeLoss);
  state.player.cultivation = clamp(state.player.cultivation + gain, 0, state.player.cultivationMax);
  state.player.qi = clamp(state.player.qi - 9, 0, state.player.qiMax);
  state.player.stamina = clamp(state.player.stamina - 8, 0, state.player.staminaMax);
  state.player.fatigue = clamp(state.player.fatigue + 8, 0, 100);
  publicEffects.push(`修为 +${gain}`, "灵气 -9", "疲劳上升");
  facts.push("你完成了一个完整周天，但落入丹田的灵气仍比应有的少。 ");
  if (state.counters.training === 1) addClue(state, 0, publicEffects, facts);
}

function resolveBreakthrough(state, publicEffects, facts) {
  const currentRank = state.player.realmRank || 0;
  const target = cultivationStageForRank(currentRank + 1);
  const chance = clamp(
    0.38 + state.player.visibleTalent / 180 + state.player.foundation / 320 - state.player.fatigue / 260,
    0.35,
    0.96,
  );
  const roll = random01(state.seed, state.turn, `breakthrough-${currentRank}`);
  if (roll <= chance) {
    const oldStage = cultivationStageForRank(currentRank);
    state.player.realmRank = target.rank;
    state.player.realm = target.name;
    state.player.cultivation = 0;
    state.player.cultivationMax = target.cultivationMax;
    state.player.qiMax = target.qiMax;
    state.player.qi = Math.max(Math.floor(target.qiMax * 0.55), state.player.qi);
    state.player.foundation = clamp(state.player.foundation + 2, 0, 100);
    state.player.fatigue = clamp(state.player.fatigue + 8, 0, 100);
    const crossedMajorRealm = target.majorIndex > oldStage.majorIndex;
    publicEffects.push(`境界突破：${target.name}`, `灵气上限 ${target.qiMax}`);
    facts.push(
      crossedMajorRealm
        ? `积蓄已久的灵气越过关隘，你从${oldStage.name}踏入${target.name}。经脉能够容纳的灵气随境界骤然扩张。 `
        : `你稳住最后一处浮动气机，灵气在经脉中打开新的回路，境界推进至${target.name}。 `,
    );
  } else {
    state.player.cultivation = Math.floor(state.player.cultivationMax * 0.82);
    state.player.fatigue = clamp(state.player.fatigue + 14, 0, 100);
    state.player.injury = clamp(state.player.injury + 3, 0, 100);
    publicEffects.push("突破未成", "疲劳 +14", "轻伤 +3");
    facts.push("气机在最后关口散开。你及时收束灵气，没有伤到根基，却需要重新温养经脉后再试。 ");
  }
}

function resolveHerbExplore(state, publicEffects, facts) {
  state.counters.herbExplore += 1;
  const roll = random01(state.seed, state.turn, "herb");
  state.player.stamina = clamp(state.player.stamina - 7, 0, state.player.staminaMax);
  if (roll < 0.28) {
    state.player.injury = clamp(state.player.injury + 6, 0, 100);
    publicEffects.push("体力 -7", "轻伤 +6");
    facts.push("湿石突然松动，你手腕被锋利石棱划开，所幸没有伤到筋骨。 ");
  } else {
    addItem(state, { id: "dew_herb", name: "凝露草", type: "material", count: 2, description: "常见九品药材。" });
    publicEffects.push("获得凝露草 ×2", "体力 -7");
    facts.push("你从石缝间辨出两株叶缘带露的凝露草。 ");
  }
  if (state.counters.herbExplore >= 2) addClue(state, 1, publicEffects, facts);
}

function resolveLuTalk(state, publicEffects, facts) {
  state.counters.luTalk += 1;
  state.focusCharacterId = "lu";
  changeFavor(state, "lu", 4, publicEffects);
  facts.push("陆青禾没有嘲笑你的怀疑，而是把每次异常发生的时辰认真记在纸上。 ");
  if (state.knowledge.clueIds.length >= 2 && state.counters.luTalk >= 2) {
    state.npcStates.apprentice.known = true;
    if (state.worldTruth.routeId === "damaged") {
      facts.push("她建议你去找丹房学徒许棠查一查旧医簿。 ");
    } else if (state.worldTruth.routeId === "sealed") {
      state.npcStates.guest.known = true;
      facts.push("她提到一位最近借住宗门、精通阵印的闻鹤客卿。 ");
    } else {
      state.npcStates.laborer.known = true;
      facts.push(state.worldTruth.routeId === "drained"
        ? "她认出残留气息与杂役院焚掉的旧符纸相近。 "
        : "她建议把历年灵牌记录找出来，先排除伤势、阵印和外力。 ");
    }
  }
}

function resolveApprenticeTalk(state, publicEffects, facts) {
  state.npcStates.apprentice.known = true;
  state.focusCharacterId = "apprentice";
  state.counters.apprenticeTalk += 1;
  changeFavor(state, "apprentice", 3, publicEffects);
  facts.push("许棠先问清每次刺痛的时辰与位置，才以两指搭住你的腕脉，没有轻率下结论。 ");
  if (state.worldTruth.routeId === "damaged" && state.knowledge.clueIds.length >= 2) {
    addClue(state, 2, publicEffects, facts);
  } else if (state.worldTruth.routeId === "ordinary" && state.counters.apprenticeTalk >= 1) {
    facts.push("她反复诊过三次，只能确认你的经脉健康、灵息稳定，没有药理上的异常。 ");
  } else {
    facts.push("她确认经脉没有新伤，建议你把注意力转向阵印、功法或修炼地点。 ");
  }
}

function resolveGuestConsult(state, publicEffects, facts) {
  state.npcStates.guest.known = true;
  state.focusCharacterId = "guest";
  state.storyFlags.guestConsulted = true;
  state.counters.guestTalk += 1;
  changeFavor(state, "guest", 2, publicEffects);
  state.npcStates.guest.notes = ["答应在小比前替你完成一次阵印复核。"];
  if (state.worldTruth.routeId === "sealed" && state.knowledge.clueIds.length >= 2) {
    facts.push("闻鹤只让你运转最基础的一段吐纳，随后以竹简压住腕下浮出的三瓣纹路。 ");
    addClue(state, 2, publicEffects, facts);
  } else {
    facts.push("闻鹤看过你的行气路线，没有发现封印痕迹，只提醒你别把每次停滞都归咎于神秘外力。 ");
  }
}

function resolveStewardReview(state, publicEffects, facts) {
  state.focusCharacterId = "steward";
  state.storyFlags.stewardReview = true;
  state.questStates.entryReview = "passed";
  changeFavor(state, "steward", 5, publicEffects);
  state.npcStates.steward.notes = ["已在你的木牌背面补刻月末复核印。"];
  state.player.reputation += 2;
  publicEffects.push("月末复核资格确认", "声望 +2");
  facts.push("周执事逐页看完记录，认可你没有用传闻冒充证据，并在木牌背面补刻了复核印。 ");
  if (state.worldTruth.routeId === "ordinary" && state.knowledge.clueIds.length >= 2) {
    addClue(state, 2, publicEffects, facts);
  }
}

function resolveTruthRoute(state, publicEffects, facts) {
  const route = getRoute(state);
  addClue(state, 3, publicEffects, facts);
  state.knowledge.truthRevealed = true;
  state.knowledge.routeResolved = true;
  state.questStates.anomaly = "resolved";
  state.player.visibleTalent = state.worldTruth.realTalent;
  state.player.foundation = clamp(state.player.foundation + (route.id === "ordinary" ? 10 : 8), 0, 100);
  state.player.cultivation = clamp(state.player.cultivation + (route.id === "ordinary" ? 8 : 16), 0, state.player.cultivationMax);
  state.player.qiMax += route.id === "ordinary" ? 4 : 10;
  state.player.qi = state.player.qiMax;
  state.knowledge.suspicions = [`已处理：${route.resolution.title}。`];
  facts.push(route.resolution.text);
  publicEffects.push(route.resolution.title, `可见天赋恢复为 ${state.player.visibleTalent}`, "根基提升", "灵气上限提升");
}

function resolvePersonalStory(state, actionId, publicEffects, facts) {
  if (actionId === "share_supper") {
    state.storyFlags.luSupper = true;
    state.focusCharacterId = "lu";
    changeFavor(state, "lu", 8, publicEffects);
    state.npcStates.lu.notes = ["已与你约好，小比之后无论输赢都一起去看榜。"];
    facts.push("陆青禾把自己舍不得吃的半枚腌梅放进粥里。她承认自己也怕月末复核，只是比你更会把怕藏起来。你们约好，小比之后无论输赢都一起去看榜。 ");
  } else if (actionId === "spar_han") {
    state.storyFlags.hanSpar = true;
    state.counters.hanSpar += 1;
    state.focusCharacterId = "han";
    changeFavor(state, "han", 7, publicEffects);
    state.npcStates.han.notes = ["承认你值得自己在小比中全力出手。"];
    state.player.foundation = clamp(state.player.foundation + 4, 0, 100);
    facts.push("韩照没有放慢木剑，只把每一招拆到你能看懂的位置。他说天赋差会走得慢，但动作错了才会永远走不到。第三招，你终于逼得他换了一次脚。 ");
    publicEffects.push("根基 +4", "获得小比优势");
  } else if (actionId === "help_apprentice") {
    state.storyFlags.apprenticeHelp = true;
    state.npcStates.apprentice.known = true;
    state.focusCharacterId = "apprentice";
    changeFavor(state, "apprentice", 6, publicEffects);
    state.npcStates.apprentice.notes = ["愿意继续替你复查经脉与旧医簿。"];
    addItem(state, { id: "meridian_decoction", name: "温脉散", type: "consumable", count: 1, description: "许棠配的九品药散，可缓解经脉刺痛与轻伤。" });
    facts.push("你按药性把晒架重新排过一遍，许棠省下半个时辰。她把一包温脉散推给你，只说药账已经用你的工钱抵过。 ");
    publicEffects.push("获得温脉散 ×1");
  } else if (actionId === "help_laborer") {
    state.storyFlags.laborerHelp = true;
    state.focusCharacterId = "laborer";
    changeFavor(state, "laborer", 7, publicEffects);
    state.npcStates.laborer.notes = ["把刻有传功坪方位的旧铜钉留给了你。"];
    facts.push("你没有追问莫七不愿说的旧事，只陪他把潮掉的符纸一张张分开。火盆将熄时，他把一枚刻着传功坪方位的旧铜钉留在灰边。 ");
    publicEffects.push("获得情报：旧符去向");
  }
}

function resolveBattle(state, actionId, publicEffects, facts) {
  const battle = state.battle;
  battle.round += 1;
  const enemyRoll = random01(state.seed, state.turn, `enemy-${battle.round}`);
  let playerDamage = 0;
  let enemyDamage = 0;

  if (actionId === "battle_attack") {
    if (state.player.qi < 6) {
      facts.push("丹田空虚，你强行出手却只带起一阵散乱灵风。 ");
      playerDamage = 2;
    } else {
      state.player.qi -= 6;
      enemyDamage = 9 + (battle.observed ? 5 : 0) + Math.floor(random01(state.seed, state.turn, "attack") * 6);
      battle.observed = false;
      facts.push("你贴着韩照回剑的空隙逼近，掌中灵气撞上他的护体气劲。 ");
    }
    playerDamage += 7 + Math.floor(enemyRoll * 7);
  } else if (actionId === "battle_defend") {
    playerDamage = 2 + Math.floor(enemyRoll * 4);
    state.player.qi = clamp(state.player.qi + 2, 0, state.player.qiMax);
    facts.push("你没有追着剑光乱退，而是守住肩胯一线，卸去大半冲力。 ");
  } else if (actionId === "battle_observe") {
    battle.observed = true;
    playerDamage = 5 + Math.floor(enemyRoll * 5);
    facts.push("你让出半步，终于确认韩照每次变招前都会先压低右肩。 ");
  } else {
    if (state.player.qi >= 3) state.player.qi -= 3;
    enemyDamage = 5 + (battle.observed ? 4 : 0);
    battle.observed = true;
    playerDamage = 4 + Math.floor(enemyRoll * 4);
    facts.push("你贴着朱线横移，佯攻左侧，逼得韩照提前换步；这一招伤害不重，却打乱了他的节奏。 ");
  }

  if (state.counters.hanObserve > 0 && battle.round === 1) enemyDamage += 5;
  if (state.storyFlags.hanSpar && battle.round === 1) enemyDamage += 4;
  if (state.knowledge.routeResolved && actionId === "battle_attack") enemyDamage += 3;
  battle.playerHp = clamp(battle.playerHp - playerDamage, 0, battle.playerMaxHp || 55);
  battle.enemyHp = clamp(battle.enemyHp - enemyDamage, 0, battle.enemyMaxHp || 60);
  publicEffects.push(`你承受 ${playerDamage} 点压力`);
  if (enemyDamage > 0) publicEffects.push(`韩照承受 ${enemyDamage} 点压力`);

  if (battle.playerHp <= 0 || battle.enemyHp <= 0 || battle.round >= 6) {
    battle.finished = true;
    battle.won = battle.enemyHp < battle.playerHp;
    state.player.reputation += battle.won ? 8 : 2;
    changeFavor(state, "han", battle.won ? 6 : 3, publicEffects);
    facts.push(
      battle.won
        ? "最后一次交锋后，韩照的木剑先一步落出朱线。四周短暂安静，随后才响起议论。 "
        : "你的脚跟先退出朱线。韩照收剑没有讥笑，只认真看了你一眼。 ",
    );
    publicEffects.push(battle.won ? "外门小比：胜" : "外门小比：负");
  }
}

function buildStageEnding(state) {
  const route = getRoute(state);
  const allies = Object.entries(state.npcStates)
    .filter(([id, npcState]) => id !== "steward" && npcState.known && npcState.favor >= 45)
    .map(([id]) => NPCS[id].name);
  const won = Boolean(state.battle?.won);
  const resolved = Boolean(state.knowledge.routeResolved);
  const reviewed = Boolean(state.storyFlags.stewardReview);
  const score = (won ? 3 : 0) + (resolved ? 4 : 0) + (reviewed ? 1 : 0) + Math.min(allies.length, 2);
  let title = "山长水远";
  if (score >= 9) title = "破茧初鸣";
  else if (resolved && won) title = "一战正名";
  else if (resolved) title = "真相在手";
  else if (won) title = "逆风留名";

  const allyText = allies.length
    ? `${allies.join("、")}站在散去的人群里等你。`
    : "人群渐散，你独自把木牌重新系回腰间。";
  const resultText = won
    ? "你的名字第一次不是和“废柴”二字一起被人提起。"
    : "你没有赢下擂台，却撑到了所有人都必须认真看你的那一刻。";
  const truthText = resolved
    ? route.resolution.text
    : state.knowledge.truthRevealed
      ? `你已经确认${route.title}，但还没有来得及完成处理。`
      : "关于天赋异常，你只握住了零散证据，答案仍留在下一段山路上。";
  return {
    title,
    grade: score >= 9 ? "上上" : score >= 6 ? "上" : score >= 3 ? "中" : "未定",
    wonTournament: won,
    truthResolved: resolved,
    truthTitle: state.knowledge.truthRevealed ? route.title : "仍未完全查明",
    truthText,
    allies,
    summary: `${resultText}${allyText}`,
    nextHook: resolved
      ? "周执事准你继续留在青崖宗。更高的境界仍遥远，但你已不再被错误的答案困住。"
      : "周执事仍保留了你的外门木牌。下一次复核之前，你还有机会把未完的调查继续下去。",
  };
}

function buildLocalNarration(actionId, facts, state) {
  const location = LOCATIONS[state.locationId];
  const leadByAction = {
    accept_entry: "你接过那块粗糙木牌，没有为四周的低笑停步。",
    question_result: "你抬起头，请周执事再验一次灵牌。",
    observe_peers: "你退到石阶边缘，把每一道目光都记在心里。",
    inspect_spirit_tablet: "你没有急着争辩，而是俯身查看验灵石与灵牌。",
    train: "暮钟余音散进石坪，你按住呼吸，将微薄灵气引入经脉。",
    attempt_breakthrough: "你封住杂念，将积满的灵气一寸寸推向境界关隘。",
    explore_herbs: "百草坡雾气贴着脚踝游走，你循着异常灵息俯身搜寻。",
    gather_herbs: "你避开不认识的艳色花叶，只采药典中记得最牢的凝露草。",
    talk_lu: "灵火灯轻轻一跳，陆青禾停下手里的药杵，等你说完。",
    observe_han: "你没有模仿韩照的剑招，只盯着他的呼吸和落脚。",
    work_chores: "药篓沾着露水与泥，你按气味把杂乱药草逐一分开。",
    talk_laborer: "莫七扫了你一眼，把将要投入火盆的旧符纸压在掌下。",
    share_supper: "夜色落进竹窗，陆青禾把两只粗瓷碗并排放在灵火灯下。",
    spar_han: "传功坪的人声渐远，韩照把一柄木剑抛到你手里。",
    steward_review: "你把七日里记下的异常整理成册，重新走上试心阶。",
    talk_apprentice: "丹房铜炉轻响，许棠把手中的药杵洗净，示意你伸出腕脉。",
    help_apprentice: "晒药架压得竹竿微弯，你挽起袖口，从最容易受潮的药草理起。",
    help_laborer: "火盆里的旧符一张张卷起焦边，莫七始终没有催你。",
    read_records: "藏经阁的旧册带着潮气，你按年份翻找每一次灵牌测试。",
    consult_guest: "闻鹤合上阵图，只让你从最基础的吐纳开始运气。",
    treat_meridian: "许棠将凝露草碾成青泥，药香里混着一丝灼热。",
    break_seal: "藏经阁地面的旧阵纹逐寸亮起，你把手按在正中的阵眼上。",
    sever_talisman: "莫七掀开传功坪边一块松动旧石，露出已经发黑的符脚。",
    rebuild_method: "你把《引气诀》拆成最笨的三段，不再追赶任何人的速度。",
    rest: "木窗外竹影缓慢移动，你终于让绷紧的经脉松弛下来。",
    meditate_gate: "山门风穿过空阶，你在旧蒲团上守住一线呼吸。",
    sect_patrol: "你在山门领过木符，沿着外门地界开始今日巡查。",
    end_day: "你合上今日的记录，决定不再把夜色塞进下一件差事。",
    start_tournament: "朱线围住擂台，韩照提着木剑站在另一端。",
    battle_attack: "你先动了。",
    battle_defend: "木剑破风而来，你沉肩守住中线。",
    battle_observe: "你压下抢攻的冲动，让韩照先暴露节奏。",
    battle_feint: "你贴着擂台朱线绕开正面，虚晃一掌。",
    finish_stage: "你走下擂台，喧声被山风一点点吹远；这不是结局，只是修行路上的第一道刻痕。",
    free_action: "你没有照着任何人的安排，而是试着走出自己的下一步。",
  };
  return [leadByAction[actionId] ?? `你在${location.name}停下脚步。`, ...facts].join("\n\n");
}

function makeOutcome(state, actionId, actionLabel, publicEffects, facts) {
  return {
    turnId: state.turn + 1,
    actionId,
    actionLabel,
    narration: buildLocalNarration(actionId, facts, state),
    publicEffects,
    narrativeFacts: facts,
    focusCharacterId: state.focusCharacterId,
    sceneMood: state.sceneMood,
  };
}

function finalizeTurn(state, outcome, actionLabel) {
  state.turn += 1;
  state.updatedAt = new Date().toISOString();
  state.recentTurns.push({ turn: state.turn, action: actionLabel, effects: outcome.publicEffects, summary: outcome.narrativeFacts.join("") });
  if (state.recentTurns.length > 5) state.recentTurns.shift();
  state.eventLog.unshift({
    turn: state.turn,
    day: state.day,
    slot: state.slot,
    title: actionLabel,
    text: outcome.narrativeFacts.join("") || outcome.narration.split("\n")[0],
    factsText: outcome.narrativeFacts.join("") || outcome.narration.split("\n")[0],
    kind: "turn",
    source: "local",
  });
  if (state.eventLog.length > 60) state.eventLog.length = 60;
  if (state.turn % 5 === 0) {
    state.longTermSummary = state.eventLog
      .slice(0, 8)
      .reverse()
      .map((entry) => `${entry.title}：${entry.factsText || entry.text}`)
      .join("；")
      .slice(0, 800);
  }
}

export function resolveAction(inputState, actionId, { expectedTurn, freeText = "", choiceLabel = "", adjudication = null } = {}) {
  if (expectedTurn !== undefined && expectedTurn !== inputState.turn) {
    throw new Error("回合状态已经变化，请重新选择。 ");
  }
  const allowed = getAvailableActions(inputState);
  const action = allowed.find((entry) => entry.id === actionId);
  if (!action) throw new Error("当前场景不能执行这个行动。 ");

  const state = clone(inputState);
  const publicEffects = [];
  const facts = [];
  const contextualLabel = String(choiceLabel || "").trim().slice(0, 60);
  const label = freeText ? `自由行动：${freeText.slice(0, 28)}` : contextualLabel || action.label;
  state.focusCharacterId = PLAYER_FOCUS_ID;
  state.locationIntro = false;
  state.sceneMood = "calm";

  if (state.phase === "intro") {
    resolveIntro(state, actionId, publicEffects, facts);
  } else if (actionId === "train") {
    resolveTraining(state, publicEffects, facts);
  } else if (actionId === "attempt_breakthrough") {
    resolveBreakthrough(state, publicEffects, facts);
  } else if (actionId === "explore_herbs") {
    resolveHerbExplore(state, publicEffects, facts);
  } else if (actionId === "gather_herbs") {
    state.player.stamina = clamp(state.player.stamina - 4, 0, state.player.staminaMax);
    addItem(state, { id: "dew_herb", name: "凝露草", type: "material", count: 2, description: "常见九品药材。" });
    publicEffects.push("凝露草 +2", "体力 -4");
    facts.push("药篓很快添了两株完整凝露草，没有惊动坡后的低阶灵兽。 ");
  } else if (actionId === "talk_lu") {
    resolveLuTalk(state, publicEffects, facts);
  } else if (["share_supper", "spar_han", "help_apprentice", "help_laborer"].includes(actionId)) {
    resolvePersonalStory(state, actionId, publicEffects, facts);
  } else if (actionId === "observe_han") {
    state.focusCharacterId = "han";
    state.counters.hanObserve += 1;
    changeFavor(state, "han", 1, publicEffects);
    facts.push("韩照的剑势很快，但发力前总会先压右肩。这个习惯也许能在小比中利用。 ");
    publicEffects.push("获得小比优势");
  } else if (actionId === "work_chores") {
    state.counters.chores += 1;
    state.npcStates.laborer.known = true;
    state.player.spiritStones += 3;
    state.player.stamina = clamp(state.player.stamina - 10, 0, state.player.staminaMax);
    state.player.fatigue = clamp(state.player.fatigue + 7, 0, 100);
    publicEffects.push("下品灵石 +3", "体力 -10");
    facts.push("半日杂务换来三枚下品灵石，也让你听见几句关于废弃转灵符的闲谈。 ");
  } else if (actionId === "talk_laborer") {
    state.npcStates.laborer.known = true;
    state.focusCharacterId = "laborer";
    state.counters.laborerTalk += 1;
    changeFavor(state, "laborer", 2, publicEffects);
    facts.push("莫七没有解释旧符用途，只说这些符每月都有人来收，不能留。 ");
    if (state.worldTruth.routeId === "drained" && state.knowledge.clueIds.length >= 2) addClue(state, 2, publicEffects, facts);
  } else if (actionId === "talk_apprentice") {
    resolveApprenticeTalk(state, publicEffects, facts);
  } else if (actionId === "consult_guest") {
    resolveGuestConsult(state, publicEffects, facts);
  } else if (actionId === "steward_review") {
    resolveStewardReview(state, publicEffects, facts);
  } else if (actionId === "read_records") {
    facts.push("你对照四次测试记录，纸上数值虽然低，却没有被涂改或突然衰减的痕迹。 ");
    if (["ordinary", "damaged"].includes(state.worldTruth.routeId) && state.knowledge.clueIds.length >= 2) addClue(state, 2, publicEffects, facts);
    if (state.worldTruth.routeId === "sealed" && state.knowledge.clueIds.length >= 2) {
      state.npcStates.guest.known = true;
      facts.push("阵图边角的三瓣纹路与你腕下痕迹一致，借阅签上写着闻鹤客卿的名字。 ");
    }
  } else if (["treat_meridian", "break_seal", "sever_talisman", "rebuild_method"].includes(actionId)) {
    if (actionId === "treat_meridian") state.focusCharacterId = "apprentice";
    if (actionId === "break_seal") state.focusCharacterId = "guest";
    if (actionId === "sever_talisman") state.focusCharacterId = "laborer";
    if (actionId === "rebuild_method") state.focusCharacterId = "han";
    resolveTruthRoute(state, publicEffects, facts);
  } else if (actionId === "rest") {
    state.player.stamina = clamp(state.player.stamina + 38, 0, state.player.staminaMax);
    state.player.qi = clamp(state.player.qi + 24, 0, state.player.qiMax);
    state.player.fatigue = clamp(state.player.fatigue - 28, 0, 100);
    state.player.injury = clamp(state.player.injury - 3, 0, 100);
    publicEffects.push("体力恢复", "灵气恢复", "疲劳下降");
    facts.push("一觉醒来，紊乱的呼吸终于平稳了些。 ");
  } else if (actionId === "meditate_gate") {
    state.player.qi = clamp(state.player.qi + 12, 0, state.player.qiMax);
    state.player.fatigue = clamp(state.player.fatigue - 5, 0, 100);
    publicEffects.push("灵气 +12");
    facts.push("你没有强求进境，只让灵气安静流过经脉。 ");
  } else if (actionId === "sect_patrol") {
    const patrolRoll = random01(state.seed, state.turn, "sect-patrol");
    const reward = patrolRoll > 0.72 ? 7 : 5;
    state.player.spiritStones += reward;
    state.player.reputation += 1;
    state.player.stamina = clamp(state.player.stamina - 14, 0, state.player.staminaMax);
    state.player.fatigue = clamp(state.player.fatigue + 8, 0, 100);
    publicEffects.push(`下品灵石 +${reward}`, "声望 +1", "体力 -14");
    facts.push(
      patrolRoll > 0.72
        ? "你在偏僻山道发现一处被雨水冲坏的界桩，补好阵脚后才返回山门，因此领到额外赏钱。 "
        : "巡山一路无事。你按木符记录逐处核对界桩，回到山门时领到了今日报酬。 ",
    );
  } else if (actionId === "end_day") {
    const finishedDay = state.day;
    state.day += 1;
    state.slot = 0;
    state.locationId = "residence";
    state.focusCharacterId = PLAYER_FOCUS_ID;
    state.sceneMood = "calm";
    state.player.stamina = clamp(state.player.stamina + 46, 0, state.player.staminaMax);
    state.player.qi = clamp(state.player.qi + 30, 0, state.player.qiMax);
    state.player.fatigue = clamp(state.player.fatigue - 34, 0, 100);
    state.player.injury = clamp(state.player.injury - 4, 0, 100);
    state.player.daysRemainingEstimate = Math.max(0, state.player.daysRemainingEstimate - 1);
    publicEffects.push(`第${finishedDay}日结束`, "体力与灵气恢复", "疲劳下降");
    facts.push(`你主动结束了第${finishedDay}日的行程，回到外门居所歇息。再睁眼时，竹窗外已是第${state.day}日清晨。 `);
  } else if (actionId === "start_tournament") {
    state.locationId = "arena";
    state.phase = "battle";
    state.focusCharacterId = "han";
    state.sceneMood = "tense";
    const playerMaxHp = 55 + (state.knowledge.routeResolved ? 10 : 0) + (state.storyFlags.hanSpar ? 5 : 0);
    state.battle = { round: 0, playerHp: playerMaxHp, playerMaxHp, enemyHp: 60, enemyMaxHp: 60, observed: false, finished: false, won: false };
    state.questStates.tournament = "active";
    facts.push("韩照向你抱拳，没有因你的低天赋而收起剑势。 ");
    publicEffects.push("进入外门小比");
  } else if (actionId.startsWith("battle_")) {
    state.focusCharacterId = "han";
    state.sceneMood = "tense";
    resolveBattle(state, actionId, publicEffects, facts);
  } else if (actionId === "finish_stage") {
    state.phase = "explore";
    state.locationId = "residence";
    state.questStates.tournament = "complete";
    state.stageEnding = buildStageEnding(state);
    state.sceneMood = "hopeful";
    facts.push(state.stageEnding.truthText, state.stageEnding.summary, state.stageEnding.nextHook);
    publicEffects.push(`完成入门里程碑：${state.stageEnding.title}`, `评价：${state.stageEnding.grade}`);
  } else if (actionId === "free_action") {
    if (adjudication?.feasible) {
      const { applied } = applyDeltas(state, adjudication.deltas);
      for (const entry of applied) publicEffects.push(entry.label);
      facts.push(...adjudication.narrativeFacts);
      if (!applied.length && !adjudication.narrativeFacts.length) {
        facts.push("你试过了，但什么也没能改变。 ");
      }
    } else {
      // 未接裁决层时的本地兜底：界面在未启用 AI 时会隐藏该入口。
      state.player.stamina = clamp(state.player.stamina - 3, 0, state.player.staminaMax);
      facts.push(`你尝试了“${freeText || "未说明的行动"}”。这项自由行动没有越过当前能力与场景的边界。 `);
      publicEffects.push("体力 -3");
    }
  }

  spendTime(state, timeCostOf(actionId));

  const outcome = makeOutcome(state, actionId, label, publicEffects, facts);
  finalizeTurn(state, outcome, label);
  return { state, outcome };
}

/**
 * 谁在场是世界规则，不该由格式化层决定：当前地点的常驻 NPC（且已认识），
 * 外加本回合镜头对准的对象（若确实是一名已认识的 NPC）。
 */
function presentNpcIdsFor(state) {
  const ids = Object.values(NPCS)
    .filter((npc) => npc.home === state.locationId && state.npcStates[npc.id]?.known)
    .map((npc) => npc.id);
  const focus = state.focusCharacterId;
  if (NPCS[focus] && state.npcStates[focus]?.known && !ids.includes(focus)) ids.push(focus);
  return ids;
}

const WORLD_PULSE_LIMIT = 10;

/**
 * 应用江湖动态：只允许小幅调整已认识 NPC 的好感，并把事件记入 worldPulse。
 * 这些事发生在玩家不在场时，因此不得改动玩家自身的任何数值。
 */
export function applyWorldEvents(inputState, events) {
  if (!Array.isArray(events) || !events.length) return inputState;
  const state = clone(inputState);
  state.worldPulse = Array.isArray(state.worldPulse) ? state.worldPulse : [];
  const batch = [];
  for (const event of events) {
    const npcState = event.npcId ? state.npcStates[event.npcId] : null;
    if (npcState && Number.isFinite(event.favorDelta) && event.favorDelta !== 0) {
      npcState.favor += Math.max(-3, Math.min(3, Math.trunc(event.favorDelta)));
    }
    batch.push({ day: state.day, npcId: event.npcId ?? null, text: event.text });
  }
  // 整批插入：新的一批排在最前，批内保持模型给出的叙述顺序。
  state.worldPulse.unshift(...batch);
  if (state.worldPulse.length > WORLD_PULSE_LIMIT) state.worldPulse.length = WORLD_PULSE_LIMIT;
  return state;
}

export function getVisibleState(state) {
  const knownNpcs = Object.values(NPCS)
    .filter((npc) => state.npcStates[npc.id]?.known)
    .map((npc) => ({
      id: npc.id,
      name: npc.name,
      role: npc.role,
      age: npc.age,
      personality: npc.personality,
      goal: npc.publicGoal,
      voice: npc.voice,
      portrait: npc.portrait,
      attitude: favorStage(state.npcStates[npc.id].favor),
      notes: state.npcStates[npc.id].notes,
    }));
  const route = getRoute(state);
  const clues = route.clues.filter((clue) => state.knowledge.clueIds.includes(clue.id));
  const chapterObjective = state.questStates?.tournament === "complete"
    ? "继续在青崖宗修炼、历练与经营关系，准备下一次境界突破"
    : state.day >= 7
      ? "前往外门小比，完成入门后的第一项里程碑"
      : state.knowledge.routeResolved
        ? "准备外门小比，决定这七日的答案"
        : state.knowledge.truthRevealed
          ? `处理真因：${route.title}`
          : state.knowledge.clueIds.length >= 2
            ? "沿已知线索求证天赋异常"
            : "在第七日前取得复核资格并寻找可靠线索";
  return {
    saveVersion: state.saveVersion,
    gameId: state.gameId,
    turn: state.turn,
    day: state.day,
    time: TIME_SLOTS[displaySlotIndex(state.slot)],
    phase: state.phase,
    location: LOCATIONS[state.locationId],
    player: clone(state.player),
    knownNpcs,
    presentNpcIds: presentNpcIdsFor(state),
    clues,
    suspicions: clone(state.knowledge.suspicions),
    truth: state.knowledge.truthRevealed
      ? {
          title: route.title,
          text: state.knowledge.routeResolved ? route.resolution.text : route.shortTruth,
          resolved: state.knowledge.routeResolved,
          realTalent: state.knowledge.routeResolved ? state.worldTruth.realTalent : null,
        }
      : { title: "？？？", text: "尚未查明", resolved: false, realTalent: null },
    chapterObjective,
    inventory: clone(state.inventory),
    eventLog: clone(state.eventLog),
    recentTurns: clone(state.recentTurns),
    worldPulse: clone(state.worldPulse || []),
    dialogueMemory: clone(state.dialogueMemory || []),
    longTermSummary: state.longTermSummary,
    locationIntro: Boolean(state.locationIntro),
    battle: clone(state.battle),
    stageEnding: clone(state.stageEnding),
  };
}

export function validateImportedSave(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("存档内容无效。 ");
  // 升版本时必须显式保留旧号，否则现有存档会被直接拒绝。
  const SUPPORTED_SAVE_VERSIONS = ["1.0.0", "2.0.0", "3.0.0", "3.1.0", SAVE_VERSION];
  if (!SUPPORTED_SAVE_VERSIONS.includes(candidate.saveVersion)) {
    throw new Error(`暂不支持存档版本 ${candidate.saveVersion ?? "未知"}。 `);
  }
  const required = ["gameId", "seed", "turn", "day", "slot", "phase", "player", "worldTruth", "knowledge", "npcStates"];
  for (const key of required) if (!(key in candidate)) throw new Error(`存档缺少字段：${key}`);
  if (!ROUTE_IDS.includes(candidate.worldTruth.routeId)) throw new Error("存档中的世界真相类型无效。 ");
  if (!LOCATIONS[candidate.locationId]) throw new Error("存档中的地点无效。 ");
  const migrated = clone(candidate);
  migrated.saveVersion = SAVE_VERSION;
  migrated.dialogueMemory = Array.isArray(migrated.dialogueMemory) ? migrated.dialogueMemory.slice(-3) : [];
  migrated.knowledge = {
    clueIds: [],
    suspicions: [],
    truthRevealed: false,
    routeResolved: false,
    ...migrated.knowledge,
  };
  migrated.questStates = {
    entryReview: migrated.storyFlags?.stewardReview ? "passed" : "active",
    anomaly: migrated.knowledge.truthRevealed ? "truth_known" : migrated.knowledge.clueIds.length >= 2 ? "investigating" : "undiscovered",
    tournament: migrated.stageEnding ? "complete" : migrated.phase === "battle" ? "active" : "locked",
    ...migrated.questStates,
  };
  migrated.storyFlags = {
    luSupper: false,
    hanSpar: false,
    stewardReview: false,
    apprenticeHelp: false,
    laborerHelp: false,
    guestConsulted: false,
    ...migrated.storyFlags,
  };
  if (migrated.stageEnding && !migrated.stageEnding.title) {
    migrated.stageEnding = buildStageEnding(migrated);
  }
  if (migrated.stageEnding && migrated.phase === "ending") {
    migrated.phase = "explore";
    migrated.locationId = "residence";
    migrated.questStates.tournament = "complete";
  }
  migrated.counters = {
    training: 0,
    herbExplore: 0,
    chores: 0,
    luTalk: 0,
    hanObserve: 0,
    hanSpar: 0,
    apprenticeTalk: 0,
    laborerTalk: 0,
    guestTalk: 0,
    ...migrated.counters,
  };
  if (migrated.battle) {
    migrated.battle.playerMaxHp ||= 55;
    migrated.battle.enemyMaxHp ||= 60;
  }
  migrated.locationIntro = Boolean(migrated.locationIntro);
  migrated.worldPulse = Array.isArray(migrated.worldPulse) ? migrated.worldPulse.slice(0, 10) : [];
  if (migrated.focusCharacterId === "shen") migrated.focusCharacterId = PLAYER_FOCUS_ID;
  if (migrated.lastOutcome?.focusCharacterId === "shen") {
    migrated.lastOutcome.focusCharacterId = PLAYER_FOCUS_ID;
  }
  migrated.player.realmRank = Number.isInteger(migrated.player.realmRank) ? migrated.player.realmRank : 0;
  if (migrated.player.gender === "女" && migrated.player.portrait === DEFAULT_PROFILE.portrait) {
    migrated.player.portrait = "assets/portraits/player-female.jpg";
  }
  const playerName = String(migrated.player?.name || "").trim();
  if (playerName && playerName !== DEFAULT_PROFILE.name) {
    migrated.longTermSummary = migrateLegacyPlayerAddress(migrated.longTermSummary, migrated.player);
    if (migrated.lastOutcome) {
      migrated.lastOutcome.narration = migrateLegacyPlayerAddress(migrated.lastOutcome.narration, migrated.player);
      for (const segment of migrated.lastOutcome.aiNarration || []) {
        segment.text = migrateLegacyPlayerAddress(segment.text, migrated.player);
      }
    }
    for (const event of migrated.eventLog || []) {
      if (event.source === "ai") event.text = migrateLegacyPlayerAddress(event.text, migrated.player);
    }
    for (const memory of migrated.dialogueMemory || []) {
      memory.text = migrateLegacyPlayerAddress(memory.text, migrated.player);
    }
  }
  return migrated;
}

export function getDisplayTime(state) {
  return `第${state.day}日 · ${TIME_SLOTS[displaySlotIndex(state.slot)]}`;
}
