import test from "node:test";
import assert from "node:assert/strict";
import { hashNumber, random01 } from "../src/rng.js";

test("random01 在相同输入下可复现", () => {
  assert.equal(random01(123, 4, "train"), random01(123, 4, "train"));
  assert.notEqual(random01(123, 4, "train"), random01(123, 5, "train"));
  assert.notEqual(random01(123, 4, "train"), random01(123, 4, "herb"));
});

test("random01 落在 [0,1) 区间", () => {
  for (let turn = 0; turn < 200; turn += 1) {
    const value = random01(9876, turn, "free-action");
    assert.ok(value >= 0 && value < 1, `turn ${turn} 得到 ${value}`);
  }
});

test("hashNumber 是稳定的无符号整数", () => {
  assert.equal(hashNumber("abc"), hashNumber("abc"));
  assert.ok(Number.isInteger(hashNumber("abc")) && hashNumber("abc") >= 0);
});
