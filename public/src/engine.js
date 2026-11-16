import {
  GROUP_BY_KEY,
  GROUP_DEFS,
  PHASE_LABELS,
  addAudit,
  findUnitById,
  playerName,
  randomId,
  validateRoster
} from "./model.js";

export class EngineError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EngineError";
    this.details = details;
  }
}

export function secureRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 0x100000000;
  }
  return Math.random();
}

function shuffle(values, random = secureRandom) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function matchCodePrefix(groupKey) {
  return {
    new_men: "NM",
    new_women: "NW",
    advanced_men: "AM",
    advanced_women: "AW"
  }[groupKey];
}

function emptySchedule() {
  return {
    court: null,
    startAt: null,
    endAt: null,
    estimatedMinutes: null,
    status: "unassigned",
    actualStartAt: null,
    actualEndAt: null
  };
}

function makeMatch({
  groupKey,
  phase,
  roundIndex,
  order,
  code,
  slots,
  groupId = null,
  dependencies = []
}) {
  const group = GROUP_BY_KEY[groupKey];
  return {
    id: randomId("m"),
    code,
    group: groupKey,
    groupId,
    phase,
    phaseLabel: PHASE_LABELS[phase],
    roundIndex,
    order,
    slots,
    dependencies,
    winnerId: null,
    loserId: null,
    completedAt: null,
    notes: "",
    schedule: {
      ...emptySchedule(),
      estimatedMinutes: group.level === "new" ? 7 : 17
    },
    revision: 0
  };
}

