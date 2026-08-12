import test from "node:test";
import assert from "node:assert/strict";
import { NPCS } from "../src/game-data.js";
import {
  createNewGame,
  getAvailableActions,
  getDisplayTime,
  applyWorldEvents,
  getMoveDestinations,
  getVisibleState,
  moveTo,
  resolveAction,
  validateImportedSave,
} from "../src/game-engine.js";

function act(state, actionId, freeText = "") {
  return resolveAction(state, actionId, { expectedTurn: state.turn, freeText }).state;
}

function endCurrentDay(state) {
  let next = state.locationId === "residence" ? state : moveTo(state, "residence");
  while (!getAvailableActions(next).some((action) => action.id === "end_day")) {
    next = act(next, "rest");
  }
  return act(next, "end_day");
}

/** 若当日预算不足以执行 actionId，则先过夜；随后确保站在 locationId 再执行。 */
function goAct(state, locationId, actionId) {
  let next = state.locationId === locationId ? state : moveTo(state, locationId);
  if (!getAvailableActions(next).some((action) => action.id === actionId)) {
    next = endCurrentDay(next);
    if (next.locationId !== locationId) next = moveTo(next, locationId);
  }
  return act(next, actionId);
}

test("开场与小比都提供四个明确行动", () => {
  let state = createNewGame({ seed: 100 });
  assert.equal(getAvailableActions(state).length, 4);
  state = act(state, "inspect_spirit_tablet");
  state.day = 7;
  state = act(state, "start_tournament");
  assert.equal(getAvailableActions(state).length, 4);
  assert.ok(getAvailableActions(state).some((action) => action.id === "battle_feint"));
});

test("相同种子会生成相同世界真相，公开状态不会泄露真相", () => {
  const first = createNewGame({ seed: 12345 });
  const second = createNewGame({ seed: 12345 });
  assert.equal(first.worldTruth.routeId, second.worldTruth.routeId);
  assert.equal(first.worldTruth.realTalent, second.worldTruth.realTalent);
  const visible = getVisibleState(first);
  assert.equal("worldTruth" in visible, false);
  assert.equal(visible.truth.title, "？？？");
  assert.equal(visible.truth.realTalent, null);
});

test("过期回合请求不能重复结算", () => {
  const state = createNewGame({ seed: 1 });
  assert.throws(() => resolveAction(state, "accept_entry", { expectedTurn: 9 }), /回合状态已经变化/);
  const result = resolveAction(state, "accept_entry", { expectedTurn: 0 });
  assert.equal(result.state.turn, 1);
  assert.equal(state.turn, 0, "输入状态保持不可变");
});

test("剧情化选项文案会进入事件记录但不会改变行动结算", () => {
  const state = createNewGame({ seed: 2 });
  const result = resolveAction(state, "accept_entry", {
    expectedTurn: 0,
    choiceLabel: "接过木牌，先向陆青禾点头示意",
  });
  assert.equal(result.outcome.actionId, "accept_entry");
  assert.equal(result.outcome.actionLabel, "接过木牌，先向陆青禾点头示意");
  assert.equal(result.state.locationId, "residence");
  assert.equal(result.state.eventLog[0].title, "接过木牌，先向陆青禾点头示意");
});

test("四条废柴真因都能被求证、处理并恢复可见天赋", () => {
  const routeCases = [
    { seed: 8, route: "damaged", investigate: [["alchemy", "talk_apprentice"]], resolve: ["alchemy", "treat_meridian"] },
    { seed: 6, route: "sealed", investigate: [["archive", "read_records"], ["archive", "consult_guest"]], resolve: ["archive", "break_seal"] },
    { seed: 1, route: "drained", investigate: [["chores", "talk_laborer"]], resolve: ["chores", "sever_talisman"] },
    { seed: 4, route: "ordinary", investigate: [["archive", "read_records"]], resolve: ["training", "rebuild_method"] },
  ];
  for (const routeCase of routeCases) {
    let state = createNewGame({ seed: routeCase.seed });
    assert.equal(state.worldTruth.routeId, routeCase.route);
    state = act(state, "accept_entry");
    state = goAct(state, "training", "train");
    state = goAct(state, "herbHill", "explore_herbs");
    state = goAct(state, "herbHill", "explore_herbs");
    assert.equal(state.knowledge.clueIds.length, 2, routeCase.route);

    for (const [locationId, actionId] of routeCase.investigate) {
      state = goAct(state, locationId, actionId);
    }
    assert.equal(state.knowledge.truthRevealed, true, routeCase.route);
    assert.equal(state.knowledge.routeResolved, false, routeCase.route);

    state = goAct(state, routeCase.resolve[0], routeCase.resolve[1]);
    assert.equal(state.knowledge.routeResolved, true, routeCase.route);
    assert.equal(state.player.visibleTalent, state.worldTruth.realTalent, routeCase.route);
    assert.equal(getVisibleState(state).truth.realTalent, state.worldTruth.realTalent, routeCase.route);
  }
});

