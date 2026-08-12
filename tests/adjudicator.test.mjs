import test from "node:test";
import assert from "node:assert/strict";
import { DELTA_LIMITS, FAVOR_LIMIT, validateProposal, applyDeltas, halvePositive, rollOutcome } from "../src/adjudicator.js";
import { createNewGame } from "../src/game-engine.js";

function visible() {
  return {
    knownNpcs: [{ id: "lu" }, { id: "han" }],
    inventory: [{ id: "dew_herb", count: 2 }],
  };
}

const ALLOWED = ["rest", "talk_lu"];

function proposalWith(deltas) {
  return { feasible: true, difficulty: "medium", deltas, failureDeltas: [], narrativeFacts: ["测试"] };
}

test("白名单字段正常放行", () => {
  const result = validateProposal(proposalWith([{ path: "player.stamina", value: -5 }]), visible(), ALLOWED);
  assert.equal(result.feasible, true);
  assert.deepEqual(result.deltas, [{ kind: "player", field: "stamina", value: -5, path: "player.stamina" }]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.clamped, []);
});

test("超幅字段被钳到边界并记录", () => {
  const result = validateProposal(proposalWith([{ path: "player.reputation", value: 9999 }]), visible(), ALLOWED);
  assert.equal(result.deltas[0].value, DELTA_LIMITS["player.reputation"]);
  assert.deepEqual(result.clamped, ["player.reputation"]);
});

test("负向超幅同样被钳制", () => {
  const result = validateProposal(proposalWith([{ path: "player.stamina", value: -9999 }]), visible(), ALLOWED);
  assert.equal(result.deltas[0].value, -DELTA_LIMITS["player.stamina"]);
});

test("硬拒绝字段整条丢弃", () => {
  const result = validateProposal(
    proposalWith([
      { path: "player.cultivation", value: 50 },
      { path: "player.realmRank", value: 9 },
      { path: "knowledge.truthRevealed", value: 1 },
      { path: "worldTruth.routeId", value: 1 },
      { path: "player.stamina", value: -2 },
    ]),
    visible(),
    ALLOWED,
  );
  assert.equal(result.deltas.length, 1, "只剩合法的那条");
  assert.equal(result.deltas[0].field, "stamina");
  assert.equal(result.rejected.length, 4);
});

test("未列入白名单的未知路径按硬拒绝处理", () => {
  const result = validateProposal(proposalWith([{ path: "player.somethingNew", value: 1 }]), visible(), ALLOWED);
  assert.deepEqual(result.deltas, []);
  assert.deepEqual(result.rejected, ["player.somethingNew"]);
});

test("原型污染路径被拒绝", () => {
  const attacks = [
    "player.__proto__",
    "__proto__.polluted",
    "constructor.prototype.polluted",
    "player.constructor",
    "npcFavor.__proto__",
    "inventory.__proto__",
  ];
  for (const path of attacks) {
    const result = validateProposal(proposalWith([{ path, value: 1 }]), visible(), ALLOWED);
    assert.deepEqual(result.deltas, [], `${path} 不应通过校验`);
  }
  assert.equal({}.polluted, undefined, "全局原型未被污染");
});

test("好感只能指向已认识的 NPC 且受独立幅度限制", () => {
  const ok = validateProposal(proposalWith([{ path: "npcFavor.lu", value: 99 }]), visible(), ALLOWED);
  assert.equal(ok.deltas[0].value, FAVOR_LIMIT);
  assert.equal(ok.deltas[0].kind, "favor");

  const unknown = validateProposal(proposalWith([{ path: "npcFavor.guest", value: 5 }]), visible(), ALLOWED);
  assert.deepEqual(unknown.deltas, [], "未认识的 NPC 不可被调整好感");
});

test("物品只能减少已持有的，且不超过持有量", () => {
  const spend = validateProposal(proposalWith([{ path: "inventory.dew_herb", value: -5 }]), visible(), ALLOWED);
  assert.equal(spend.deltas[0].value, -2, "钳到实际持有量");

  const gain = validateProposal(proposalWith([{ path: "inventory.dew_herb", value: 3 }]), visible(), ALLOWED);
  assert.deepEqual(gain.deltas, [], "不允许凭空获得");

  const unknownItem = validateProposal(proposalWith([{ path: "inventory.elixir", value: -1 }]), visible(), ALLOWED);
  assert.deepEqual(unknownItem.deltas, [], "未持有的物品不可消耗");
});