export function groupSizesForCount(count) {
  const base = Math.floor(count / 4);
  const remainder = count % 4;
  return Array.from({ length: 4 }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function generateGroupDraw(state, groupKey, random = secureRandom) {
  const group = GROUP_BY_KEY[groupKey];
  if (!group || group.level !== "new") throw new EngineError("仅新手组使用小组抽签。");
  const players = state.players.filter((player) => player.group === groupKey);
  if (players.length < 4) throw new EngineError("参赛人数不足，无法分为四个小组。");

  const sizes = groupSizesForCount(players.length);
  const shuffled = shuffle(players, random);
  const groups = [];
  let cursor = 0;
  sizes.forEach((size, index) => {
    groups.push({
      id: `${groupKey}_g${index + 1}`,
      name: `${String.fromCharCode(65 + index)}组`,
      playerIds: shuffled.slice(cursor, cursor + size).map((player) => player.id)
    });
    cursor += size;
  });

  state.draws[groupKey] = {
    status: "preview",
    groups,
    knockoutCreated: false,
    previewedAt: new Date().toISOString()
  };

  const previewIds = new Set(groups.flatMap((entry) => entry.playerIds));
  if (previewIds.size !== players.length) throw new EngineError("抽签分配校验失败：存在重复或遗漏。");
  addAudit(
    state,
    "生成小组抽签预览",
    `${group.name}按 ${sizes.join(" / ")} 人随机分组，尚未锁定。`
  );
  return state.draws[groupKey];
}

export function swapGroupPlayers(state, groupKey, playerAId, playerBId) {
  const draw = state.draws[groupKey];
  if (draw?.status !== "preview") throw new EngineError("仅抽签预览状态可以手动交换。");
  const groupA = draw.groups.find((entry) => entry.playerIds.includes(playerAId));
  const groupB = draw.groups.find((entry) => entry.playerIds.includes(playerBId));
  if (!groupA || !groupB || groupA.id === groupB.id) {
    throw new EngineError("请选择两个不同小组中的选手。");
  }
  groupA.playerIds[groupA.playerIds.indexOf(playerAId)] = playerBId;
  groupB.playerIds[groupB.playerIds.indexOf(playerBId)] = playerAId;
  addAudit(
    state,
    "手动交换小组选手",
    `${playerName(state, playerAId)} ↔ ${playerName(state, playerBId)}（${GROUP_BY_KEY[groupKey].name}）`
  );
  return draw;
}

export function validateAdvancedSeeds(state, groupKey) {
  const group = GROUP_BY_KEY[groupKey];
  if (!group || group.level !== "advanced") throw new EngineError("该组别不使用种子签表。");
  const players = state.players.filter((player) => player.group === groupKey);
  const seeds = players.filter((player) => player.seed);
  const nonSeeds = players.filter((player) => !player.seed);
  if (players.length !== 24) {
    throw new EngineError(`${group.name}标准签表需要24人，当前为${players.length}人。`);
  }
  if (seeds.length !== 8) {
    throw new EngineError(`${group.name}必须指定8名种子，当前为${seeds.length}名。`);
  }
  const seedUnitIds = seeds.map((player) => player.unitId).filter(Boolean);
  if (seedUnitIds.length !== 8 || new Set(seedUnitIds).size !== 8) {
    throw new EngineError(`${group.name}的8名种子必须分别来自8个不同联合参赛单位。`);
  }
  return { players, seeds, nonSeeds };
}

export function generateAdvancedPreview(state, groupKey, random = secureRandom) {
  const { seeds, nonSeeds } = validateAdvancedSeeds(state, groupKey);
  const seedSlots = shuffle(seeds, random).map((player) => player.id);
  const qualifierPlayers = shuffle(nonSeeds, random).map((player) => player.id);
  const qualifiers = Array.from({ length: 8 }, (_, index) =>
    qualifierPlayers.slice(index * 2, index * 2 + 2)
  );
  state.draws[groupKey] = {
    status: "preview",
    seedSlots,
    qualifiers,
    generated: false,
    previewedAt: new Date().toISOString()
  };
  addAudit(
    state,
    "生成进阶组签表预览",
    `${GROUP_BY_KEY[groupKey].name}：8名种子分别进入8个16强位置，16人随机生成资格赛。`
  );
  return state.draws[groupKey];
}

export function swapAdvancedPreviewPlayers(state, groupKey, playerAId, playerBId) {
  const draw = state.draws[groupKey];
  if (draw?.status !== "preview") throw new EngineError("仅签表预览状态可以手动交换。");
  const slotA = locateAdvancedPreviewSlot(draw, playerAId);
  const slotB = locateAdvancedPreviewSlot(draw, playerBId);
  if (!slotA || !slotB) throw new EngineError("未找到要交换的选手签位。");
  const seedsA = slotA.type === "seed";
  const seedsB = slotB.type === "seed";
  if (seedsA !== seedsB) throw new EngineError("种子选手只能与其他种子交换，非种子只能与其他非种子交换。");
  writeAdvancedPreviewSlot(draw, slotA, playerBId);
  writeAdvancedPreviewSlot(draw, slotB, playerAId);
  addAudit(
    state,
    "手动交换签位",
    `${playerName(state, playerAId)} ↔ ${playerName(state, playerBId)}（${GROUP_BY_KEY[groupKey].name}）`
  );
  return draw;
}

function locateAdvancedPreviewSlot(draw, playerId) {
  const seedIndex = draw.seedSlots.indexOf(playerId);
  if (seedIndex >= 0) return { type: "seed", index: seedIndex };
  for (let matchIndex = 0; matchIndex < draw.qualifiers.length; matchIndex += 1) {
    const slotIndex = draw.qualifiers[matchIndex].indexOf(playerId);
    if (slotIndex >= 0) return { type: "qualifier", matchIndex, slotIndex };
  }
  return null;
}

function writeAdvancedPreviewSlot(draw, location, playerId) {
  if (location.type === "seed") draw.seedSlots[location.index] = playerId;
  else draw.qualifiers[location.matchIndex][location.slotIndex] = playerId;
}

export function clearMatchesForGroup(state, groupKey) {
  const matchIds = new Set(
    state.matches.filter((match) => match.group === groupKey).map((match) => match.id)
  );
  state.matches = state.matches.filter((match) => !matchIds.has(match.id));
  for (const key of Object.keys(state.groupResolutions)) {
    if (key.startsWith(`${groupKey}:`)) delete state.groupResolutions[key];
  }
}

export function confirmDraw(state, groupKey) {
  const draw = state.draws[groupKey];
  if (!draw || draw.status !== "preview") throw new EngineError("当前没有可确认的抽签预览。");
  if (state.meta.phase === "live" && state.matches.some((match) => match.group === groupKey && match.winnerId)) {
    throw new EngineError("该组已有正式比赛结果，必须通过“重新抽签”并确认清除结果后才能修改。", {
      requiresReset: true
    });
  }

  clearMatchesForGroup(state, groupKey);
  const group = GROUP_BY_KEY[groupKey];
  if (group.level === "new") {
    let serial = 1;
    for (const drawGroup of draw.groups) {
      for (let left = 0; left < drawGroup.playerIds.length; left += 1) {
        for (let right = left + 1; right < drawGroup.playerIds.length; right += 1) {
          state.matches.push(
            makeMatch({
              groupKey,
              phase: "group",
              roundIndex: 0,
              order: serial - 1,
              code: `${matchCodePrefix(groupKey)}-${drawGroup.name}-${String(serial).padStart(2, "0")}`,
              slots: [
                { type: "player", playerId: drawGroup.playerIds[left] },
                { type: "player", playerId: drawGroup.playerIds[right] }
              ],
              groupId: drawGroup.id
            })
          );
          serial += 1;
        }
      }
    }
    state.draws[groupKey] = {
      ...draw,
      status: "locked",
      lockedAt: new Date().toISOString(),
      groupMatchCount: serial - 1
    };
  } else {
    createAdvancedBracket(state, groupKey, draw);
    state.draws[groupKey] = {
      ...draw,
      status: "locked",
      generated: true,
      lockedAt: new Date().toISOString()
    };
  }

  state.meta.phase = state.meta.phase === "setup" ? "draw" : state.meta.phase;
  addAudit(
    state,
    "确认抽签并生成赛程",
    `${group.name}抽签已锁定，生成${state.matches.filter((match) => match.group === groupKey).length}场对应比赛。`
  );
  return state;
}

function createAdvancedBracket(state, groupKey, draw) {
  clearMatchesForGroup(state, groupKey);
  const prefix = matchCodePrefix(groupKey);
  const qualifiers = [];
  for (let index = 0; index < 8; index += 1) {
    const match = makeMatch({
      groupKey,
      phase: "qualifier",
      roundIndex: 0,
      order: index,
      code: `${prefix}-Q${index + 1}`,
      slots: draw.qualifiers[index].map((playerId) => ({ type: "player", playerId }))
    });
    qualifiers.push(match);
    state.matches.push(match);
  }

  const r16 = [];
  for (let index = 0; index < 8; index += 1) {
    const match = makeMatch({
      groupKey,
      phase: "r16",
      roundIndex: 1,
      order: index,
      code: `${prefix}-R16-${index + 1}`,
      slots: [
        { type: "player", playerId: draw.seedSlots[index] },
        { type: "winner", matchId: qualifiers[index].id }
      ],
      dependencies: [qualifiers[index].id]
    });
    r16.push(match);
    state.matches.push(match);
  }

  const qf = [];
  for (let index = 0; index < 4; index += 1) {
    const match = makeMatch({
      groupKey,
      phase: "qf",
      roundIndex: 2,
      order: index,
      code: `${prefix}-QF${index + 1}`,
      slots: [
        { type: "winner", matchId: r16[index * 2].id },
        { type: "winner", matchId: r16[index * 2 + 1].id }
      ],
      dependencies: [r16[index * 2].id, r16[index * 2 + 1].id]
    });
    qf.push(match);
    state.matches.push(match);
  }

  const sf = [];
  for (let index = 0; index < 2; index += 1) {
    const match = makeMatch({
      groupKey,
      phase: "sf",
      roundIndex: 3,
      order: index,
      code: `${prefix}-SF${index + 1}`,
      slots: [
        { type: "winner", matchId: qf[index * 2].id },
        { type: "winner", matchId: qf[index * 2 + 1].id }
      ],
      dependencies: [qf[index * 2].id, qf[index * 2 + 1].id]
    });
    sf.push(match);
    state.matches.push(match);
  }

  const final = makeMatch({
    groupKey,
    phase: "final",
    roundIndex: 4,
    order: 0,
    code: `${prefix}-F`,
    slots: [
      { type: "winner", matchId: sf[0].id },
      { type: "winner", matchId: sf[1].id }
    ],
    dependencies: [sf[0].id, sf[1].id]
  });
  const third = makeMatch({
    groupKey,
    phase: "third",
    roundIndex: 4,
    order: 1,
    code: `${prefix}-3RD`,
    slots: [
      { type: "loser", matchId: sf[0].id },
      { type: "loser", matchId: sf[1].id }
    ],
    dependencies: [sf[0].id, sf[1].id]
  });
  state.matches.push(final, third);
}

export function resolveSlot(state, slot) {
  if (!slot) return null;
  if (slot.type === "player") {
    return state.players.find((player) => player.id === slot.playerId) ?? null;
  }
  const source = state.matches.find((match) => match.id === slot.matchId);
  if (!source) return null;
  const playerId = slot.type === "winner" ? source.winnerId : source.loserId;
  return state.players.find((player) => player.id === playerId) ?? null;
}

export function getMatchPlayers(state, match) {
  return match.slots.map((slot) => resolveSlot(state, slot));
}

export function getDependenciesForMatch(state, matchId) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match) return [];
  const ids = new Set(match.dependencies ?? []);
  for (const slot of match.slots) {
    if (slot.matchId) ids.add(slot.matchId);
  }
  return [...ids];
}

