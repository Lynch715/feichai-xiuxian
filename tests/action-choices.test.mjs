import test from "node:test";
import assert from "node:assert/strict";
import { selectTurnChoices } from "../src/action-choices.js";
import { createNewGame, getAvailableActions, resolveAction } from "../src/game-engine.js";

test("只取场景行动并把自由行动分离出来", () => {
  let state = createNewGame({ seed: 101 });
  state = resolveAction(state, "accept_entry", { expectedTurn: 0 }).state;
  const selected = selectTurnChoices(getAvailableActions(state));
  assert.deepEqual(selected.numberedActions.map((action) => action.id), ["rest", "talk_lu"]);
  assert.equal(selected.freeAction.id, "free_action");
  assert.equal(selected.numberedActions.some((action) => action.freeInput), false);
  assert.equal(selected.numberedActions.some((action) => action.id.startsWith("move:")), false);
});

test("选项数量不超过上限", () => {
  let state = createNewGame({ seed: 102 });
  state = resolveAction(state, "accept_entry", { expectedTurn: 0 }).state;
  state.locationId = "training";
  assert.ok(selectTurnChoices(getAvailableActions(state), 2).numberedActions.length <= 2);
});
