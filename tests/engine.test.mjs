import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_DEFS,
  createDemoState,
  validateRoster
} from "../public/src/model.js";
import {
  EngineError,
  batchDeletePlayers,
  batchSetSeeds,
  calculateTeamStandings,
  canCreateNewbieKnockout,
  confirmDraw,
  createNewbieKnockout,
  expectedMatchCounts,
  generateAdvancedPreview,
  generateGroupDraw,
  getDependenciesForMatch,
  getDownstreamMatches,
  getGroupMatches,
  getGroupStandings,
  getMatchPlayers,
  getPlacements,
  resolveGroupTie,
  setMatchWinner,
  undoMatchResult
} from "../public/src/engine.js";
import { autoSchedule, validateSchedule } from "../public/src/schedule.js";

function deterministicRandomFactory() {
  let value = 0x12345678;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function prepareAllDraws() {
  const state = createDemoState();
  state.players.forEach((player) => {
    if (player.group === "advanced_men" || player.group === "advanced_women") {
      player.seed = false;
    }
  });
  for (const groupKey of ["advanced_men", "advanced_women"]) {
    const players = state.players.filter((player) => player.group === groupKey);
    for (const unit of state.units) {
      players.find((player) => player.unitId === unit.id).seed = true;
    }
  }
  for (const group of GROUP_DEFS) {
    if (group.level === "new") {
      generateGroupDraw(state, group.key, deterministicRandomFactory());
    } else {
      generateAdvancedPreview(state, group.key, deterministicRandomFactory());
    }
    confirmDraw(state, group.key);
  }
  return state;
}

function finishGroups(state, groupKey) {
  const draw = state.draws[groupKey];
  for (const group of draw.groups) {
    const order = [...group.playerIds];
    const matches = getGroupMatches(state, groupKey, group.id);
    for (const match of matches) {
      const players = getMatchPlayers(state, match);
      players.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
      setMatchWinner(state, match.id, players[0].id);
    }
  }
}

function finishAllBrackets(state) {
  const groupOrder = ["new_men", "new_women", "advanced_men", "advanced_women"];
  for (const groupKey of groupOrder) {
    for (const phase of ["qualifier", "r16", "qf", "sf"]) {
      const matches = state.matches
        .filter((match) => match.group === groupKey && match.phase === phase)
        .sort((left, right) => left.order - right.order);
      for (const match of matches) {
        const players = getMatchPlayers(state, match);
        if (players.every(Boolean)) setMatchWinner(state, match.id, players[0].id);
      }
    }
    const final = state.matches.find(
      (match) => match.group === groupKey && match.phase === "final"
    );
    const third = state.matches.find(
      (match) => match.group === groupKey && match.phase === "third"
    );
    if (getMatchPlayers(state, final).every(Boolean)) {
      setMatchWinner(state, final.id, getMatchPlayers(state, final)[1].id);
    }
    if (getMatchPlayers(state, third).every(Boolean)) {
      setMatchWinner(state, third.id, getMatchPlayers(state, third)[0].id);
    }
  }
}

test("模拟名单为84人且四个组别人数正确", () => {
  const state = createDemoState();
  assert.equal(state.players.length, 84);
  assert.deepEqual(
    GROUP_DEFS.map((group) => state.players.filter((player) => player.group === group.key).length),
    [17, 19, 24, 24]
  );
  assert.equal(validateRoster(state).valid, true);
  assert.equal(new Set(state.players.map((player) => player.id)).size, 84);
});

test("四组抽签生成128场且进退阶种子结构正确", () => {
  const state = prepareAllDraws();
  assert.equal(state.matches.length, 112);
  for (const groupKey of ["advanced_men", "advanced_women"]) {
    const qualifiers = state.matches.filter(
      (match) => match.group === groupKey && match.phase === "qualifier"
    );
    const r16 = state.matches.filter(
      (match) => match.group === groupKey && match.phase === "r16"
    );
    assert.equal(qualifiers.length, 8);
    assert.equal(r16.length, 8);
    for (const match of r16) {
      const directSeed = match.slots.find((slot) => slot.type === "player");
      const qualifierWinner = match.slots.find((slot) => slot.type === "winner");
      assert.ok(state.players.find((player) => player.id === directSeed.playerId)?.seed);
      assert.equal(
        state.matches.find((entry) => entry.id === qualifierWinner.matchId)?.phase,
        "qualifier"
      );
    }
  }
  finishGroups(state, "new_men");
  finishGroups(state, "new_women");
  assert.equal(canCreateNewbieKnockout(state, "new_men"), true);
  assert.equal(canCreateNewbieKnockout(state, "new_women"), true);
  createNewbieKnockout(state, "new_men", deterministicRandomFactory());
  createNewbieKnockout(state, "new_women", deterministicRandomFactory());
  assert.equal(state.matches.length, 128);
  const counts = expectedMatchCounts(state);
  assert.deepEqual(
    counts.map((entry) => entry.total),
    [36, 44, 24, 24]
  );
  assert.equal(
    state.matches.filter((match) => match.phase === "third").length,
    4
  );
});

test("三人循环胜负进入人工裁决并按填写顺序排名", () => {
  const state = createDemoState();
  generateGroupDraw(state, "new_men", deterministicRandomFactory());
  confirmDraw(state, "new_men");
  const group = state.draws.new_men.groups.find((entry) => entry.playerIds.length === 4);
  const [a, b, c, d] = group.playerIds;
  const matches = getGroupMatches(state, "new_men", group.id);
  const winnerByPair = new Map([
    [[a, b].sort().join("|"), a],
    [[b, c].sort().join("|"), b],
    [[a, c].sort().join("|"), c],
    [[a, d].sort().join("|"), a],
    [[b, d].sort().join("|"), b],
    [[c, d].sort().join("|"), c]
  ]);
  for (const match of matches) {
    const ids = getMatchPlayers(state, match).map((player) => player.id);
    const key = [...ids].sort().join("|");
    setMatchWinner(state, match.id, winnerByPair.get(key));
  }
  const standings = getGroupStandings(state, "new_men", group.id);
  assert.equal(standings.complete, true);
  assert.equal(standings.pending, true);
  resolveGroupTie(state, "new_men", group.id, [c, a, b], "按竞赛规程人工裁决");
  const resolved = getGroupStandings(state, "new_men", group.id);
  assert.equal(resolved.pending, false);
  assert.deepEqual(resolved.rows.map((row) => row.playerId), [c, a, b, d]);
  assert.equal(resolved.rows[0].qualifies, true);
  assert.equal(resolved.rows[1].qualifies, true);
});

test("半决赛负者进入季军赛，冠军亚军季军可完整产生", () => {
  const state = prepareAllDraws();
  finishGroups(state, "new_men");
  finishGroups(state, "new_women");
  createNewbieKnockout(state, "new_men", deterministicRandomFactory());
  createNewbieKnockout(state, "new_women", deterministicRandomFactory());
  finishAllBrackets(state);
  for (const group of GROUP_DEFS) {
    const third = state.matches.find(
      (match) => match.group === group.key && match.phase === "third"
    );
    const semifinals = state.matches.filter(
      (match) => match.group === group.key && match.phase === "sf"
    );
    assert.equal(semifinals.length, 2);
    assert.deepEqual(
      getMatchPlayers(state, third).map((player) => player.id).sort(),
      semifinals.map((match) => match.loserId).sort()
    );
    const placements = getPlacements(state, group.key);
    assert.equal(placements.size, 8);
  }
  const standings = calculateTeamStandings(state);
  assert.equal(standings.some((team) => team.total > 0), true);
});

test("修改早期赛果时阻止静默覆盖，确认后按依赖顺序清除下游", () => {
  const state = prepareAllDraws();
  finishGroups(state, "new_men");
  finishGroups(state, "new_women");
  createNewbieKnockout(state, "new_men", deterministicRandomFactory());
  const quarterfinal = state.matches.find(
    (match) => match.group === "new_men" && match.phase === "qf"
  );
  const quarterfinals = state.matches
    .filter((match) => match.group === "new_men" && match.phase === "qf")
    .sort((left, right) => left.order - right.order);
  for (const match of quarterfinals) {
    const players = getMatchPlayers(state, match);
    setMatchWinner(state, match.id, players[0].id);
  }
  const originalPlayers = getMatchPlayers(state, quarterfinal);
  const downstream = getDownstreamMatches(state, quarterfinal.id);
  const semifinal = downstream.find((match) => match.phase === "sf");
  const semifinalPlayers = getMatchPlayers(state, semifinal);
  setMatchWinner(state, semifinal.id, semifinalPlayers[0].id);
  assert.throws(
    () => setMatchWinner(state, quarterfinal.id, originalPlayers[1].id),
    (error) =>
      error instanceof EngineError &&
      error.details.requiresCascade &&
      error.details.impactedCodes.includes(semifinal.code)
  );
  setMatchWinner(state, quarterfinal.id, originalPlayers[1].id, {
    cascade: true,
    reason: "计分员误录"
  });
  assert.equal(semifinal.winnerId, null);
  assert.equal(quarterfinal.winnerId, originalPlayers[1].id);
  undoMatchResult(state, quarterfinal.id, { cascade: true, reason: "再次复核" });
  assert.equal(quarterfinal.winnerId, null);
});

test("自动排场满足4片场地、午间禁排和依赖顺序", () => {
  const state = prepareAllDraws();
  finishGroups(state, "new_men");
  finishGroups(state, "new_women");
  createNewbieKnockout(state, "new_men", deterministicRandomFactory());
  createNewbieKnockout(state, "new_women", deterministicRandomFactory());
  assert.equal(state.matches.length, 128);
  const result = autoSchedule(state);
  assert.equal(result.scheduledCount + result.unassignedCount, 128);
  assert.equal(result.unassignedCount, 0);
  const validation = validateSchedule(state);
  assert.deepEqual(validation.errors, []);
  for (const match of state.matches) {
    if (!match.schedule.startAt) continue;
    const start = new Date(match.schedule.startAt);
    const end = new Date(match.schedule.endAt);
    const startText = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }).format(start);
    const endText = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }).format(end);
    assert.ok(startText >= "09:00");
    assert.ok(!(startText < "14:00" && endText > "12:00"));
    for (const dependencyId of getDependenciesForMatch(state, match.id)) {
      const dependency = state.matches.find((entry) => entry.id === dependencyId);
      if (dependency?.schedule.endAt) {
        assert.ok(
          new Date(match.schedule.startAt) >=
            new Date(dependency.schedule.endAt.getTime?.() ?? dependency.schedule.endAt)
        );
      }
    }
  }
});

