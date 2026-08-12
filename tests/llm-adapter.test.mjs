import test from "node:test";
import assert from "node:assert/strict";
import { createNewGame, getAvailableActions, getVisibleState, moveTo, resolveAction } from "../src/game-engine.js";
import { extractNarrationDraft, normalizeLlmConfig, requestAiNarration, requestAdjudication } from "../src/llm.js";
import { DELTA_LIMITS } from "../src/adjudicator.js";

function responseWith(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function choicesFor(state) {
  return getAvailableActions(state)
    .filter((action) => !action.freeInput && action.id !== "new_journey")
    .slice(0, 4)
    .map((action) => ({ actionId: action.id, label: `承接剧情：${action.label}` }));
}

test("LLM 请求只发送公开状态，返回叙事不能修改游戏数值", async () => {
  const initial = createNewGame({ seed: 123, profile: { name: "顾长风", gender: "男" } });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const visible = getVisibleState(state);
  let captured;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return responseWith({
      choices: [{ message: { content: JSON.stringify({
        turnId: outcome.turnId,
        narration: [{ type: "narrator", text: "你收起木牌，踏进雾中的外门。" }],
        choices: choicesFor(state),
        presentation: { focusCharacterId: "steward", expression: "calm", sceneMood: "solemn" },
      }) } }]
    });
  };

  try {
    const result = await requestAiNarration({
      config: { enabled: true, provider: "deepseek", apiKey: "dummy-key", baseUrl: "https://example.test", model: "deepseek-v4-pro" },
      visibleState: visible,
      outcome,
      availableActions: getAvailableActions(state),
    });
    assert.equal(result.narration[0].text, "你收起木牌，踏进雾中的外门。");
    assert.deepEqual(result.choices.map((choice) => choice.actionId), choicesFor(state).map((choice) => choice.actionId));
    assert.equal("deltas" in result, false, "叙事调用不承担结算职责，数值变化只能来自裁决调用");
    const sentText = JSON.stringify(captured.body);
    assert.equal(sentText.includes("worldTruth"), false);
    assert.equal(sentText.includes(String(state.worldTruth.realTalent)), false);
    assert.equal(sentText.includes("dummy-key"), false);
    assert.equal(sentText.includes("沈砚"), false);
    assert.equal(captured.body.messages[1].content.includes('"exactName":"顾长风"'), true);
    assert.equal(captured.body.messages[1].content.includes('"genericHonorific":"师兄"'), true);
    assert.equal(captured.options.headers.Authorization, "Bearer dummy-key");
    assert.equal(captured.body.model, "deepseek-v4-pro");
    assert.deepEqual(captured.body.thinking, { type: "disabled" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek旧模型名称会迁移到V4 Flash，自定义模型保持不变", () => {
  assert.equal(normalizeLlmConfig({ provider: "deepseek", model: "deepseek-chat" }).model, "deepseek-v4-flash");
  assert.equal(normalizeLlmConfig({ provider: "deepseek", model: "deepseek-reasoner" }).model, "deepseek-v4-flash");
  assert.equal(normalizeLlmConfig({ provider: "deepseek", model: "deepseek-v4-pro" }).model, "deepseek-v4-pro");
  assert.equal(normalizeLlmConfig({ provider: "custom", model: "my-private-model" }).model, "my-private-model");
});

test("未知说话人先触发修复；修复仍失败则剔除该段并保留其余", async () => {
  const initial = createNewGame({ seed: 44 });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      turnId: outcome.turnId,
      narration: [
        { type: "narrator", text: "\u77f3\u9636\u5c3d\u5934\u7684\u96fe\u6563\u5f00\u4e00\u7ebf\u3002" },
        { type: "dialogue", speakerId: "guest", text: "\u6211\u77e5\u9053\u4f60\u7684\u5168\u90e8\u79d8\u5bc6\u3002" },
      ],
      choices: choicesFor(state),
      presentation: { focusCharacterId: null, expression: "neutral", sceneMood: "uneasy" },
    }) } }] });
  };
  try {
    const result = await requestAiNarration({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test/v1", model: "demo" },
      visibleState: getVisibleState(state),
      outcome,
      availableActions: getAvailableActions(state),
    });
    assert.equal(calls, 2, "\u9996\u6b21\u4e25\u683c\u5931\u8d25\u540e\u4fee\u590d\u4e00\u6b21");
    assert.equal(result.narration.length, 1, "\u8fdd\u89c4\u6bb5\u843d\u88ab\u5254\u9664");
    assert.equal(result.narration[0].text, "\u77f3\u9636\u5c3d\u5934\u7684\u96fe\u6563\u5f00\u4e00\u7ebf\u3002");
    assert.equal(
      result.narration.some((segment) => segment.speakerId === "guest"),
      false,
      "\u672a\u77e5 NPC \u4f9d\u7136\u6ca1\u6709\u5f00\u53e3",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("格式错误时只重试一次修复请求", async () => {
  const initial = createNewGame({ seed: 88 });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return responseWith({ choices: [{ message: { content: "这不是JSON" } }] });
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      turnId: outcome.turnId,
      narration: [{ type: "narrator", text: "格式修复后，故事继续。" }],
      choices: choicesFor(state),
      presentation: { focusCharacterId: "steward", expression: "calm", sceneMood: "solemn" }
    }) } }] });
  };
  try {
    const result = await requestAiNarration({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      outcome,
      availableActions: getAvailableActions(state),
    });
    assert.equal(calls, 2);
    assert.equal(result.narration[0].text, "格式修复后，故事继续。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("选项非法时静默降级为程序文案，不发起第二次请求", async () => {
  const initial = createNewGame({ seed: 91 });
  const { state, outcome } = resolveAction(initial, "inspect_spirit_tablet", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      turnId: outcome.turnId,
      narration: [{ type: "dialogue", speakerId: "lu", text: "\u4f60\u770b\u51fa\u4ec0\u4e48\u4e86\uff1f" }],
      choices: [{ actionId: "invent_new_route", label: "\u544a\u8bc9\u5979\u6240\u6709\u771f\u76f8" }],
      presentation: { focusCharacterId: "lu", expression: "worried", sceneMood: "uneasy" },
    }) } }] });
  };
  try {
    const result = await requestAiNarration({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      outcome,
      availableActions: getAvailableActions(state),
    });
    assert.equal(calls, 1, "\u9009\u9879\u964d\u7ea7\u4e0d\u5e94\u89e6\u53d1\u4fee\u590d\u8bf7\u6c42");
    assert.equal(result.choices, null, "\u975e\u6cd5\u9009\u9879\u964d\u7ea7\u4e3a null\uff0c\u7531\u754c\u9762\u7528\u7a0b\u5e8f\u6587\u6848");
    assert.equal(result.narration[0].text, "\u4f60\u770b\u51fa\u4ec0\u4e48\u4e86\uff1f", "\u6b63\u6587\u5fc5\u987b\u4fdd\u7559");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("流式返回会在完整JSON结束前提取可读正文", async () => {
  const initial = createNewGame({ seed: 93 });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  state.dialogueMemory = [{ turn: 0, location: "山门试心阶", speakers: ["steward"], text: "周执事：先把木牌收好。" }];
  const payload = {
    turnId: outcome.turnId,
    narration: [
      { type: "narrator", text: "竹窗被晨风推开一道缝。" },
      { type: "dialogue", speakerId: "lu", text: "先坐下，我听你慢慢说。" },
    ],
    choices: choicesFor(state),
    presentation: { focusCharacterId: "lu", expression: "calm", sceneMood: "calm" },
  };
  const serialized = JSON.stringify(payload);
  const pieces = [serialized.slice(0, 72), serialized.slice(72, 126), serialized.slice(126)];
  const originalFetch = globalThis.fetch;
  let capturedBody;
  const drafts = [];
  globalThis.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const piece of pieces) {
          const event = { choices: [{ delta: { content: piece } }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const result = await requestAiNarration({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      outcome,
      availableActions: getAvailableActions(state),
      onProgress: (draft) => drafts.push(draft),
    });
    assert.equal(capturedBody.stream, true);
    assert.ok(drafts.some((draft) => draft.some((segment) => segment.text.includes("晨风"))));
    assert.equal(result.narration[1].text, "先坐下，我听你慢慢说。");
    assert.match(capturedBody.messages[1].content, /先把木牌收好/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("不完整JSON片段也能形成流式草稿", () => {
  const draft = extractNarrationDraft('{"turnId":1,"narration":[{"type":"narrator","text":"山风穿过竹');
  assert.equal(draft[0].text, "山风穿过竹");
});

test("发送给模型的在场人物只包含当前地点的人", async () => {
  const initial = createNewGame({ seed: 87 });
  let { state } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  state = moveTo(state, "herbHill");
  const { state: acted, outcome } = resolveAction(state, "explore_herbs", { expectedTurn: state.turn });
  let captured;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      turnId: outcome.turnId,
      narration: [{ type: "narrator", text: "\u96fe\u6c14\u8d34\u7740\u811a\u8e1d\u3002" }],
      choices: choicesFor(acted),
      presentation: { focusCharacterId: null, expression: "calm", sceneMood: "calm" },
    }) } }] });
  };
  try {
    await requestAiNarration({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(acted),
      outcome,
      availableActions: getAvailableActions(acted),
    });
    const sent = JSON.parse(captured.messages[1].content);
    assert.deepEqual(sent.presentCharacters, [], "\u767e\u8349\u5761\u72ec\u5904\u65f6\u4e0d\u5e94\u6709\u4efb\u4f55\u5728\u573a\u4eba\u7269");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("全部段落非法时才真正降级到本地叙事", async () => {
  const initial = createNewGame({ seed: 45 });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWith({ choices: [{ message: { content: JSON.stringify({
    turnId: outcome.turnId,
    narration: [{ type: "dialogue", speakerId: "guest", text: "我知道你的全部秘密。" }],
    choices: choicesFor(state),
    presentation: { focusCharacterId: null, expression: "neutral", sceneMood: "uneasy" },
  }) } }] });
  try {
    await assert.rejects(
      requestAiNarration({
        config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test/v1", model: "demo" },
        visibleState: getVisibleState(state),
        outcome,
        availableActions: getAvailableActions(state),
      }),
      /叙事段落全部无效/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("回合编号对不上时不进入抢救流程", async () => {
  const initial = createNewGame({ seed: 46 });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      turnId: outcome.turnId + 99,
      narration: [{ type: "narrator", text: "这段属于另一个回合。" }],
      choices: choicesFor(state),
      presentation: { focusCharacterId: null, expression: "neutral", sceneMood: "calm" },
    }) } }] });
  };
  try {
    await assert.rejects(
      requestAiNarration({
        config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
        visibleState: getVisibleState(state),
        outcome,
        availableActions: getAvailableActions(state),
      }),
      /错误的回合编号/,
    );
    assert.equal(calls, 2, "修复一次后直接降级，不抢救");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("裁决请求发送玩家原文与允许行动，且不泄露世界真相", async () => {
  const initial = createNewGame({ seed: 123 });
  const { state } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  let captured;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      feasible: true,
      difficulty: "medium",
      deltas: [{ path: "player.stamina", value: -4 }],
      failureDeltas: [{ path: "player.stamina", value: -6 }],
      narrativeFacts: ["你按住呼吸，慢慢靠近。"],
    }) } }] });
  };
  try {
    const result = await requestAdjudication({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      freeText: "我想凑近看看那块验灵石背面",
      allowedActionIds: ["rest", "talk_lu"],
    });
    assert.equal(result.feasible, true);
    assert.equal(result.deltas[0].value, -4);
    const sent = JSON.stringify(captured);
    assert.ok(sent.includes("凑近看看"), "玩家原文必须送达");
    assert.equal(sent.includes("worldTruth"), false);
    assert.equal(sent.includes(String(state.worldTruth.realTalent)), false);
    assert.equal(sent.includes("dummy-key"), false);
    assert.equal(captured.temperature, 0, "裁决必须低温");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("裁决返回非法 JSON 时只修复一次", async () => {
  const initial = createNewGame({ seed: 124 });
  const { state } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return responseWith({ choices: [{ message: { content: "这不是JSON" } }] });
    return responseWith({ choices: [{ message: { content: JSON.stringify({
      feasible: false, reason: "你还不会御剑飞行。", nearestActionId: "rest",
    }) } }] });
  };
  try {
    const result = await requestAdjudication({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      freeText: "我御剑飞上山顶",
      allowedActionIds: ["rest"],
    });
    assert.equal(calls, 2);
    assert.equal(result.feasible, false);
    assert.equal(result.nearestActionId, "rest");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型给出的越界数值在适配器层就被钳住", async () => {
  const initial = createNewGame({ seed: 125 });
  const { state } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWith({ choices: [{ message: { content: JSON.stringify({
    feasible: true,
    difficulty: "easy",
    deltas: [
      { path: "player.spiritStones", value: 9999 },
      { path: "player.realmRank", value: 30 },
    ],
    narrativeFacts: ["天降横财"],
  }) } }] });
  try {
    const result = await requestAdjudication({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      freeText: "我捡到一大袋灵石并当场突破",
      allowedActionIds: ["rest"],
    });
    assert.equal(result.deltas.length, 1, "境界字段被整条丢弃");
    assert.equal(result.deltas[0].value, DELTA_LIMITS["player.spiritStones"]);
    assert.deepEqual(result.rejected, ["player.realmRank"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function narrationPayload(state, outcome, extra = {}) {
  return {
    turnId: outcome.turnId,
    narration: [{ type: "narrator", text: "竹窗外风声未歇。" }],
    choices: choicesFor(state),
    presentation: { focusCharacterId: null, expression: "calm", sceneMood: "calm" },
    ...extra,
  };
}

async function narrateWith(seed, extra, options = {}) {
  const initial = createNewGame({ seed });
  const { state, outcome } = resolveAction(initial, "accept_entry", { expectedTurn: 0 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWith({
    choices: [{ message: { content: JSON.stringify(narrationPayload(state, outcome, extra)) } }],
  });
  try {
    return await requestAiNarration({
      config: { enabled: true, apiKey: "dummy-key", baseUrl: "https://example.test", model: "demo" },
      visibleState: getVisibleState(state),
      outcome,
      availableActions: getAvailableActions(state),
      ...options,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("建议选项被保留并截断到两条", async () => {
  const result = await narrateWith(400, {
    suggestedActions: [
      { text: "沿药圃边缘再找一遍那株枯掉的凝露草" },
      { text: "问陆青禾昨夜有没有听见钟声" },
      { text: "第三条应被丢弃" },
    ],
  });
  assert.equal(result.suggestions.length, 2, "最多两条");
  assert.equal(result.suggestions[0], "沿药圃边缘再找一遍那株枯掉的凝露草");
});

test("建议选项非法时降级为空数组且不连累正文", async () => {
  for (const bad of ["不是数组", [{ text: "" }], [{ text: 42 }], null, [{}]]) {
    const result = await narrateWith(401, { suggestedActions: bad });
    assert.deepEqual(result.suggestions, [], `${JSON.stringify(bad)} 应降级为空`);
    assert.equal(result.narration[0].text, "竹窗外风声未歇。", "正文必须不受影响");
  }
});

test("建议选项超长会被截断", async () => {
  const result = await narrateWith(402, { suggestedActions: [{ text: "字".repeat(200) }] });
  assert.equal(result.suggestions[0].length, 42);
});

test("未开启江湖动态时不接受 worldEvents", async () => {
  const result = await narrateWith(403, {
    worldEvents: [{ npcId: "lu", text: "陆青禾去了藏经阁。", favorDelta: 2 }],
  });
  assert.deepEqual(result.worldEvents, [], "未请求时一律忽略");
});

test("江湖动态：未认识的 NPC 丢弃 id 但保留文本", async () => {
  const result = await narrateWith(404, {
    worldEvents: [
      { npcId: "guest", text: "有位客卿住进了藏经阁后院。", favorDelta: 2 },
      { npcId: "lu", text: "陆青禾把药杵洗净收好。", favorDelta: 1 },
    ],
  }, { includeWorldPulse: true });
  assert.equal(result.worldEvents.length, 2);
  assert.equal(result.worldEvents[0].npcId, null, "未认识的 NPC 不能被指名");
  assert.equal(result.worldEvents[0].text, "有位客卿住进了藏经阁后院。", "文本仍保留");
  assert.equal(result.worldEvents[1].npcId, "lu");
});

test("江湖动态：好感变化钳到 ±3，条数截断到 3", async () => {
  const result = await narrateWith(405, {
    worldEvents: [
      { npcId: "lu", text: "一", favorDelta: 99 },
      { npcId: "han", text: "二", favorDelta: -99 },
      { npcId: "lu", text: "三", favorDelta: 1 },
      { npcId: "lu", text: "四", favorDelta: 1 },
    ],
  }, { includeWorldPulse: true });
  assert.equal(result.worldEvents.length, 3, "最多三条");
  assert.equal(result.worldEvents[0].favorDelta, 3);
  assert.equal(result.worldEvents[1].favorDelta, -3);
});

test("江湖动态：非法条目逐条丢弃不影响其余", async () => {
  const result = await narrateWith(406, {
    worldEvents: [
      { npcId: "lu", text: "", favorDelta: 1 },
      { text: "山下传来消息，说今年药市开得早。" },
      { npcId: "lu", text: 42 },
    ],
  }, { includeWorldPulse: true });
  assert.equal(result.worldEvents.length, 1);
  assert.equal(result.worldEvents[0].text, "山下传来消息，说今年药市开得早。");
  assert.equal(result.worldEvents[0].favorDelta, 0, "未给出时为 0");
});
