import { validateProposal } from "./adjudicator.js";

const CONFIG_KEY = "feichai_llm_config_v1";
const SESSION_KEY = "feichai_llm_key_session_v1";
const PERSISTENT_KEY = "feichai_llm_key_persistent_v1";

export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export const DEFAULT_LLM_CONFIG = {
  enabled: false,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  rememberKey: false,
};

export function normalizeLlmConfig(config = {}) {
  const normalized = { ...DEFAULT_LLM_CONFIG, ...config };
  normalized.provider = normalized.provider === "custom" ? "custom" : "deepseek";
  if (normalized.provider === "deepseek" && !DEEPSEEK_MODELS.includes(normalized.model)) {
    normalized.model = DEFAULT_LLM_CONFIG.model;
  }
  return normalized;
}

export function loadLlmConfig() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  } catch {
    stored = {};
  }
  const config = normalizeLlmConfig(stored);
  const apiKey = config.rememberKey
    ? localStorage.getItem(PERSISTENT_KEY) || ""
    : sessionStorage.getItem(SESSION_KEY) || "";
  return { ...config, apiKey };
}

export function saveLlmConfig(config) {
  const safeConfig = normalizeLlmConfig({
    enabled: Boolean(config.enabled),
    provider: config.provider === "custom" ? "custom" : "deepseek",
    baseUrl: String(config.baseUrl || "").trim(),
    model: String(config.model || "").trim(),
    rememberKey: Boolean(config.rememberKey),
  });
  localStorage.setItem(CONFIG_KEY, JSON.stringify(safeConfig));
  if (safeConfig.rememberKey) {
    localStorage.setItem(PERSISTENT_KEY, config.apiKey || "");
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, config.apiKey || "");
    localStorage.removeItem(PERSISTENT_KEY);
  }
  return { ...safeConfig, apiKey: config.apiKey || "" };
}

export function clearStoredApiKey() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(PERSISTENT_KEY);
}

function endpointFrom(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("请填写 API 地址。 ");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("模型没有返回内容。 ");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("模型返回的不是有效 JSON。 ");
  }
}

function decodePartialJsonString(raw) {
  const safe = raw.replace(/\\$/u, "");
  try {
    return JSON.parse(`"${safe}"`);
  } catch {
    return safe
      .replaceAll("\\n", "\n")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
}

export function extractNarrationDraft(source) {
  const text = String(source || "");
  const narrationStart = text.indexOf('"narration"');
  if (narrationStart < 0) return [];
  const choicesStart = text.indexOf('"choices"', narrationStart);
  const section = text.slice(narrationStart, choicesStart < 0 ? text.length : choicesStart);
  const segments = [];
  let cursor = 0;

  while (cursor < section.length) {
    const textKey = section.indexOf('"text"', cursor);
    if (textKey < 0) break;
    const colon = section.indexOf(":", textKey + 6);
    const openingQuote = section.indexOf('"', colon + 1);
    if (colon < 0 || openingQuote < 0) break;
    let closingQuote = -1;
    let escaped = false;
    for (let index = openingQuote + 1; index < section.length; index += 1) {
      const character = section[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        closingQuote = index;
        break;
      }
    }
    const objectStart = section.lastIndexOf("{", textKey);
    const prefix = section.slice(Math.max(0, objectStart), textKey);
    const type = /"type"\s*:\s*"dialogue"/u.test(prefix) ? "dialogue" : "narrator";
    const speakerId = prefix.match(/"speakerId"\s*:\s*"([^"]+)"/u)?.[1] || null;
    const raw = section.slice(openingQuote + 1, closingQuote < 0 ? section.length : closingQuote);
    const decoded = decodePartialJsonString(raw).trim();
    if (decoded) segments.push({ type, speakerId: type === "dialogue" ? speakerId : null, text: decoded });
    if (closingQuote < 0) break;
    cursor = closingQuote + 1;
  }
  return segments;
}

