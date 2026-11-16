import {
  GROUP_BY_KEY,
  GROUP_DEFS,
  MATCH_STATUS_LABELS,
  PHASE_LABELS,
  playerName,
  playerUnitName
} from "./model.js";
import {
  calculateTeamStandings,
  canCreateNewbieKnockout,
  drawSummary,
  eventCompletion,
  getDownstreamMatches,
  getGroupStandings,
  getImpactOfResultChange,
  getMatchPlayers,
  getPlacementRows,
  getPlacements,
  placementLabel,
  resolveSlot,
  validateAllRoster
} from "./engine.js";
import {
  dateLabel,
  getCourtState,
  getStats,
  readyMatches,
  timeLabelFromDate,
  validateSchedule
} from "./schedule.js";

const NAV_ITEMS = [
  { key: "dashboard", label: "赛事首页", viewer: true },
  { key: "draw", label: "抽签", viewer: true },
  { key: "groups", label: "小组赛", viewer: true },
  { key: "bracket", label: "签表", viewer: true },
  { key: "schedule", label: "比赛日调度", viewer: true },
  { key: "teams", label: "团体积分", viewer: true },
  { key: "players", label: "名单管理", viewer: false },
  { key: "settings", label: "设置与数据", viewer: false }
];

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : escapeHtml(value);
}

function statusBadge(status) {
  const labels = {
    ...MATCH_STATUS_LABELS,
    pending: "待录入",
    preview: "预览待确认",
    locked: "已锁定",
    empty: "未抽签",
    conflict: "有冲突"
  };
  const className =
    status === "live"
      ? "live"
      : status === "completed"
        ? "completed"
        : status === "unassigned" || status === "empty"
          ? "unassigned"
          : status === "conflict"
            ? "conflict"
            : "scheduled";
  return `<span class="status-badge ${className}">${labels[status] ?? escapeHtml(status)}</span>`;
}

function roleChip(role) {
  return role === "admin"
    ? '<span class="role-chip admin">管理员模式</span>'
    : '<span class="role-chip viewer">观众模式</span>';
}

function networkChip(network) {
  const online = network === "online";
  return `<span class="sync-chip ${online ? "" : "offline"}"><span class="sync-dot"></span>${online ? "实时同步" : "网络中断"}</span>`;
}

function pageHeader(eyebrow, title, subtitle, actions = "") {
  return `<div class="page-heading">
    <div>
      <span class="eyebrow">${escapeHtml(eyebrow)}</span>
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <p class="page-subtitle">${escapeHtml(subtitle)}</p>
    </div>
    ${actions ? `<div class="heading-actions">${actions}</div>` : ""}
  </div>`;
}

function actionButton(label, action, options = {}) {
  const {
    style = "",
    disabled = false,
    data = "",
    title = "",
    type = "button",
    size = ""
  } = options;
  return `<button type="${type}" class="button ${style} ${size}" data-action="${escapeHtml(action)}" ${data} ${disabled ? "disabled" : ""} ${title ? `title="${escapeHtml(title)}"` : ""}>${label}</button>`;
}

function shortGroupName(groupKey) {
  return GROUP_BY_KEY[groupKey]?.short ?? groupKey;
}

function recentResults(state, limit = 6) {
  return state.matches
    .filter((match) => match.winnerId && match.completedAt)
    .sort((left, right) => new Date(right.completedAt) - new Date(left.completedAt))
    .slice(0, limit);
}

function groupProgress(state, groupKey) {
  const matches = state.matches.filter((match) => match.group === groupKey);
  const complete = matches.filter((match) => match.winnerId).length;
  return {
    complete,
    total: matches.length,
    percent: matches.length ? Math.round((complete / matches.length) * 100) : 0
  };
}

function playerButton(state, match, player, role, extraClass = "winner-button") {
  if (!player) return `<span class="${extraClass}">待定</span>`;
  const isWinner = match.winnerId === player.id;
  const isLoser = Boolean(match.winnerId && !isWinner);
  const className = `${extraClass}${isWinner ? " is-winner" : ""}${isLoser ? " is-loser" : ""}`;
  const title = `${player.name} · ${playerUnitName(state, player.id)}`;
  if (role !== "admin") {
    return `<span class="${className}" title="${escapeHtml(title)}">${escapeHtml(player.name)}</span>`;
  }
  return `<button type="button" class="${className}" data-action="winner" data-match="${match.id}" data-player="${player.id}" title="${escapeHtml(title)}（点击确认胜者）">${escapeHtml(player.name)}</button>`;
}

function renderMatchPlayers(state, match, role) {
  const players = getMatchPlayers(state, match);
  return `<div class="match-players">
    ${playerButton(state, match, players[0], role)}
    ${playerButton(state, match, players[1], role)}
  </div>`;
}

function scheduleLabel(state, match) {
  if (!match.schedule.startAt) return "待安排";
  return `${timeLabelFromDate(match.schedule.startAt)} · ${match.schedule.court ? `${match.schedule.court}号场` : "待定场"}`;
}

export function renderApp({ root, state, role, view, selectedGroup, network, saving, adminPath }) {
  const visibleNav = NAV_ITEMS.filter((item) => item.viewer || role === "admin");
  const activeView = visibleNav.some((item) => item.key === view) ? view : "dashboard";
  const page = renderView({
    state,
    role,
    view: activeView,
    selectedGroup,
    adminPath
  });
  root.innerHTML = `
    ${saving ? '<div class="saving-bar" aria-label="正在保存"></div>' : ""}
    <header class="app-header">
      <div class="header-main">
        <div class="brand">
          <div class="brand-mark">MH</div>
          <div>
            <span class="brand-title">MiHoo 赛事中心</span>
            <span class="brand-sub">九系壁球联赛 · 2026</span>
          </div>
        </div>
        ${roleChip(role)}
        ${networkChip(network)}
        <div class="header-event">
          <strong>${escapeHtml(state.meta.name)}</strong>
          <span>${escapeHtml(state.meta.date)} · ${escapeHtml(state.meta.venue)}</span>
        </div>
      </div>
      <nav class="header-nav" aria-label="主导航">
        <div class="nav-inner">
          ${visibleNav
            .map(
              (item) =>
                `<button class="nav-button ${activeView === item.key ? "active" : ""}" data-action="navigate" data-view="${item.key}">${escapeHtml(item.label)}</button>`
            )
            .join("")}
        </div>
      </nav>
    </header>
    ${network !== "online" ? '<div class="offline-ribbon">网络连接中断。页面保留当前数据，但编辑操作已暂停，恢复联网后请重新操作。</div>' : ""}
    <main class="page">${page}</main>
  `;
}

function renderView(context) {
  switch (context.view) {
    case "draw":
      return renderDrawPage(context);
    case "groups":
      return renderGroupsPage(context);
    case "bracket":
      return renderBracketPage(context);
    case "schedule":
      return renderSchedulePage(context);
    case "teams":
      return renderTeamsPage(context);
    case "players":
      return renderPlayersPage(context);
    case "settings":
      return renderSettingsPage(context);
    default:
      return renderDashboard(context);
  }
}

