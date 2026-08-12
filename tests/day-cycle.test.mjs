import test from "node:test";
import assert from "node:assert/strict";
import { SLOTS_PER_DAY, canAfford, describeTimeCost, displaySlotIndex, isDayExhausted, spendTime, timeCostOf } from "../src/day-cycle.js";

test("行动耗时分为 0 / 1 / 2 三档", () => {
  assert.equal(timeCostOf("end_day"), 0);
  assert.equal(timeCostOf("battle_attack"), 0);
  assert.equal(timeCostOf("start_tournament"), 0);
  assert.equal(timeCostOf("finish_stage"), 0);
  assert.equal(timeCostOf("work_chores"), 2);
  assert.equal(timeCostOf("attempt_breakthrough"), 2);
  assert.equal(timeCostOf("sect_patrol"), 2);
  assert.equal(timeCostOf("train"), 1);
  assert.equal(timeCostOf("free_action"), 1);
});

test("可负担性以 slot + cost <= SLOTS_PER_DAY 判定", () => {
  assert.equal(SLOTS_PER_DAY, 5);
  assert.equal(canAfford({ slot: 4 }, "train"), true, "傍晚仍可做普通行动");
  assert.equal(canAfford({ slot: 4 }, "work_chores"), false, "傍晚不能开始长行动");
  assert.equal(canAfford({ slot: 5 }, "train"), false);
  assert.equal(canAfford({ slot: 5 }, "end_day"), true, "零耗时行动永远可负担");
});

test("预算耗尽的判定与显示钳制", () => {
  assert.equal(isDayExhausted({ slot: 4 }), false);
  assert.equal(isDayExhausted({ slot: 5 }), true);
  assert.equal(isDayExhausted({ slot: 0 }), false, "清晨显然没耗尽");
});

test("spendTime 上钳到 SLOTS_PER_DAY，不会溢出", () => {
  const state = { slot: 4 };
  spendTime(state, 2);
  assert.equal(state.slot, SLOTS_PER_DAY, "超支被钳到上限而非 6");
  spendTime(state, 1);
  assert.equal(state.slot, SLOTS_PER_DAY);
});

test("耗时文案", () => {
  assert.equal(describeTimeCost(0), "不推进时辰");
  assert.equal(describeTimeCost(1), "耗时1时段");
  assert.equal(describeTimeCost(2), "耗时2时段");
});

test("displaySlotIndex 把哨兵值钳到最后一个有名称的时段", () => {
  assert.equal(displaySlotIndex(0), 0);
  assert.equal(displaySlotIndex(4), 4);
  assert.equal(displaySlotIndex(SLOTS_PER_DAY), SLOTS_PER_DAY - 1, "今日已满仍显示夜间");
  assert.equal(displaySlotIndex(undefined), 0);
});