test("时段用满后不会自动跨日，玩家确认才进入次日", () => {
  let state = createNewGame({ seed: 77 });
  state = act(state, "accept_entry");
  assert.equal(state.slot, 1, "开场行动占掉清晨");
  for (let i = 0; i < 4; i += 1) state = act(state, "talk_lu");
  assert.equal(state.slot, 5, "时段用满并停在哨兵值，多余行动不再累加");
  assert.equal(state.day, 1, "时段用满也不会自动进入次日");
  state = act(state, "end_day");
  assert.equal(state.day, 2);
  assert.equal(state.slot, 0);
  while (state.day < 7) state = endCurrentDay(state);
  assert.ok(getAvailableActions(state).some((action) => action.id === "start_tournament"));
});

test("时段用满时显示钳制到夜间，不出现 undefined", () => {
  let state = createNewGame({ seed: 76 });
  state = act(state, "accept_entry");
  state.slot = 5;
  assert.equal(getDisplayTime(state), "第1日 · 夜间");
  assert.equal(getVisibleState(state).time, "夜间");
});

test("擂台攻防不推进时辰，选项会公开耗时", () => {
  let state = createNewGame({ seed: 78 });
  state = act(state, "accept_entry");
  const restAction = getAvailableActions(state).find((action) => action.id === "rest");
  assert.equal(restAction.timeCost, 1);
  assert.match(restAction.hint, /耗时1时段/);
  state.day = 7;
  state = act(state, "start_tournament");
  const beforeAttack = state.slot;
  state = act(state, "battle_attack");
  assert.equal(state.slot, beforeAttack);
});

test("小比后可以继续修炼并突破境界", () => {
  let state = createNewGame({ seed: 79 });
  state = act(state, "accept_entry");
  state = moveTo(state, "training");
  state.player.cultivation = state.player.cultivationMax;
  state.player.visibleTalent = 100;
  state.player.foundation = 100;
  state.player.fatigue = 0;
  assert.ok(getAvailableActions(state).some((action) => action.id === "attempt_breakthrough"));
  state = act(state, "attempt_breakthrough");
  assert.equal(state.player.realmRank, 1);
  assert.equal(state.player.realm, "练气二层");
});

test("外门小比在有限回合内结束并产生阶段结果", () => {
  let state = createNewGame({ seed: 99 });
  state = act(state, "accept_entry");
  state.day = 7;
  state = act(state, "start_tournament");
  for (let i = 0; i < 6 && !state.battle.finished; i += 1) {
    state = act(state, i % 3 === 2 ? "battle_observe" : "battle_attack");
  }
  assert.equal(state.battle.finished, true);
  state = act(state, "finish_stage");
  assert.ok(state.stageEnding);
  assert.equal(state.phase, "explore");
  assert.ok(getAvailableActions(state).some((action) => action.id === "rest"));
});