function renderDashboard({ state, role }) {
  const stats = getStats(state);
  const completion = eventCompletion(structuredClone(state));
  const teams = calculateTeamStandings(state);
  const validation = validateAllRoster(state);
  const rosterCount = state.players.length;
  const teamTop = teams.slice(0, 5);
  const ready = readyMatches(state).slice(0, 6);
  const results = recentResults(state, 5);
  return `
    <section class="hero">
      <span class="hero-kicker">MIHOO · 2026 COLLEGIATE SQUASH</span>
      <h2>${escapeHtml(state.meta.name)}</h2>
      <div class="hero-meta">
        <span>${escapeHtml(state.meta.date)} · 星期六</span>
        <span>${escapeHtml(state.meta.timeLabel)}</span>
        <span>${escapeHtml(state.meta.venue)} · 4片球场</span>
      </div>
      <div class="hero-actions">
        ${actionButton("打开现场调度台", "navigate", { data: 'data-view="schedule"', style: "light" })}
        ${actionButton("查看淘汰赛签表", "navigate", { data: 'data-view="bracket"', style: "light" })}
        ${actionButton("全屏投影模式", "fullscreen", { style: "light" })}
      </div>
    </section>

    <section class="stats-grid">
      <article class="stat-card">
        <span class="stat-label">参赛选手 <span class="badge neutral">${state.meta.isDemo ? "模拟数据" : "正式数据"}</span></span>
        <strong class="stat-value">${rosterCount}</strong>
        <span class="stat-foot">${validation.errors.length ? `${validation.errors.length} 项需修正` : "名单结构校验通过"}</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">全部比赛</span>
        <strong class="stat-value">${stats.total || 0}</strong>
        <span class="stat-foot">${stats.unassigned} 场尚未排场</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">已完成</span>
        <strong class="stat-value">${stats.completed}</strong>
        <span class="stat-foot">${completion.allFinalsComplete ? "四组决赛全部完成" : "成绩可实时推进"}</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">进行中 / 冲突</span>
        <strong class="stat-value">${stats.live} <span class="muted" style="font-size:18px">/ ${stats.conflicts}</span></strong>
        <span class="stat-foot">${stats.conflicts ? "请前往调度台处理冲突" : "当前无排场硬冲突"}</span>
      </article>
    </section>

    <div class="content-grid">
      <div class="content-stack">
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">四个比赛组别</h2>
              <p class="card-subtitle">抽签、小组赛与淘汰赛进度</p>
            </div>
            ${actionButton("抽签管理", "navigate", { data: 'data-view="draw"', size: "small" })}
          </div>
          <div class="group-grid">
            ${GROUP_DEFS.map((group) => renderGroupOverviewCard(state, group, role)).join("")}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">四片场地</h2>
              <p class="card-subtitle">当前比赛、下一场与场地状态</p>
            </div>
            ${actionButton("调度台", "navigate", { data: 'data-view="schedule"', size: "small" })}
          </div>
          <div class="courts-grid">
            ${[1, 2, 3, 4].map((court) => renderCourtCard(state, court)).join("")}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">快速录入</h2>
              <p class="card-subtitle">${role === "admin" ? "点击选手姓名即可打开胜者确认" : "当前可开始的比赛"}</p>
            </div>
          </div>
          ${ready.length ? `<div class="quick-match-list">${ready.map((match) => renderQuickMatch(state, match, role)).join("")}</div>` : renderEmpty("当前没有可录入的比赛", "先完成名单、抽签与排场；当对阵双方确定后，这里会显示快捷录入入口。")}
        </section>
      </div>

      <div class="content-stack">
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">团体积分榜</h2>
              <p class="card-subtitle">按当前成绩实时计算</p>
            </div>
            ${actionButton("完整榜单", "navigate", { data: 'data-view="teams"', size: "small" })}
          </div>
          ${teamTop.length ? `<div class="table-wrap"><table class="data-table compact"><thead><tr><th>名次</th><th>参赛单位</th><th class="num">总分</th></tr></thead><tbody>${teamTop.map((team) => `<tr><td><span class="rank-medal ${team.rank === 1 ? "gold" : team.rank === 2 ? "silver" : team.rank === 3 ? "bronze" : ""}">${team.tied ? "T" : ""}${team.rank}</span></td><td class="name">${escapeHtml(team.unitName)}</td><td class="num score-total">${team.total}</td></tr>`).join("")}</tbody></table></div>` : renderEmpty("等待比赛结果", "产生前八名后，团体积分将自动汇总。")}
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">最近结果</h2>
              <p class="card-subtitle">最新确认的比赛</p>
            </div>
          </div>
          ${results.length ? `<div class="audit-list">${results.map((match) => `<div class="audit-row" style="grid-template-columns:92px 1fr"><span class="audit-time">${shortGroupName(match.group)} · ${escapeHtml(match.code)}</span><span class="audit-action">${escapeHtml(playerName(state, match.winnerId))} 胜 ${escapeHtml(playerName(state, match.loserId))}</span></div>`).join("")}</div>` : renderEmpty("尚无比赛结果", "完成第一场比赛后，这里会显示最新赛果。")}
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">赛事提醒</h2>
              <p class="card-subtitle">自动检查关键状态</p>
            </div>
          </div>
          <div class="card-body">
            ${
              validation.errors.length
                ? `<div class="error-box"><div><strong>名单有 ${validation.errors.length} 项错误</strong>${escapeHtml(validation.errors[0])}</div></div>`
                : `<div class="info-box"><div><strong>名单基础结构正常</strong>${validation.warnings.length ? `有 ${validation.warnings.length} 项人数或种子提醒，请到名单管理查看。` : "四个组别的姓名与组别字段检查通过。"}</div></div>`
            }
            <div style="height:10px"></div>
            ${
              stats.conflicts
                ? `<div class="warning-box"><div><strong>排场有 ${stats.conflicts} 个硬冲突</strong>系统不会隐藏场地、休息或时段冲突，请到调度台处理。</div></div>`
                : `<div class="info-box"><div><strong>排场状态</strong>${stats.total ? "当前未检测到场地重叠、午间排赛或已知选手冲突。" : "签表生成后可自动排场。"}</div></div>`
            }
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderGroupOverviewCard(state, group, role) {
  const players = state.players.filter((player) => player.group === group.key);
  const progress = groupProgress(state, group.key);
  const drawState = state.draws[group.key]?.status ?? "empty";
  return `<article class="group-card" style="--group-color:${group.color}">
    <div class="group-card-head">
      <div>
        <h3 class="group-name">${escapeHtml(group.name)}</h3>
        <div class="group-count">${group.level === "new" ? "4组单循环 · 前2晋级" : "8种子轮空 · 16人资格赛"}</div>
      </div>
      <span class="badge ${drawState === "locked" ? "green" : drawState === "preview" ? "amber" : "neutral"}">${escapeHtml(drawSummary(state, group.key))}</span>
    </div>
    <div class="group-progress">
      <div class="progress-label"><span>${players.length} 位选手</span><span>${progress.complete}/${progress.total || "—"} 场</span></div>
      <div class="progress-track"><span class="progress-bar" style="width:${progress.percent}%"></span></div>
    </div>
    <div class="group-card-foot">
      <span class="muted" style="font-size:11px">${group.level === "new" ? "PAR11 · 单局" : "PAR11 · 三局两胜 · 含热球"}</span>
      ${actionButton(group.level === "new" ? "小组赛" : "签表", "navigate", {
        data: `data-view="${group.level === "new" ? "groups" : "bracket"}" data-group="${group.key}"`,
        size: "small"
      })}
    </div>
  </article>`;
}

function renderCourtCard(state, court) {
  const courtState = getCourtState(state, court);
  const current = courtState.live ?? courtState.current;
  return `<article class="court-card">
    <div class="court-number"><span>COURT</span><strong>${court}</strong></div>
    ${
      current
        ? `<div class="court-current">${getMatchPlayers(state, current).filter(Boolean).map((player) => escapeHtml(player.name)).join(" vs ") || "对阵待定"}</div>
           <div class="court-next">${escapeHtml(current.code)} · ${timeLabelFromDate(current.schedule.startAt)} ${statusBadge(current.schedule.status === "live" ? "live" : "scheduled")}</div>
           <div class="court-next">下一场：${courtState.upcoming ? `${escapeHtml(courtState.upcoming.code)} · ${timeLabelFromDate(courtState.upcoming.schedule.startAt)}` : "待安排"}</div>`
        : '<div class="court-empty">暂无已排比赛</div>'
    }
  </article>`;
}

function renderQuickMatch(state, match, role) {
  return `<div class="quick-match">
    <div>
      <div class="quick-match-code">${escapeHtml(match.code)}</div>
      <div class="muted" style="font-size:10px;margin-top:4px">${shortGroupName(match.group)} · ${escapeHtml(PHASE_LABELS[match.phase])}</div>
    </div>
    ${renderMatchPlayers(state, match, role)}
    <div class="match-actions">
      <span class="badge neutral">${escapeHtml(scheduleLabel(state, match))}</span>
      ${role === "admin" && match.winnerId ? actionButton("撤销", "undo-match", { size: "tiny", data: `data-match="${match.id}"` }) : ""}
    </div>
  </div>`;
}

export function renderEmpty(title, message) {
  return `<div class="empty-state">
    <div class="empty-mark">MH</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  </div>`;
}

function renderDrawPage({ state, role }) {
  const admin = role === "admin";
  return `
    ${pageHeader(
      "DRAW & SEEDING",
      "抽签与种子管理",
      "四个组别分别抽签；预览可重抽或交换，确认后锁定并生成全部对阵。",
      admin ? actionButton("先检查参赛名单", "navigate", { data: 'data-view="players"', size: "small" }) : ""
    )}
    <div class="warning-box" style="margin-bottom:18px">
      <div><strong>抽签公平性说明</strong>系统使用浏览器安全随机源进行 Fisher–Yates 洗牌，不以 Excel 行序或姓名排序生成签位。已确认并产生成绩后再次改签需要明确确认，且会清除该组全部相关成绩。</div>
    </div>
    <div class="draw-grid">
      ${GROUP_DEFS.map((group) => renderDrawCard(state, group, admin)).join("")}
    </div>
  `;
}

function renderDrawCard(state, group, admin) {
  const draw = state.draws[group.key];
  const players = state.players.filter((player) => player.group === group.key);
  const status = draw?.status ?? "empty";
  const canPreview = group.level === "new" ? players.length >= 4 : players.length === 24 && players.filter((player) => player.seed).length === 8;
  return `<section class="card draw-card">
    <div class="card-header">
      <div>
        <span class="eyebrow" style="color:${group.color}">${group.level === "new" ? "GROUP STAGE" : "SEEDED KNOCKOUT"}</span>
        <h2 class="card-title">${escapeHtml(group.name)}</h2>
        <p class="card-subtitle">${players.length} 人 · ${group.level === "new" ? "四组循环，前二晋级八强" : "8名种子首轮轮空，其他16人资格赛"}</p>
      </div>
      ${statusBadge(status)}
    </div>
    <div class="card-body">
      <div class="draw-status-row">
        ${
          group.level === "new"
            ? `<span class="badge neutral">小组人数 ${groupSizesLabel(players.length)}</span>`
            : `<span class="badge neutral">种子 ${players.filter((player) => player.seed).length}/8</span><span class="badge neutral">资格赛 16人</span>`
        }
        ${!canPreview ? '<span class="badge red">名单条件未满足</span>' : ""}
      </div>
      ${
        status === "preview"
          ? group.level === "new"
            ? renderPreviewGroups(state, draw)
            : renderAdvancedPreview(state, draw)
          : status === "locked"
            ? group.level === "new"
              ? renderPreviewGroups(state, draw, true)
              : renderAdvancedLockedSummary(state, group, draw)
            : renderEmpty(
                "尚未抽签",
                group.level === "new"
                  ? "点击一键随机抽签，生成 4 个小组的预览。"
                  : "先在名单管理为8个参赛单位各指定1名种子，再生成签表预览。"
              )
      }
    </div>
    <div class="group-summary-actions">
      <div class="button-row">
        ${
          admin
            ? status === "preview"
              ? `${actionButton(group.level === "new" ? "重新随机" : "重抽签表", "reroll-draw", { data: `data-group="${group.key}"`, size: "small" })}
                 ${actionButton(group.level === "new" ? "交换组员" : "交换签位", "swap-draw", { data: `data-group="${group.key}"`, size: "small" })}
                 ${actionButton("确认并锁定", "confirm-draw", { data: `data-group="${group.key}"`, style: "primary", size: "small" })}`
              : status === "locked"
                ? `${actionButton("重新抽签", "reroll-draw", { data: `data-group="${group.key}"`, size: "small", style: "ghost" })}
                   ${
                     group.level === "new" && !draw.knockoutCreated && canCreateNewbieKnockout(state, group.key)
                       ? actionButton("随机生成八强", "create-knockout", { data: `data-group="${group.key}"`, style: "primary", size: "small" })
                       : ""
                   }`
                : actionButton("一键随机抽签", "reroll-draw", {
                    data: `data-group="${group.key}"`,
                    style: "primary",
                    size: "small",
                    disabled: !canPreview
                  })
            : ""
        }
        ${group.level === "new" ? actionButton("查看小组", "navigate", { data: `data-view="groups" data-group="${group.key}"`, size: "small" }) : actionButton("打开签表", "navigate", { data: `data-view="bracket" data-group="${group.key}"`, size: "small" })}
      </div>
    </div>
  </section>`;
}

function groupSizesLabel(count) {
  const base = Math.floor(count / 4);
  const remainder = count % 4;
  return Array.from({ length: 4 }, (_, index) => base + (index < remainder ? 1 : 0)).join(" / ");
}

function renderPreviewGroups(state, draw, locked = false) {
  return `<div class="draw-groups">${(draw.groups ?? [])
    .map(
      (group) => `<div class="mini-group">
        <div class="mini-group-head"><span>${escapeHtml(group.name)}</span><span class="muted">${group.playerIds.length}人</span></div>
        ${group.playerIds
          .map(
            (playerId) =>
              `<span class="player-chip">${escapeHtml(playerName(state, playerId))}</span>`
          )
          .join("")}
      </div>`
    )
    .join("")}</div>${locked ? '<p class="field-hint" style="margin-top:12px">该分组已锁定。比赛成绩产生后，改签会清除本组全部结果。</p>' : ""}`;
}

function renderAdvancedPreview(state, draw) {
  return `<div class="seed-layout">
    <div>
      <p class="pane-label">16强种子位置</p>
      <div class="seed-list">
        ${(draw.seedSlots ?? []).map((playerId, index) => `<div class="seed-row"><span><span class="player-seed">S${index + 1}</span> ${escapeHtml(playerName(state, playerId))}</span><span class="muted">${escapeHtml(playerUnitName(state, playerId))}</span></div>`).join("")}
      </div>
    </div>
    <div>
      <p class="pane-label">随机资格赛</p>
      <div class="qualifier-list">
        ${(draw.qualifiers ?? []).map((pair, index) => `<div class="qualifier-row"><strong>Q${index + 1}</strong><span>${escapeHtml(playerName(state, pair[0]))}</span><span>vs</span><span>${escapeHtml(playerName(state, pair[1]))}</span></div>`).join("")}
      </div>
    </div>
  </div>`;
}

function renderAdvancedLockedSummary(state, group, draw) {
  const matches = state.matches.filter((match) => match.group === group.key);
  return `<div class="info-box"><div><strong>签表已锁定</strong>已生成 ${matches.length} 场：8场资格赛、8场16强、4场八强、2场半决赛、决赛和季军赛。种子分别位于8个16强位置，首轮轮空。</div></div>
  <div style="height:12px"></div>
  <div class="draw-groups">
    ${draw.seedSlots.slice(0, 8).map((id) => `<div class="mini-group"><div class="mini-group-head"><span>种子</span><span class="muted">${escapeHtml(playerUnitName(state, id))}</span></div><strong>${escapeHtml(playerName(state, id))}</strong></div>`).join("")}
  </div>`;
}

function renderGroupsPage({ state, role, selectedGroup }) {
  const newGroups = GROUP_DEFS.filter((group) => group.level === "new");
  return `
    ${pageHeader(
      "GROUP STAGE",
      "新手组小组赛",
      "排名先看胜场；双人同胜场比较相互胜负，三人及以上循环或无法区分时进入管理员人工裁决。",
      role === "admin" ? actionButton("前往抽签", "navigate", { data: 'data-view="draw"', size: "small" }) : ""
    )}
    <div class="filter-bar">
      <div class="segmented">
        ${newGroups.map((group) => `<button class="segment ${selectedGroup === group.key ? "active" : ""}" data-action="select-group" data-group="${group.key}">${escapeHtml(group.name)}</button>`).join("")}
      </div>
    </div>
    <div class="group-sections">
      ${renderNewbieGroupSections(state, selectedGroup, role)}
    </div>
  `;
}

function renderNewbieGroupSections(state, groupKey, role) {
  const group = GROUP_BY_KEY[groupKey] ?? GROUP_DEFS[0];
  const draw = state.draws[group.key];
  if (draw?.status !== "locked" || !draw.groups?.length) {
    return `<section class="card">${renderEmpty("该组尚未锁定抽签", "先在抽签页面生成并确认四个小组，系统随后自动生成全部组内循环对阵。")}</section>`;
  }
  const allStandings = draw.groups.map((drawGroup) =>
    getGroupStandings(state, group.key, drawGroup.id)
  );
  const readyForKnockout = canCreateNewbieKnockout(state, group.key) && !draw.knockoutCreated;
  return `
    ${readyForKnockout ? `<div class="info-box"><div><strong>四个小组已完成且排名可确定</strong>可以随机生成八强签表；系统会避免同组第一与第二在首轮相遇。</div></div>` : ""}
    ${allStandings.map((entry) => renderGroupSection(state, group, entry, role)).join("")}
    ${
      role === "admin" && readyForKnockout
        ? `<div class="card-body button-row" style="justify-content:flex-end">${actionButton("随机生成八强签表", "create-knockout", { data: `data-group="${group.key}"`, style: "primary" })}</div>`
        : ""
    }
  `;
}

function standingsRankLabel(entry, playerId) {
  const tied = entry.rows.filter((row) => row.wins === entry.rows.find((item) => item.playerId === playerId)?.wins);
  if (tied.length > 1) {
    const firstRank = Math.min(...tied.map((row) => row.rank));
    return `T${firstRank}`;
  }
  return entry.rows.find((row) => row.playerId === playerId)?.rank ?? "—";
}

function renderGroupSection(state, group, entry, role) {
  const { drawGroup, matches, rows, complete, pending } = entry;
  return `<section class="group-section">
    <div class="group-section-header">
      <div>
        <h3>${escapeHtml(drawGroup.name)} <span class="muted" style="font-weight:500;font-size:11px">${drawGroup.playerIds.length}人 · ${matches.length}场循环</span></h3>
        <p>${complete ? (pending ? "全部完成，但排名仍需人工裁决" : "小组赛完成，前两名已标记晋级") : `已录入 ${matches.filter((match) => match.winnerId).length}/${matches.length} 场`}</p>
      </div>
      ${pending ? '<span class="badge amber">排名待裁决</span>' : complete ? '<span class="badge green">已完成</span>' : '<span class="badge neutral">进行中</span>'}
    </div>
    <div class="group-workspace">
      <div class="standings-pane">
        <p class="pane-label">实时排名</p>
        <table class="standings-table">
          <thead><tr><th>#</th><th>选手</th><th>赛</th><th>胜</th><th>负</th><th>状态</th></tr></thead>
          <tbody>
            ${rows.map((row) => `<tr class="${row.qualifies ? "qualify" : ""} ${row.tiePending ? "pending" : ""}">
              <td class="rank-cell">${standingsRankLabel(entry, row.playerId)}</td>
              <td><div class="name">${escapeHtml(playerName(state, row.playerId))}</div><div class="muted" style="font-size:9px">${escapeHtml(playerUnitName(state, row.playerId))}</div></td>
              <td>${row.played}</td><td><strong>${row.wins}</strong></td><td>${row.losses}</td>
              <td>${row.qualifies ? '<span class="badge green">晋级</span>' : row.tiePending ? '<span class="badge amber">待裁决</span>' : complete ? '<span class="badge neutral">淘汰</span>' : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        ${pending && role === "admin" ? `<div style="margin-top:12px">${actionButton("人工确定并列排名", "tie-resolve", { data: `data-group="${group.key}" data-group-id="${drawGroup.id}"`, style: "primary", size: "small" })}</div>` : ""}
        ${pending && role !== "admin" ? '<p class="field-hint">并列选手等待管理员裁决。</p>' : ""}
      </div>
      <div class="matches-pane">
        <p class="pane-label">循环赛对阵 · 点击姓名确认胜者</p>
        <div class="match-list">
          ${matches.map((match) => `<div class="match-row ${match.schedule.status === "live" ? "mine-live" : ""}">
            <div><div class="match-code">${escapeHtml(match.code)}</div><div class="muted" style="font-size:9px;margin-top:3px">${escapeHtml(scheduleLabel(state, match))}</div></div>
            ${renderMatchPlayers(state, match, role)}
            <div class="match-actions">
              ${statusBadge(match.winnerId ? "completed" : match.schedule.status)}
              ${role === "admin" && match.winnerId ? actionButton("撤销", "undo-match", { size: "tiny", data: `data-match="${match.id}"` }) : ""}
            </div>
          </div>`).join("")}
        </div>
      </div>
    </div>
  </section>`;
}

function renderBracketPage({ state, role, selectedGroup }) {
  const selected = GROUP_BY_KEY[selectedGroup] ? selectedGroup : "new_men";
  const group = GROUP_BY_KEY[selected];
  const matches = state.matches.filter((match) => match.group === selected);
  const bracketExists =
    group.level === "new"
      ? state.draws[selected]?.knockoutCreated && matches.some((match) => match.phase === "qf")
      : state.draws[selected]?.generated && matches.some((match) => match.phase === "qualifier");
  const actions = `<div class="button-row">
    ${actionButton("全屏投影", "fullscreen", { size: "small" })}
    ${actionButton("打印签表", "print", { size: "small" })}
  </div>`;
  return `
    ${pageHeader(
      "KNOCKOUT BRACKET",
      "淘汰赛签表",
      "横向查看完整晋级树；管理员点击选手姓名确认晋级，撤销早期结果时会先检查所有下游比赛。",
      actions
    )}
    <div class="bracket-toolbar">
      <div class="segmented">
        ${GROUP_DEFS.map((entry) => `<button class="segment ${entry.key === selected ? "active" : ""}" data-action="select-group" data-group="${entry.key}">${escapeHtml(entry.name)}</button>`).join("")}
      </div>
      <span class="badge ${bracketExists ? "green" : "neutral"}">${bracketExists ? "签表已生成" : "等待生成"}</span>
    </div>
    ${
      bracketExists
        ? renderBracketShell(state, group, matches, role)
        : `<section class="card">${renderEmpty(
            "淘汰赛签表尚未生成",
            group.level === "new"
              ? "四个小组全部完成且排名确认后，在小组赛或抽签页面点击“随机生成八强签表”。"
              : "完成抽签预览并确认后，系统会生成资格赛、16强、八强、半决赛、决赛和季军赛。"
          )}</section>`
    }
  `;
}

function renderBracketShell(state, group, matches, role) {
  const phaseOrder =
    group.level === "advanced"
      ? ["qualifier", "r16", "qf", "sf", "final"]
      : ["qf", "sf", "final"];
  const phases = phaseOrder.map((phase) => ({
    phase,
    matches: matches.filter((match) => match.phase === phase).sort((a, b) => a.order - b.order)
  }));
  const layout = layoutBracket(phases);
  const third = matches.find((match) => match.phase === "third");
  const final = matches.find((match) => match.phase === "final");
  const thirdMatch = matches.find((match) => match.phase === "third");
  const champion = final?.winnerId
    ? state.players.find((player) => player.id === final.winnerId)
    : null;
  const runnerUp = final?.loserId
    ? state.players.find((player) => player.id === final.loserId)
    : null;
  const bronze = thirdMatch?.winnerId
    ? state.players.find((player) => player.id === thirdMatch.winnerId)
    : null;
  return `<section class="bracket-shell" id="print-bracket">
    <div class="bracket-header-bar">
      <div>
        <h2>${escapeHtml(group.name)} · 淘汰赛</h2>
        <p>${group.level === "advanced" ? "资格赛 → 16强 → 八强 → 半决赛 → 决赛；季军赛独立排列" : "八强 → 半决赛 → 决赛；季军赛独立排列"} · 单败淘汰</p>
      </div>
      <div class="button-row">
        <span class="badge purple">${group.level === "new" ? "单局 PAR11" : "三局两胜 PAR11 · 赛前2分钟热球"}</span>
        ${final?.winnerId ? '<span class="badge green">冠军已产生</span>' : ""}
      </div>
    </div>
    <div class="bracket-scroll">
      <div class="bracket-canvas" style="width:${layout.width}px;height:${layout.height}px">
        <svg class="bracket-svg" width="${layout.width}" height="${layout.height}" aria-hidden="true">
          ${layout.connectors
            .map(
              (line) =>
                `<path d="${line.path}" fill="none" stroke="#d0c9d8" stroke-width="1.5" stroke-linecap="round"/>`
            )
            .join("")}
        </svg>
        ${phases
          .map(
            (phase, index) =>
              `<div class="bracket-phase" style="left:${28 + index * 282}px;top:12px">${escapeHtml(PHASE_LABELS[phase.phase])}</div>`
          )
          .join("")}
        ${phases
          .flatMap((phase) =>
            phase.matches.map((match) =>
              renderBracketCard(
                state,
                match,
                layout.positions.get(match.id),
                role
              )
            )
          )
          .join("")}
      </div>
    </div>
    <div class="third-place-wrap">
      <h3>季军赛</h3>
      <p>两场半决赛的负者自动进入此对阵。</p>
      ${third ? renderThirdPlaceCard(state, third, role) : renderEmpty("季军赛尚未生成", "签表生成后将自动创建季军赛。")}
    </div>
    <div class="podium-grid">
      ${renderPodium("冠军", champion, group.key, state)}
      ${renderPodium("亚军", runnerUp, group.key, state)}
      ${renderPodium("季军", bronze, group.key, state)}
    </div>
  </section>`;
}

function layoutBracket(phases) {
  const positions = new Map();
  const cardHeight = 90;
  const connectors = [];
  const initialTop = 54;
  const rowSpacing = phases[0]?.phase === "qualifier" ? 116 : 150;
  const xFor = (index) => 28 + index * 282;

  const first = phases[0]?.matches ?? [];
  first.forEach((match, index) => {
    positions.set(match.id, {
      x: xFor(0),
      y: initialTop + index * rowSpacing,
      centerY: initialTop + index * rowSpacing + cardHeight / 2
    });
  });

  for (let phaseIndex = 1; phaseIndex < phases.length; phaseIndex += 1) {
    const previous = phases[phaseIndex - 1].matches;
    const current = phases[phaseIndex].matches;
    current.forEach((match, index) => {
      let y;
      if (current.length === previous.length) {
        y = positions.get(previous[index].id)?.y ?? initialTop + index * rowSpacing;
      } else {
        const sources = match.slots
          .map((slot) => (slot.matchId ? positions.get(slot.matchId) : null))
          .filter(Boolean);
        y = sources.length
          ? sources.reduce((sum, position) => sum + position.centerY, 0) / sources.length - cardHeight / 2
          : initialTop + index * rowSpacing * 2;
      }
      positions.set(match.id, {
        x: xFor(phaseIndex),
        y,
        centerY: y + cardHeight / 2
      });
    });
  }

  for (const phase of phases) {
    for (const match of phase.matches) {
      const target = positions.get(match.id);
      for (const slot of match.slots) {
        if (!slot.matchId) continue;
        const source = positions.get(slot.matchId);
        if (!source) continue;
        const startX = source.x + 226;
        const startY = source.centerY;
        const endX = target.x;
        const endY = target.centerY;
        const middleX = startX + (endX - startX) / 2;
        connectors.push({
          path: `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`
        });
      }
    }
  }

  const finalPositions = [...positions.values()];
  const width = xFor(phases.length - 1) + 226 + 30;
  const height =
    Math.max(360, ...finalPositions.map((position) => position.y + cardHeight + 60));
  return { positions, connectors, width, height };
}

function rawSlotLabel(state, slot) {
  if (!slot) return "待定";
  if (slot.type === "winner") {
    const match = state.matches.find((entry) => entry.id === slot.matchId);
    return match ? `${match.code} 胜者` : "胜者待定";
  }
  if (slot.type === "loser") {
    const match = state.matches.find((entry) => entry.id === slot.matchId);
    return match ? `${match.code} 负者` : "负者待定";
  }
  return "待定";
}

function bracketPlayerRow(state, match, slot, role) {
  const player = resolveSlot(state, slot);
  if (!player) {
    return `<div class="bracket-player muted"><span class="player-main">${escapeHtml(rawSlotLabel(state, slot))}</span></div>`;
  }
  const isWinner = match.winnerId === player.id;
  const isLoser = Boolean(match.winnerId && !isWinner);
  const content = `<span class="player-seed">${player.seed ? "S" : ""}</span><span class="player-main">${escapeHtml(player.name)}</span><span class="player-dept">${escapeHtml(playerUnitName(state, player.id))}</span>`;
  if (role === "admin") {
    return `<button type="button" class="bracket-player ${isWinner ? "winner" : ""} ${isLoser ? "loser" : ""}" data-action="winner" data-match="${match.id}" data-player="${player.id}" title="点击确认 ${escapeHtml(player.name)} 获胜">${content}</button>`;
  }
  return `<div class="bracket-player ${isWinner ? "winner" : ""} ${isLoser ? "loser" : ""}">${content}</div>`;
}

function renderBracketCard(state, match, position, role) {
  if (!position) return "";
  const status =
    match.schedule.status === "live"
      ? "进行中"
      : match.winnerId
        ? "已完成"
        : `${timeLabelFromDate(match.schedule.startAt)} · ${match.schedule.court ? `${match.schedule.court}号场` : "待排"}`;
  return `<article class="bracket-card ${match.schedule.status === "live" ? "is-live" : ""}" style="left:${position.x}px;top:${position.y}px">
    <div class="bracket-card-head">
      <span>${escapeHtml(match.code)}</span>
      <span>${escapeHtml(status)}</span>
    </div>
    ${match.slots.map((slot) => bracketPlayerRow(state, match, slot, role)).join("")}
  </article>`;
}

function renderThirdPlaceCard(state, match, role) {
  const players = getMatchPlayers(state, match);
  return `<div class="match-row" style="max-width:760px">
    <div><div class="match-code">${escapeHtml(match.code)}</div><div class="muted" style="font-size:9px;margin-top:3px">${escapeHtml(scheduleLabel(state, match))}</div></div>
    ${renderMatchPlayers(state, match, role)}
    <div class="match-actions">${statusBadge(match.winnerId ? "completed" : match.schedule.status)}</div>
  </div>`;
}

function renderPodium(label, player, groupKey, state) {
  return `<div class="podium-card">
    <div class="podium-place">${escapeHtml(label)}</div>
    <div class="podium-name">${player ? escapeHtml(player.name) : "待产生"}</div>
    <div class="podium-dept">${player ? escapeHtml(playerUnitName(state, player.id)) : `${escapeHtml(GROUP_BY_KEY[groupKey]?.name ?? "")} · 等待决赛`}</div>
  </div>`;
}

function renderSchedulePage({ state, role, selectedGroup }) {
  const admin = role === "admin";
  const stats = getStats(state);
  const validation = state.matches.length
    ? validateSchedule(state)
    : { errors: [], warnings: [], unassigned: 0 };
  const groupKey = GROUP_BY_KEY[selectedGroup] ? selectedGroup : "new_men";
  const selectedMatches = state.matches
    .filter((match) => match.group === groupKey)
    .sort((left, right) => {
      const leftTime = left.schedule.startAt ? new Date(left.schedule.startAt).getTime() : Infinity;
      const rightTime = right.schedule.startAt ? new Date(right.schedule.startAt).getTime() : Infinity;
      return leftTime - rightTime || left.roundIndex - right.roundIndex || left.order - right.order;
    });
  return `
    ${pageHeader(
      "MATCH-DAY OPERATIONS",
      "比赛日调度台",
      "四片场地共用；12:00–14:00 禁止排赛。进阶组默认17分钟含2分钟热球，新手组默认7分钟。",
      admin
        ? `<div class="button-row">
             ${actionButton("自动排场", "auto-schedule", { style: "primary", disabled: !state.matches.length })}
             ${actionButton("排场设置", "schedule-settings", { size: "small" })}
           </div>`
        : ""
    )}
    <section class="stats-grid">
      <article class="stat-card"><span class="stat-label">已排比赛</span><strong class="stat-value">${stats.total - stats.unassigned}</strong><span class="stat-foot">共 ${stats.total} 场</span></article>
      <article class="stat-card"><span class="stat-label">待开始</span><strong class="stat-value">${state.matches.filter((match) => !match.winnerId && match.schedule.startAt).length}</strong><span class="stat-foot">已分配时间与场地</span></article>
      <article class="stat-card"><span class="stat-label">进行中</span><strong class="stat-value">${stats.live}</strong><span class="stat-foot">可由管理员手动标记</span></article>
      <article class="stat-card"><span class="stat-label">冲突</span><strong class="stat-value">${validation.errors.length}</strong><span class="stat-foot">${validation.unassigned} 场未安排</span></article>
    </section>
    ${
      validation.errors.length
        ? `<div class="error-box" style="margin-bottom:18px"><div><strong>必须处理的排场冲突（${validation.errors.length}）</strong>${validation.errors
            .slice(0, 8)
            .map((error) => escapeHtml(error))
            .join("<br>")}${validation.errors.length > 8 ? `<br>另有 ${validation.errors.length - 8} 项…` : ""}</div></div>`
        : state.matches.length
          ? `<div class="info-box" style="margin-bottom:18px"><div><strong>排场约束检查</strong>当前未发现场地重叠、比赛时段越界、午间排赛、依赖顺序或已知选手休息冲突。未安排的比赛会显示在下方清单。</div></div>`
          : ""
    }
    <div class="schedule-board">
      ${[1, 2, 3, 4].map((court) => renderScheduleCourt(state, court, admin)).join("")}
    </div>
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">比赛清单</h2>
          <p class="card-subtitle">${escapeHtml(GROUP_BY_KEY[groupKey].name)} · ${selectedMatches.length} 场</p>
        </div>
        <div class="segmented">
          ${GROUP_DEFS.map((group) => `<button class="segment ${group.key === groupKey ? "active" : ""}" data-action="select-group" data-group="${group.key}">${escapeHtml(group.short)}</button>`).join("")}
        </div>
      </div>
      ${
        selectedMatches.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>比赛</th><th>阶段</th><th>对阵</th><th>时间 / 场地</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${selectedMatches.map((match) => renderScheduleTableRow(state, match, admin)).join("")}</tbody>
            </table></div>`
          : renderEmpty("该组尚无比赛", "先在抽签页面确认签表，比赛才会进入调度台。")
      }
    </section>
  `;
}

function renderScheduleCourt(state, court, admin) {
  const courtState = getCourtState(state, court);
  const current = courtState.live ?? courtState.current;
  const next = courtState.assigned
    .filter((match) => match.id !== current?.id && !match.winnerId)
    .slice(0, 1)[0];
  const players = current ? getMatchPlayers(state, current).filter(Boolean) : [];
  return `<section class="schedule-court">
    <div class="schedule-court-head"><span>COURT ${court} · ${court}号场</span>${current?.schedule.status === "live" ? '<span class="badge blue">进行中</span>' : '<span class="badge neutral">待赛</span>'}</div>
    <div class="schedule-court-body">
      ${
        current
          ? `<div class="court-match-label">${escapeHtml(current.code)} · ${shortGroupName(current.group)} · ${escapeHtml(PHASE_LABELS[current.phase])}</div>
             <div class="court-match-title">${players.length === 2 ? players.map((player) => escapeHtml(player.name)).join(" vs ") : "对阵双方待定"}</div>
             <div class="court-match-meta">${timeLabelFromDate(current.schedule.startAt)}–${timeLabelFromDate(current.schedule.endAt)} · 预计${current.schedule.estimatedMinutes}分钟</div>
             <div class="court-match-actions">
               ${admin && !current.winnerId && current.schedule.status !== "live" ? actionButton("开始", "mark-live", { size: "tiny", data: `data-match="${current.id}"` }) : ""}
               ${admin ? actionButton("调整", "match-schedule", { size: "tiny", data: `data-match="${current.id}"` }) : ""}
             </div>`
          : '<div class="court-empty">当前没有待进行比赛</div>'
      }
      <div class="court-match-meta" style="margin-top:16px;padding-top:12px;border-top:1px solid #eceaf0">
        下一场：${next ? `${escapeHtml(next.code)} · ${timeLabelFromDate(next.schedule.startAt)}` : "待安排"}
      </div>
    </div>
  </section>`;
}

function renderScheduleTableRow(state, match, admin) {
  return `<tr>
    <td class="match-code">${escapeHtml(match.code)}</td>
    <td>${escapeHtml(PHASE_LABELS[match.phase])}</td>
    <td>${renderMatchPlayers(state, match, roleFromAdmin(admin))}</td>
    <td><div>${match.schedule.startAt ? `${timeLabelFromDate(match.schedule.startAt)}–${timeLabelFromDate(match.schedule.endAt)}` : "待安排"}</div><div class="muted" style="font-size:10px">${match.schedule.court ? `${match.schedule.court}号场` : "未指定场地"} · ${match.schedule.estimatedMinutes ?? "—"}分钟</div></td>
    <td>${statusBadge(match.winnerId ? "completed" : match.schedule.status)}</td>
    <td><div class="inline-actions">
      ${admin && !match.winnerId ? actionButton("开始", "mark-live", { size: "tiny", data: `data-match="${match.id}"`, disabled: match.schedule.status === "live" }) : ""}
      ${admin ? actionButton("排场", "match-schedule", { size: "tiny", data: `data-match="${match.id}"` }) : ""}
      ${admin && match.winnerId ? actionButton("撤销", "undo-match", { size: "tiny", data: `data-match="${match.id}"` }) : ""}
    </div></td>
  </tr>`;
}

function roleFromAdmin(admin) {
  return admin ? "admin" : "viewer";
}

function renderTeamsPage({ state, role }) {
  const teams = calculateTeamStandings(state);
  const placements = getPlacementRows(state);
  const champion = teams[0]?.total > 0 ? teams[0] : null;
  const finalComplete =
    state.matches.filter((match) => match.phase === "final").length === 4 &&
    state.matches.filter((match) => match.phase === "final").every((match) => match.winnerId);
  return `
    ${pageHeader(
      "TEAM SCORING",
      "院系团体积分榜",
      "八个联合参赛单位计分；外院系个人名次对应的团队分值空缺，不顺延。校友积分归入原所属院系。",
      role === "admin" ? actionButton("编辑积分规则", "points-edit", { size: "small" }) : ""
    )}
    <div class="info-box" style="margin-bottom:18px">
      <div><strong>${finalComplete ? "最终团体成绩" : "实时团体排名"}</strong>${champion ? `${escapeHtml(champion.unitName)}当前以 ${champion.total} 分位列第一。` : "等待前八名产生后自动计分。"} 积分值来自管理员可编辑的规则，未写死在赛制逻辑中。</div>
    </div>
    <section class="card" style="margin-bottom:18px">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>排名</th><th>联合参赛单位</th>${GROUP_DEFS.map((group) => `<th class="num">${escapeHtml(group.name)}</th>`).join("")}<th class="num">总分</th></tr></thead>
          <tbody>
            ${teams.map((team) => `<tr>
              <td><span class="rank-medal ${team.rank === 1 ? "gold" : team.rank === 2 ? "silver" : team.rank === 3 ? "bronze" : ""}">${team.tied ? "T" : ""}${team.rank}</span></td>
              <td class="name">${escapeHtml(team.unitName)}${team.rank === 1 && team.total > 0 && finalComplete ? ' <span class="badge green">团体冠军</span>' : ""}</td>
              ${GROUP_DEFS.map((group) => `<td class="num">${team.byGroup[group.key] || "—"}</td>`).join("")}
              <td class="num score-total">${team.total}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">个人名次与积分明细</h2>
          <p class="card-subtitle">前八名按当前规则计分；并列名次使用同一档积分</p>
        </div>
        <span class="badge purple">规则：1–8名 ${[1, 2, 3, 4, 5, 6, 7, 8].map((place) => state.settings.pointsByPlace[place] ?? 0).join(" / ")}</span>
      </div>
      ${
        placements.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>组别</th><th>名次</th><th>选手</th><th>院系</th><th>积分归属</th><th class="num">积分</th></tr></thead>
              <tbody>${placements.map((row) => `<tr>
                <td>${escapeHtml(row.groupName)}</td>
                <td>${escapeHtml(row.placeLabel)}</td>
                <td class="name">${escapeHtml(row.player.name)}${row.player.alumni ? ' <span class="badge purple">校友</span>' : ""}</td>
                <td>${escapeHtml(row.player.department)}</td>
                <td>${row.pointsUnit ? escapeHtml(row.pointsUnit.name) : '<span class="badge neutral">外院系 · 团队分值空缺</span>'}</td>
                <td class="num">${row.pointsUnit ? row.points : "—"}</td>
              </tr>`).join("")}</tbody>
            </table></div>`
          : renderEmpty("尚无前八名", "淘汰赛产生八强后，个人名次与院系积分会出现在这里。")
      }
    </section>
  `;
}

function renderPlayersPage({ state, role, selectedGroup }) {
  if (role !== "admin") {
    return `<section class="card">${renderEmpty("仅管理员可访问名单管理", "请使用赛事管理员私密链接进行名单维护。")}</section>`;
  }
  const groupKey = GROUP_BY_KEY[selectedGroup] ? selectedGroup : "new_men";
  const group = GROUP_BY_KEY[groupKey];
  const players = state.players.filter((player) => player.group === groupKey);
  const validation = validateAllRoster(state);
  return `
    ${pageHeader(
      "ROSTER OPERATIONS",
      "参赛名单管理",
      "Excel只导入姓名、院系、组别三列；系统生成稳定内部ID，校友、积分归属和进阶种子在网页中维护。",
      `<div class="button-row">
         <a class="button" href="#" data-action="template-download">下载Excel模板</a>
         <label class="button">导入Excel<input type="file" accept=".xlsx" data-file="roster" hidden></label>
         ${actionButton("导出当前组", "export-roster", { data: `data-group="${groupKey}"`, size: "small" })}
       </div>`
    )}
    ${
      validation.errors.length
        ? `<div class="error-box" style="margin-bottom:16px"><div><strong>名单校验发现 ${validation.errors.length} 个错误</strong>${validation.errors
            .slice(0, 8)
            .map(escapeHtml)
            .join("<br>")}</div></div>`
        : `<div class="info-box" style="margin-bottom:16px"><div><strong>名单基础校验通过</strong>${validation.warnings.length ? validation.warnings.map(escapeHtml).join("<br>") : "四个组别的人数配置符合初始赛制。"}</div></div>`
    }
    <div class="filter-bar" style="justify-content:space-between">
      <div class="segmented">
        ${GROUP_DEFS.map((entry) => `<button class="segment ${entry.key === groupKey ? "active" : ""}" data-action="select-group" data-group="${entry.key}">${escapeHtml(entry.name)}</button>`).join("")}
      </div>
      <div class="inline-actions">
        ${actionButton("新增选手", "player-add", { style: "primary", size: "small" })}
        ${actionButton("导出四组名单", "export-all-rosters", { size: "small" })}
      </div>
    </div>
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${escapeHtml(group.name)} · ${players.length}人</h2>
          <p class="card-subtitle">${group.level === "advanced" ? `种子 ${players.filter((player) => player.seed).length}/8，须来自8个不同参赛单位` : "前两名晋级八强"}</p>
        </div>
        ${pageHeaderBadgeForRoster(group, players)}
      </div>
      ${
        players.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>选手姓名</th><th>院系</th><th>联合参赛单位</th><th>身份</th>${group.level === "advanced" ? "<th>种子</th>" : ""}<th>当前成绩</th><th>操作</th></tr></thead>
              <tbody>${players.map((player) => renderPlayerRow(state, player, group)).join("")}</tbody>
            </table></div>`
          : renderEmpty("该组暂无选手", "通过Excel导入，或点击新增选手。")
      }
    </section>
  `;
}

function pageHeaderBadgeForRoster(group, players) {
  if (group.level === "advanced") {
    const seeds = players.filter((player) => player.seed).length;
    return `<span class="badge ${seeds === 8 ? "green" : "amber"}">种子 ${seeds}/8</span>`;
  }
  return `<span class="badge purple">${group.initialSize}人初始配置</span>`;
}

function renderPlayerRow(state, player, group) {
  const placement = getPlacements(state, group.key).get(player.id);
  return `<tr>
    <td class="name">${escapeHtml(player.name)}</td>
    <td>${escapeHtml(player.department)}</td>
    <td>${player.unitId ? escapeHtml(playerUnitName(state, player.id)) : '<span class="badge neutral">外院系</span>'}</td>
    <td>${player.alumni ? '<span class="badge purple">校友</span>' : "在校生"}</td>
    ${group.level === "advanced" ? `<td>${player.seed ? '<span class="badge green">种子</span>' : "—"}</td>` : ""}
    <td>${placement ? escapeHtml(placementLabel(placement)) : '<span class="muted">未产生</span>'}</td>
    <td><div class="inline-actions">
      ${actionButton("编辑", "player-edit", { size: "tiny", data: `data-player="${player.id}"` })}
      ${actionButton("删除", "player-delete", { size: "tiny", style: "danger", data: `data-player="${player.id}"` })}
    </div></td>
  </tr>`;
}

function renderSettingsPage({ state, role, adminPath }) {
  if (role !== "admin") {
    return `<section class="card">${renderEmpty("仅管理员可访问设置", "该页面含有数据管理、积分规则和管理员链接信息。")}</section>`;
  }
  const validation = validateAllRoster(state);
  const currentAdminUrl = new URL(adminPath || window.location.pathname, window.location.origin).href;
  return `
    ${pageHeader(
      "CONFIGURATION & DATA",
      "设置与数据安全",
      "管理院系映射、积分规则、排场参数、数据备份和操作记录。",
      actionButton("返回首页", "navigate", { data: 'data-view="dashboard"', size: "small" })
    )}
    <div class="content-grid">
      <div class="content-stack">
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">赛事基本参数</h2><p class="card-subtitle">当前赛事配置</p></div>${actionButton("编辑赛事信息", "event-edit", { size: "small" })}</div>
          <div class="card-body">
            <div class="field-grid">
              <div><span class="field-label">赛事名称</span><p>${escapeHtml(state.meta.name)}</p></div>
              <div><span class="field-label">日期</span><p>${escapeHtml(state.meta.date)}</p></div>
              <div><span class="field-label">地点</span><p>${escapeHtml(state.meta.venue)}</p></div>
              <div><span class="field-label">场地数</span><p>${state.meta.courts} 片</p></div>
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">联合参赛单位与院系映射</h2><p class="card-subtitle">同单位院校名称合并；其他院系可参赛但不产生团队积分</p></div>${actionButton("编辑映射", "units-edit", { size: "small" })}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>计分单位</th><th>可识别院系名称</th><th>状态</th></tr></thead><tbody>
            ${state.units.map((unit) => `<tr><td class="name">${escapeHtml(unit.name)}</td><td>${unit.aliases.map(escapeHtml).join("、")}</td><td>${unit.active ? '<span class="badge green">启用</span>' : '<span class="badge neutral">停用</span>'}</td></tr>`).join("")}
          </tbody></table></div>
        </section>
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">操作记录</h2><p class="card-subtitle">保留最近500条关键操作</p></div></div>
          ${state.audit.length ? `<div class="audit-list">${state.audit.slice(0, 40).map((entry) => `<div class="audit-row"><span class="audit-time">${escapeHtml(dateLabel(entry.at))}</span><span class="audit-action">${escapeHtml(entry.action)}</span><span class="audit-detail">${escapeHtml(entry.detail)}</span></div>`).join("")}</div>` : renderEmpty("暂无操作记录", "抽签、成绩、排场与设置操作会自动记录。")}
        </section>
      </div>
      <div class="content-stack">
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">管理员私密链接</h2><p class="card-subtitle">拥有全部编辑权限</p></div><span class="badge red">请勿公开</span></div>
          <div class="card-body">
            <div class="warning-box"><div><strong>仅赛事核心成员可持有</strong>任何获得此链接的人都能修改成绩、抽签和赛事数据。观众页面不会出现此链接。</div></div>
            <div style="height:12px"></div>
            <div class="field"><label>当前管理员链接</label><input class="input" readonly value="${escapeHtml(currentAdminUrl)}" /></div>
            <div class="button-row" style="margin-top:12px">${actionButton("复制管理员链接", "copy-admin-link", { size: "small" })}</div>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">数据备份与恢复</h2><p class="card-subtitle">每次保存自动保留上一版服务端快照</p></div></div>
          <div class="card-body">
            <div class="button-row">
              ${actionButton("下载完整JSON备份", "backup-download", { size: "small" })}
              <label class="button small">从JSON恢复<input type="file" accept=".json" data-file="backup" hidden></label>
              ${actionButton("恢复上一版", "restore-previous", { size: "small" })}
            </div>
            <div style="height:14px"></div>
            <div class="info-box"><div><strong>服务端保存</strong>本次数据版本 v${state.meta.version}，最后保存于 ${escapeHtml(dateLabel(state.meta.updatedAt))}。保存失败会明确报错，不会显示为成功。</div></div>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">赛事结果导出</h2><p class="card-subtitle">Excel工作簿与打印签表</p></div></div>
          <div class="card-body">
            <div class="button-row">
              ${actionButton("导出全部结果工作簿", "export-results", { data: 'data-type="sheets"', style: "primary", size: "small" })}
              ${actionButton("小组赛对阵及成绩", "export-results", { data: 'data-type="group"', size: "small" })}
              ${actionButton("淘汰赛结果", "export-results", { data: 'data-type="knockout"', size: "small" })}
              ${actionButton("院系积分榜", "export-results", { data: 'data-type="score"', size: "small" })}
              ${actionButton("四组参赛名单", "export-results", { data: 'data-type="roster"', size: "small" })}
              ${actionButton("打印当前签表", "print", { size: "small" })}
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">测试与重置</h2><p class="card-subtitle">以下操作不可回退，需二次确认</p></div></div>
          <div class="card-body">
            <div class="button-row">
              ${actionButton("载入84人模拟数据", "reset-demo", { style: "danger", size: "small" })}
              ${actionButton("清空为正式空赛事", "reset-empty", { style: "danger", size: "small" })}
            </div>
            <p class="field-hint" style="margin-top:12px">正式启用前，先下载备份，再清空模拟数据并导入真实名单。当前名单校验：${validation.errors.length ? `${validation.errors.length}个错误` : "通过"}；${validation.warnings.length}项提醒。</p>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><div><h2 class="card-title">实时同步说明</h2><p class="card-subtitle">当前技术状态</p></div></div>
          <div class="card-body">
            <div class="info-box"><div><strong>服务端数据 + 自动同步</strong>管理员保存成功后，观众页面会自动获取新版本；免费云部署使用约5秒轮询，Node部署支持即时SSE推送。私密令牌始终由服务端校验。</div></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function modalShell({ title, subtitle = "", body, footer = "", large = false }) {
  return `<div class="modal-backdrop" data-action="modal-backdrop">
    <section class="modal ${large ? "large" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <div><h2 id="modal-title">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div>
        <button type="button" class="modal-close" data-action="modal-close" aria-label="关闭">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
    </section>
  </div>`;
}

function cancelButton() {
  return actionButton("取消", "modal-close", { size: "small" });
}

function timeInputValue(iso, fallback = "09:00") {
  if (!iso) return fallback;
  return timeLabelFromDate(iso);
}

export function renderModal(modal, state, role = "admin") {
  if (!modal) return "";
  if (modal.type === "winner") return renderWinnerModal(modal, state, role);
  if (modal.type === "undo") return renderUndoModal(modal, state);
  if (modal.type === "tie") return renderTieModal(modal, state);
  if (modal.type === "swap-draw") return renderSwapDrawModal(modal, state);
  if (modal.type === "player") return renderPlayerModal(modal, state);
  if (modal.type === "match-schedule") return renderMatchScheduleModal(modal, state);
  if (modal.type === "points") return renderPointsModal(modal, state);
  if (modal.type === "units") return renderUnitsModal(modal, state);
  if (modal.type === "event") return renderEventModal(modal, state);
  if (modal.type === "schedule-settings") return renderScheduleSettingsModal(modal, state);
  if (modal.type === "import-preview") return renderImportPreviewModal(modal, state);
  if (modal.type === "delete-player") return renderDeletePlayerModal(modal, state);
  if (modal.type === "generic") return renderGenericModal(modal);
  return "";
}

function renderWinnerModal(modal, state, role) {
  const match = state.matches.find((entry) => entry.id === modal.data.matchId);
  if (!match) return renderGenericModal({ data: { title: "比赛不存在", message: "请刷新页面后重试。" } });
  const players = getMatchPlayers(state, match);
  if (players.filter(Boolean).length !== 2) {
    return renderGenericModal({
      data: {
        title: "对阵尚未确定",
        message: "必须先完成相关上游比赛，双方选手都确定后才能录入胜负。"
      }
    });
  }
  const impact = getImpactOfResultChange(state, match.id).filter((entry) => entry.id !== match.id);
  const selected = match.winnerId === modal.data.playerId;
  return modalShell({
    title: match.winnerId ? "修改比赛结果" : "确认比赛胜负",
    subtitle: `${match.code} · ${GROUP_BY_KEY[match.group].name} · ${PHASE_LABELS[match.phase]}`,
    body: `<div class="winner-choice">
      ${players.map((player) => `<button type="button" class="winner-choice-card" data-action="confirm-winner" data-match="${match.id}" data-player="${player.id}" ${selected && player.id === modal.data.playerId ? 'style="border-color:var(--purple-600);background:var(--purple-50)"' : ""}>
        <strong>${escapeHtml(player.name)}${player.seed ? ' <span class="badge purple">种子</span>' : ""}</strong>
        <span>${escapeHtml(playerUnitName(state, player.id))}</span>
      </button>`).join("")}
    </div>
    <div class="info-box"><div><strong>点击选手卡片即确认胜者</strong>胜者显示为绿色并自动进入下一轮；负者自动变灰。半决赛负者同时进入季军赛。</div></div>
    ${
      impact.length
        ? `<div class="modal-impact"><strong>将撤销以下已开始或已完成的后续比赛：</strong><br>${impact.map((entry) => `${escapeHtml(entry.code)}（${escapeHtml(PHASE_LABELS[entry.phase])}）`).join("、")}<br>确认后由系统按依赖顺序清除，不会静默覆盖。</div>`
        : ""
    }
    ${match.winnerId ? `<p class="field-hint" style="margin-top:12px">当前胜者：${escapeHtml(playerName(state, match.winnerId))}。选择另一名选手将纠正结果。</p>` : ""}`,
    footer: cancelButton()
  });
}

function renderUndoModal(modal, state) {
  const match = state.matches.find((entry) => entry.id === modal.data.matchId);
  if (!match) return renderGenericModal({ data: { title: "比赛不存在", message: "请刷新页面。" } });
  const impact = getImpactOfResultChange(state, match.id).filter((entry) => entry.id !== match.id);
  return modalShell({
    title: "撤销比赛结果",
    subtitle: `${match.code} · ${escapeHtml(playerName(state, match.winnerId))} 当前为胜者`,
    body: `<form id="modal-form" data-modal-type="undo">
      ${impact.length ? `<div class="error-box"><div><strong>下游已有结果</strong>${impact.map((entry) => escapeHtml(entry.code)).join("、")} 将被一并撤销。系统会按正确依赖顺序处理。</div></div><div style="height:12px"></div>` : ""}
      <div class="field"><label for="undo-reason">撤销原因（必填）</label><textarea class="textarea" id="undo-reason" name="reason" required placeholder="例如：计分员误选、现场复核后纠正"></textarea></div>
    </form>`,
    footer: `${cancelButton()}${actionButton("确认撤销", "submit-modal", { style: "danger", size: "small" })}`
  });
}

function renderTieModal(modal, state) {
  const group = GROUP_BY_KEY[modal.data.groupKey];
  const standings = getGroupStandings(state, modal.data.groupKey, modal.data.groupId);
  const pending = standings.rows.filter((row) => row.tiePending);
  const tieSignature = pending[0]?.tieSignature;
  const tied = pending.filter((row) => row.tieSignature === tieSignature);
  return modalShell({
    title: "并列排名人工裁决",
    subtitle: `${group.name} · ${standings.drawGroup.name}`,
    body: `<form id="modal-form" data-modal-type="tie">
      <div class="warning-box"><div><strong>排名规则</strong>并列选手之间出现循环胜负或规则仍无法区分。请根据赛事规程人工确定最终顺序，并填写裁决原因。此操作会写入操作记录。</div></div>
      <div style="height:14px"></div>
      <div class="field-grid">
        ${tied.map((row, index) => `<div class="field"><label>第 ${index + 1} 位</label><select class="select" name="order${index}" required>
          ${tied.map((candidate) => `<option value="${candidate.playerId}" ${candidate.playerId === row.playerId ? "selected" : ""}>${escapeHtml(playerName(state, candidate.playerId))} · ${candidate.wins}胜</option>`).join("")}
        </select><span class="field-hint">当前 ${escapeHtml(playerName(state, row.playerId))}</span></div>`).join("")}
      </div>
      <div style="height:12px"></div>
      <div class="field"><label>裁决原因（必填）</label><textarea class="textarea" name="reason" required placeholder="填写依据与裁决说明"></textarea></div>
    </form>`,
    footer: `${cancelButton()}${actionButton("保存裁决", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderSwapDrawModal(modal, state) {
  const groupKey = modal.data.groupKey;
  const group = GROUP_BY_KEY[groupKey];
  const players = state.players.filter((player) => player.group === groupKey);
  const options = (excluded = "") =>
    players
      .filter((player) => player.id !== excluded)
      .map(
        (player) =>
          `<option value="${player.id}">${escapeHtml(player.name)} · ${escapeHtml(playerUnitName(state, player.id))}</option>`
      )
      .join("");
  return modalShell({
    title: group.level === "new" ? "手动交换小组选手" : "手动交换签位",
    subtitle: `${group.name} · 仅抽签预览状态可操作`,
    body: `<form id="modal-form" data-modal-type="swap-draw" data-group="${groupKey}">
      <div class="info-box"><div><strong>${group.level === "new" ? "交换不同小组中的两名选手" : "种子只能与种子交换，非种子只能与非种子交换"}</strong>交换后会保留安全随机抽签的其余结果，并写入操作记录。</div></div>
      <div style="height:14px"></div>
      <div class="field-grid">
        <div class="field"><label>选手 A</label><select class="select" name="playerA" required><option value="">请选择</option>${options()}</select></div>
        <div class="field"><label>选手 B</label><select class="select" name="playerB" required><option value="">请选择</option>${options()}</select></div>
      </div>
    </form>`,
    footer: `${cancelButton()}${actionButton("确认交换", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderPlayerModal(modal, state) {
  const player = modal.data.playerId
    ? state.players.find((entry) => entry.id === modal.data.playerId)
    : null;
  const groupKey = player?.group ?? modal.data.groupKey ?? "new_men";
  const unit = state.units.find((entry) => entry.id === player?.unitId);
  const pointsUnit = state.units.find(
    (entry) => entry.id === (player?.pointsUnitId ?? player?.unitId)
  );
  return modalShell({
    title: player ? "编辑参赛选手" : "新增参赛选手",
    subtitle: player ? player.name : "内部ID将由系统自动生成",
    body: `<form id="modal-form" data-modal-type="player" data-player="${player?.id ?? ""}">
      <div class="field-grid">
        <div class="field"><label>选手姓名 *</label><input class="input" name="name" required value="${escapeHtml(player?.name ?? "")}" /></div>
        <div class="field"><label>组别 *</label><select class="select" name="group" required>
          ${GROUP_DEFS.map((group) => `<option value="${group.key}" ${group.key === groupKey ? "selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}
        </select></div>
        <div class="field"><label>院系 / 原始参赛单位 *</label><input class="input" name="department" required value="${escapeHtml(player?.department ?? "")}" list="department-list" />
          <datalist id="department-list">${state.units.flatMap((entry) => entry.aliases.map((alias) => `<option value="${escapeHtml(alias)}"></option>`)).join("")}</datalist>
        </div>
        <div class="field"><label>计分归属单位覆盖</label><select class="select" name="unitId"><option value="">按院系自动识别 / 外院系</option>
          ${state.units.map((entry) => `<option value="${entry.id}" ${entry.id === unit?.id ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}
        </select><span class="field-hint">只在院系别名未匹配或需要手动覆盖时选择。</span></div>
        <div class="field"><label>校友身份</label><label class="check-row"><input type="checkbox" name="alumni" ${player?.alumni ? "checked" : ""} /> 标记为校友</label><span class="field-hint">校友个人成绩归入原所属院系。</span></div>
        <div class="field"><label>校友积分归属</label><select class="select" name="pointsUnitId"><option value="">随院系映射</option>
          ${state.units.map((entry) => `<option value="${entry.id}" ${entry.id === pointsUnit?.id ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}
        </select></div>
        <div class="field full"><label class="check-row"><input type="checkbox" name="seed" ${player?.seed ? "checked" : ""} /> 进阶组种子选手</label><span class="field-hint">只对进阶组有效。每个组必须从8个不同参赛单位各指定1名种子。</span></div>
      </div>
    </form>`,
    footer: `${cancelButton()}${actionButton(player ? "保存修改" : "新增选手", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderDeletePlayerModal(modal, state) {
  const player = state.players.find((entry) => entry.id === modal.data.playerId);
  if (!player) return "";
  const hadDraw = state.matches.some((match) =>
    getMatchPlayers(state, match).some((entry) => entry?.id === player.id)
  );
  return modalShell({
    title: "删除参赛选手",
    subtitle: `${player.name} · ${GROUP_BY_KEY[player.group].name}`,
    body: `<div class="error-box"><div><strong>此操作会删除名单记录</strong>${hadDraw ? "该选手已经出现在已生成赛程中。删除后必须重新抽签或修复相关比赛，否则名单与签表将不一致。" : "删除后可在保存前取消，但保存后需通过备份恢复。"}</div></div>
      <form id="modal-form" data-modal-type="delete-player" data-player="${player.id}">
        <div style="height:12px"></div>
        <div class="field"><label>输入选手姓名以确认</label><input class="input" name="confirmName" autocomplete="off" required placeholder="${escapeHtml(player.name)}" /></div>
      </form>`,
    footer: `${cancelButton()}${actionButton("确认删除", "submit-modal", { style: "danger", size: "small" })}`
  });
}

function renderMatchScheduleModal(modal, state) {
  const match = state.matches.find((entry) => entry.id === modal.data.matchId);
  if (!match) return "";
  return modalShell({
    title: "调整比赛排场",
    subtitle: `${match.code} · ${GROUP_BY_KEY[match.group].name} · ${PHASE_LABELS[match.phase]}`,
    body: `<form id="modal-form" data-modal-type="match-schedule" data-match="${match.id}">
      ${match.group && GROUP_BY_KEY[match.group].level === "advanced" ? '<div class="info-box"><div><strong>进阶组时长包含赛前2分钟热球</strong>默认17分钟，可在本场比赛调整预计时长。</div></div><div style="height:12px"></div>' : ""}
      <div class="field-grid">
        <div class="field"><label>场地</label><select class="select" name="court" required>
          ${[1, 2, 3, 4].map((court) => `<option value="${court}" ${match.schedule.court === court ? "selected" : ""}>${court}号场</option>`).join("")}
        </select></div>
        <div class="field"><label>预计开始时间</label><input class="input" type="time" name="startTime" min="09:00" max="18:00" step="60" value="${timeInputValue(match.schedule.startAt)}" required /></div>
        <div class="field"><label>预计时长（分钟）</label><input class="input" type="number" name="estimatedMinutes" min="3" max="120" value="${match.schedule.estimatedMinutes ?? (GROUP_BY_KEY[match.group].level === "new" ? 7 : 17)}" required /></div>
        <div class="field"><label>状态</label><select class="select" name="status">
          ${["scheduled", "live", "unassigned"].map((status) => `<option value="${status}" ${match.schedule.status === status ? "selected" : ""}>${MATCH_STATUS_LABELS[status]}</option>`).join("")}
        </select></div>
      </div>
      <p class="field-hint" style="margin-top:12px">保存时会重新检查场地重叠、午间禁排、场地容量和选手已知冲突。存在硬冲突时会明确提示。</p>
    </form>`,
    footer: `${cancelButton()}${actionButton("保存排场", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderPointsModal(modal, state) {
  return modalShell({
    title: "编辑个人名次积分规则",
    subtitle: "并列名次使用同一档积分；空白或0均不会顺延给下一名",
    body: `<form id="modal-form" data-modal-type="points">
      <div class="config-grid">
        ${[1, 2, 3, 4, 5, 6, 7, 8].map((place) => `<div class="config-field"><label>${escapeHtml(placementLabel(place))}</label><input class="input" type="number" min="0" max="1000" name="place${place}" value="${state.settings.pointsByPlace[place] ?? 0}" /></div>`).join("")}
      </div>
      <div class="info-box" style="margin-top:14px"><div><strong>外院系名次处理</strong>若外院系选手获得前八名，其对应分值直接空缺，不转移给后一名。校友积分归入管理员指定或原院系映射的联合单位。</div></div>
    </form>`,
    footer: `${cancelButton()}${actionButton("保存积分规则", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderUnitsModal(modal, state) {
  return modalShell({
    title: "编辑联合参赛单位与院系映射",
    subtitle: "每行一个单位；别名用顿号、逗号或换行分隔",
    large: true,
    body: `<form id="modal-form" data-modal-type="units">
      <div style="display:grid;gap:10px">
        ${state.units.map((unit, index) => `<div class="config-field"><div class="field-grid"><div class="field"><label>单位 ${index + 1} 名称</label><input class="input" name="unitName${index}" value="${escapeHtml(unit.name)}" required /></div><div class="field"><label>可识别院系别名</label><textarea class="textarea" name="unitAliases${index}" required style="min-height:62px">${escapeHtml(unit.aliases.join("\n"))}</textarea></div></div><input type="hidden" name="unitId${index}" value="${unit.id}" /></div>`).join("")}
      </div>
    </form>`,
    footer: `${cancelButton()}${actionButton("保存映射", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderEventModal(modal, state) {
  return modalShell({
    title: "编辑赛事基本参数",
    subtitle: "修改赛事名称、日期、地点与场地数量",
    body: `<form id="modal-form" data-modal-type="event">
      <div class="field-grid">
        <div class="field full"><label>赛事名称</label><input class="input" name="name" value="${escapeHtml(state.meta.name)}" required /></div>
        <div class="field"><label>日期</label><input class="input" type="date" name="date" value="${escapeHtml(state.meta.date)}" required /></div>
        <div class="field"><label>场地数量</label><input class="input" type="number" name="courts" min="1" max="8" value="${state.meta.courts}" required /></div>
        <div class="field full"><label>地点</label><input class="input" name="venue" value="${escapeHtml(state.meta.venue)}" required /></div>
        <div class="field full"><label>时段显示</label><input class="input" name="timeLabel" value="${escapeHtml(state.meta.timeLabel)}" required /></div>
      </div>
    </form>`,
    footer: `${cancelButton()}${actionButton("保存赛事信息", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderScheduleSettingsModal(modal, state) {
  return modalShell({
    title: "排场参数",
    subtitle: "修改默认时长与连续比赛休息时间",
    body: `<form id="modal-form" data-modal-type="schedule-settings">
      <div class="field-grid">
        <div class="field"><label>新手组每场预计时长（分钟）</label><input class="input" type="number" min="3" max="60" name="newDuration" value="${state.settings.durations.new}" required /></div>
        <div class="field"><label>进阶组每场预计时长（分钟）</label><input class="input" type="number" min="5" max="90" name="advancedDuration" value="${state.settings.durations.advanced}" required /><span class="field-hint">包含2分钟热球与简短周转。</span></div>
        <div class="field"><label>进阶组热球时长（分钟）</label><input class="input" type="number" min="0" max="10" name="warmup" value="${state.settings.durations.advancedWarmupMinutes}" required /></div>
        <div class="field"><label>同一选手最短休息（分钟）</label><input class="input" type="number" min="0" max="120" name="restMinutes" value="${state.settings.restMinutes}" required /></div>
      </div>
      <div class="info-box" style="margin-top:14px"><div><strong>午间禁排</strong>12:00–14:00 由系统固定保留，不提供关闭选项。</div></div>
    </form>`,
    footer: `${cancelButton()}${actionButton("保存参数", "submit-modal", { style: "primary", size: "small" })}`
  });
}

function renderImportPreviewModal(modal, state) {
  const rows = modal.data.rows ?? [];
  const counts = Object.fromEntries(
    GROUP_DEFS.map((group) => [group.key, rows.filter((row) => row.canonicalGroup === group.key).length])
  );
  const errors = modal.data.errors ?? [];
  return modalShell({
    title: `导入预览 · ${rows.length}行`,
    subtitle: "确认后将整份名单替换或追加到当前赛事",
    large: true,
    body: `<form id="modal-form" data-modal-type="import-preview">
      <div class="import-summary">
        ${GROUP_DEFS.map((group) => `<div class="import-group"><span>${escapeHtml(group.name)}</span><strong>${counts[group.key] ?? 0} <span style="font-size:10px;color:var(--muted);font-weight:500">/ ${group.initialSize}</span></strong></div>`).join("")}
      </div>
      ${errors.length ? `<div class="error-box"><div><strong>发现 ${errors.length} 个错误，当前不能导入</strong>${errors.slice(0, 12).map(escapeHtml).join("<br>")}${errors.length > 12 ? `<br>另有 ${errors.length - 12} 项…` : ""}</div></div><div style="height:14px"></div>` : '<div class="info-box"><div><strong>文件结构校验通过</strong>姓名、院系和组别字段均可读取。外院系会自动识别为不产生团体积分的参赛者。</div></div><div style="height:14px"></div>'}
      <div class="field-grid">
        <div class="field"><label>导入方式</label><select class="select" name="mode"><option value="replace">替换全部名单（清除现有签表）</option><option value="append">追加到现有名单</option></select></div>
        <div class="field"><label>处理说明</label><span class="field-hint">替换会清除全部比赛和抽签；追加不会自动重抽，已有签表可能需要重新生成。</span></div>
      </div>
      <div style="height:14px"></div>
      <div class="table-wrap" style="max-height:350px;border:1px solid var(--line);border-radius:10px">
        <table class="data-table"><thead><tr><th>行</th><th>姓名</th><th>院系</th><th>组别</th><th>识别单位</th><th>校验</th></tr></thead><tbody>
          ${rows.slice(0, 200).map((row, index) => `<tr><td>${index + 2}</td><td class="name">${escapeHtml(row.name)}</td><td>${escapeHtml(row.department)}</td><td>${escapeHtml(row.group)}</td><td>${row.unit ? escapeHtml(row.unit.name) : '<span class="badge neutral">外院系</span>'}</td><td>${row.error ? `<span class="badge red">${escapeHtml(row.error)}</span>` : '<span class="badge green">可导入</span>'}</td></tr>`).join("")}
        </tbody></table>
      </div>
    </form>`,
    footer: `${cancelButton()}${actionButton(errors.length ? "存在错误，无法导入" : "确认导入", "submit-modal", { style: "primary", size: "small", disabled: errors.length > 0 })}`
  });
}

function renderGenericModal(modal) {
  const data = modal.data ?? {};
  return modalShell({
    title: data.title ?? "请确认",
    subtitle: data.subtitle ?? "",
    body: `<div class="${data.tone === "danger" ? "error-box" : data.tone === "warning" ? "warning-box" : "info-box"}"><div><strong>${escapeHtml(data.heading ?? data.title ?? "操作确认")}</strong>${escapeHtml(data.message ?? "")}</div></div>
      ${data.list?.length ? `<ul class="field-hint" style="padding-left:20px;line-height:1.9">${data.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}`,
    footer: `${cancelButton()}${actionButton(escapeHtml(data.confirmLabel ?? "确认"), "confirm-generic", {
      style: data.tone === "danger" ? "danger" : "primary",
      size: "small",
      data: data.confirmData ?? ""
    })}`
  });
}
