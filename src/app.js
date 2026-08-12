import { LOCATIONS, NPCS, PLAYER_FOCUS_ID, favorStage } from "./game-data.js";
import { selectTurnChoices } from "./action-choices.js";
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
} from "./game-engine.js";
import {
  DEFAULT_LLM_CONFIG,
  DEEPSEEK_MODELS,
  loadLlmConfig,
  requestAdjudication,
  requestAiNarration,
  saveLlmConfig,
  testLlmConnection,
} from "./llm.js";
import { halvePositive, rollOutcome } from "./adjudicator.js";

const SAVE_KEY = "feichai_game_save_v1";
const SNAPSHOT_KEY = "feichai_game_snapshots_v1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  app: $("#app"),
  time: $("#timeLabel"),
  location: $("#locationLabel"),
  aiStatus: $("#aiStatus"),
  locationButton: $("#locationButton"),
  settingsButton: $("#settingsButton"),
  sceneCard: $(".scene-card"),
  scenePortrait: $("#scenePortrait"),
  speakerName: $("#speakerName"),
  speakerRole: $("#speakerRole"),
  speakerMood: $("#speakerMood"),
  narrativePanel: $(".narrative-panel"),
  narrativeText: $("#narrativeText"),
  effects: $("#effectList"),
  llmWarning: $("#llmWarning"),
  actionList: $("#actionList"),
  turn: $("#turnLabel"),
  battlePanel: $("#battlePanel"),
  battlePlayerName: $("#battlePlayerName"),
  playerBattleBar: $("#playerBattleBar"),
  playerBattleValue: $("#playerBattleValue"),
  enemyBattleBar: $("#enemyBattleBar"),
  enemyBattleValue: $("#enemyBattleValue"),
  endingPanel: $("#endingPanel"),
  choicesPanel: $(".choices-panel"),
  playerPortrait: $("#playerPortrait"),
  playerName: $("#playerName"),
  playerIdentity: $("#playerIdentity"),
  characterStats: $("#characterStats"),
  truthState: $("#truthState"),
  suspicionText: $("#suspicionText"),
  knownNpcCount: $("#knownNpcCount"),
  relationList: $("#relationList"),
  stoneCount: $("#stoneCount"),
  inventoryList: $("#inventoryList"),
  clueCount: $("#clueCount"),
  clueList: $("#clueList"),
  eventCount: $("#eventCount"),
  eventLog: $("#eventLog"),
  pulseSection: $("#pulseSection"),
  pulseList: $("#pulseList"),
  newGameDialog: $("#newGameDialog"),
  newGameForm: $("#newGameForm"),
  profileName: $("#profileName"),
  profileGender: $("#profileGender"),
  profilePath: $("#profilePath"),
  profilePortrait: $("#profilePortrait"),
  rollTalent: $("#rollTalent"),
  rollTraits: $("#rollTraits"),
  rerollButton: $("#rerollButton"),
  continueButton: $("#continueButton"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  llmEnabled: $("#llmEnabled"),
  provider: $("#providerSelect"),
  baseUrl: $("#baseUrlInput"),
  model: $("#modelInput"),
  deepseekModel: $("#deepseekModelSelect"),
  deepseekModelField: $("#deepseekModelField"),
  customModelField: $("#customModelField"),
  apiKey: $("#apiKeyInput"),
  rememberKey: $("#rememberKeyInput"),
  testConnection: $("#testConnectionButton"),
  exportButton: $("#exportButton"),
  importButton: $("#importButton"),
  importFile: $("#importFile"),
  newGameButton: $("#newGameButton"),
  freeActionDialog: $("#freeActionDialog"),
  freeActionForm: $("#freeActionForm"),
  freeActionInput: $("#freeActionInput"),
  locationDialog: $("#locationDialog"),
  locationActions: $("#locationActions"),
  toast: $("#toast"),
};

let state = loadGame();
let llmConfig = loadLlmConfig();
let busy = false;
let adjudicating = false;
let rerollUsed = false;
let toastTimer = null;
let activeNarrationAbort = null;
let pendingHintTimer = null;
let requestTimeoutTimer = null;

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? validateImportedSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveGame({ snapshot = false } = {}) {
  if (!state) return;
  if (snapshot) {
    let snapshots = [];
    try {
      snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
    } catch {
      snapshots = [];
    }
    snapshots.unshift(state);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0, 3)));
  }
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle("is-error", isError);
  ui.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), 2800);
}

