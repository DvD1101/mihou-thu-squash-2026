import {
  GROUP_BY_KEY,
  GROUP_DEFS,
  addAudit,
  canonicalGroupKey,
  createDemoState,
  createEmptyState,
  createPlayer,
  findUnitByDepartment,
  normalizeText,
  playerName,
  playerUnitName,
  recomputePlayerUnits,
  validateRoster
} from "./model.js";
import {
  EngineError,
  batchDeletePlayers,
  batchSetSeeds,
  calculateTeamStandings,
  canCreateNewbieKnockout,
  clearMatchesForGroup,
  confirmDraw,
  createNewbieKnockout,
  generateAdvancedPreview,
  generateGroupDraw,
  getDependenciesForMatch,
  getGroupStandings,
  getImpactOfResultChange,
  getMatchPlayers,
  getPlacementRows,
  resolveGroupTie,
  setMatchWinner,
  swapAdvancedPreviewPlayers,
  swapGroupPlayers,
  undoMatchResult,
  validateAdvancedSeeds
} from "./engine.js";
import {
  autoSchedule,
  getStats,
  isoFromEventMinute,
  markMatchLive,
  minutesFromTime,
  updateMatchSchedule,
  validateSchedule
} from "./schedule.js";
import {
  createWorkbook,
  downloadBytes,
  downloadText,
  downloadWorkbook,
  parseRosterWorkbook
} from "./xlsx.js";
import { renderApp, renderModal } from "./ui.js";

const root = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
const toastRoot = document.querySelector("#toast-root");
const appBasePath = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const relativeLocationPath = (() => {
  if (!appBasePath) return window.location.pathname;
  return window.location.pathname.startsWith(appBasePath)
    ? window.location.pathname.slice(appBasePath.length) || "/"
    : window.location.pathname;
})();
const routeParts = relativeLocationPath.split("/").filter(Boolean);
const routeRole = routeParts[0] === "admin" ? "admin" : "viewer";
const routeToken = routeRole === "admin" ? decodeURIComponent(routeParts[1] ?? "") : "";
const apiBase = `${appBasePath}/api`;

let state;
let role = routeRole;
let adminPath = null;
let view = ["dashboard", "draw", "groups", "bracket", "schedule", "teams", "players", "settings"].includes(
  window.location.hash.slice(1)
)
  ? window.location.hash.slice(1)
  : "dashboard";
let selectedGroup =
  new URLSearchParams(window.location.search).get("group") &&
  GROUP_BY_KEY[new URLSearchParams(window.location.search).get("group")]
    ? new URLSearchParams(window.location.search).get("group")
    : "new_men";
let network = navigator.onLine ? "online" : "offline";
let saving = false;
let modal = null;
let pendingConfirm = null;
let eventSource = null;
let transport = "sse";
let pollIntervalMs = 5000;
let pollTimer = null;
let toastTimer = null;
let refreshInFlight = false;

function renderAll() {
  renderApp({
    root,
    state,
    role,
    view,
    selectedGroup,
    network,
    saving,
    adminPath
  });
  modalRoot.innerHTML = renderModal(modal, state, role);
  if (modal) {
    const focusTarget = modalRoot.querySelector("input:not([type=hidden]), select, textarea, button");
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 0);
  }
  updateBulkSelectionUi();
}

function getSelectedPlayerIds() {
  return [...document.querySelectorAll("input[data-bulk-player]:checked")].map(
    (input) => input.dataset.bulkPlayer
  );
}

function updateBulkSelectionUi() {
  const checkboxes = [...document.querySelectorAll("input[data-bulk-player]")];
  const selectAll = document.querySelector("input[data-bulk-select-all]");
  if (!selectAll) return;
  const selectedCount = checkboxes.filter((input) => input.checked).length;
  const countLabel = document.querySelector("[data-bulk-count]");
  if (countLabel) countLabel.textContent = `已选择 ${selectedCount} 人`;
  selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  for (const button of document.querySelectorAll(
    '[data-action="batch-seed"], [data-action="batch-delete"]'
  )) {
    button.disabled = selectedCount === 0;
  }
}

function toast(message, tone = "info", duration = 4200) {
  clearTimeout(toastTimer);
  toastRoot.innerHTML = `<div class="toast ${tone}">${String(message).replaceAll("\n", "<br>")}</div>`;
  toastTimer = setTimeout(() => {
    toastRoot.innerHTML = "";
  }, duration);
}