export function getDownstreamMatches(state, matchId) {
  const downstream = new Set();
  let frontier = [matchId];
  while (frontier.length) {
    const current = new Set(frontier);
    const next = state.matches
      .filter((match) => getDependenciesForMatch(state, match.id).some((id) => current.has(id)))
      .map((match) => match.id)
      .filter((id) => !downstream.has(id));
    next.forEach((id) => downstream.add(id));
    frontier = next;
  }
  return state.matches.filter((match) => downstream.has(match.id));
}

export function getImpactOfResultChange(state, matchId) {
  return getDownstreamMatches(state, matchId).filter(
    (match) => match.winnerId || match.schedule.status === "live" || match.schedule.status === "completed"
  );
}

export function setMatchWinner(state, matchId, winnerId, { cascade = false, reason = "" } = {}) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match) throw new EngineError("比赛不存在。");
  const players = getMatchPlayers(state, match);
  const resolvedIds = players.filter(Boolean).map((player) => player.id);
  if (resolvedIds.length !== 2) throw new EngineError("对阵双方尚未完全确定，不能录入胜负。");
  if (!resolvedIds.includes(winnerId)) throw new EngineError("所选选手不在此场比赛中。");

  const impact = getImpactOfResultChange(state, matchId).filter((item) => item.id !== matchId);
  if (impact.length && !cascade) {
    throw new EngineError("修改该结果会影响已开始或已完成的后续比赛。", {
      requiresCascade: true,
      impactedIds: impact.map((item) => item.id),
      impactedCodes: impact.map((item) => item.code)
    });
  }

  if (impact.length) {
    const ordered = getDownstreamMatches(state, matchId).sort(
      (left, right) => right.roundIndex - left.roundIndex
    );
    for (const downstream of ordered) {
      downstream.winnerId = null;
      downstream.loserId = null;
      downstream.completedAt = null;
      downstream.revision = (downstream.revision ?? 0) + 1;
      if (["completed", "live"].includes(downstream.schedule.status)) {
        downstream.schedule.status = downstream.schedule.court ? "scheduled" : "unassigned";
        downstream.schedule.actualStartAt = null;
        downstream.schedule.actualEndAt = null;
      }
    }
  }

  const previousWinner = match.winnerId;
  const loser = resolvedIds.find((id) => id !== winnerId);
  match.winnerId = winnerId;
  match.loserId = loser;
  match.completedAt = new Date().toISOString();
  match.revision = (match.revision ?? 0) + 1;
  if (match.schedule.status !== "unassigned") {
    match.schedule.status = "completed";
    match.schedule.actualEndAt ??= new Date().toISOString();
  }

  const action = previousWinner ? "纠正比赛结果" : "确认比赛结果";
  const suffix = impact.length ? `；按依赖顺序撤销${impact.length}场后续结果` : "";
  addAudit(
    state,
    action,
    `${match.code}：${playerName(state, winnerId)}胜 ${playerName(state, loser)}${reason ? `；原因：${reason}` : ""}${suffix}`
  );
  state.meta.phase = "live";
  return { match, cleared: impact };
}