test("完整人物线与真因处理可以走到差异化里程碑并继续游戏", () => {
  let state = createNewGame({ seed: 8 });
  const script = [
    ["training", "train"],
    ["herbHill", "explore_herbs"],
    ["herbHill", "explore_herbs"],
    ["alchemy", "talk_apprentice"],
    ["alchemy", "help_apprentice"],
    ["alchemy", "treat_meridian"],
    ["residence", "share_supper"],
    ["residence", "talk_lu"],
    ["training", "observe_han"],
    ["training", "spar_han"],
    ["chores", "work_chores"],
    ["chores", "talk_laborer"],
    ["chores", "help_laborer"],
    ["gate", "steward_review"],
  ];
  state = act(state, "accept_entry");
  for (const [locationId, actionId] of script) state = goAct(state, locationId, actionId);
  while (state.day < 7) state = endCurrentDay(state);
  state = act(state, "start_tournament");
  while (!state.battle.finished) state = act(state, state.battle.round % 3 === 0 ? "battle_observe" : "battle_attack");
  state = act(state, "finish_stage");
  assert.equal(state.stageEnding.truthResolved, true);
  assert.ok(state.stageEnding.allies.includes("陆青禾"));
  assert.equal(state.phase, "explore");
  assert.ok(getAvailableActions(state).length > 1);
});

test("自由行动受回合边界约束并消耗体力", () => {
  let state = createNewGame({ seed: 9 });
  state = act(state, "accept_entry");
  const before = state.player.stamina;
  state = act(state, "free_action", "检查木牌背面是否有刮痕");
  assert.equal(state.player.stamina, before - 3);
  assert.match(state.recentTurns.at(-1).action, /检查木牌背面/);
});

test("有效存档可重新导入，缺失关键字段会被拒绝", () => {
  const state = createNewGame({ seed: 55 });
  const imported = validateImportedSave(JSON.parse(JSON.stringify(state)));
  assert.equal(imported.gameId, state.gameId);
  const broken = JSON.parse(JSON.stringify(state));
  delete broken.player;
  assert.throws(() => validateImportedSave(broken), /缺少字段/);
});

test("V2首章结局存档会迁移为可继续游玩的里程碑", () => {
  const legacy = createNewGame({ seed: 57 });
  legacy.saveVersion = "2.0.0";
  legacy.phase = "ending";
  legacy.stageEnding = { title: "真相在手", grade: "上", truthText: "旧记录", summary: "小比结束", nextHook: "继续修行" };
  const migrated = validateImportedSave(legacy);
  assert.equal(migrated.phase, "explore");
  assert.equal(migrated.questStates.tournament, "complete");
  assert.ok(getAvailableActions(migrated).length > 1);
});

test("自定义姓名会写入长期记忆，旧存档中的默认姓名会自动迁移", () => {
  const state = createNewGame({ seed: 56, profile: { name: "顾长风", gender: "男" } });
  assert.match(state.longTermSummary, /^顾长风参加/);
  assert.equal(state.longTermSummary.includes("沈砚"), false);

  const legacy = JSON.parse(JSON.stringify(state));
  legacy.saveVersion = "1.0.0";
  delete legacy.questStates;
  delete legacy.storyFlags;
  delete legacy.knowledge.routeResolved;
  legacy.longTermSummary = "沈砚参加青崖宗收徒试，可见天赋低下，尚未确定能否留下。";
  legacy.lastOutcome = {
    narration: "本地事实不含姓名。",
    aiNarration: [{ type: "dialogue", speakerId: "lu", text: "沈师兄，你别太忧心。" }],
  };
  legacy.eventLog.unshift({ turn: 1, day: 1, slot: 1, title: "旧AI记录", text: "沈师兄收下了木牌。", kind: "turn", source: "ai" });
  const migrated = validateImportedSave(legacy);
  assert.match(migrated.longTermSummary, /^顾长风参加/);
  assert.equal(migrated.longTermSummary.includes("沈砚"), false);
  assert.equal(migrated.lastOutcome.aiNarration[0].text, "顾长风师兄，你别太忧心。");
  assert.equal(migrated.eventLog[0].text, "顾长风师兄收下了木牌。");
});

test("事件簿展示文本可替换，长期记忆仍只使用规则事实", () => {
  let state = createNewGame({ seed: 66 });
  state = act(state, "accept_entry");
  const firstTurn = state.eventLog.find((event) => event.kind === "turn" && event.turn === 1);
  assert.ok(firstTurn.factsText);
  firstTurn.text = "模型增加的文学描写，不应成为新的规则事实。";
  firstTurn.source = "ai";
  state = act(state, "talk_lu");
  state = act(state, "talk_lu");
  state = act(state, "rest");
  state = act(state, "rest");
  assert.equal(state.turn, 5);
  assert.equal(state.longTermSummary.includes("模型增加的文学描写"), false);
  assert.equal(state.longTermSummary.includes(firstTurn.factsText), true);
});