function validateNarrationSegments(payload, knownNpcIds, { salvage = false } = {}) {
  if (!Array.isArray(payload.narration) || payload.narration.length === 0) {
    throw new Error("\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53d9\u4e8b\u6bb5\u843d\u3002 ");
  }
  if (payload.narration.length > 8) throw new Error("\u6a21\u578b\u8fd4\u56de\u7684\u53d9\u4e8b\u6bb5\u843d\u8fc7\u591a\u3002 ");
  const segments = [];
  for (const segment of payload.narration) {
    try {
      if (!segment || typeof segment.text !== "string" || !segment.text.trim()) {
        throw new Error("\u53d9\u4e8b\u6bb5\u843d\u683c\u5f0f\u9519\u8bef\u3002 ");
      }
      const type = segment.type === "dialogue" ? "dialogue" : "narrator";
      if (type === "dialogue" && !knownNpcIds.includes(segment.speakerId)) {
        throw new Error("\u6a21\u578b\u4f7f\u7528\u4e86\u5f53\u524d\u4e0d\u53ef\u89c1\u7684\u8bf4\u8bdd\u4eba\u3002 ");
      }
      segments.push({
        type,
        speakerId: type === "dialogue" ? segment.speakerId : null,
        text: segment.text.trim().slice(0, 1200),
      });
    } catch (error) {
      // \u62a2\u6551\u6a21\u5f0f\u4e0b\u4e22\u6389\u8fdd\u89c4\u6bb5\u843d\u800c\u975e\u6539\u5199：\u672a\u77e5 NPC \u4f9d\u7136\u4e0d\u4f1a\u5f00\u53e3\u3002
      if (!salvage) throw error;
    }
  }
  if (!segments.length) throw new Error("\u53d9\u4e8b\u6bb5\u843d\u5168\u90e8\u65e0\u6548\u3002 ");
  return segments;
}

/** \u9009\u9879\u975e\u6cd5\u65f6\u8fd4\u56de null\uff08\u4e0d\u629b\u9519\uff09\uff0c\u7531\u754c\u9762\u56de\u9000\u5230\u7a0b\u5e8f\u6587\u6848\u3002 */
function validateChoices(payload, allowedChoices) {
  if (!Array.isArray(payload.choices) || payload.choices.length !== allowedChoices.length) return null;
  const returned = new Map();
  for (const choice of payload.choices) {
    if (!choice || typeof choice.actionId !== "string" || typeof choice.label !== "string") return null;
    if (!allowedChoices.some((allowed) => allowed.id === choice.actionId) || returned.has(choice.actionId)) return null;
    const label = choice.label.trim().replace(/^\s*[1-4][.\u3001)\uff09\s]+/, "").slice(0, 42);
    if (!label) return null;
    returned.set(choice.actionId, label);
  }
  const choices = allowedChoices.map((allowed) => ({ actionId: allowed.id, label: returned.get(allowed.id) }));
  return choices.some((choice) => !choice.label) ? null : choices;
}

function validateSuggestions(payload) {
  // 生成时不接触任何游戏状态，因此没有越权面；异常一律降级为空数组，
  // 绝不抛错连累正文——沿用分级降级原则。
  if (!Array.isArray(payload.suggestedActions)) return [];
  const suggestions = [];
  for (const entry of payload.suggestedActions) {
    const text = typeof entry?.text === "string" ? entry.text.trim().slice(0, 42) : "";
    if (text) suggestions.push(text);
    if (suggestions.length >= 2) break;
  }
  return suggestions;
}