function setView(nextView) {
  view = nextView;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${view}`);
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setGroup(groupKey) {
  if (!GROUP_BY_KEY[groupKey]) return;
  selectedGroup = groupKey;
  const url = new URL(window.location.href);
  url.searchParams.set("group", groupKey);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  renderAll();
}

function showGenericConfirm({
  title,
  subtitle = "",
  heading,
  message,
  list = [],
  confirmLabel = "确认",
  tone = "warning"
}, callback) {
  pendingConfirm = callback;
  modal = {
    type: "generic",
    data: { title, subtitle, heading, message, list, confirmLabel, tone }
  };
  renderAll();
}

function authHeaders() {
  return {
    Authorization: `Bearer ${routeToken}`
  };
}

async function loadState({ initial = false } = {}) {
  if (!navigator.onLine) {
    network = "offline";
    if (!initial) renderAll();
    return;
  }
  try {
    const query = role === "admin" ? `?token=${encodeURIComponent(routeToken)}` : "";
    const response = await fetch(`${apiBase}/state${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "无法载入赛事数据。");
    state = body.state;
    role = body.role;
    adminPath = body.adminPath;
    transport = body.transport ?? "sse";
    pollIntervalMs = Number(body.pollIntervalMs) || 5000;
    network = "online";
    if (!["dashboard", "draw", "groups", "bracket", "schedule", "teams", "players", "settings"].includes(view)) {
      view = "dashboard";
    }
    if (role !== "admin" && ["players", "settings"].includes(view)) view = "dashboard";
    renderAll();
    connectEvents();
  } catch (error) {
    network = "offline";
    root.innerHTML = `
      <main class="page">
        <section class="card" style="margin-top:10vh">
          <div class="empty-state">
            <div class="empty-mark">!</div>
            <h3>无法打开赛事页面</h3>
            <p>${escapeClient(error.message)}<br>管理员链接无效、服务暂时不可用，或网络连接中断时会出现此提示。</p>
            <button class="button primary" data-action="reload">重新载入</button>
          </div>
        </section>
      </main>`;
  }
}

function escapeClient(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function connectEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  clearTimeout(pollTimer);
  pollTimer = null;
  if (transport === "poll") {
    schedulePoll();
    return;
  }
  if (typeof EventSource === "undefined") return;
  eventSource = new EventSource(`${apiBase}/events`);
  eventSource.addEventListener("revision", async (event) => {
    const data = JSON.parse(event.data);
    network = "online";
    if (Number(data.version) === Number(state.meta.version) || saving || refreshInFlight) return;
    await refreshState();
  });
  eventSource.onerror = () => {
    network = "offline";
    renderAll();
  };
  eventSource.onopen = async () => {
    if (network !== "online") {
      network = "online";
      await refreshState();
    }
  };
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (transport !== "poll") return;
  pollTimer = setTimeout(async () => {
    if (!document.hidden && !saving && !refreshInFlight) await refreshState();
    schedulePoll();
  }, pollIntervalMs);
}