test("hint 标称耗时与实际扣减不可能分歧", () => {
  let base = createNewGame({ seed: 4242 });
  base = act(base, "accept_entry");
  base.day = 7;
  const locations = ["residence", "training", "herbHill", "chores", "alchemy", "archive", "gate"];
  const checked = new Set();
  // slot 0 覆盖常规行动；slot 3 让「结束今日」也进入可选列表。
  for (const startSlot of [0, 3]) {
    for (const locationId of locations) {
      const at = { ...base, locationId, slot: startSlot };
      for (const action of getAvailableActions(at)) {
        if (checked.has(action.id) || action.freeInput) continue;
        checked.add(action.id);
        const after = resolveAction({ ...at }, action.id, { expectedTurn: at.turn }).state;
        const advanced = action.id === "end_day" ? 0 : after.slot - startSlot;
        assert.equal(advanced, action.timeCost, `${action.id} 的 hint 与实际扣减不一致`);
      }
    }
  }
  assert.ok(checked.has("end_day"), "必须覆盖到结束今日");
  // 移动脱离回合后，原先计入的 7 个 move: 行动不再存在，覆盖数由 23 降到 16。
  assert.ok(checked.size >= 16, `覆盖行动数偏少：${checked.size}`);
});

test("预算耗尽后不再有消耗时段的行动", () => {
  let state = createNewGame({ seed: 77 });
  state = act(state, "accept_entry");
  for (let i = 0; i < 4; i += 1) state = act(state, "talk_lu");
  assert.equal(state.slot, 5, "5 个普通行动用满一天");
  const remaining = getAvailableActions(state);
  assert.ok(remaining.some((action) => action.id === "end_day"), "结束今日必须可选");
  assert.deepEqual(
    remaining.filter((action) => action.timeCost > 0).map((action) => action.id),
    [],
    "没有任何消耗时段的行动残留",
  );
});

test("夜间不能开始需要两个时段的长行动", () => {
  let state = createNewGame({ seed: 78 });
  state = act(state, "accept_entry");
  state.locationId = "chores";
  state.slot = 3;
  assert.ok(getAvailableActions(state).some((action) => action.id === "work_chores"), "傍晚仍可接长杂务");
  state.slot = 4;
  assert.equal(
    getAvailableActions(state).some((action) => action.id === "work_chores"),
    false,
    "夜间时长行动应从选项中消失",
  );
  assert.ok(getAvailableActions(state).some((action) => action.id === "talk_laborer"), "普通行动仍在");
});

test("战斗阶段不受时段预算限制", () => {
  let state = createNewGame({ seed: 79 });
  state = act(state, "accept_entry");
  state.day = 7;
  state = act(state, "start_tournament");
  state.slot = 5;
  const actions = getAvailableActions(state);
  assert.equal(actions.length, 4, "天黑不应让战斗卡死");
  assert.ok(actions.some((action) => action.id === "battle_attack"));
});

test("移动不产生回合、不推进时辰、不写事件簿", () => {
  let state = createNewGame({ seed: 81 });
  state = act(state, "accept_entry");
  const before = {
    turn: state.turn,
    slot: state.slot,
    day: state.day,
    events: state.eventLog.length,
    recent: state.recentTurns.length,
  };
  const moved = moveTo(state, "training");
  assert.equal(moved.locationId, "training");
  assert.equal(moved.turn, before.turn, "移动不增加回合");
  assert.equal(moved.slot, before.slot, "移动不推进时辰");
  assert.equal(moved.day, before.day);
  assert.equal(moved.eventLog.length, before.events, "移动不写事件簿");
  assert.equal(moved.recentTurns.length, before.recent);
  assert.equal(state.locationId, "residence", "入参状态保持不可变");
});

test("移动会置位地点导语，随后的行动清除它", () => {
  let state = createNewGame({ seed: 82 });
  state = act(state, "accept_entry");
  const moved = moveTo(state, "training");
  assert.equal(moved.locationIntro, true);
  const after = resolveAction(moved, "train", { expectedTurn: moved.turn }).state;
  assert.equal(after.locationIntro, false);
});