export function undoMatchResult(state, matchId, { cascade = false, reason = "" } = {}) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match?.winnerId) throw new EngineError("该比赛尚无结果可撤销。");
  const impact = getImpactOfResultChange(state, matchId).filter((item) => item.id !== matchId);
  if (impact.length && !cascade) {
    throw new EngineError("撤销会影响已开始或已完成的后续比赛。", {
      requiresCascade: true,
      impactedCodes: impact.map((item) => item.code)
    });
  }
  const previous = match.winnerId;
  if (impact.length) {
    for (const downstream of getDownstreamMatches(state, matchId)) {
      downstream.winnerId = null;
      downstream.loserId = null;
      downstream.completedAt = null;
      if (["completed", "live"].includes(downstream.schedule.status)) {
        downstream.schedule.status = downstream.schedule.court ? "scheduled" : "unassigned";
        downstream.schedule.actualStartAt = null;
        downstream.schedule.actualEndAt = null;
      }
    }
  }
  match.winnerId = null;
  match.loserId = null;
  match.completedAt = null;
  match.revision += 1;
  if (match.schedule.status === "completed") {
    match.schedule.status = match.schedule.court ? "scheduled" : "unassigned";
    match.schedule.actualStartAt = null;
    match.schedule.actualEndAt = null;
  }
  addAudit(
    state,
    "撤销比赛结果",
    `${match.code}：撤销 ${playerName(state, previous)} 的胜果${reason ? `；原因：${reason}` : ""}`
  );
  return { match, cleared: impact };
}