test("同单位可以有多名种子，但每组总数仍不得超过8人", () => {
  const state = createDemoState();
  const players = state.players.filter((player) => player.group === "advanced_men");
  const currentSeeds = players.filter((player) => player.seed);
  batchSetSeeds(
    state,
    "advanced_men",
    currentSeeds.map((player) => player.id),
    false
  );
  assert.equal(state.players.filter((player) => player.group === "advanced_men" && player.seed).length, 0);

  const repeatedUnits = [
    ...players.filter((player) => player.unitId === state.units[0].id).slice(0, 3),
    ...players.filter((player) => player.unitId === state.units[1].id).slice(0, 3),
    ...players.filter((player) => player.unitId === state.units[2].id).slice(0, 2)
  ];
  batchSetSeeds(
    state,
    "advanced_men",
    repeatedUnits.map((player) => player.id),
    true
  );
  assert.equal(state.players.filter((player) => player.group === "advanced_men" && player.seed).length, 8);
  const unitCounts = repeatedUnits.reduce((counts, player) => {
    counts[player.unitId] = (counts[player.unitId] ?? 0) + 1;
    return counts;
  }, {});
  assert.ok(Math.max(...Object.values(unitCounts)) > 1);
  const ninth = players.find((player) => !player.seed);
  assert.throws(
    () => batchSetSeeds(state, "advanced_men", [ninth.id], true),
    /种子不能超过8名/
  );
  assert.doesNotThrow(() => generateAdvancedPreview(state, "advanced_men"));
});

test("批量删除阻止删除已进入签表的选手并重置未锁定预览", () => {
  const state = createDemoState();
  generateGroupDraw(state, "new_men", deterministicRandomFactory());
  const previewPlayers = state.players.filter((player) => player.group === "new_men").slice(0, 2);
  const removed = batchDeletePlayers(state, previewPlayers.map((player) => player.id));
  assert.equal(removed, 2);
  assert.equal(state.draws.new_men.status, "empty");

  generateGroupDraw(state, "new_men", deterministicRandomFactory());
  confirmDraw(state, "new_men");
  const drawnPlayer = state.players.find((player) => player.group === "new_men");
  assert.throws(
    () => batchDeletePlayers(state, [drawnPlayer.id]),
    /已经进入比赛签表/
  );
});
