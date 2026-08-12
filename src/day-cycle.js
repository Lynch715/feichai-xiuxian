export const SLOTS_PER_DAY = 5;

const ZERO_COST_ACTIONS = new Set(["end_day", "start_tournament", "finish_stage"]);

const LONG_ACTIONS = new Set([
  "work_chores",
  "treat_meridian",
  "break_seal",
  "sever_talisman",
  "rebuild_method",
  "attempt_breakthrough",
  "sect_patrol",
]);

export function timeCostOf(actionId) {
  const id = String(actionId ?? "");
  if (ZERO_COST_ACTIONS.has(id) || id.startsWith("battle_")) return 0;
  return LONG_ACTIONS.has(id) ? 2 : 1;
}

export function canAfford(state, actionId) {
  return (state.slot ?? 0) + timeCostOf(actionId) <= SLOTS_PER_DAY;
}

export function isDayExhausted(state) {
  return (state.slot ?? 0) >= SLOTS_PER_DAY;
}

/**
 * 扣减时段。用满后 state.slot 等于 SLOTS_PER_DAY（5），该值是「今日已满」的哨兵，
 * 在 TIME_SLOTS 中没有对应名称——显示层必须钳到 TIME_SLOTS.length - 1。
 */
export function spendTime(state, cost) {
  state.slot = Math.min(SLOTS_PER_DAY, (state.slot ?? 0) + Math.max(0, cost));
}

/**
 * 把可能等于 SLOTS_PER_DAY（今日已满哨兵）的 slot 钳到有名称的时段下标，
 * 供显示层使用。TIME_SLOTS 只有 SLOTS_PER_DAY 个名称，下标 0..SLOTS_PER_DAY-1。
 */
export function displaySlotIndex(slot) {
  return Math.min(slot ?? 0, SLOTS_PER_DAY - 1);
}

export function describeTimeCost(cost) {
  return cost === 0 ? "不推进时辰" : `耗时${cost}时段`;
}