export function getGroupMatches(state, groupKey, groupId) {
  return state.matches.filter(
    (match) => match.group === groupKey && match.phase === "group" && match.groupId === groupId
  );
}

export function getGroupStandings(state, groupKey, groupId) {
  const draw = state.draws[groupKey];
  const drawGroup = draw?.groups?.find((entry) => entry.id === groupId);
  if (!drawGroup) return { rows: [], complete: false, pending: false };
  const matches = getGroupMatches(state, groupKey, groupId);
  const stats = new Map(
    drawGroup.playerIds.map((id) => [
      id,
      { playerId: id, played: 0, wins: 0, losses: 0, tiePending: false }
    ])
  );
  for (const match of matches) {
    if (!match.winnerId) continue;
    const participants = getMatchPlayers(state, match).map((player) => player.id);
    const loserId = participants.find((id) => id !== match.winnerId);
    if (stats.has(match.winnerId)) {
      stats.get(match.winnerId).played += 1;
      stats.get(match.winnerId).wins += 1;
    }
    if (stats.has(loserId)) {
      stats.get(loserId).played += 1;
      stats.get(loserId).losses += 1;
    }
  }

  const allComplete = matches.length > 0 && matches.every((match) => match.winnerId);
  const winBuckets = new Map();
  for (const row of stats.values()) {
    if (!winBuckets.has(row.wins)) winBuckets.set(row.wins, []);
    winBuckets.get(row.wins).push(row);
  }

  const ordered = [];
  let pending = false;
  const winsDescending = [...winBuckets.keys()].sort((left, right) => right - left);
  for (const wins of winsDescending) {
    const bucket = winBuckets.get(wins);
    if (bucket.length === 1) {
      ordered.push(...bucket);
      continue;
    }
    const ids = bucket.map((row) => row.playerId);
    const signature = [...ids].sort().join("|");
    const manualKey = `${groupKey}:${groupId}:${signature}`;
    const manual = state.groupResolutions[manualKey];
    if (manual && manual.signature === signature) {
      bucket.sort((left, right) => manual.order.indexOf(left.playerId) - manual.order.indexOf(right.playerId));
      ordered.push(...bucket);
      continue;
    }

    if (bucket.length === 2) {
      const [left, right] = ids;
      const headToHead = matches.find((match) => {
        const participants = getMatchPlayers(state, match).map((player) => player.id);
        return participants.includes(left) && participants.includes(right) && match.winnerId;
      });
      if (headToHead) {
        const winnerFirst = [...bucket].sort((a, b) =>
          a.playerId === headToHead.winnerId ? -1 : b.playerId === headToHead.winnerId ? 1 : 0
        );
        ordered.push(...winnerFirst);
        continue;
      }
    } else {
      const miniWins = new Map(ids.map((id) => [id, 0]));
      for (const match of matches) {
        const participants = getMatchPlayers(state, match).map((player) => player.id);
        if (participants.every((id) => ids.includes(id)) && match.winnerId) {
          miniWins.set(match.winnerId, (miniWins.get(match.winnerId) ?? 0) + 1);
        }
      }
      const miniCounts = [...miniWins.values()];
      if (new Set(miniCounts).size === miniCounts.length) {
        bucket.sort((left, right) => miniWins.get(right.playerId) - miniWins.get(left.playerId));
        ordered.push(...bucket);
        continue;
      }
    }
    pending = true;
    bucket.forEach((row) => {
      row.tiePending = true;
      row.tieSignature = signature;
    });
    ordered.push(...bucket);
  }

  ordered.forEach((row, index) => {
    row.rank = index + 1;
    row.qualifies = allComplete && !pending && index < 2;
  });
  return { rows: ordered, complete: allComplete, pending, matches, drawGroup };
}

