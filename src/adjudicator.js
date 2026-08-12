import { random01 } from "./rng.js";
import { NPCS, favorStage } from "./game-data.js";

/** 单次自由行动允许调整的玩家字段与幅度上限。未列入者一律硬拒绝。 */
export const DELTA_LIMITS = {
  "player.stamina": 15,
  "player.qi": 15,
  "player.fatigue": 15,
  "player.injury": 12,
  "player.spiritStones": 5,
  "player.reputation": 3,
};

export const FAVOR_LIMIT = 8;

const DIFFICULTIES = ["easy", "medium", "hard"];

function clampMagnitude(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * 把 path 解析成一条明确的、可安全应用的指令。
 * 只认三种形状，且 id 必须在实际数据中存在——这是防原型污染的关键：
 * 全程不做动态属性遍历，未知路径一律返回 null。
 */
function classifyPath(path, visibleState) {
  if (typeof path !== "string") return null;

  if (Object.hasOwn(DELTA_LIMITS, path)) {
    return { kind: "player", field: path.slice("player.".length), limit: DELTA_LIMITS[path], path };
  }

  const favorMatch = /^npcFavor\.([a-z]+)$/.exec(path);
  if (favorMatch) {
    const npcId = favorMatch[1];
    const known = (visibleState.knownNpcs || []).some((npc) => npc.id === npcId);
    return known ? { kind: "favor", npcId, limit: FAVOR_LIMIT, path } : null;
  }

  const itemMatch = /^inventory\.([a-z_]+)$/.exec(path);
  if (itemMatch) {
    const itemId = itemMatch[1];
    const owned = (visibleState.inventory || []).find((entry) => entry.id === itemId);
    return owned ? { kind: "item", itemId, limit: owned.count, path } : null;
  }

  return null;
}

function normalizeDeltas(rawDeltas, visibleState, rejected, clamped) {
  const result = [];
  for (const raw of Array.isArray(rawDeltas) ? rawDeltas : []) {
    const path = raw?.path;
    const value = raw?.value;
    const target = classifyPath(path, visibleState);
    if (!target || !Number.isFinite(value)) {
      rejected.push(typeof path === "string" ? path : String(path));
      continue;
    }
    // 物品只能消耗，不能凭空获得。
    if (target.kind === "item" && value >= 0) {
      rejected.push(path);
      continue;
    }
    const bounded = target.kind === "item"
      ? Math.max(-target.limit, value)
      : clampMagnitude(value, target.limit);
    if (bounded !== value) clamped.push(path);
    if (bounded === 0) continue;
    result.push(
      target.kind === "player"
        ? { kind: "player", field: target.field, value: bounded, path }
        : target.kind === "favor"
          ? { kind: "favor", npcId: target.npcId, value: bounded, path }
          : { kind: "item", itemId: target.itemId, value: bounded, path },
    );
  }
  return result;
}

/** 各玩家字段的绝对上下限。与引擎既有约束保持一致——幅度限制与绝对上限是两层独立防线。 */
const PLAYER_BOUNDS = {
  stamina: (state) => [0, state.player.staminaMax],
  qi: (state) => [0, state.player.qiMax],
  fatigue: () => [0, 100],
  injury: () => [0, 100],
  spiritStones: () => [0, Number.MAX_SAFE_INTEGER],
  reputation: () => [0, Number.MAX_SAFE_INTEGER],
};

const FIELD_LABELS = {
  stamina: "体力",
  qi: "灵气",
  fatigue: "疲劳",
  injury: "伤势",
  spiritStones: "下品灵石",
  reputation: "声望",
};

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

/** 就地应用 deltas。返回实际生效的条目，供 publicEffects 使用。 */
export function applyDeltas(state, deltas) {
  const applied = [];
  for (const delta of deltas || []) {
    if (delta.kind === "player") {
      const bounds = PLAYER_BOUNDS[delta.field];
      if (!bounds) continue;
      const [min, max] = bounds(state);
      const before = state.player[delta.field];
      const after = Math.max(min, Math.min(max, before + delta.value));
      if (after === before) continue;
      state.player[delta.field] = after;
      applied.push({ path: delta.path, value: after - before, label: `${FIELD_LABELS[delta.field]} ${signed(after - before)}` });
    } else if (delta.kind === "favor") {
      const npcState = state.npcStates?.[delta.npcId];
      if (!npcState) continue;
      const beforeStage = favorStage(npcState.favor);
      npcState.favor += delta.value;
      const afterStage = favorStage(npcState.favor);
      const name = NPCS[delta.npcId]?.name ?? delta.npcId;
      const label = afterStage !== beforeStage
        ? `${name}的态度变为“${afterStage}”`
        : delta.value > 0
          ? `${name}的态度略有好转`
          : `${name}的态度略有冷淡`;
      applied.push({ path: delta.path, value: delta.value, label });
    } else if (delta.kind === "item") {
      const index = (state.inventory || []).findIndex((entry) => entry.id === delta.itemId);
      if (index < 0) continue;
      const item = state.inventory[index];
      const spent = Math.min(item.count, -delta.value);
      if (spent <= 0) continue;
      item.count -= spent;
      if (item.count <= 0) state.inventory.splice(index, 1);
      applied.push({ path: delta.path, value: -spent, label: `${item.name} -${spent}` });
    }
  }
  return { applied };
}

/** 判定阈值集中在此，便于调平衡。 */
const DIFFICULTY_THRESHOLDS = {
  easy: { success: 0.7, partial: 0.92 },
  medium: { success: 0.45, partial: 0.8 },
  hard: { success: 0.2, partial: 0.55 },
};

/** 用现有的种子 RNG 掷判定，保证同种子同回合可复现。 */
export function rollOutcome(state, difficulty) {
  const thresholds = DIFFICULTY_THRESHOLDS[difficulty] || DIFFICULTY_THRESHOLDS.medium;
  const roll = random01(state.seed, state.turn, "free-action");
  if (roll < thresholds.success) return "success";
  if (roll < thresholds.partial) return "partial";
  return "failure";
}

/** partial 时正向条目减半（向零取整），负向条目不变。 */
export function halvePositive(deltas) {
  return (deltas || [])
    .map((delta) => (delta.value > 0 ? { ...delta, value: Math.trunc(delta.value / 2) } : delta))
    .filter((delta) => delta.value !== 0);
}

/**
 * 校验模型提案。非法条目整条丢弃，超幅条目钳到边界；任何一条越界都不会
 * 导致整包失败——与叙事层的分级降级是同一条原则。
 */
export function validateProposal(proposal, visibleState, allowedActionIds = []) {
  const rejected = [];
  const clamped = [];

  if (!proposal || typeof proposal !== "object") {
    return {
      feasible: false,
      reason: "裁决结果无法解析。 ",
      nearestActionId: null,
      deltas: [],
      failureDeltas: [],
      difficulty: "medium",
      narrativeFacts: [],
      rejected,
      clamped,
    };
  }

  if (proposal.feasible === false) {
    const nearest = typeof proposal.nearestActionId === "string" && allowedActionIds.includes(proposal.nearestActionId)
      ? proposal.nearestActionId
      : null;
    return {
      feasible: false,
      reason: String(proposal.reason || "这件事现在做不到。 ").slice(0, 120),
      nearestActionId: nearest,
      deltas: [],
      failureDeltas: [],
      difficulty: "medium",
      narrativeFacts: [],
      rejected,
      clamped,
    };
  }

  const facts = (Array.isArray(proposal.narrativeFacts) ? proposal.narrativeFacts : [])
    .filter((fact) => typeof fact === "string" && fact.trim())
    .slice(0, 4)
    .map((fact) => fact.trim().slice(0, 200));

  return {
    feasible: true,
    reason: null,
    nearestActionId: null,
    deltas: normalizeDeltas(proposal.deltas, visibleState, rejected, clamped),
    failureDeltas: normalizeDeltas(proposal.failureDeltas, visibleState, [], []),
    difficulty: DIFFICULTIES.includes(proposal.difficulty) ? proposal.difficulty : "medium",
    narrativeFacts: facts,
    rejected,
    clamped,
  };
}