function validateWorldEvents(payload, knownNpcIds, includeWorldPulse) {
  if (!includeWorldPulse || !Array.isArray(payload.worldEvents)) return [];
  const events = [];
  for (const entry of payload.worldEvents) {
    const text = typeof entry?.text === "string" ? entry.text.trim().slice(0, 120) : "";
    if (!text) continue;
    // 未认识的 NPC 不能被指名，但事件文本仍保留——世上也会发生与熟人无关的事。
    const npcId = knownNpcIds.includes(entry?.npcId) ? entry.npcId : null;
    const raw = Number(entry?.favorDelta);
    const favorDelta = npcId && Number.isFinite(raw) ? Math.max(-3, Math.min(3, Math.trunc(raw))) : 0;
    events.push({ npcId, text, favorDelta });
    if (events.length >= 3) break;
  }
  return events;
}

function normalizePresentation(payload, knownNpcIds) {
  return {
    focusCharacterId: knownNpcIds.includes(payload.presentation?.focusCharacterId)
      ? payload.presentation.focusCharacterId
      : null,
    expression: ["neutral", "worried", "angry", "hurt", "surprised", "calm"].includes(payload.presentation?.expression)
      ? payload.presentation.expression
      : "neutral",
    sceneMood: ["calm", "tense", "uneasy", "hopeful", "solemn"].includes(payload.presentation?.sceneMood)
      ? payload.presentation.sceneMood
      : "calm",
  };
}

function systemPrompt(includeWorldPulse) {
  return `你是《废柴修仙模拟器》的中文小说叙事层，只负责把已经结算的回合写得具体、生动、有人味，不负责数值结算。

硬性规则：
1. 程序提供的 resolvedOutcome 已经结算，不得修改、撤销或增加物品、修为、好感、伤势、地点和时间。
2. 规则事实只能来自 visibleState、narrativeFacts 和 presentCharacters；允许补充不影响规则的环境声息、动作、神态、停顿和感官细节，但不得借此创造物品、关系、线索、身份或剧情结论。
3. 不得猜测隐藏天赋、废柴真因、NPC秘密；未知内容保持未知。
4. 不替玩家选择下一行动，不自动结局，不加入科幻、量子、现代网络用语。
5. NPC言行必须符合年龄、身份、性格、关系和 voice。对白要有说话人的个人习惯，用动作与潜台词承载情绪，避免把面板信息和规则结论直接念出来。
6. 玩家姓名只以 visibleState.player.name 和 playerAddressing.exactName 为准。不得沿用默认姓名、旧姓名或自行猜测玩家姓氏；若在称呼中带姓名，必须使用完整的 exactName，也可以只用 playerAddressing.genericHonorific。
7. nextAllowedChoices 是下一回合界面实际显示的四个行动。正文结尾必须自然落到这些行动上；如果 NPC 在结尾直接提问，至少一个 choice label 必须能直接回答这个问题。不得在结尾提出四个行动都无法回应的新问题。
8. choices 必须逐项保留 nextAllowedChoices 的 actionId，不得新增、删除、替换行动，也不得改变其含义和实际效果；只把 label 改写成承接本回合正文的、玩家一看就知道会做什么的当前语境文案。label 不带数字序号，每项不超过42个汉字。
9. recentDialogue 是最近真实出现过的模型正文。续写时承接其中的语气、称呼和未完回应，不重复上一轮已经说过的话。
10. 每段只承担一种功能：推进动作、呈现感受或说一句有个性的对白。少用“微微、缓缓、仿佛、不禁、眸中闪过”等模板化词语，不写空泛总结。
11. 正文通常120—280个汉字，关键回合不超过500字；开头直接进入动作或对白。
13. suggestedActions 给 0—2 条建议行动，必须是 nextAllowedChoices 没有覆盖的、当下就能做的具体小事，写成玩家第一人称的一句话（例如「沿药圃边缘再找一遍那株枯掉的凝露草」）。不要重复固定选项的含义，也不要建议超出练气期能力的事。想不出就给空数组。
12. 只返回一个 JSON 对象，不要 Markdown、代码围栏或额外说明。

${includeWorldPulse ? `14. worldEvents 写 1—3 条你不在场时江湖上发生的事：已认识 NPC 的近况、宗门琐事或山下传闻。npcId 只能填已认识人物的 id，与熟人无关的事把 npcId 留空。favorDelta 取 -3 到 3 的小幅变化，多数事件填 0。这些事不由玩家参与，不得改变玩家自身的任何数值。
` : ""}
返回格式：
{"turnId":数字,"narration":[{"type":"narrator","text":"..."},{"type":"dialogue","speakerId":"已知人物ID","text":"..."}],"choices":[{"actionId":"必须照抄允许的ID","label":"承接正文且含义不变的行动文案"}],"presentation":{"focusCharacterId":"已知人物ID或null","expression":"neutral|worried|angry|hurt|surprised|calm","sceneMood":"calm|tense|uneasy|hopeful|solemn"},"suggestedActions":[{"text":"建议行动"}]${includeWorldPulse ? `,"worldEvents":[{"npcId":"已知人物ID或null","text":"江湖近况","favorDelta":0}]` : ""}}`;
}