export function resolveGroupTie(state, groupKey, groupId, orderedPlayerIds, reason) {
  if (!reason?.trim()) throw new EngineError("人工裁决必须填写原因。");
  const standings = getGroupStandings(state, groupKey, groupId);
  if (!standings.pending) throw new EngineError("当前小组没有待裁决的排名。");
  const pendingRows = standings.rows.filter((row) => row.tiePending);
  const signature = pendingRows[0]?.tieSignature;
  const tiedIds = pendingRows
    .filter((row) => row.tieSignature === signature)
    .map((row) => row.playerId);
  if (new Set(orderedPlayerIds).size !== tiedIds.length || !tiedIds.every((id) => orderedPlayerIds.includes(id))) {
    throw new EngineError("人工排序必须完整包含当前这一组同胜场的并列选手。");
  }
  state.groupResolutions[`${groupKey}:${groupId}:${signature}`] = {
    signature: [...tiedIds].sort().join("|"),
    order: [...orderedPlayerIds],
    reason: reason.trim(),
    at: new Date().toISOString()
  };
  addAudit(
    state,
    "小组排名人工裁决",
    `${GROUP_BY_KEY[groupKey].name} ${standings.drawGroup.name}：${orderedPlayerIds
      .map((id) => playerName(state, id))
      .join(" > ")}；原因：${reason.trim()}`
  );
  return getGroupStandings(state, groupKey, groupId);
}

export function canCreateNewbieKnockout(state, groupKey) {
  const draw = state.draws[groupKey];
  if (draw?.status !== "locked" || GROUP_BY_KEY[groupKey]?.level !== "new") return false;
  const standings = draw.groups.map((group) => getGroupStandings(state, groupKey, group.id));
  return standings.length === 4 && standings.every((entry) => entry.complete && !entry.pending);
}