test("移动拒绝非法目标与战斗中离场", () => {
  let state = createNewGame({ seed: 83 });
  state = act(state, "accept_entry");
  assert.throws(() => moveTo(state, "nowhere"), /无法前往/);
  assert.throws(() => moveTo(state, "residence"), /已经在/);
  state.day = 7;
  state = act(state, "start_tournament");
  assert.throws(() => moveTo(state, "residence"), /无法前往/);
});

test("地点菜单列出除当前地点外的全部常规地点", () => {
  let state = createNewGame({ seed: 84 });
  state = act(state, "accept_entry");
  const destinations = getMoveDestinations(state);
  assert.equal(destinations.length, 6, "七个常规地点去掉当前所在");
  assert.equal(destinations.some((entry) => entry.id === "residence"), false);
  assert.ok(destinations.every((entry) => entry.name && entry.description));
});

test("行动列表不再包含移动", () => {
  let state = createNewGame({ seed: 85 });
  state = act(state, "accept_entry");
  assert.equal(
    getAvailableActions(state).some((action) => action.id.startsWith("move:")),
    false,
  );
});

test("在场人物按地点计算，野外独处时为空", () => {
  let state = createNewGame({ seed: 86 });
  state = act(state, "accept_entry");
  // 陆青禾常驻居所；周执事此刻是镜头对象——本回合正文正是山门交接木牌那一幕，
  // 他出现在其中是对的。要修的是他「无条件永远在场」，不是「在自己的戏里在场」。
  assert.deepEqual(getVisibleState(state).presentNpcIds, ["lu", "steward"]);

  const afterRest = act(state, "rest");
  assert.deepEqual(getVisibleState(afterRest).presentNpcIds, ["lu"], "镜头移开后周执事不再滞留");

  const atHerbHill = moveTo(state, "herbHill");
  assert.deepEqual(getVisibleState(atHerbHill).presentNpcIds, [], "百草坡是无人野外");

  const atArchive = moveTo(state, "archive");
  assert.deepEqual(
    getVisibleState(atArchive).presentNpcIds,
    [],
    "闻鹤客卿尚未认识，即使在其常驻地也不在场",
  );

  const known = moveTo(state, "archive");
  known.npcStates.guest.known = true;
  assert.deepEqual(getVisibleState(known).presentNpcIds, ["guest"]);
});

test("\u4e3b\u89d2\u955c\u5934\u4f7f\u7528\u5408\u6cd5\u5e38\u91cf\uff0c\u65e7\u5b58\u6863\u7684 shen \u4f1a\u88ab\u8fc1\u79fb", () => {
  let state = createNewGame({ seed: 88 });
  state = act(state, "accept_entry");
  state = act(state, "rest");
  assert.equal(state.focusCharacterId, "player");
  assert.equal(state.focusCharacterId in NPCS, false, "\u4e3b\u89d2\u4e0d\u662f NPC");

  const moved = moveTo(state, "training");
  assert.equal(moved.focusCharacterId, "player", "\u79fb\u52a8\u4e5f\u4f7f\u7528\u5408\u6cd5\u5e38\u91cf");

  const legacy = JSON.parse(JSON.stringify(state));
  legacy.focusCharacterId = "shen";
  legacy.lastOutcome = { turnId: 1, focusCharacterId: "shen", narration: "\u65e7\u5b58\u6863" };
  const migrated = validateImportedSave(legacy);
  assert.equal(migrated.focusCharacterId, "player");
  assert.equal(migrated.lastOutcome.focusCharacterId, "player");
});

test("自由行动应用裁决结果并写入真实效果", () => {
  let state = createNewGame({ seed: 300 });
  state = act(state, "accept_entry");
  const before = state.player.spiritStones;
  const result = resolveAction(state, "free_action", {
    expectedTurn: state.turn,
    freeText: "我用灵石向陆青禾换一份笔记",
    adjudication: {
      feasible: true,
      outcome: "success",
      deltas: [
        { kind: "player", field: "spiritStones", value: -3, path: "player.spiritStones" },
        { kind: "favor", npcId: "lu", value: 5, path: "npcFavor.lu" },
      ],
      narrativeFacts: ["陆青禾把笔记推到你面前。"],
    },
  });
  assert.equal(result.state.player.spiritStones, before - 3);
  assert.ok(result.outcome.publicEffects.some((effect) => effect.includes("灵石")));
  assert.ok(result.outcome.narrativeFacts.includes("陆青禾把笔记推到你面前。"));
  assert.equal(result.state.turn, state.turn + 1);
});