export async function requestAiNarration({ config, visibleState, outcome, availableActions, signal, onProgress, includeWorldPulse = false }) {
  if (!config.enabled) return null;
  if (!config.apiKey) throw new Error("尚未填写 API Key。 ");
  if (!config.model) throw new Error("尚未填写模型名称。 ");

  const knownNpcIds = visibleState.knownNpcs.map((npc) => npc.id);
  const allowedChoices = availableActions
    .filter((action) => !action.freeInput && action.id !== "new_journey")
    .slice(0, 4)
    .map(({ id, label, hint }) => ({ id, label, hint }));
  const presentIds = visibleState.presentNpcIds || [];
  const presentCharacters = visibleState.knownNpcs
    .filter((npc) => presentIds.includes(npc.id))
    .map(({ id, name, role, age, personality, attitude, goal, voice, notes }) => ({ id, name, role, age, personality, attitude, goal, voice, notes }));
  const body = {
    model: config.model,
    temperature: 0.82,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt(includeWorldPulse) },
      {
        role: "user",
        content: JSON.stringify({
          schemaVersion: "1.0",
          turnId: outcome.turnId,
          visibleState: {
            time: `第${visibleState.day}日·${visibleState.time}`,
            location: visibleState.location,
            player: visibleState.player,
            clues: visibleState.clues,
            suspicions: visibleState.suspicions,
            knownTruth: visibleState.truth.title === "？？？" ? null : visibleState.truth,
            chapterObjective: visibleState.chapterObjective,
            battle: visibleState.battle,
          },
          playerAddressing: {
            exactName: visibleState.player.name,
            genericHonorific: visibleState.player.gender === "女" ? "师姐" : visibleState.player.gender === "男" ? "师兄" : "道友",
          },
          resolvedOutcome: {
            action: outcome.actionLabel,
            publicEffects: outcome.publicEffects,
            narrativeFacts: outcome.narrativeFacts,
          },
          presentCharacters,
          recentMemory: visibleState.recentTurns.slice(-5),
          recentDialogue: (visibleState.dialogueMemory || []).slice(-3),
          longTermSummary: visibleState.longTermSummary,
          nextAllowedChoices: allowedChoices,
        }),
      },
    ],
  };
  if (config.provider === "deepseek") body.thinking = { type: "disabled" };

  async function postCompletion(requestBody, { stream = false, onDelta } = {}) {
    const transmittedBody = stream
      ? { ...requestBody, stream: true, stream_options: { include_usage: false } }
      : requestBody;
    const response = await fetch(endpointFrom(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(transmittedBody),
      signal,
    });
    if (!response.ok) {
      let message = `接口返回 ${response.status}`;
      try {
        const errorBody = await response.json();
        message = errorBody?.error?.message || message;
      } catch {
        // Keep the status-only error when the response is not JSON.
      }
      throw new Error(message);
    }
    if (!stream || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
      const data = await response.json();
      return data?.choices?.[0]?.message?.content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let eventBuffer = "";
    let contentBuffer = "";
    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const dataText = trimmed.slice(5).trim();
      if (!dataText || dataText === "[DONE]") return;
      const chunk = JSON.parse(dataText);
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (!delta) return;
      contentBuffer += delta;
      onDelta?.(contentBuffer);
    };

    while (true) {
      const { value, done } = await reader.read();
      eventBuffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let newline = eventBuffer.indexOf("\n");
      while (newline >= 0) {
        consumeLine(eventBuffer.slice(0, newline));
        eventBuffer = eventBuffer.slice(newline + 1);
        newline = eventBuffer.indexOf("\n");
      }
      if (done) break;
    }
    if (eventBuffer.trim()) consumeLine(eventBuffer);
    return contentBuffer;
  }

  const content = await postCompletion(body, {
    stream: true,
    onDelta: (partialContent) => {
      const draft = extractNarrationDraft(partialContent);
      if (draft.length) onProgress?.(draft);
    },
  });
  function build(payload, salvage) {
    if (!payload || typeof payload !== "object") throw new Error("\u53d9\u4e8b\u6570\u636e\u65e0\u6548\u3002 ");
    if (Number(payload.turnId) !== Number(outcome.turnId)) throw new Error("\u6a21\u578b\u8fd4\u56de\u4e86\u9519\u8bef\u7684\u56de\u5408\u7f16\u53f7\u3002 ");
    return {
      turnId: outcome.turnId,
      narration: validateNarrationSegments(payload, knownNpcIds, { salvage }),
      choices: validateChoices(payload, allowedChoices),
      presentation: normalizePresentation(payload, knownNpcIds),
      suggestions: validateSuggestions(payload),
      worldEvents: validateWorldEvents(payload, knownNpcIds, includeWorldPulse),
    };
  }

  try {
    return build(extractJson(content), false);
  } catch (firstError) {
    const repairBody = {
      ...body,
      temperature: 0,
      messages: [
        ...body.messages,
        { role: "assistant", content: String(content || "") },
        {
          role: "user",
          content: `\u4e0a\u4e00\u4e2a\u56de\u590d\u672a\u901a\u8fc7\u6821\u9a8c\uff1a${firstError.message}\u3002\u53ea\u4fee\u590d JSON \u683c\u5f0f\u548c\u8d8a\u6743\u5b57\u6bb5\uff0c\u4e0d\u5f97\u91cd\u5199\u5df2\u7ed9\u5b9a\u4e8b\u5b9e\uff1bturnId \u5fc5\u987b\u4e3a ${outcome.turnId}\uff0c\u8bf4\u8bdd\u4eba\u53ea\u80fd\u4ece ${knownNpcIds.join("\u3001") || "\u65e0"} \u4e2d\u9009\u62e9\uff1bchoices \u5fc5\u987b\u9010\u9879\u4f7f\u7528\u8fd9\u4e9b actionId\uff1a${allowedChoices.map((choice) => choice.id).join("\u3001")}\u3002`,
        },
      ],
    };
    const repairedPayload = extractJson(await postCompletion(repairBody));
    try {
      return build(repairedPayload, false);
    } catch (secondError) {
      // \u56de\u5408\u7f16\u53f7\u5bf9\u4e0d\u4e0a\u65f6\u9010\u6bb5\u62a2\u6551\u65e0\u610f\u4e49\uff1a\u5b83\u63cf\u8ff0\u7684\u662f\u53e6\u4e00\u4e2a\u56de\u5408\u3002
      if (Number(repairedPayload?.turnId) !== Number(outcome.turnId)) throw secondError;
      return build(repairedPayload, true);
    }
  }
}