function textElement(tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function getFocusPerson(visible, focusId) {
  // 兼容未迁移的旧存档：两个哨兵值都视作主角
  if (!focusId || focusId === "shen" || focusId === PLAYER_FOCUS_ID) {
    return {
      id: PLAYER_FOCUS_ID,
      name: visible.player.name,
      role: "青崖宗外门弟子",
      portrait: visible.player.portrait,
      attitude: "沉静",
    };
  }
  const known = visible.knownNpcs.find((npc) => npc.id === focusId);
  if (known) return known;
  const npc = NPCS[focusId];
  if (npc?.known) return { ...npc, attitude: "中立" };
  return { id: "unknown", name: "？？？", role: "身份未知", portrait: null, attitude: "未知" };
}

function appendNarrationSegments(segments, visible) {
  for (const segment of segments) {
    const paragraph = textElement("p", segment.text, segment.type === "dialogue" ? "dialogue" : "");
    if (segment.type === "dialogue") {
      const speaker = visible.knownNpcs.find((npc) => npc.id === segment.speakerId);
      if (speaker) paragraph.prepend(textElement("strong", speaker.name));
    }
    ui.narrativeText.append(paragraph);
  }
}

function waitingStoryCopy(visible, slow = false) {
  if (slow) return "这一页迟迟未落定。你可以再等片刻，或先看简略记述。";
  const copyByLocation = {
    gate: "山门云雾未散，下一幕正从石阶上展开……",
    residence: "竹窗外风声未歇，故事正从灯影里续写……",
    training: "石坪上的余音尚在，后文渐渐浮现……",
    herbHill: "草木间灵息轻动，前路仍在雾中显形……",
    chores: "火盆噼啪作响，这一页尚未写尽……",
    alchemy: "炉火映着药烟，后文正缓缓显现……",
    archive: "雨铃掠过檐角，旧页之后又添新字……",
    arena: "朱线内剑风未歇，下一瞬仍悬在半空……",
  };
  return copyByLocation[visible.location.id] || "风声掠过山道，故事正从此处续写……";
}

function renderNarration(visible) {
  ui.narrativeText.replaceChildren();
  if (state.locationIntro) {
    ui.narrativeText.append(textElement("p", visible.location.description));
    return;
  }
  const last = state.lastOutcome;
  if (!last) {
    const intro = [
      "验灵石上，属于你的光只亮起细如发丝的一线。四周的少年有人移开目光，也有人没忍住笑出了声。",
      "周执事把一块没有刻名字的外门木牌放在案上：‘资质下下。若愿留下，月末复核之前，你只有一次证明自己的机会。’",
    ];
    intro.forEach((text) => ui.narrativeText.append(textElement("p", text)));
    return;
  }

  if (last.pending) {
    if (last.aiDraft?.length) {
      appendNarrationSegments(last.aiDraft, visible);
      const streaming = document.createElement("div");
      streaming.className = "ai-streaming-status";
      streaming.append(
        textElement("span", "", "ai-streaming-dot"),
        textElement("span", last.pendingSlow ? "墨迹未干，可再等片刻" : "后文渐显"),
      );
      const cancel = textElement("button", "先看简略记述", "stream-cancel-button");
      cancel.type = "button";
      cancel.addEventListener("click", () => activeNarrationAbort?.abort("user"));
      streaming.append(cancel);
      ui.narrativeText.append(streaming);
      return;
    }
    const pending = document.createElement("section");
    pending.className = "ai-pending";
    const seal = textElement("span", "演", "ai-pending-seal");
    seal.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.append(
      textElement("strong", "且听风声，再续此页"),
      textElement("p", waitingStoryCopy(visible, last.pendingSlow)),
    );
    const cancel = textElement("button", "先看简略记述", "cancel-ai-button");
    cancel.type = "button";
    cancel.addEventListener("click", () => activeNarrationAbort?.abort("user"));
    pending.append(seal, copy, cancel);
    ui.narrativeText.append(pending);
    return;
  }

  if (last.aiNarration?.length) {
    appendNarrationSegments(last.aiNarration, visible);
  } else {
    String(last.narration || "").split(/\n{2,}/).filter(Boolean).forEach((text) => ui.narrativeText.append(textElement("p", text)));
  }
}

function renderStory(visible) {
  const focusId = state.lastOutcome?.presentation?.focusCharacterId || state.lastOutcome?.focusCharacterId || state.focusCharacterId;
  const person = getFocusPerson(visible, focusId);
  ui.time.textContent = getDisplayTime(state);
  ui.location.textContent = visible.location.name;
  ui.turn.textContent = `第 ${state.turn} 回合`;
  ui.speakerName.textContent = person.name;
  ui.speakerRole.textContent = person.role;
  ui.speakerMood.textContent = person.attitude || "沉静";
  ui.sceneCard.dataset.initial = person.name.slice(0, 1);
  ui.sceneCard.classList.toggle("is-placeholder", !person.portrait);
  ui.scenePortrait.hidden = !person.portrait;
  if (person.portrait) {
    ui.scenePortrait.src = person.portrait;
    ui.scenePortrait.alt = `${person.name}立绘`;
  }

  renderNarration(visible);
  ui.effects.replaceChildren();
  for (const effect of state.lastOutcome?.publicEffects || []) ui.effects.append(textElement("span", effect));

  const battle = visible.battle;
  ui.battlePanel.hidden = !battle || Boolean(visible.stageEnding);
  if (battle && !visible.stageEnding) {
    const playerMaxHp = battle.playerMaxHp || 55;
    const enemyMaxHp = battle.enemyMaxHp || 60;
    ui.battlePlayerName.textContent = visible.player.name;
    ui.playerBattleBar.style.width = `${(battle.playerHp / playerMaxHp) * 100}%`;
    ui.enemyBattleBar.style.width = `${(battle.enemyHp / enemyMaxHp) * 100}%`;
    ui.playerBattleValue.textContent = `${battle.playerHp}/${playerMaxHp}`;
    ui.enemyBattleValue.textContent = `${battle.enemyHp}/${enemyMaxHp}`;
  }

  ui.endingPanel.hidden = !visible.stageEnding;
  ui.choicesPanel.hidden = false;
  if (visible.stageEnding) {
    ui.endingPanel.replaceChildren(
      textElement("span", `入门里程碑 · ${visible.stageEnding.grade}`, "ending-grade"),
      textElement("h2", visible.stageEnding.title),
      textElement("p", `天赋异常：${visible.stageEnding.truthTitle}`),
      textElement("p", visible.stageEnding.truthText),
      textElement("p", visible.stageEnding.summary),
      textElement("p", visible.stageEnding.nextHook, "ending-hook"),
      textElement("p", "游戏不会在这里结束。你仍可修炼、调查、交往与历练。", "ending-continuation"),
    );
  }

  renderActions();
}

function renderActions() {
  ui.actionList.replaceChildren();
  const actions = getAvailableActions(state);
  const { numberedActions, freeAction } = selectTurnChoices(actions);
  const contextualChoices = state.lastOutcome?.turnId === state.turn && Array.isArray(state.lastOutcome?.aiChoices)
    ? new Map(state.lastOutcome.aiChoices.map((choice) => [choice.actionId, choice.label]))
    : new Map();
  const primaryId = numberedActions.find((action) => action.id === "start_tournament")?.id || numberedActions[0]?.id;
  for (const [index, action] of numberedActions.entries()) {
    const displayedLabel = contextualChoices.get(action.id) || action.label;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.dataset.choiceIndex = String(index + 1);
    button.setAttribute("aria-keyshortcuts", String(index + 1));
    if (action.id === primaryId) button.classList.add("is-primary");
    button.disabled = busy || adjudicating;
    button.append(
      textElement("span", String(index + 1), "action-index"),
      textElement("span", displayedLabel, "action-label"),
      textElement("small", action.hint),
    );
    button.addEventListener("click", () => performAction(action.id, "", displayedLabel));
    ui.actionList.append(button);
  }

  const suggestions = llmConfig.enabled && state.lastOutcome?.turnId === state.turn
    ? state.lastOutcome.aiSuggestions || []
    : [];
  for (const text of suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button is-suggested";
    button.disabled = busy || adjudicating;
    button.append(textElement("span", text, "action-label"), textElement("small", "模型建议 · 由系统裁决可行性"));
    button.addEventListener("click", () => performFreeAction(text));
    ui.actionList.append(button);
  }

  if (freeAction && llmConfig.enabled) {
    const freeButton = document.createElement("button");
    freeButton.type = "button";
    freeButton.className = "action-button is-free";
    freeButton.disabled = busy || adjudicating;
    freeButton.append(textElement("span", freeAction.label), textElement("small", freeAction.hint));
    freeButton.addEventListener("click", () => {
      ui.freeActionInput.value = "";
      ui.freeActionDialog.showModal();
    });
    ui.actionList.append(freeButton);
  }
}

function renderCharacter(visible) {
  ui.playerPortrait.src = visible.player.portrait;
  ui.playerName.textContent = visible.player.name;
  ui.playerIdentity.textContent = `${visible.player.race} · ${visible.player.mainPath} · 青崖宗外门弟子`;
  ui.characterStats.replaceChildren();

  const cultivation = document.createElement("section");
  cultivation.className = "stat-card";
  const header = document.createElement("header");
  header.append(textElement("span", "境界"), textElement("strong", visible.player.realm));
  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("i");
  bar.style.width = `${(visible.player.cultivation / visible.player.cultivationMax) * 100}%`;
  progress.append(bar);
  cultivation.append(header, progress, textElement("small", `修为 ${visible.player.cultivation} / ${visible.player.cultivationMax}`));

  const stats = document.createElement("section");
  stats.className = "stat-grid";
  const entries = [
    ["灵气", `${visible.player.qi}/${visible.player.qiMax}`],
    ["体力", `${visible.player.stamina}/${visible.player.staminaMax}`],
    ["根基", visible.player.foundation],
    ["疲劳", visible.player.fatigue],
    ["可见天赋", visible.player.visibleTalent],
    ["真实天赋", visible.truth.realTalent ?? "？？？"],
    ["善恶", visible.player.morality],
    ["声望", visible.player.reputation],
  ];
  for (const [label, value] of entries) {
    const item = document.createElement("div");
    item.append(textElement("small", label), textElement("strong", String(value)));
    stats.append(item);
  }
  ui.characterStats.append(cultivation, stats);
  ui.truthState.textContent = visible.truth.resolved ? `${visible.truth.title} · 已处理` : visible.truth.title;
  ui.suspicionText.textContent = visible.truth.title === "？？？"
    ? visible.suspicions.at(-1) || visible.chapterObjective
    : `${visible.truth.text} 当前目标：${visible.chapterObjective}`;
}

function renderRelations(visible) {
  ui.knownNpcCount.textContent = `已认识 ${visible.knownNpcs.length} 人`;
  ui.relationList.replaceChildren();
  for (const npc of visible.knownNpcs) {
    const row = document.createElement("article");
    row.className = "relation-row";
    const avatar = document.createElement("span");
    avatar.className = "relation-avatar";
    if (npc.portrait) {
      const image = document.createElement("img");
      image.src = npc.portrait;
      image.alt = "";
      avatar.append(image);
    } else {
      avatar.textContent = npc.name.slice(0, 1);
    }
    const main = document.createElement("span");
    main.className = "relation-main";
    main.append(
      textElement("strong", npc.name),
      textElement("small", `${npc.role} · ${npc.personality.join("、")}`),
      textElement("small", npc.notes.at(-1) || `近况：${npc.goal}`, "relation-note"),
    );
    row.append(avatar, main, textElement("em", npc.attitude, "relation-stage"));
    ui.relationList.append(row);
  }
}

function renderInventory(visible) {
  ui.stoneCount.textContent = `下品灵石 ${visible.player.spiritStones}`;
  ui.inventoryList.replaceChildren();
  if (!visible.inventory.length) ui.inventoryList.append(textElement("p", "行囊还是空的。", "empty-state"));
  for (const item of visible.inventory) {
    const row = document.createElement("article");
    row.className = "inventory-row";
    row.append(textElement("span", item.type === "manual" ? "诀" : item.type === "material" ? "草" : "药", "item-icon"));
    const main = document.createElement("span");
    main.className = "item-main";
    main.append(textElement("strong", item.name), textElement("small", item.description));
    row.append(main, textElement("em", `×${item.count}`, "item-count"));
    ui.inventoryList.append(row);
  }

  ui.clueCount.textContent = `${visible.clues.length} 条`;
  ui.clueList.replaceChildren();
  if (!visible.clues.length) ui.clueList.append(textElement("p", "尚未获得可靠线索。", "empty-state"));
  for (const clue of visible.clues) {
    const row = document.createElement("article");
    row.className = "clue-row";
    const main = document.createElement("div");
    main.append(textElement("strong", clue.title), textElement("p", clue.text));
    row.append(main);
    ui.clueList.append(row);
  }
}

function narrationTextForEventLog(narration, visible) {
  return narration
    .map((segment) => {
      if (segment.type !== "dialogue") return segment.text;
      const speaker = visible.knownNpcs.find((npc) => npc.id === segment.speakerId);
      return speaker ? `${speaker.name}：“${segment.text}”` : segment.text;
    })
    .join("\n\n")
    .slice(0, 1600);
}

function syncAiNarrationToEventLog(targetState, narration, turnId) {
  if (!Array.isArray(narration) || !narration.length) return false;
  const entry = targetState.eventLog.find((event) => event.kind === "turn" && event.turn === turnId);
  if (!entry) return false;
  const nextText = narrationTextForEventLog(narration, getVisibleState(targetState));
  if (entry.text === nextText && entry.source === "ai") return false;
  entry.text = nextText;
  entry.source = "ai";
  return true;
}

function rememberAiDialogue(targetState, narration, turnId) {
  if (!Array.isArray(narration) || !narration.length) return;
  targetState.dialogueMemory ||= [];
  targetState.dialogueMemory.push({
    turn: turnId,
    location: getVisibleState(targetState).location.name,
    speakers: [...new Set(narration.filter((segment) => segment.type === "dialogue").map((segment) => segment.speakerId))],
    text: narrationTextForEventLog(narration, getVisibleState(targetState)).slice(0, 1200),
  });
  targetState.dialogueMemory = targetState.dialogueMemory.slice(-3);
}

function renderLog(visible) {
  ui.eventCount.textContent = `${visible.eventLog.length} 条记录`;
  ui.pulseSection.hidden = !visible.worldPulse?.length;
  ui.pulseList.replaceChildren();
  for (const pulse of visible.worldPulse || []) {
    const row = document.createElement("article");
    row.className = "pulse-row";
    row.append(textElement("time", `第${pulse.day}日`), textElement("p", pulse.text));
    ui.pulseList.append(row);
  }
  ui.eventLog.replaceChildren();
  for (const event of visible.eventLog) {
    const item = document.createElement("li");
    const awaitingAi = state.lastOutcome?.pending && event.kind === "turn" && event.turn === state.lastOutcome.turnId;
    const sourceLabels = { ai: "AI叙事", local: "本地叙事", system: event.kind === "clue" ? "系统线索" : "系统事件" };
    const meta = document.createElement("div");
    meta.className = "timeline-meta";
    meta.append(
      textElement("time", `第${event.day}日 · 第${event.turn}回合`),
      textElement("span", awaitingAi ? "本页续写中" : sourceLabels[event.source] || "事件记录", "timeline-source"),
    );
    item.append(
      meta,
      textElement("strong", event.title),
      textElement("p", awaitingAi ? "这一页仍在续写，落笔后会自动收入事件簿。" : event.text),
    );
    ui.eventLog.append(item);
  }
}

function renderLocations() {
  ui.locationActions.replaceChildren();
  const destinations = state.phase === "explore" ? getMoveDestinations(state) : [];
  const tournament = getAvailableActions(state).find((action) => action.id === "start_tournament");
  if (!destinations.length && !tournament) {
    ui.locationActions.append(textElement("p", "当前无法离开这里。", "empty-state"));
  }
  for (const destination of destinations) {
    const button = document.createElement("button");
    button.type = "button";
    button.append(textElement("span", destination.name), textElement("small", destination.description));
    button.addEventListener("click", () => {
      ui.locationDialog.close();
      performMove(destination.id);
    });
    ui.locationActions.append(button);
  }
  if (tournament) {
    const button = document.createElement("button");
    button.type = "button";
    button.append(textElement("span", LOCATIONS.arena.name), textElement("small", tournament.hint));
    button.addEventListener("click", () => {
      ui.locationDialog.close();
      performAction("start_tournament");
    });
    ui.locationActions.append(button);
  }
}

function renderAll() {
  if (!state) return;
  const visible = getVisibleState(state);
  ui.aiStatus.textContent = llmConfig.enabled ? `AI · ${llmConfig.model || "未配置"}` : "本地叙事";
  ui.aiStatus.classList.toggle("is-on", llmConfig.enabled);
  renderStory(visible);
  renderCharacter(visible);
  renderRelations(visible);
  renderInventory(visible);
  renderLog(visible);
}

async function performAction(actionId, freeText = "", choiceLabel = "", adjudication = null) {
  if (busy || !state) return;
  busy = true;
  ui.llmWarning.hidden = true;
  ui.narrativePanel.classList.add("is-thinking");
  ui.narrativePanel.setAttribute("aria-busy", "true");
  renderActions();
  const previousState = state;
  try {
    const { state: nextState, outcome } = resolveAction(state, actionId, { expectedTurn: state.turn, freeText, choiceLabel, adjudication });
    if (!outcome) return;
    saveGame({ snapshot: true });
    state = nextState;
    state.lastOutcome = { ...outcome, pending: Boolean(llmConfig.enabled), pendingSlow: false, aiDraft: [] };
    saveGame();
    renderAll();

    if (llmConfig.enabled) {
      activeNarrationAbort = new AbortController();
      pendingHintTimer = setTimeout(() => {
        if (state.lastOutcome?.pending) {
          state.lastOutcome.pendingSlow = true;
          renderNarration(getVisibleState(state));
        }
      }, 8000);
      requestTimeoutTimer = setTimeout(() => activeNarrationAbort?.abort("timeout"), 60000);
      try {
        const visible = getVisibleState(state);
        const nextChoices = selectTurnChoices(getAvailableActions(state)).numberedActions;
        const ai = await requestAiNarration({
          config: llmConfig,
          visibleState: visible,
          outcome,
          availableActions: nextChoices,
          // 江湖动态搭「结束今日」那次已有的叙事调用，不额外发请求。
          includeWorldPulse: actionId === "end_day",
          signal: activeNarrationAbort.signal,
          onProgress: (draft) => {
            if (state.lastOutcome?.turnId !== outcome.turnId || !state.lastOutcome.pending) return;
            state.lastOutcome.aiDraft = draft;
            renderNarration(getVisibleState(state));
          },
        });
        if (ai) {
          state.lastOutcome.aiNarration = ai.narration;
          // choices 降级为 null 时不覆盖，renderActions 自然回退到程序文案
          if (ai.choices) state.lastOutcome.aiChoices = ai.choices;
          state.lastOutcome.aiSuggestions = ai.suggestions || [];
          if (ai.worldEvents?.length) {
            const withPulse = applyWorldEvents(state, ai.worldEvents);
            withPulse.lastOutcome = state.lastOutcome;
            state = withPulse;
          }
          state.lastOutcome.presentation = ai.presentation;
          syncAiNarrationToEventLog(state, ai.narration, outcome.turnId);
          rememberAiDialogue(state, ai.narration, outcome.turnId);
        }
      } catch (error) {
        const reason = activeNarrationAbort?.signal.reason;
        if (reason === "user") ui.llmWarning.textContent = "已停下续写，本回合先采用简略记述。";
        else if (reason === "timeout") ui.llmWarning.textContent = "AI等待超过60秒，本回合已自动改用本地叙事。";
        else ui.llmWarning.textContent = `AI叙事未完成，已使用本地结果：${error.message}`;
        ui.llmWarning.hidden = false;
      } finally {
        state.lastOutcome.pending = false;
        state.lastOutcome.pendingSlow = false;
        delete state.lastOutcome.aiDraft;
        clearTimeout(pendingHintTimer);
        clearTimeout(requestTimeoutTimer);
        pendingHintTimer = null;
        requestTimeoutTimer = null;
        activeNarrationAbort = null;
      }
    }
    saveGame();
  } catch (error) {
    state = previousState;
    showToast(error.message, true);
  } finally {
    busy = false;
    ui.narrativePanel.classList.remove("is-thinking");
    ui.narrativePanel.setAttribute("aria-busy", "false");
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function performFreeAction(freeText) {
  if (busy || adjudicating || !state || !llmConfig.enabled) return;
  adjudicating = true;
  ui.llmWarning.hidden = true;
  ui.narrativePanel.classList.add("is-thinking");
  renderActions();

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort("timeout"), 60000);
  let resolved = null;
  // 裁决是异步的，期间局面若被改动，这份裁决就是对着旧世界做出的。
  // 上面的 adjudicating 标志已挡住已知入口，这里再做一次事后校验兜底。
  const turnAtStart = state.turn;
  const locationAtStart = state.locationId;
  try {
    const allowedActionIds = getAvailableActions(state)
      .filter((action) => !action.freeInput)
      .map((action) => action.id);
    const adjudication = await requestAdjudication({
      config: llmConfig,
      visibleState: getVisibleState(state),
      freeText,
      allowedActionIds,
      signal: abort.signal,
    });

    if (state.turn !== turnAtStart || state.locationId !== locationAtStart) {
      ui.llmWarning.textContent = "裁决期间局面已经变化，这次输入没有生效，可以重新输入。";
      ui.llmWarning.hidden = false;
      return;
    }

    if (!adjudication.feasible) {
      const nearest = adjudication.nearestActionId
        ? getAvailableActions(state).find((action) => action.id === adjudication.nearestActionId)
        : null;
      ui.llmWarning.textContent = nearest
        ? `${adjudication.reason}（也许可以试试：${nearest.label}）`
        : adjudication.reason;
      ui.llmWarning.hidden = false;
      return;
    }

    const rolled = rollOutcome(state, adjudication.difficulty);
    const finalDeltas = rolled === "success"
      ? adjudication.deltas
      : rolled === "partial"
        ? halvePositive(adjudication.deltas)
        : adjudication.failureDeltas.length
          ? adjudication.failureDeltas
          : [{ kind: "player", field: "stamina", value: -6, path: "player.stamina" }];
    resolved = { ...adjudication, outcome: rolled, deltas: finalDeltas };
  } catch (error) {
    ui.llmWarning.textContent = abort.signal.reason === "timeout"
      ? "裁决等待超过60秒，本次输入未生效，可以再试一次。"
      : `裁决未完成，本次输入未生效：${error.message}`;
    ui.llmWarning.hidden = false;
  } finally {
    clearTimeout(timeout);
    adjudicating = false;
    ui.narrativePanel.classList.remove("is-thinking");
    if (!resolved) renderAll();
  }

  if (resolved) await performAction("free_action", freeText, "", resolved);
}

function performMove(locationId) {
  // 裁决期间也要挡住：移动虽不产生回合，却会改变地点，
  // 使正在进行的裁决所依据的可选行动与在场人物失效。
  if (busy || adjudicating || !state) return;
  try {
    state = moveTo(state, locationId);
    saveGame();
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    showToast(error.message, true);
  }
}

function switchView(view) {
  $$(".app-view").forEach((element) => element.classList.toggle("is-active", element.dataset.view === view));
  $$("[data-view-target]").forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fillSettings() {
  ui.llmEnabled.checked = llmConfig.enabled;
  ui.provider.value = llmConfig.provider;
  ui.baseUrl.value = llmConfig.baseUrl;
  ui.deepseekModel.value = DEEPSEEK_MODELS.includes(llmConfig.model) ? llmConfig.model : DEFAULT_LLM_CONFIG.model;
  ui.model.value = llmConfig.provider === "custom" ? llmConfig.model : "";
  ui.apiKey.value = llmConfig.apiKey;
  ui.rememberKey.checked = llmConfig.rememberKey;
  syncProviderFields();
}

function syncProviderFields() {
  const isDeepSeek = ui.provider.value === "deepseek";
  ui.deepseekModelField.hidden = !isDeepSeek;
  ui.customModelField.hidden = isDeepSeek;
}

function collectSettings() {
  return {
    enabled: ui.llmEnabled.checked,
    provider: ui.provider.value,
    baseUrl: ui.baseUrl.value.trim(),
    model: ui.provider.value === "deepseek" ? ui.deepseekModel.value : ui.model.value.trim(),
    apiKey: ui.apiKey.value.trim(),
    rememberKey: ui.rememberKey.checked,
  };
}

function exportSave() {
  if (!state) return;
  const safe = structuredClone(state);
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `废柴修仙模拟器-${state.player.name}-第${state.day}日.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("存档已导出，文件中不包含 API Key。 ");
}

function resetStartForm() {
  rerollUsed = false;
  ui.rerollButton.disabled = false;
  ui.rollTalent.textContent = "12";
  ui.rollTraits.textContent = "隐忍、执拗";
}

function showStartDialog() {
  resetStartForm();
  ui.continueButton.hidden = !state;
  if (!ui.newGameDialog.open) ui.newGameDialog.showModal();
}

$$(`[data-view-target]`).forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewTarget)));

document.addEventListener("keydown", (event) => {
  if (busy || adjudicating || !state || ui.choicesPanel.hidden || document.querySelector("dialog[open]")) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !/^[1-4]$/.test(event.key)) return;
  if (event.target instanceof Element && event.target.matches("input, textarea, select, button, [contenteditable='true']")) return;
  const choice = ui.actionList.querySelector(`[data-choice-index="${event.key}"]`);
  if (!choice || choice.disabled) return;
  event.preventDefault();
  choice.click();
});

ui.settingsButton.addEventListener("click", () => {
  fillSettings();
  ui.settingsDialog.showModal();
});

ui.locationButton.addEventListener("click", () => {
  if (!state) return;
  renderLocations();
  ui.locationDialog.showModal();
});

ui.newGameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const profile = {
    name: ui.profileName.value.trim() || "沈砚",
    gender: ui.profileGender.value,
    mainPath: ui.profilePath.value,
    portrait: ui.profilePortrait.value,
    visibleTalent: Number(ui.rollTalent.textContent),
    traits: ui.rollTraits.textContent.split("、"),
  };
  state = createNewGame({ profile });
  state.lastOutcome = null;
  saveGame();
  ui.newGameDialog.close();
  switchView("story");
  renderAll();
  showToast("新游戏已建立。世界真相已经确定，但不会提前向你公开。 ");
});

ui.continueButton.addEventListener("click", () => {
  ui.newGameDialog.close();
  renderAll();
});

ui.rerollButton.addEventListener("click", () => {
  if (rerollUsed) return;
  const traitPairs = [["谨慎", "坚韧"], ["豁达", "好胜"], ["寡言", "敏锐"], ["温和", "执拗"]];
  const pair = traitPairs[Math.floor(Math.random() * traitPairs.length)];
  ui.rollTalent.textContent = String(8 + Math.floor(Math.random() * 11));
  ui.rollTraits.textContent = pair.join("、");
  rerollUsed = true;
  ui.rerollButton.disabled = true;
});

ui.profileGender.addEventListener("change", () => {
  if (ui.profileGender.value === "女") ui.profilePortrait.value = "assets/portraits/player-female.jpg";
  else if (ui.profileGender.value === "男") ui.profilePortrait.value = "assets/portraits/shen-yan.jpg";
});

ui.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  llmConfig = saveLlmConfig(collectSettings());
  ui.settingsDialog.close();
  renderAll();
  showToast(llmConfig.enabled ? "AI叙事设置已保存。 " : "已切换为本地叙事。 ");
});

ui.provider.addEventListener("change", () => {
  syncProviderFields();
  if (ui.provider.value === "deepseek") {
    ui.baseUrl.value = DEFAULT_LLM_CONFIG.baseUrl;
    if (!DEEPSEEK_MODELS.includes(ui.deepseekModel.value)) ui.deepseekModel.value = DEFAULT_LLM_CONFIG.model;
  }
});

ui.testConnection.addEventListener("click", async () => {
  ui.testConnection.disabled = true;
  ui.testConnection.textContent = "连接中…";
  try {
    await testLlmConnection(collectSettings());
    showToast("连接成功。 ");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    ui.testConnection.disabled = false;
    ui.testConnection.textContent = "测试连接";
  }
});

ui.freeActionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = ui.freeActionInput.value.trim();
  if (!text) return;
  ui.freeActionDialog.close();
  performFreeAction(text);
});

ui.exportButton.addEventListener("click", exportSave);
ui.importButton.addEventListener("click", () => ui.importFile.click());
ui.importFile.addEventListener("change", async () => {
  const file = ui.importFile.files?.[0];
  if (!file) return;
  try {
    const imported = validateImportedSave(JSON.parse(await file.text()));
    state = imported;
    saveGame({ snapshot: true });
    ui.settingsDialog.close();
    renderAll();
    showToast("存档导入成功。 ");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    ui.importFile.value = "";
  }
});

ui.newGameButton.addEventListener("click", () => {
  if (!confirm("重新开始会覆盖当前自动存档。你可以先导出存档；最近三个回合仍保留在本机回滚快照中。确定继续吗？")) return;
  ui.settingsDialog.close();
  state = null;
  showStartDialog();
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

let recoveredPendingNarration = false;
let recoveredAiEventLog = false;
if (state?.lastOutcome?.pending) {
  state.lastOutcome.pending = false;
  state.lastOutcome.pendingSlow = false;
  delete state.lastOutcome.aiDraft;
  recoveredPendingNarration = true;
  saveGame();
}
if (state?.lastOutcome?.aiNarration?.length) {
  recoveredAiEventLog = syncAiNarrationToEventLog(state, state.lastOutcome.aiNarration, state.lastOutcome.turnId);
  if (recoveredAiEventLog) saveGame();
}

if (state) {
  renderAll();
  showStartDialog();
} else {
  showStartDialog();
}

if (recoveredPendingNarration) {
  ui.llmWarning.textContent = "上次等待在页面关闭时中断，已恢复为本地叙事，回合结算没有重复。";
  ui.llmWarning.hidden = false;
}