test("没有裁决结果时自由行动退回本地兜底", () => {
  let state = createNewGame({ seed: 301 });
  state = act(state, "accept_entry");
  const before = state.player.stamina;
  const result = resolveAction(state, "free_action", {
    expectedTurn: state.turn,
    freeText: "随便看看",
  });
  assert.equal(result.state.player.stamina, before - 3);
});

test("验收不变量：完整线索链与真因处理必须在 7 日预算内走完", () => {
  let state = createNewGame({ seed: 8 });
  assert.equal(state.worldTruth.routeId, "damaged");

  state = act(state, "accept_entry");
  state = goAct(state, "training", "train");
  state = goAct(state, "herbHill", "explore_herbs");
  state = goAct(state, "herbHill", "explore_herbs");
  assert.equal(state.knowledge.clueIds.length, 2, "两条线索到手");

  state = goAct(state, "alchemy", "talk_apprentice");
  assert.equal(state.knowledge.truthRevealed, true, "真因已查明");

  state = goAct(state, "alchemy", "treat_meridian");
  assert.equal(state.knowledge.routeResolved, true, "真因已处理");

  assert.ok(
    state.day <= 7,
    `完整线索链应在 7 日内走完，实际用到第 ${state.day} 日——` +
      "调整优先级为 SLOTS_PER_DAY → 长行动耗时 → 小比解锁天数，不得删减内容",
  );
});

test("江湖动态写入 worldPulse 并应用小幅好感变化", () => {
  let state = createNewGame({ seed: 500 });
  state = act(state, "accept_entry");
  const before = state.npcStates.lu.favor;
  const next = applyWorldEvents(state, [
    { npcId: "lu", text: "陆青禾替你把晾着的药收了回去。", favorDelta: 2 },
    { npcId: null, text: "山下传来消息，说今年药市开得早。", favorDelta: 0 },
  ]);
  assert.equal(next.npcStates.lu.favor, before + 2);
  assert.equal(next.worldPulse.length, 2);
  assert.equal(next.worldPulse[0].text, "陆青禾替你把晾着的药收了回去。");
  assert.equal(state.worldPulse.length, 0, "入参状态保持不可变");
});

test("worldPulse 只保留最近 10 条", () => {
  let state = createNewGame({ seed: 501 });
  state = act(state, "accept_entry");
  for (let i = 0; i < 6; i += 1) {
    state = applyWorldEvents(state, [
      { npcId: null, text: `事件${i}A`, favorDelta: 0 },
      { npcId: null, text: `事件${i}B`, favorDelta: 0 },
    ]);
  }
  assert.equal(state.worldPulse.length, 10, "上限 10 条");
  assert.equal(state.worldPulse[0].text, "事件5A", "最新一批排在最前，批内保持原顺序");
});

test("江湖动态不能改动玩家自身数值", () => {
  let state = createNewGame({ seed: 502 });
  state = act(state, "accept_entry");
  const snapshot = JSON.stringify(state.player);
  const next = applyWorldEvents(state, [{ npcId: "lu", text: "闲事一桩。", favorDelta: 3 }]);
  assert.equal(JSON.stringify(next.player), snapshot, "player 面板逐字节不变");
});

test("存档升到 3.2.0 且 3.0.0 / 3.1.0 仍被接受", () => {
  const state = createNewGame({ seed: 503 });
  assert.equal(state.saveVersion, "3.2.0");
  for (const old of ["3.0.0", "3.1.0"]) {
    const legacy = JSON.parse(JSON.stringify(state));
    legacy.saveVersion = old;
    delete legacy.worldPulse;
    const migrated = validateImportedSave(legacy);
    assert.equal(migrated.saveVersion, "3.2.0", `${old} 应可迁移`);
    assert.deepEqual(migrated.worldPulse, [], "缺失字段补默认值");
  }
});