async function refreshState() {
  if (refreshInFlight || !navigator.onLine) return;
  refreshInFlight = true;
  try {
    const query = role === "admin" ? `?token=${encodeURIComponent(routeToken)}` : "";
    const response = await fetch(`${apiBase}/state${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "同步失败。");
    const changed =
      body.state.meta.version !== state.meta.version ||
      body.role !== role ||
      network !== "online";
    state = body.state;
    role = body.role;
    network = "online";
    if (changed) renderAll();
  } catch {
    network = "offline";
    renderAll();
  } finally {
    refreshInFlight = false;
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchAdminStateAtLeast(minimumVersion, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(
        `${apiBase}/state?token=${encodeURIComponent(routeToken)}&_sync=${Date.now()}`,
        { cache: "no-store", headers: { "Cache-Control": "no-cache" } }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "无法读取最新赛事数据。");
      if (Number(body.state.meta.version) >= Number(minimumVersion)) return body.state;
      lastError = new Error("云端数据仍在同步，请稍候。");
    } catch (error) {
      lastError = error;
    }
    await wait(250 * (attempt + 1));
  }
  throw lastError ?? new Error("云端数据同步超时，请稍后重试。");
}

async function commit(mutator, { closeModal = true, success = "已保存" } = {}) {
  if (role !== "admin") {
    toast("观众链接没有编辑权限。", "error");
    return false;
  }
  if (saving) {
    toast("上一项操作正在保存，请稍候。", "error");
    return false;
  }
  if (!navigator.onLine) {
    toast("网络已中断，无法保存。请恢复网络后重新操作。", "error");
    return false;
  }
  let baseVersion = Number(state.meta.version);
  let draft = structuredClone(state);
  let result;
  try {
    result = await mutator(draft);
  } catch (error) {
    handleEngineError(error);
    return false;
  }
  saving = true;
  renderAll();
  try {
    let merged = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${apiBase}/state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders()
        },
        body: JSON.stringify({
          expectedVersion: baseVersion,
          state: draft
        })
      });
      const body = await response.json();
      if (response.ok) {
        state = body.state;
        role = "admin";
        network = "online";
        if (closeModal) modal = null;
        toast(merged ? "数据已自动合并并保存" : success, "success");
        return result ?? true;
      }
      if (response.status !== 409) {
        throw new Error(body.error || "服务器未确认保存。");
      }

      const serverVersion = Number(body.currentVersion);
      if (!Number.isFinite(serverVersion) || serverVersion <= baseVersion) {
        await wait(300 * (attempt + 1));
        continue;
      }

      const latest = await fetchAdminStateAtLeast(serverVersion);
      state = latest;
      baseVersion = Number(latest.meta.version);
      draft = structuredClone(latest);
      try {
        result = await mutator(draft);
      } catch (error) {
        handleEngineError(error);
        return false;
      }
      merged = true;
      renderAll();
    }
    await refreshState();
    throw new Error("云端数据连续冲突，页面已同步；请确认最新状态后再操作。");
  } catch (error) {
    network = navigator.onLine ? "online" : "offline";
    toast(`保存失败：${error.message}`, "error", 6500);
    return false;
  } finally {
    saving = false;
    renderAll();
  }
}

function handleEngineError(error) {
  if (error instanceof EngineError) {
    const details = error.details ?? {};
    if (details.requiresCascade) {
      toast(`${error.message}\n受影响比赛：${(details.impactedCodes ?? []).join("、")}`, "error", 7000);
    } else {
      toast(error.message, "error", 6000);
    }
    return;
  }
  toast(error?.message || "操作失败。", "error", 6000);
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function rerollDraw(groupKey) {
  const existing = state.matches.filter((match) => match.group === groupKey);
  const hasResults = existing.some((match) => match.winnerId);
  if (existing.length) {
    showGenericConfirm(
      {
        title: "重新抽签将清除本组赛程",
        heading: hasResults ? "该组已有比赛结果" : "该组已有已锁定赛程",
        message: hasResults
          ? "重新抽签会清除本组全部结果、签表和排场。请确认这是正式赛事开始前的修正，并已通知相关人员。"
          : "重新抽签会清除当前已生成的对阵和排场，再生成新的预览。",
        list: [`当前本组比赛：${existing.length} 场`, `已录入结果：${existing.filter((match) => match.winnerId).length} 场`],
        confirmLabel: "确认清除并重抽",
        tone: "danger"
      },
      async () => {
        await commit((draft) => {
          clearMatchesForGroup(draft, groupKey);
          const group = GROUP_BY_KEY[groupKey];
          if (group.level === "new") generateGroupDraw(draft, groupKey);
          else generateAdvancedPreview(draft, groupKey);
        }, { success: "新抽签预览已生成" });
      }
    );
    return;
  }
  await commit((draft) => {
    const group = GROUP_BY_KEY[groupKey];
    if (group.level === "new") generateGroupDraw(draft, groupKey);
    else generateAdvancedPreview(draft, groupKey);
  }, { success: "抽签预览已生成" });
}

function localInputToIso(stateValue, time) {
  const minute = minutesFromTime(time);
  return isoFromEventMinute(stateValue, minute);
}

async function submitModal(form) {
  if (!modal) return;
  const values = formValues(form);
  const type = form.dataset.modalType;

  if (type === "undo") {
    const matchId = modal.data.matchId;
    const impact = getImpactOfResultChange(state, matchId).filter((entry) => entry.id !== matchId);
    await commit(
      (draft) =>
        undoMatchResult(draft, matchId, {
          cascade: impact.length > 0,
          reason: values.reason
        }),
      { success: "比赛结果已撤销，相关下游结果已按依赖顺序清理" }
    );
    return;
  }

  if (type === "tie") {
    const standings = getGroupStandings(state, modal.data.groupKey, modal.data.groupId);
    const pending = standings.rows.filter((row) => row.tiePending);
    const tieSignature = pending[0]?.tieSignature;
    const tied = pending.filter((row) => row.tieSignature === tieSignature);
    const order = tied.map((_, index) => values[`order${index}`]).filter(Boolean);
    if (new Set(order).size !== tied.length) {
      toast("裁决顺序中有重复选手，请重新选择。", "error");
      return;
    }
    await commit(
      (draft) =>
        resolveGroupTie(
          draft,
          modal.data.groupKey,
          modal.data.groupId,
          order,
          values.reason
        ),
      { success: "人工裁决已保存" }
    );
    return;
  }

  if (type === "swap-draw") {
    const groupKey = form.dataset.group;
    if (!values.playerA || !values.playerB || values.playerA === values.playerB) {
      toast("请选择两名不同选手。", "error");
      return;
    }
    await commit((draft) => {
      if (GROUP_BY_KEY[groupKey].level === "new") {
        swapGroupPlayers(draft, groupKey, values.playerA, values.playerB);
      } else {
        swapAdvancedPreviewPlayers(draft, groupKey, values.playerA, values.playerB);
      }
    }, { success: "签位交换已保存" });
    return;
  }

  if (type === "player") {
    const playerId = form.dataset.player;
    const isAdvanced = GROUP_BY_KEY[values.group]?.level === "advanced";
    await commit((draft) => {
      const existing = playerId
        ? draft.players.find((player) => player.id === playerId)
        : null;
      if (
        existing &&
        draft.matches.some((match) =>
          getMatchPlayers(draft, match).some((player) => player?.id === existing.id)
        )
      ) {
        if (existing.group !== values.group) {
          throw new EngineError("该选手已经进入签表，不能直接更改组别。请先重新抽签清空该组赛程。");
        }
      }
      if (!existing && draft.draws[values.group]?.status === "locked") {
        throw new EngineError("该组抽签已锁定，不能直接增加选手。请先重新抽签。");
      }
      const department = values.department.trim();
      const selectedUnit = draft.units.find((unit) => unit.id === values.unitId);
      const mappedUnit = selectedUnit ?? findUnitByDepartment(department, draft.units);
      const payload = {
        name: values.name.trim(),
        department,
        group: values.group,
        alumni: values.alumni === "on",
        seed: Boolean(values.seed === "on" && isAdvanced),
        unitId: mappedUnit?.id ?? null,
        pointsUnitId: draft.units.find((unit) => unit.id === values.pointsUnitId)?.id ?? mappedUnit?.id ?? null
      };
      if (!payload.name || !payload.department) throw new EngineError("姓名和院系不能为空。");
      if (existing) {
        if (
          existing.seed !== payload.seed &&
          draft.draws[payload.group]?.status !== "empty" &&
          draft.matches.some((match) => match.group === payload.group)
        ) {
          throw new EngineError("该组签表已生成，不能直接更改种子标记。请先重新抽签。");
        }
        Object.assign(existing, payload, {
          unitOverridden: Boolean(selectedUnit),
          pointsUnitOverridden: Boolean(values.pointsUnitId)
        });
        addAudit(draft, "编辑参赛选手", `${payload.name}（${GROUP_BY_KEY[payload.group].name}）`);
      } else {
        const created = createPlayer(payload, draft.units);
        Object.assign(created, {
          unitId: payload.unitId,
          pointsUnitId: payload.pointsUnitId,
          unitOverridden: Boolean(selectedUnit),
          pointsUnitOverridden: Boolean(values.pointsUnitId)
        });
        draft.players.push(created);
        addAudit(draft, "新增参赛选手", `${created.name}（${GROUP_BY_KEY[created.group].name}）`);
      }
      if (isAdvanced) {
        const seeds = draft.players.filter((player) => player.group === values.group && player.seed);
        if (seeds.length > 8) throw new EngineError("种子选手不能超过8名。");
      }
    }, { success: "参赛选手信息已保存" });
    return;
  }

  if (type === "delete-player") {
    const player = state.players.find((entry) => entry.id === form.dataset.player);
    if (!player) return;
    if (values.confirmName.trim() !== player.name) {
      toast("输入的姓名与选手姓名不一致。", "error");
      return;
    }
    await commit((draft) => {
      const inMatches = draft.matches.some((match) =>
        getMatchPlayers(draft, match).some((entry) => entry?.id === player.id)
      );
      if (inMatches) throw new EngineError("该选手已经进入签表，不能直接删除。请先重新抽签清空该组赛程。");
      draft.players = draft.players.filter((entry) => entry.id !== player.id);
      addAudit(draft, "删除参赛选手", `${player.name}（${GROUP_BY_KEY[player.group].name}）`);
    }, { success: "选手已删除" });
    return;
  }

  if (type === "match-schedule") {
    const matchId = form.dataset.match;
    await commit((draft) => {
      const status = values.status === "unassigned" ? "unassigned" : values.status;
      const match = updateMatchSchedule(draft, matchId, {
        court: Number(values.court),
        startAt: localInputToIso(draft, values.startTime),
        estimatedMinutes: Number(values.estimatedMinutes),
        status
      });
      const validation = validateSchedule(draft);
      if (validation.errors.length) {
        throw new EngineError(
          `排场已检查到 ${validation.errors.length} 个冲突：${validation.errors.slice(0, 3).join("；")}`
        );
      }
      return match;
    }, { success: "排场已保存" });
    return;
  }

  if (type === "points") {
    const points = {};
    for (let place = 1; place <= 8; place += 1) {
      const value = Number(values[`place${place}`]);
      if (!Number.isFinite(value) || value < 0) {
        toast("积分必须为非负数。", "error");
        return;
      }
      points[place] = value;
    }
    await commit((draft) => {
      draft.settings.pointsByPlace = points;
      addAudit(draft, "更新积分规则", `第1–8名：${Object.values(points).join(" / ")} 分`);
    }, { success: "积分规则已更新" });
    return;
  }

  if (type === "units") {
    await commit((draft) => {
      for (let index = 0; index < draft.units.length; index += 1) {
        const name = values[`unitName${index}`]?.trim();
        const aliases = values[`unitAliases${index}`]
          ?.split(/[、,，\n]/)
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (!name || !aliases?.length) throw new EngineError("单位名称和别名不能为空。");
        draft.units[index].name = name;
        draft.units[index].aliases = [...new Set([name, ...aliases])];
      }
      recomputePlayerUnits(draft);
      addAudit(draft, "更新院系映射", "重新识别了现有选手的联合参赛单位与积分归属。");
    }, { success: "院系映射已保存" });
    return;
  }

  if (type === "event") {
    await commit((draft) => {
      draft.meta.name = values.name.trim();
      draft.meta.date = values.date;
      draft.meta.venue = values.venue.trim();
      draft.meta.courts = Number(values.courts);
      draft.meta.timeLabel = values.timeLabel.trim();
      addAudit(draft, "更新赛事信息", `${draft.meta.name}；${draft.meta.date}；${draft.meta.venue}`);
    }, { success: "赛事信息已保存" });
    return;
  }

  if (type === "schedule-settings") {
    await commit((draft) => {
      draft.settings.durations.new = Number(values.newDuration);
      draft.settings.durations.advanced = Number(values.advancedDuration);
      draft.settings.durations.advancedWarmupMinutes = Number(values.warmup);
      draft.settings.restMinutes = Number(values.restMinutes);
      addAudit(
        draft,
        "更新排场参数",
        `新手${values.newDuration}分钟；进阶${values.advancedDuration}分钟（含热球${values.warmup}分钟）；休息${values.restMinutes}分钟。`
      );
    }, { success: "排场参数已保存；重新自动排场后生效" });
    return;
  }

  if (type === "import-preview") {
    const rows = modal.data.rows;
    if (modal.data.errors?.length) return;
    await commit((draft) => {
      if (values.mode === "replace") {
        const fresh = createEmptyState();
        fresh.units = draft.units;
        fresh.settings = draft.settings;
        fresh.meta = {
          ...draft.meta,
          version: draft.meta.version,
          isDemo: false,
          phase: "setup",
          updatedAt: new Date().toISOString()
        };
        fresh.players = rows.map((row) => {
          const player = createPlayer(
            {
              name: row.name,
              department: row.department,
              group: row.canonicalGroup
            },
            fresh.units
          );
          return player;
        });
        fresh.audit = [];
        addAudit(fresh, "Excel导入参赛名单", `替换名单，共导入${fresh.players.length}名选手。`);
        Object.assign(draft, fresh);
      } else {
        if (
          draft.matches.length ||
          Object.values(draft.draws).some((draw) =>
            ["preview", "locked"].includes(draw?.status)
          )
        ) {
          throw new EngineError("已有抽签或签表时不能追加名单，请先重新抽签或使用替换导入。");
        }
        const existingKeys = new Set(
          draft.players.map((player) => `${normalizeText(player.name)}|${player.group}`)
        );
        for (const row of rows) {
          const key = `${normalizeText(row.name)}|${row.canonicalGroup}`;
          if (existingKeys.has(key)) {
            throw new EngineError(`追加名单中“${row.name}”已在对应组别存在。`);
          }
          existingKeys.add(key);
          draft.players.push(
            createPlayer(
              {
                name: row.name,
                department: row.department,
                group: row.canonicalGroup
              },
              draft.units
            )
          );
        }
        draft.meta.isDemo = false;
        addAudit(draft, "Excel追加参赛名单", `追加${rows.length}名选手。`);
      }
    }, { success: `已导入${rows.length}名选手；请检查种子与院系映射` });
  }
}

async function processRosterFile(file) {
  try {
    const rawRows = await parseRosterWorkbook(file);
    if (!rawRows.length) throw new Error("Excel没有可导入的数据行。");
    const errors = [];
    const seen = new Set();
    const rows = rawRows.map((row, index) => {
      const canonicalGroup = canonicalGroupKey(row.group);
      const unit = findUnitByDepartment(row.department, state.units);
      let error = "";
      if (!row.name) error = "姓名为空";
      else if (!row.department) error = "院系为空";
      else if (!canonicalGroup) error = "组别不合法";
      else {
        const key = `${normalizeText(row.name)}|${canonicalGroup}`;
        if (seen.has(key)) error = "姓名与组别重复";
        seen.add(key);
      }
      if (error) errors.push(`第${index + 2}行：${row.name || "空姓名"}，${error}`);
      return {
        ...row,
        canonicalGroup,
        unit,
        error
      };
    });
    modal = { type: "import-preview", data: { rows, errors } };
    renderAll();
  } catch (error) {
    toast(`Excel读取失败：${error.message}`, "error", 7000);
  }
}

async function processBackupFile(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (!backup.meta || !Array.isArray(backup.players) || !Array.isArray(backup.matches)) {
      throw new Error("JSON文件不是本系统的完整赛事备份。");
    }
    showGenericConfirm(
      {
        title: "从JSON备份恢复",
        heading: "将用备份覆盖当前赛事",
        message: `备份包含 ${backup.players.length} 名选手、${backup.matches.length} 场比赛，赛事版本 v${backup.meta.version ?? "未知"}。确认后以当前版本号作为新提交，并由服务端保留上一版快照。`,
        confirmLabel: "确认恢复备份",
        tone: "danger"
      },
      async () => {
        await commit((draft) => {
          const version = draft.meta.version;
          Object.assign(draft, structuredClone(backup));
          draft.meta.version = version;
          addAudit(draft, "从JSON备份恢复", `恢复${backup.players.length}名选手、${backup.matches.length}场比赛。`);
        }, { success: "备份已恢复" });
      }
    );
  } catch (error) {
    toast(`备份读取失败：${error.message}`, "error", 6500);
  }
}

function workbookForRosters(players = state.players) {
  return [
    {
      name: "参赛名单",
      rows: [
        ["选手姓名", "院系", "组别", "内部ID", "联合参赛单位", "校友", "种子", "积分归属"],
        ...players.map((player) => [
          player.name,
          player.department,
          GROUP_BY_KEY[player.group].name,
          player.id,
          playerUnitName(state, player.id),
          player.alumni ? "是" : "否",
          player.seed ? "是" : "否",
          player.alumni ? playerUnitName(state, player.id) : ""
        ])
      ]
    }
  ];
}

function matchRows(matches) {
  return [
    ["比赛编号", "组别", "阶段", "小组/轮次", "选手A", "选手A院系", "选手B", "选手B院系", "胜者", "负者", "场地", "预计开始", "预计结束", "预计时长", "状态"],
    ...matches.map((match) => {
      const players = getMatchPlayers(state, match);
      return [
        match.code,
        GROUP_BY_KEY[match.group].name,
        match.phaseLabel ?? match.phase,
        match.phase === "group"
          ? state.draws[match.group]?.groups?.find((entry) => entry.id === match.groupId)?.name ?? ""
          : `第${match.roundIndex + 1}轮`,
        players[0]?.name ?? "待定",
        players[0] ? playerUnitName(state, players[0].id) : "",
        players[1]?.name ?? "待定",
        players[1] ? playerUnitName(state, players[1].id) : "",
        match.winnerId ? playerName(state, match.winnerId) : "",
        match.loserId ? playerName(state, match.loserId) : "",
        match.schedule.court ?? "",
        match.schedule.startAt ?? "",
        match.schedule.endAt ?? "",
        match.schedule.estimatedMinutes ?? "",
        match.winnerId ? "已完成" : MATCH_STATUS_LABELS[match.schedule.status] ?? match.schedule.status
      ];
    })
  ];
}

function allResultsWorkbook() {
  const groupMatches = state.matches.filter((match) => match.phase === "group");
  const knockoutMatches = state.matches.filter((match) =>
    ["qualifier", "r16", "qf", "sf", "final", "third"].includes(match.phase)
  );
  const teamRows = calculateTeamStandings(state);
  const placements = getPlacementRows(state);
  return [
    { name: "全部比赛", rows: matchRows(state.matches) },
    { name: "小组赛与资格赛", rows: matchRows(groupMatches.concat(state.matches.filter((match) => match.phase === "qualifier"))) },
    { name: "淘汰赛结果", rows: matchRows(knockoutMatches) },
    {
      name: "院系积分榜",
      rows: [
        ["排名", "联合参赛单位", ...GROUP_DEFS.map((group) => group.name), "总分"],
        ...teamRows.map((team) => [
          team.rank,
          team.unitName,
          ...GROUP_DEFS.map((group) => team.byGroup[group.key] || 0),
          team.total
        ])
      ]
    },
    {
      name: "个人名次",
      rows: [
        ["组别", "名次", "选手", "院系", "积分归属", "积分"],
        ...placements.map((row) => [
          row.groupName,
          row.placeLabel,
          row.player.name,
          row.player.department,
          row.pointsUnit?.name ?? "外院系",
          row.pointsUnit ? row.points : ""
        ])
      ]
    },
    { name: "参赛名单", rows: workbookForRosters()[0].rows }
  ];
}

function downloadTemplate() {
  downloadWorkbook(
    [
      {
        name: "选手名单",
        rows: [
          ["选手姓名", "院系", "组别"],
          ["张三", "计算机系", "新手男子"],
          ["李四", "环境学院", "进阶女子"],
          ["王五", "医学院", "新手女子"],
          ["赵六", "建筑学院", "进阶男子"]
        ]
      },
      {
        name: "填写说明",
        rows: [
          ["字段", "填写要求"],
          ["选手姓名", "必填；同一组别内姓名不应重复"],
          ["院系", "必填；可填完整院系名称，系统按设置中的别名映射到八个联合参赛单位"],
          ["组别", "必填；仅可填写：新手男子、新手女子、进阶男子、进阶女子"],
          ["其他字段", "不要添加电话、种子序号、签位等字段；导入后由管理员在网页中设置种子、校友和积分归属"],
          ["替换示例", "请删除张三、李四、王五、赵六四条示例记录后填写真实名单"]
        ]
      }
    ],
    "MiHoo_九系壁球联赛_名单导入模板.xlsx"
  );
}

function handleAction(actionElement, event) {
  const action = actionElement.dataset.action;
  if (!action) return false;
  if (action === "navigate") {
    if (actionElement.dataset.group) selectedGroup = actionElement.dataset.group;
    setView(actionElement.dataset.view);
    return true;
  }
  if (action === "select-group") {
    setGroup(actionElement.dataset.group);
    return true;
  }
  if (action === "modal-close") {
    modal = null;
    pendingConfirm = null;
    renderAll();
    return true;
  }
  if (action === "modal-backdrop") {
    if (event.target !== actionElement) return false;
    modal = null;
    pendingConfirm = null;
    renderAll();
    return true;
  }
  if (action === "winner") {
    if (role !== "admin") return true;
    modal = {
      type: "winner",
      data: { matchId: actionElement.dataset.match, playerId: actionElement.dataset.player }
    };
    renderAll();
    return true;
  }
  if (action === "undo-match") {
    modal = { type: "undo", data: { matchId: actionElement.dataset.match } };
    renderAll();
    return true;
  }
  if (action === "tie-resolve") {
    modal = {
      type: "tie",
      data: {
        groupKey: actionElement.dataset.group,
        groupId: actionElement.dataset.groupId
      }
    };
    renderAll();
    return true;
  }
  if (action === "swap-draw") {
    modal = { type: "swap-draw", data: { groupKey: actionElement.dataset.group } };
    renderAll();
    return true;
  }
  if (action === "player-add") {
    modal = { type: "player", data: { groupKey: selectedGroup } };
    renderAll();
    return true;
  }
  if (action === "player-edit") {
    modal = { type: "player", data: { playerId: actionElement.dataset.player } };
    renderAll();
    return true;
  }
  if (action === "player-delete") {
    modal = { type: "delete-player", data: { playerId: actionElement.dataset.player } };
    renderAll();
    return true;
  }
  if (action === "batch-seed") {
    const playerIds = getSelectedPlayerIds();
    const seed = actionElement.dataset.mode === "set";
    commit(
      (draft) => batchSetSeeds(draft, selectedGroup, playerIds, seed),
      {
        success: seed
          ? `已将 ${playerIds.length} 名选手设为种子`
          : `已取消 ${playerIds.length} 名选手的种子标记`
      }
    );
    return true;
  }
  if (action === "batch-delete") {
    const playerIds = getSelectedPlayerIds();
    if (!playerIds.length) return true;
    const selectedNames = state.players
      .filter((player) => playerIds.includes(player.id))
      .map((player) => player.name);
    showGenericConfirm(
      {
        title: "批量删除选手",
        heading: `将删除 ${playerIds.length} 名选手`,
        message: "删除后名单数量和后续抽签条件可能变化。已经进入签表的选手会被系统阻止，不会静默删除。",
        list: [
          `所选选手：${selectedNames.slice(0, 12).join("、")}${selectedNames.length > 12 ? "…" : ""}`,
          "如需恢复，只能使用上一版数据或 JSON 备份"
        ],
        confirmLabel: "确认批量删除",
        tone: "danger"
      },
      () =>
        commit(
          (draft) => batchDeletePlayers(draft, playerIds),
          { success: `已删除 ${playerIds.length} 名选手` }
        )
    );
    return true;
  }
  if (action === "match-schedule") {
    modal = { type: "match-schedule", data: { matchId: actionElement.dataset.match } };
    renderAll();
    return true;
  }
  if (action === "points-edit") {
    modal = { type: "points", data: {} };
    renderAll();
    return true;
  }
  if (action === "units-edit") {
    modal = { type: "units", data: {} };
    renderAll();
    return true;
  }
  if (action === "event-edit") {
    modal = { type: "event", data: {} };
    renderAll();
    return true;
  }
  if (action === "schedule-settings") {
    modal = { type: "schedule-settings", data: {} };
    renderAll();
    return true;
  }
  if (action === "submit-modal") {
    const form = document.querySelector("#modal-form");
    if (!form) return true;
    if (!form.reportValidity()) return true;
    submitModal(form);
    return true;
  }
  if (action === "confirm-winner") {
    const matchId = actionElement.dataset.match;
    const winnerId = actionElement.dataset.player;
    const impact = getImpactOfResultChange(state, matchId).filter((entry) => entry.id !== matchId);
    const match = state.matches.find((entry) => entry.id === matchId);
    const reason = match?.winnerId
      ? impact.length
        ? "管理员纠正赛果，并确认按依赖顺序撤销受影响下游结果"
        : "管理员纠正赛果"
      : "";
    commit(
      (draft) => setMatchWinner(draft, matchId, winnerId, { cascade: impact.length > 0, reason }),
      { success: `${playerName(state, winnerId)} 已确认获胜，晋级关系已更新` }
    );
    return true;
  }
  if (action === "confirm-draw") {
    commit((draft) => confirmDraw(draft, actionElement.dataset.group), {
      success: "抽签已锁定，比赛和排场结构已生成"
    });
    return true;
  }
  if (action === "reroll-draw") {
    rerollDraw(actionElement.dataset.group);
    return true;
  }
  if (action === "create-knockout") {
    commit((draft) => createNewbieKnockout(draft, actionElement.dataset.group), {
      success: "八强随机签表已生成"
    });
    return true;
  }
  if (action === "auto-schedule") {
    commit((draft) => autoSchedule(draft), {
      success: "自动排场完成；请查看未安排场次与冲突提示"
    });
    return true;
  }
  if (action === "mark-live") {
    commit((draft) => markMatchLive(draft, actionElement.dataset.match), {
      success: "比赛已标记为进行中"
    });
    return true;
  }
  if (action === "template-download") {
    downloadTemplate();
    return true;
  }
  if (action === "export-roster") {
    const group = GROUP_BY_KEY[actionElement.dataset.group];
    const players = state.players.filter((player) => player.group === group.key);
    downloadWorkbook(workbookForRosters(players), `MiHoo_${group.name}_参赛名单.xlsx`);
    return true;
  }
  if (action === "export-all-rosters") {
    downloadWorkbook(
      GROUP_DEFS.map((group) => ({
        name: group.name,
        rows: workbookForRosters(
          state.players.filter((player) => player.group === group.key)
        )[0].rows
      })),
      "MiHoo_四组参赛名单.xlsx"
    );
    return true;
  }
  if (action === "export-results") {
    const type = actionElement.dataset.type;
    if (type === "sheets") downloadWorkbook(allResultsWorkbook(), "MiHoo_全部比赛结果.xlsx");
    if (type === "group") {
      const matches = state.matches.filter((match) => match.phase === "group");
      downloadWorkbook([{ name: "小组赛对阵与成绩", rows: matchRows(matches) }], "MiHoo_小组赛对阵及成绩.xlsx");
    }
    if (type === "knockout") {
      const matches = state.matches.filter((match) =>
        ["qualifier", "r16", "qf", "sf", "final", "third"].includes(match.phase)
      );
      downloadWorkbook([{ name: "淘汰赛结果", rows: matchRows(matches) }], "MiHoo_淘汰赛结果.xlsx");
    }
    if (type === "score") {
      const sheet = allResultsWorkbook().find((entry) => entry.name === "院系积分榜");
      downloadWorkbook([sheet], "MiHoo_院系积分榜.xlsx");
    }
    if (type === "roster") {
      downloadWorkbook(workbookForRosters(), "MiHoo_全部参赛名单.xlsx");
    }
    return true;
  }
  if (action === "backup-download") {
    downloadText(
      JSON.stringify(state, null, 2),
      `MiHoo_赛事备份_${new Date().toISOString().slice(0, 10)}.json`,
      "application/json;charset=utf-8"
    );
    return true;
  }
  if (action === "copy-admin-link") {
    navigator.clipboard
      ?.writeText(window.location.origin + adminPath)
      .then(() => toast("管理员链接已复制。请只分享给赛事核心成员。", "success"))
      .catch(() => toast("浏览器未允许自动复制，请手动复制设置页中的链接。", "error"));
    return true;
  }
  if (action === "fullscreen") {
    if (document.body.classList.contains("presentation-mode")) {
      document.body.classList.remove("presentation-mode");
      if (document.fullscreenElement) document.exitFullscreen?.();
      return true;
    }
    document.body.classList.add("presentation-mode");
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    toast("已进入投影模式；按 Esc 退出全屏。");
    return true;
  }
  if (action === "print") {
    window.print();
    return true;
  }
  if (action === "reset-demo") {
    showGenericConfirm(
      {
        title: "载入模拟测试数据",
        heading: "将覆盖当前全部赛事数据",
        message: "载入84名模拟选手，并清除当前名单、签表、成绩和排场。建议先下载JSON备份。",
        confirmLabel: "载入模拟数据",
        tone: "danger"
      },
      () =>
        commit((draft) => {
          const demo = createDemoState();
          const version = draft.meta.version;
          Object.assign(draft, demo);
          draft.meta.version = version;
        }, { success: "已载入84人模拟数据" })
    );
    return true;
  }
  if (action === "reset-empty") {
    showGenericConfirm(
      {
        title: "清空为正式空赛事",
        heading: "所有比赛、成绩和抽签都会被删除",
        message: "此操作适合清除模拟数据并准备导入真实名单。院系映射、积分规则和排场参数会保留。",
        list: ["建议先下载完整JSON备份", "删除后需二次确认", "服务端会自动保留上一版快照"],
        confirmLabel: "清空并保留设置",
        tone: "danger"
      },
      () =>
        commit((draft) => {
          const fresh = createEmptyState();
          fresh.units = draft.units;
          fresh.settings = draft.settings;
          fresh.meta = {
            ...draft.meta,
            phase: "setup",
            isDemo: false,
            version: draft.meta.version
          };
          fresh.audit = [];
          addAudit(fresh, "清空赛事数据", "清除模拟数据，保留院系映射、积分与排场设置。");
          Object.assign(draft, fresh);
        }, { success: "赛事已清空，可以导入真实名单" })
    );
    return true;
  }
  if (action === "restore-previous") {
    showGenericConfirm(
      {
        title: "恢复上一版服务端快照",
        heading: "当前数据将被上一版替换",
        message: "服务端在每次保存前自动复制了上一版。恢复后会作为新的版本保存，不会删除当前版本于服务器磁盘的临时回滚能力。",
        confirmLabel: "恢复上一版",
        tone: "warning"
      },
      async () => {
        try {
          const response = await fetch(`${apiBase}/previous`, { headers: authHeaders(), cache: "no-store" });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "没有可恢复的快照。");
          await commit((draft) => {
            const version = draft.meta.version;
            Object.assign(draft, body.state);
            draft.meta.version = version;
            addAudit(draft, "恢复上一版快照", `从版本 v${body.state.meta.version} 恢复。`);
          }, { success: "上一版数据已恢复" });
        } catch (error) {
          toast(`恢复失败：${error.message}`, "error");
        }
      }
    );
    return true;
  }
  if (action === "confirm-generic") {
    const callback = pendingConfirm;
    pendingConfirm = null;
    modal = null;
    renderAll();
    if (callback) callback();
    return true;
  }
  if (action === "reload") {
    window.location.reload();
    return true;
  }
  return false;
}

document.addEventListener("click", (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  if (handleAction(actionElement, event)) {
    event.preventDefault();
    event.stopPropagation();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "modal-form") return;
  event.preventDefault();
  submitModal(event.target);
});

document.addEventListener("change", (event) => {
  if (event.target.matches('[data-file="roster"]')) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) processRosterFile(file);
  }
  if (event.target.matches('[data-file="backup"]')) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) processBackupFile(file);
  }
  if (event.target.matches("input[data-bulk-select-all]")) {
    for (const checkbox of document.querySelectorAll("input[data-bulk-player]")) {
      checkbox.checked = event.target.checked;
    }
    updateBulkSelectionUi();
  }
  if (event.target.matches("input[data-bulk-player]")) {
    const selectAll = document.querySelector("input[data-bulk-select-all]");
    const checkboxes = [...document.querySelectorAll("input[data-bulk-player]")];
    if (selectAll) {
      const selectedCount = checkboxes.filter((input) => input.checked).length;
      selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
    }
    updateBulkSelectionUi();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      document.body.classList.remove("presentation-mode");
    } else if (modal) {
      modal = null;
      pendingConfirm = null;
      renderAll();
    }
  }
});

window.addEventListener("hashchange", () => {
  const hashView = window.location.hash.slice(1);
  if (hashView && hashView !== view) {
    view = hashView;
    renderAll();
  }
});

window.addEventListener("online", () => {
  network = "online";
  refreshState();
});

window.addEventListener("offline", () => {
  network = "offline";
  renderAll();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && transport === "poll") refreshState();
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) document.body.classList.remove("presentation-mode");
});

await loadState({ initial: true });