export function createNewbieKnockout(state, groupKey, random = secureRandom) {
  if (!canCreateNewbieKnockout(state, groupKey)) {
    throw new EngineError("四个小组必须全部完成且排名无待裁决，才能生成八强签表。");
  }
  const draw = state.draws[groupKey];
  if (draw.knockoutCreated) throw new EngineError("该组八强签表已经生成。");
  const standings = draw.groups.map((group) => getGroupStandings(state, groupKey, group.id));
  const groupMatches = state.matches.filter(
    (match) => match.group === groupKey && match.phase === "group"
  );
  const groupCompletionEstimate = groupMatches.reduce((latest, match) => {
    const end = match.schedule.endAt ? new Date(match.schedule.endAt).getTime() : 0;
    return Math.max(latest, end);
  }, 0);

  const winners = shuffle(
    standings.map((entry) => ({
      playerId: entry.rows[0].playerId,
      sourceGroupId: entry.drawGroup.id
    })),
    random
  );
  let runners = standings.map((entry) => ({
    playerId: entry.rows[1].playerId,
    sourceGroupId: entry.drawGroup.id
  }));
  let attempts = 0;
  do {
    runners = shuffle(runners, random);
    attempts += 1;
  } while (
    attempts < 1000 &&
    winners.some((winner, index) => winner.sourceGroupId === runners[index].sourceGroupId)
  );
  const avoidOk = winners.every(
    (winner, index) => winner.sourceGroupId !== runners[index].sourceGroupId
  );
  if (!avoidOk) throw new EngineError("未能在合理次数内满足同组回避，请重新生成。");

  const prefix = matchCodePrefix(groupKey);
  const dependencies = groupMatches.map((match) => match.id);
  const qf = [];
  for (let index = 0; index < 4; index += 1) {
    const match = makeMatch({
      groupKey,
      phase: "qf",
      roundIndex: 0,
      order: index,
      code: `${prefix}-QF${index + 1}`,
      slots: [
        { type: "player", playerId: winners[index].playerId },
        { type: "player", playerId: runners[index].playerId }
      ],
      dependencies
    });
    if (groupCompletionEstimate) {
      match.schedule.earliestAfter = new Date(groupCompletionEstimate).toISOString();
    }
    qf.push(match);
    state.matches.push(match);
  }
  const sf = [];
  for (let index = 0; index < 2; index += 1) {
    const match = makeMatch({
      groupKey,
      phase: "sf",
      roundIndex: 1,
      order: index,
      code: `${prefix}-SF${index + 1}`,
      slots: [
        { type: "winner", matchId: qf[index * 2].id },
        { type: "winner", matchId: qf[index * 2 + 1].id }
      ],
      dependencies: [qf[index * 2].id, qf[index * 2 + 1].id]
    });
    sf.push(match);
    state.matches.push(match);
  }
  const final = makeMatch({
    groupKey,
    phase: "final",
    roundIndex: 2,
    order: 0,
    code: `${prefix}-F`,
    slots: [
      { type: "winner", matchId: sf[0].id },
      { type: "winner", matchId: sf[1].id }
    ],
    dependencies: [sf[0].id, sf[1].id]
  });
  const third = makeMatch({
    groupKey,
    phase: "third",
    roundIndex: 2,
    order: 1,
    code: `${prefix}-3RD`,
    slots: [
      { type: "loser", matchId: sf[0].id },
      { type: "loser", matchId: sf[1].id }
    ],
    dependencies: [sf[0].id, sf[1].id]
  });
  state.matches.push(final, third);
  state.draws[groupKey].knockoutCreated = true;
  addAudit(
    state,
    "生成八强随机签表",
    `${GROUP_BY_KEY[groupKey].name}八强已生成，首轮已避免同组第一与第二相遇。`
  );
  return state.draws[groupKey];
}

export function expectedMatchCounts(state) {
  return GROUP_DEFS.map((group) => {
    const matches = state.matches.filter((match) => match.group === group.key);
    const preliminary = matches.filter((match) =>
      ["group", "qualifier"].includes(match.phase)
    ).length;
    const knockout = matches.filter((match) =>
      ["r16", "qf", "sf", "final", "third"].includes(match.phase)
    ).length;
    return { group: group.key, preliminary, knockout, total: matches.length };
  });
}

export function groupMatchesCreated(state) {
  const status = {};
  for (const group of GROUP_DEFS) {
    status[group.key] = state.matches.filter((match) => match.group === group.key).length;
  }
  return status;
}

export function getPlacements(state, groupKey) {
  const finals = state.matches.filter(
    (match) => match.group === groupKey && ["final", "third"].includes(match.phase)
  );
  const final = finals.find((match) => match.phase === "final");
  const third = finals.find((match) => match.phase === "third");
  const placements = new Map();
  if (final?.winnerId) placements.set(final.winnerId, 1);
  if (final?.loserId) placements.set(final.loserId, 2);
  if (third?.winnerId) placements.set(third.winnerId, 3);
  if (third?.loserId) placements.set(third.loserId, 4);
  const qfPhase = GROUP_BY_KEY[groupKey].level === "new" ? "qf" : "qf";
  for (const match of state.matches.filter(
    (entry) => entry.group === groupKey && entry.phase === qfPhase && entry.loserId
  )) {
    placements.set(match.loserId, 5);
  }
  return placements;
}