function adjudicationSystemPrompt() {
  return `你是《废柴修仙模拟器》的规则裁决层。玩家会用自然语言描述一个行动，你只判断它能否做到、会产生什么后果，不写小说。

硬性规则：
1. 只依据 visibleState 判断。不得假设玩家拥有未列出的物品、能力、关系或知识。
2. 主角是练气期外门弟子。御剑飞行、瞬移、隔空取物、一夜筑基等超出当前境界的行为一律 feasible:false。
3. 不得创造物品、功法、NPC、地点或线索。不得宣布任何关于主角天赋异常的结论。
4. deltas 只能使用这些 path：player.stamina、player.qi、player.fatigue、player.injury、player.spiritStones、player.reputation、npcFavor.<已认识的NPC的id>、inventory.<已持有物品的id>（只能为负，表示消耗）。
5. 单条 delta 的绝对值不要超过 15；好感不要超过 8；灵石不要超过 5。超出的会被程序钳制。
6. failureDeltas 是这个行动失败时的代价，必须非空：受伤、体力损失、关系恶化或资源损失。失败不能是「什么都没发生」。
7. difficulty 取 easy / medium / hard，依据行动的难度与风险。
8. feasible:false 时必须给出 reason（一句话说明为什么做不到），并从 allowedActionIds 中选一个最接近玩家意图的 nearestActionId。
9. narrativeFacts 是 1—3 条中立的事实陈述，供叙事层改写，不要写成小说。
10. 只返回一个 JSON 对象，不要 Markdown 或代码围栏。

返回格式：
{"feasible":true,"difficulty":"medium","deltas":[{"path":"player.stamina","value":-5}],"failureDeltas":[{"path":"player.injury","value":4}],"narrativeFacts":["..."]}
或
{"feasible":false,"reason":"...","nearestActionId":"..."}`;
}