test("非有限数值一律拒绝", () => {
  for (const value of [NaN, Infinity, -Infinity, "5", null, undefined, {}]) {
    const result = validateProposal(proposalWith([{ path: "player.stamina", value }]), visible(), ALLOWED);
    assert.deepEqual(result.deltas, [], `${String(value)} 不应通过校验`);
  }
});

test("不可行提案保留原因，且最接近行动必须合法", () => {
  const ok = validateProposal(
    { feasible: false, reason: "你还不会御剑飞行。", nearestActionId: "rest" },
    visible(),
    ALLOWED,
  );
  assert.equal(ok.feasible, false);
  assert.equal(ok.reason, "你还不会御剑飞行。");
  assert.equal(ok.nearestActionId, "rest");

  const bogus = validateProposal(
    { feasible: false, reason: "做不到", nearestActionId: "fly_to_moon" },
    visible(),
    ALLOWED,
  );
  assert.equal(bogus.nearestActionId, null, "越权的建议行动被剔除");
});

test("difficulty 非法时按 medium 处理", () => {
  const result = validateProposal({ ...proposalWith([]), difficulty: "impossible" }, visible(), ALLOWED);
  assert.equal(result.difficulty, "medium");
});

test("applyDeltas 真实入库并受引擎上下限约束", () => {
  const state = createNewGame({ seed: 5 });
  state.player.stamina = 95;
  const { applied } = applyDeltas(state, [
    { kind: "player", field: "stamina", value: 15, path: "player.stamina" },
    { kind: "player", field: "spiritStones", value: 3, path: "player.spiritStones" },
  ]);
  assert.equal(state.player.stamina, state.player.staminaMax, "不超过上限");
  assert.equal(state.player.spiritStones, 9, "6 + 3");
  assert.equal(applied.length, 2);
  assert.ok(applied.every((entry) => typeof entry.label === "string" && entry.label));
});

test("applyDeltas 处理好感与物品消耗", () => {
  const state = createNewGame({ seed: 5 });
  state.inventory.push({ id: "dew_herb", name: "凝露草", type: "material", count: 2, description: "" });
  const before = state.npcStates.lu.favor;
  applyDeltas(state, [
    { kind: "favor", npcId: "lu", value: 6, path: "npcFavor.lu" },
    { kind: "item", itemId: "dew_herb", value: -2, path: "inventory.dew_herb" },
  ]);
  assert.equal(state.npcStates.lu.favor, before + 6);
  assert.equal(state.inventory.some((entry) => entry.id === "dew_herb"), false, "耗尽的物品被移除");
});

test("applyDeltas 不会让数量降到负数", () => {
  const state = createNewGame({ seed: 5 });
  state.player.spiritStones = 2;
  applyDeltas(state, [{ kind: "player", field: "spiritStones", value: -5, path: "player.spiritStones" }]);
  assert.equal(state.player.spiritStones, 0);
});

test("rollOutcome 在相同种子与回合下可复现", () => {
  const state = createNewGame({ seed: 4242 });
  const first = rollOutcome(state, "medium");
  assert.equal(rollOutcome(state, "medium"), first, "同状态同难度结果一致");
  assert.ok(["success", "partial", "failure"].includes(first));
});

test("难度越高成功率越低", () => {
  let easyWins = 0;
  let hardWins = 0;
  for (let turn = 0; turn < 400; turn += 1) {
    const state = { seed: 99, turn };
    if (rollOutcome(state, "easy") === "success") easyWins += 1;
    if (rollOutcome(state, "hard") === "success") hardWins += 1;
  }
  assert.ok(easyWins > hardWins * 2, `easy=${easyWins} hard=${hardWins}`);
});

test("halvePositive 只减半正向条目并丢弃归零项", () => {
  const result = halvePositive([
    { kind: "player", field: "reputation", value: 3, path: "player.reputation" },
    { kind: "player", field: "stamina", value: -8, path: "player.stamina" },
    { kind: "player", field: "qi", value: 1, path: "player.qi" },
  ]);
  assert.equal(result.length, 2, "+1 减半归零后被丢弃");
  assert.equal(result[0].value, 1, "+3 向零取整为 +1");
  assert.equal(result[1].value, -8, "负向不变");
});