export function getPlayerPlacement(state, playerId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return null;
  return getPlacements(state, player.group).get(playerId) ?? null;
}

export function placementLabel(place) {
  if (!place) return "未产生";
  if (place === 1) return "冠军";
  if (place === 2) return "亚军";
  if (place === 3) return "季军";
  if (place === 4) return "第四名";
  return `并列第${place}名`;
}

export function calculateTeamStandings(state) {
  const teamRows = new Map(
    state.units.map((unit, index) => [
      unit.id,
      {
        unitId: unit.id,
        unitName: unit.name,
        order: index,
        total: 0,
        byGroup: Object.fromEntries(GROUP_DEFS.map((group) => [group.key, 0])),
        scorers: []
      }
    ])
  );

  for (const group of GROUP_DEFS) {
    const placements = getPlacements(state, group.key);
    for (const [playerId, place] of placements.entries()) {
      const player = state.players.find((entry) => entry.id === playerId);
      if (!player) continue;
      const points = Number(state.settings.pointsByPlace?.[place] ?? 0);
      const pointsUnitId = player.alumni
        ? player.pointsUnitId ?? player.unitId
        : player.unitId;
      if (!pointsUnitId || !teamRows.has(pointsUnitId)) continue;
      const row = teamRows.get(pointsUnitId);
      row.total += points;
      row.byGroup[group.key] += points;
      row.scorers.push({
        playerId,
        playerName: player.name,
        group: group.key,
        place,
        points,
        alumni: player.alumni
      });
    }
  }

  const rows = [...teamRows.values()].sort(
    (left, right) => right.total - left.total || left.order - right.order
  );
  let currentRank = 0;
  let previousScore = null;
  rows.forEach((row, index) => {
    if (row.total !== previousScore) {
      currentRank = index + 1;
      previousScore = row.total;
    }
    row.rank = currentRank;
  });
  for (const row of rows) {
    row.tied = rows.some((other) => other !== row && other.total === row.total);
  }
  return rows;
}

export function getPlacementRows(state) {
  const rows = [];
  for (const group of GROUP_DEFS) {
    const placements = getPlacements(state, group.key);
    for (const [playerId, place] of [...placements.entries()].sort((a, b) => a[1] - b[1])) {
      const player = state.players.find((entry) => entry.id === playerId);
      if (!player) continue;
      rows.push({
        group: group.key,
        groupName: group.name,
        place,
        placeLabel: placementLabel(place),
        player,
        pointsUnit: player.alumni
          ? findUnitById(player.pointsUnitId ?? player.unitId, state.units)
          : findUnitById(player.unitId, state.units),
        points: Number(state.settings.pointsByPlace?.[place] ?? 0)
      });
    }
  }
  return rows;
}

export function eventCompletion(state) {
  const finals = state.matches.filter((match) => match.phase === "final");
  const allFinalsComplete = finals.length === 4 && finals.every((match) => match.winnerId);
  if (allFinalsComplete) state.meta.phase = "finished";
  const completed = state.matches.filter((match) => match.winnerId).length;
  const live = state.matches.filter((match) => match.schedule.status === "live").length;
  return { completed, live, total: state.matches.length, allFinalsComplete };
}

export function validateRosterForDraw(state, groupKey) {
  const group = GROUP_BY_KEY[groupKey];
  const players = state.players.filter((player) => player.group === groupKey);
  if (group.level === "new") {
    return { valid: players.length >= 4, message: `当前${players.length}人` };
  }
  try {
    validateAdvancedSeeds(state, groupKey);
    return { valid: true, message: "24人 / 8名种子" };
  } catch (error) {
    return { valid: false, message: error.message };
  }
}

export function validateAllRoster(state) {
  return validateRoster(state);
}

export function drawSummary(state, groupKey) {
  const draw = state.draws[groupKey];
  if (!draw) return "未生成";
  if (draw.status === "preview") return "预览待确认";
  if (draw.status === "locked") return "已锁定";
  return "未生成";
}