export async function requestAdjudication({ config, visibleState, freeText, allowedActionIds, signal }) {
  if (!config.apiKey) throw new Error("尚未填写 API Key。 ");
  if (!config.model) throw new Error("尚未填写模型名称。 ");

  const body = {
    model: config.model,
    temperature: 0,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: adjudicationSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          schemaVersion: "1.0",
          playerAction: { type: "free", rawText: String(freeText || "").slice(0, 160) },
          visibleState: {
            time: `第${visibleState.day}日·${visibleState.time}`,
            location: visibleState.location,
            player: visibleState.player,
            inventory: visibleState.inventory,
            knownNpcs: visibleState.knownNpcs.map(({ id, name, role, attitude }) => ({ id, name, role, attitude })),
            presentNpcIds: visibleState.presentNpcIds,
            clues: visibleState.clues,
          },
          allowedActionIds,
        }),
      },
    ],
  };
  if (config.provider === "deepseek") body.thinking = { type: "disabled" };

  async function post(requestBody) {
    const response = await fetch(endpointFrom(config.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(requestBody),
      signal,
    });
    if (!response.ok) {
      let message = `接口返回 ${response.status}`;
      try {
        const errorBody = await response.json();
        message = errorBody?.error?.message || message;
      } catch {
        // 非 JSON 错误体时保留状态码信息。
      }
      throw new Error(message);
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content;
  }

  const content = await post(body);
  try {
    return validateProposal(extractJson(content), visibleState, allowedActionIds);
  } catch (firstError) {
    const repaired = await post({
      ...body,
      messages: [
        ...body.messages,
        { role: "assistant", content: String(content || "") },
        { role: "user", content: `上一个回复无法解析：${firstError.message}。只返回一个符合格式的 JSON 对象，不要任何其他文字。` },
      ],
    });
    return validateProposal(extractJson(repaired), visibleState, allowedActionIds);
  }
}

export async function testLlmConnection(config, signal) {
  if (!config.apiKey) throw new Error("请先填写 API Key。 ");
  const response = await fetch(endpointFrom(config.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      ...(config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
      temperature: 0,
      max_tokens: 8,
      messages: [{ role: "user", content: "只回复：连接成功" }],
    }),
    signal,
  });
  if (!response.ok) throw new Error(`连接失败：接口返回 ${response.status}`);
  return true;
}
