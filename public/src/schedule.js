import { GROUP_BY_KEY, addAudit } from "./model.js";
import { getDependenciesForMatch, getMatchPlayers } from "./engine.js";

const DAY_OFFSET = "+08:00";

export function minutesFromTime(value) {
  const [hours, minutes] = String(value ?? "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeLabelFromDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(date);
}

export function dateLabel(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

export function isoFromEventMinute(state, minute) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${state.meta.date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00${DAY_OFFSET}`;
}

function eventMinuteFromIso(state, iso) {
  if (!iso) return null;
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
  const [hour, minute] = formatter.format(date).split(":").map(Number);
  return hour * 60 + minute;
}

export function getDayWindows(state) {
  return state.settings.dayWindows.map((window) => ({
    ...window,
    startMinute: minutesFromTime(window.start),
    endMinute: minutesFromTime(window.end)
  }));
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function getMatchDuration(state, match) {
  const group = GROUP_BY_KEY[match.group];
  return Number(
    match.schedule.estimatedMinutes ??
      state.settings.durations[group.level] ??
      (group.level === "new" ? 7 : 17)
  );
}

function findFreeStart(windows, intervals, earliestMinute, duration) {
  for (const window of windows) {
    let candidate = Math.max(earliestMinute, window.startMinute);
    const relevant = intervals
      .filter((entry) => entry.endMinute > candidate && entry.startMinute < window.endMinute)
      .sort((left, right) => left.startMinute - right.startMinute);
    for (const interval of relevant) {
      if (candidate + duration <= interval.startMinute) {
        return candidate;
      }
      if (candidate < interval.endMinute) candidate = interval.endMinute;
    }
    if (candidate + duration <= window.endMinute) return candidate;
  }
  return null;
}

function dependencyEarliest(state, match, scheduledByCourt, matchMap) {
  let earliest = 0;
  if (match.schedule.earliestAfter) {
    earliest = Math.max(earliest, eventMinuteFromIso(state, match.schedule.earliestAfter));
  }
  for (const dependencyId of getDependenciesForMatch(state, match.id)) {
    const dependency = matchMap.get(dependencyId);
    if (!dependency?.schedule.endAt) continue;
    earliest = Math.max(
      earliest,
      eventMinuteFromIso(state, dependency.schedule.endAt) + state.settings.restMinutes
    );
  }
  return earliest;
}

function logicalDepth(state, matchId, memo = new Map(), visiting = new Set()) {
  if (memo.has(matchId)) return memo.get(matchId);
  if (visiting.has(matchId)) return 0;
  visiting.add(matchId);
  const match = state.matches.find((entry) => entry.id === matchId);
  const dependencies = getDependenciesForMatch(state, matchId).filter((id) => id !== matchId);
  const depth = dependencies.length
    ? Math.max(...dependencies.map((id) => logicalDepth(state, id, memo, visiting) + 1))
    : 0;
  visiting.delete(matchId);
  memo.set(matchId, depth);
  return depth;
}

export function autoSchedule(state, { preserveStarted = true } = {}) {
  const windows = getDayWindows(state);
  const matchMap = new Map(state.matches.map((match) => [match.id, match]));
  const courtIntervals = new Map(
    Array.from({ length: state.meta.courts }, (_, index) => [index + 1, []])
  );
  const playerIntervals = new Map();
  const preserved = [];
  const pending = [];

  for (const match of state.matches) {
    const canPreserve =
      preserveStarted &&
      match.schedule.court &&
      match.schedule.startAt &&
      ["live", "completed"].includes(match.schedule.status) &&
      match.schedule.endAt;
    if (canPreserve) {
      preserved.push(match);
      const startMinute = eventMinuteFromIso(state, match.schedule.startAt);
      const endMinute = eventMinuteFromIso(state, match.schedule.endAt);
      courtIntervals.get(match.schedule.court)?.push({ startMinute, endMinute });
      for (const player of getMatchPlayers(state, match).filter(Boolean)) {
        if (!playerIntervals.has(player.id)) playerIntervals.set(player.id, []);
        playerIntervals.get(player.id).push({
          startMinute,
          endMinute: endMinute + state.settings.restMinutes
        });
      }
    } else {
      match.schedule.court = null;
      match.schedule.startAt = null;
      match.schedule.endAt = null;
      match.schedule.actualStartAt = null;
      match.schedule.actualEndAt = null;
      match.schedule.status = "unassigned";
      pending.push(match);
    }
  }

  pending.sort((left, right) => {
    const leftDepth = logicalDepth(state, left.id);
    const rightDepth = logicalDepth(state, right.id);
    return leftDepth - rightDepth || left.roundIndex - right.roundIndex || left.order - right.order;
  });

  let scheduledCount = preserved.length;
  for (const match of pending) {
    const duration = getMatchDuration(state, match);
    match.schedule.estimatedMinutes = duration;
    const dependencyMinute = dependencyEarliest(state, match, courtIntervals, matchMap);
    const knownPlayers = getMatchPlayers(state, match).filter(Boolean);
    const playerEarliest = knownPlayers.reduce((latest, player) => {
      const intervals = playerIntervals.get(player.id) ?? [];
      const end = intervals.reduce((max, interval) => Math.max(max, interval.endMinute), 0);
      return Math.max(latest, end);
    }, 0);
    const earliest = Math.max(dependencyMinute, playerEarliest);
    let best = null;

    for (let court = 1; court <= state.meta.courts; court += 1) {
      const startMinute = findFreeStart(
        windows,
        courtIntervals.get(court) ?? [],
        earliest,
        duration
      );
      if (startMinute === null) continue;
      const playerBlocked =
        knownPlayers.length > 0 &&
        knownPlayers.some((player) =>
          (playerIntervals.get(player.id) ?? []).some((interval) =>
            overlaps(startMinute, startMinute + duration, interval.startMinute, interval.endMinute)
          )
        );
      if (playerBlocked) continue;
      if (!best || startMinute < best.startMinute || (startMinute === best.startMinute && court < best.court)) {
        best = { court, startMinute };
      }
    }

    if (!best) {
      match.schedule.status = "unassigned";
      continue;
    }

    const endMinute = best.startMinute + duration;
    match.schedule.court = best.court;
    match.schedule.startAt = isoFromEventMinute(state, best.startMinute);
    match.schedule.endAt = isoFromEventMinute(state, endMinute);
    match.schedule.status = match.winnerId ? "completed" : "scheduled";
    courtIntervals.get(best.court).push({ startMinute: best.startMinute, endMinute });
    for (const player of knownPlayers) {
      if (!playerIntervals.has(player.id)) playerIntervals.set(player.id, []);
      playerIntervals.get(player.id).push({
        startMinute: best.startMinute,
        endMinute: endMinute + state.settings.restMinutes
      });
    }
    scheduledCount += 1;
  }

  const warnings = validateSchedule(state);
  addAudit(
    state,
    "自动排场",
    `已安排${scheduledCount}/${state.matches.length}场；保留${preserved.length}场已开始或完成比赛。`
  );
  return { scheduledCount, unassignedCount: state.matches.length - scheduledCount, warnings };
}

export function validateSchedule(state) {
  const errors = [];
  const warnings = [];
  const windows = getDayWindows(state);
  const courtGroups = new Map();
  const playerGroups = new Map();

  for (const match of state.matches) {
    if (!match.schedule.court || !match.schedule.startAt || !match.schedule.endAt) {
      warnings.push(`${match.code} 尚未安排场地或时间。`);
      continue;
    }
    const startMinute = eventMinuteFromIso(state, match.schedule.startAt);
    const endMinute = eventMinuteFromIso(state, match.schedule.endAt);
    const withinWindow = windows.some(
      (window) => startMinute >= window.startMinute && endMinute <= window.endMinute
    );
    if (!withinWindow) {
      errors.push(`${match.code} 超出比赛时段或跨入午间休赛。`);
    }
    if (endMinute <= startMinute) errors.push(`${match.code} 的结束时间不晚于开始时间。`);
    if (match.schedule.court < 1 || match.schedule.court > state.meta.courts) {
      errors.push(`${match.code} 使用了不存在场地 ${match.schedule.court}。`);
    }
    if (!courtGroups.has(match.schedule.court)) courtGroups.set(match.schedule.court, []);
    courtGroups.get(match.schedule.court).push({ match, startMinute, endMinute });
    for (const player of getMatchPlayers(state, match).filter(Boolean)) {
      if (!playerGroups.has(player.id)) playerGroups.set(player.id, []);
      playerGroups.get(player.id).push({ match, startMinute, endMinute });
    }

    for (const dependencyId of getDependenciesForMatch(state, match.id)) {
      const dependency = state.matches.find((entry) => entry.id === dependencyId);
      if (!dependency?.schedule.endAt) continue;
      const dependencyEnd = eventMinuteFromIso(state, dependency.schedule.endAt);
      if (startMinute < dependencyEnd + state.settings.restMinutes) {
        errors.push(`${match.code} 在依赖比赛 ${dependency.code} 结束和休息时间之前开始。`);
      }
    }
  }

  for (const [court, entries] of courtGroups) {
    entries.sort((left, right) => left.startMinute - right.startMinute);
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index].startMinute < entries[index - 1].endMinute) {
        errors.push(
          `${court}号场：${entries[index - 1].match.code} 与 ${entries[index].match.code} 时间重叠。`
        );
      }
    }
  }

  for (const [, entries] of playerGroups) {
    entries.sort((left, right) => left.startMinute - right.startMinute);
    for (let index = 1; index < entries.length; index += 1) {
      if (
        entries[index].startMinute <
        entries[index - 1].endMinute + state.settings.restMinutes
      ) {
        const players = getMatchPlayers(state, entries[index].match)
          .filter(Boolean)
          .map((player) => player.name)
          .join(" / ");
        errors.push(
          `${players} 的 ${entries[index - 1].match.code} 与 ${entries[index].match.code} 间隔不足 ${state.settings.restMinutes} 分钟。`
        );
      }
    }
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    unassigned: state.matches.filter((match) => !match.schedule.startAt).length
  };
}

export function updateMatchSchedule(
  state,
  matchId,
  { court, startAt, estimatedMinutes, status }
) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match) throw new Error("比赛不存在。");
  const duration = Math.max(1, Number(estimatedMinutes ?? getMatchDuration(state, match)));
  const startMinute = eventMinuteFromIso(state, startAt);
  if (startMinute === null) throw new Error("开始时间格式无效。");
  match.schedule.court = Number(court) || null;
  match.schedule.startAt = startAt;
  match.schedule.endAt = isoFromEventMinute(state, startMinute + duration);
  match.schedule.estimatedMinutes = duration;
  match.schedule.status =
    status ??
    (match.winnerId ? "completed" : match.schedule.court ? "scheduled" : "unassigned");
  if (match.schedule.status === "live" && !match.schedule.actualStartAt) {
    match.schedule.actualStartAt = new Date().toISOString();
  }
  addAudit(
    state,
    "人工调整排场",
    `${match.code} → ${match.schedule.court ? `${match.schedule.court}号场` : "待安排场"}，${timeLabelFromDate(match.schedule.startAt)}–${timeLabelFromDate(match.schedule.endAt)}`
  );
  return match;
}

export function markMatchLive(state, matchId) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match) throw new Error("比赛不存在。");
  if (match.winnerId) throw new Error("比赛已经完成。");
  match.schedule.status = "live";
  match.schedule.actualStartAt = new Date().toISOString();
  addAudit(
    state,
    "开始比赛",
    `${match.code} 在${match.schedule.court ? `${match.schedule.court}号场` : "未指派场地"}开始。`
  );
  return match;
}

export function getCourtState(state, court) {
  const assigned = state.matches
    .filter((match) => match.schedule.court === court && match.schedule.startAt)
    .sort((left, right) => new Date(left.schedule.startAt) - new Date(right.schedule.startAt));
  const live = assigned.find((match) => match.schedule.status === "live");
  const current = live ?? assigned.find((match) => !match.winnerId);
  const upcoming = assigned.find(
    (match) => match.id !== current?.id && !match.winnerId && match.schedule.status !== "live"
  );
  return { live, current, upcoming, assigned };
}

export function getStats(state) {
  const completed = state.matches.filter((match) => match.winnerId).length;
  const live = state.matches.filter((match) => match.schedule.status === "live").length;
  const unassigned = state.matches.filter((match) => !match.schedule.startAt).length;
  const result = validationSafe(state);
  return {
    total: state.matches.length,
    completed,
    live,
    unassigned,
    conflicts: result.errors.length
  };
}

function validationSafe(state) {
  try {
    return validateSchedule(state);
  } catch {
    return { errors: [], warnings: [] };
  }
}

export function readyMatches(state) {
  return state.matches
    .filter((match) => {
      const players = getMatchPlayers(state, match);
      return !match.winnerId && players.length === 2 && players.every(Boolean);
    })
    .sort((left, right) => {
      const leftTime = left.schedule.startAt ? new Date(left.schedule.startAt).getTime() : Infinity;
      const rightTime = right.schedule.startAt ? new Date(right.schedule.startAt).getTime() : Infinity;
      return leftTime - rightTime;
    });
}