test("好感效果文案使用角色名与态度阶段，不泄露内部 id 或数字", () => {
  const state = createNewGame({ seed: 5 });
  state.npcStates.lu.favor = 44;
  const { applied } = applyDeltas(state, [{ kind: "favor", npcId: "lu", value: 6, path: "npcFavor.lu" }]);
  assert.equal(applied.length, 1);
  assert.match(applied[0].label, /陆青禾/, "必须使用角色名");
  assert.equal(applied[0].label.includes("lu"), false, "不得泄露内部 id");
  assert.equal(/\d/.test(applied[0].label), false, "不得显示好感数字");
  assert.match(applied[0].label, /亲近/, "跨越阶段时应announce新阶段");

  const state2 = createNewGame({ seed: 5 });
  state2.npcStates.lu.favor = 30;
  const small = applyDeltas(state2, [{ kind: "favor", npcId: "lu", value: 2, path: "npcFavor.lu" }]);
  assert.match(small.applied[0].label, /陆青禾/);
  assert.equal(/\d/.test(small.applied[0].label), false, "未跨阶段也不显示数字");
});

test("验收不变量：任何恶意提案都不能让世界状态越界", () => {
  const malicious = [
    { path: "player.spiritStones", value: 999999 },
    { path: "player.stamina", value: -999999 },
    { path: "player.qi", value: Number.MAX_SAFE_INTEGER },
    { path: "player.cultivation", value: 100000 },
    { path: "player.realmRank", value: 37 },
    { path: "player.visibleTalent", value: 100 },
    { path: "player.__proto__", value: 1 },
    { path: "__proto__.polluted", value: 1 },
    { path: "constructor.prototype.polluted", value: 1 },
    { path: "knowledge.truthRevealed", value: 1 },
    { path: "knowledge.clueIds", value: 4 },
    { path: "worldTruth.realTalent", value: 100 },
    { path: "npcFavor.guest", value: 100 },
    { path: "npcFavor.__proto__", value: 1 },
    { path: "inventory.legendary_sword", value: 1 },
    { path: "day", value: 999 },
    { path: "slot", value: -50 },
    { path: "turn", value: 0 },
    { path: "locationId", value: 1 },
    { path: "seed", value: 1 },
  ];

  const state = createNewGame({ seed: 777 });
  const snapshot = {
    knowledge: JSON.stringify(state.knowledge),
    worldTruth: JSON.stringify(state.worldTruth),
    realm: state.player.realm,
    realmRank: state.player.realmRank,
    cultivation: state.player.cultivation,
    visibleTalent: state.player.visibleTalent,
    inventoryIds: state.inventory.map((entry) => entry.id).sort().join(","),
    day: state.day,
    slot: state.slot,
    turn: state.turn,
    locationId: state.locationId,
  };

  const visibleState = { knownNpcs: [{ id: "lu" }], inventory: state.inventory.map(({ id, count }) => ({ id, count })) };
  const validated = validateProposal(
    { feasible: true, difficulty: "easy", deltas: malicious, failureDeltas: [], narrativeFacts: [] },
    visibleState,
    ["rest"],
  );
  applyDeltas(state, validated.deltas);

  assert.equal({}.polluted, undefined, "全局原型未被污染");
  assert.equal(JSON.stringify(state.knowledge), snapshot.knowledge, "knowledge 逐字节不变");
  assert.equal(JSON.stringify(state.worldTruth), snapshot.worldTruth, "worldTruth 逐字节不变");
  assert.equal(state.player.realm, snapshot.realm);
  assert.equal(state.player.realmRank, snapshot.realmRank);
  assert.equal(state.player.cultivation, snapshot.cultivation);
  assert.equal(state.player.visibleTalent, snapshot.visibleTalent);
  assert.equal(state.day, snapshot.day);
  assert.equal(state.slot, snapshot.slot);
  assert.equal(state.turn, snapshot.turn);
  assert.equal(state.locationId, snapshot.locationId);
  assert.equal(
    state.inventory.map((entry) => entry.id).sort().join(","),
    snapshot.inventoryIds,
    "不出现结算前不存在的物品",
  );

  assert.ok(state.player.stamina >= 0 && state.player.stamina <= state.player.staminaMax);
  assert.ok(state.player.qi >= 0 && state.player.qi <= state.player.qiMax);
  assert.ok(state.player.fatigue >= 0 && state.player.fatigue <= 100);
  assert.ok(state.player.injury >= 0 && state.player.injury <= 100);
  assert.ok(state.player.spiritStones >= 0);
});
