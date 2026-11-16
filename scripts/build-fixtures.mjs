import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GROUP_DEFS, createDemoState } from "../public/src/model.js";
import {
  autoSchedule
} from "../public/src/schedule.js";
import {
  confirmDraw,
  createNewbieKnockout,
  eventCompletion,
  generateAdvancedPreview,
  generateGroupDraw,
  getGroupMatches,
  getMatchPlayers,
  setMatchWinner
} from "../public/src/engine.js";
import { createWorkbook } from "../public/src/xlsx.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "outputs");
await fs.mkdir(outputDir, { recursive: true });

function deterministicRandomFactory() {
  let value = 0x2f6e2b1;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function prepareDraws() {
  const state = createDemoState();
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

function finishGroupStage(state, groupKey) {
  for (const group of state.draws[groupKey].groups) {
    const ranking = [...group.playerIds];
    for (const match of getGroupMatches(state, groupKey, group.id)) {
      const players = getMatchPlayers(state, match).sort(
        (left, right) => ranking.indexOf(left.id) - ranking.indexOf(right.id)
      );
      setMatchWinner(state, match.id, players[0].id);
    }
  }
}

function finishBracket(state, groupKey, { partial = false } = {}) {
  const phases = ["qualifier", "r16", "qf", "sf"];
  for (const phase of phases) {
    const matches = state.matches
      .filter((match) => match.group === groupKey && match.phase === phase)
      .sort((left, right) => left.order - right.order);
    for (const [index, match] of matches.entries()) {
      if (partial && index >= Math.ceil(matches.length / 2)) continue;
      const players = getMatchPlayers(state, match);
      if (players.every(Boolean)) setMatchWinner(state, match.id, players[0].id);
    }
  }
  if (partial) return;
  for (const phase of ["final", "third"]) {
    const match = state.matches.find(
      (entry) => entry.group === groupKey && entry.phase === phase
    );
    const players = getMatchPlayers(state, match);
    if (players.every(Boolean)) {
      setMatchWinner(state, match.id, phase === "final" ? players[1].id : players[0].id);
    }
  }
}

const ready = prepareDraws();
for (const groupKey of ["new_men", "new_women"]) {
  finishGroupStage(ready, groupKey);
  createNewbieKnockout(ready, groupKey, deterministicRandomFactory());
}
autoSchedule(ready);
await fs.writeFile(
  path.join(outputDir, "模拟赛事_完整签表待开赛.json"),
  `${JSON.stringify(ready, null, 2)}\n`,
  "utf8"
);

const completed = structuredClone(ready);
for (const group of GROUP_DEFS) {
  finishBracket(completed, group.key);
}
eventCompletion(completed);
autoSchedule(completed);
await fs.writeFile(
  path.join(outputDir, "模拟赛事_全部完成.json"),
  `${JSON.stringify(completed, null, 2)}\n`,
  "utf8"
);

const live = structuredClone(ready);
for (const groupKey of ["new_men", "new_women"]) {
  const matches = live.matches.filter((match) => match.group === groupKey && match.phase === "group");
  matches.slice(0, Math.ceil(matches.length * 0.7)).forEach((match) => {
    const players = getMatchPlayers(live, match);
    setMatchWinner(live, match.id, players[0].id);
  });
}
for (const groupKey of ["advanced_men", "advanced_women"]) {
  const qualifiers = live.matches
    .filter((match) => match.group === groupKey && match.phase === "qualifier")
    .slice(0, 5);
  for (const match of qualifiers) {
    setMatchWinner(live, match.id, getMatchPlayers(live, match)[0].id);
  }
}
autoSchedule(live);
await fs.writeFile(
  path.join(outputDir, "模拟赛事_比赛进行中.json"),
  `${JSON.stringify(live, null, 2)}\n`,
  "utf8"
);

const templateWorkbook = createWorkbook([
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
      ["院系", "必填；系统按设置中的院系别名映射到八个联合参赛单位"],
      ["组别", "仅可填写：新手男子、新手女子、进阶男子、进阶女子"],
      ["其他字段", "不需要种子序号、签位、联系方式；导入后在网页中维护"],
      ["示例数据", "请删除四条示例记录后填写真实名单"]
    ]
  }
]);
await fs.writeFile(path.join(outputDir, "MiHoo_九系壁球联赛_名单导入模板.xlsx"), templateWorkbook);

const demoWorkbook = createWorkbook([
  {
    name: "84人模拟名单",
    rows: [
      ["选手姓名", "院系", "组别"],
      ...ready.players.map((player) => [
        player.name,
        player.department,
        GROUP_DEFS.find((group) => group.key === player.group).name
      ])
    ]
  }
]);
await fs.writeFile(path.join(outputDir, "MiHoo_84人模拟参赛名单.xlsx"), demoWorkbook);

console.log(`Fixtures written to ${outputDir}`);
