export const GROUP_DEFS = [
  {
    key: "new_men",
    name: "新手男子",
    short: "新男",
    level: "new",
    initialSize: 17,
    color: "#5b3f8c"
  },
  {
    key: "new_women",
    name: "新手女子",
    short: "新女",
    level: "new",
    initialSize: 19,
    color: "#a06c9b"
  },
  {
    key: "advanced_men",
    name: "进阶男子",
    short: "进男",
    level: "advanced",
    initialSize: 24,
    color: "#2f5f81"
  },
  {
    key: "advanced_women",
    name: "进阶女子",
    short: "进女",
    level: "advanced",
    initialSize: 24,
    color: "#387a6b"
  }
];

export const GROUP_BY_KEY = Object.fromEntries(GROUP_DEFS.map((group) => [group.key, group]));

export const GROUP_NAME_TO_KEY = Object.fromEntries(
  GROUP_DEFS.flatMap((group) => [
    [group.name, group.key],
    [group.short, group.key],
    [group.key, group.key]
  ])
);

export const PHASE_LABELS = {
  group: "小组赛",
  qualifier: "资格赛",
  r16: "16强",
  qf: "八强",
  sf: "半决赛",
  final: "决赛",
  third: "季军赛"
};

export const MATCH_STATUS_LABELS = {
  unassigned: "待安排",
  scheduled: "待开始",
  ready: "可开始",
  live: "进行中",
  completed: "已完成"
};

export const DEFAULT_UNITS = [
  {
    id: "u_cs",
    name: "计算机系",
    aliases: ["计算机系", "计算机科学与技术系"],
    active: true
  },
  {
    id: "u_arch",
    name: "建筑学院",
    aliases: ["建筑学院", "建筑系"],
    active: true
  },
  {
    id: "u_civil",
    name: "土木建管系",
    aliases: ["土木工程系", "建设管理系", "土木建管系"],
    active: true
  },
  {
    id: "u_env",
    name: "环境学院",
    aliases: ["环境学院", "环境科学与工程系"],
    active: true
  },
  {
    id: "u_me",
    name: "机械工程系",
    aliases: ["机械工程系", "机械系"],
    active: true
  },
  {
    id: "u_energy",
    name: "能源与动力工程系",
    aliases: ["能源与动力工程系", "能动系"],
    active: true
  },
  {
    id: "u_med",
    name: "医学院·万科卫健学院",
    aliases: [
      "医学院",
      "万科公共卫生与健康学院",
      "万科卫健学院",
      "医学院·万科卫健学院"
    ],
    active: true
  },
  {
    id: "u_sem",
    name: "经济管理学院",
    aliases: ["经济管理学院", "经管学院"],
    active: true
  }
];

export const DEFAULT_POINTS = {
  1: 10,
  2: 8,
  3: 6,
  4: 5,
  5: 3,
  6: 2,
  7: 1,
  8: 0
};

export const DEMO_DEPARTMENTS = DEFAULT_UNITS.flatMap((unit) => {
  const value = unit.aliases[0] ?? unit.name;
  return Array.from({ length: 10 }, () => value);
});

const SURNAMES = [
  "王",
  "李",
  "张",
  "刘",
  "陈",
  "杨",
  "黄",
  "赵",
  "吴",
  "周",
  "徐",
  "孙",
  "胡",
  "朱",
  "高",
  "林",
  "何",
  "郭",
  "马",
  "罗"
];

const GIVEN_NAMES = [
  "子涵",
  "宇辰",
  "雨桐",
  "思远",
  "嘉宁",
  "明轩",
  "若溪",
  "浩然",
  "安琪",
  "书航",
  "晨阳",
  "欣怡",
  "博文",
  "可心",
  "景行",
  "知夏",
  "一诺",
  "清越",
  "嘉树",
  "云舒",
  "致远",
  "语晨",
  "昊然",
  "芷宁",
  "文博",
  "诗雨",
  "承宇",
  "思齐",
  "锦程",
  "沐阳",
  "亦凡",
  "映雪",
  "弘毅",
  "青禾",
  "睿泽",
  "婉清",
  "修远",
  "暖阳",
  "泽宇",
  "星澜",
  "皓月",
  "以宁",
  "维岳",
  "乐彤",
  "少卿",
  "令仪",
  "思源",
  "明悦",
  "怀瑾",
  "和风",
  "沐晴",
  "知远",
  "弘文",
  "云帆",
  "清和",
  "书瑶",
  "致远",
  "听澜",
  "予安",
  "俊逸",
  "可欣"
];

export function randomId(prefix = "id") {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `${prefix}_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function findUnitByDepartment(department, units) {
  const normalized = normalizeText(department);
  if (!normalized) return null;
  return (
    units.find((unit) =>
      [unit.name, ...(unit.aliases ?? [])].some((alias) => normalizeText(alias) === normalized)
    ) ?? null
  );
}

export function findUnitById(unitId, units) {
  return units.find((unit) => unit.id === unitId) ?? null;
}

export function canonicalGroupKey(value) {
  const normalized = String(value ?? "").trim();
  if (GROUP_NAME_TO_KEY[normalized]) return GROUP_NAME_TO_KEY[normalized];
  const lower = normalized.toLowerCase();
  return Object.entries(GROUP_NAME_TO_KEY).find(([key]) => key.toLowerCase() === lower)?.[1] ?? null;
}

export function createSettings() {
  return {
    restMinutes: 10,
    dayWindows: [
      { label: "上午", start: "09:00", end: "12:00" },
      { label: "下午", start: "14:00", end: "18:00" }
    ],
    durations: {
      new: 7,
      advanced: 17,
      advancedWarmupMinutes: 2
    },
    pointsByPlace: { ...DEFAULT_POINTS },
    teamRankingMode: "sum",
    drawLocked: false
  };
}

export function createEmptyState() {
  const now = new Date().toISOString();
  return {
    meta: {
      eventId: "mihou-nine-school-2026",
      name: "清华大学九系壁球俱乐部联赛",
      date: "2026-11-21",
      timeLabel: "09:00–12:00 / 14:00–18:00",
      venue: "清华大学北体育馆",
      courts: 4,
      organizer: "MiHoo咪呼壁球工作室",
      phase: "setup",
      version: 0,
      updatedAt: now,
      createdAt: now,
      isDemo: false
    },
    units: structuredClone(DEFAULT_UNITS),
    players: [],
    draws: {
      new_men: { status: "empty", groups: [], knockoutCreated: false },
      new_women: { status: "empty", groups: [], knockoutCreated: false },
      advanced_men: { status: "empty", preview: null, generated: false },
      advanced_women: { status: "empty", preview: null, generated: false }
    },
    matches: [],
    groupResolutions: {},
    settings: createSettings(),
    audit: [],
    revisions: []
  };
}

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildDemoNames(total) {
  const result = new Set();
  while (result.size < total) {
    const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
    const given = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
    result.add(`${surname}${given}`);
  }
  return [...result];
}

export function createDemoState() {
  const state = createEmptyState();
  state.meta.isDemo = true;
  state.meta.phase = "setup";
  const allNames = shuffle(buildDemoNames(84));
  let nameIndex = 0;

  for (const group of GROUP_DEFS) {
    for (let index = 0; index < group.initialSize; index += 1) {
      const unit = state.units[index % state.units.length];
      const department =
        index === group.initialSize - 1 && group.level === "new"
          ? "美术学院"
          : unit.aliases[0] ?? unit.name;
      const mappedUnit = findUnitByDepartment(department, state.units);
      state.players.push({
        id: randomId("p"),
        name: allNames[nameIndex],
        department,
        unitId: mappedUnit?.id ?? null,
        pointsUnitId: mappedUnit?.id ?? null,
        group: group.key,
        alumni: index === 2,
        seed: false,
        createdAt: new Date().toISOString()
      });
      nameIndex += 1;
    }
  }

  for (const groupKey of ["advanced_men", "advanced_women"]) {
    const players = state.players.filter((player) => player.group === groupKey);
    for (const unit of state.units) {
      const candidate = players.find((player) => player.unitId === unit.id);
      if (candidate) candidate.seed = true;
    }
  }

  addAudit(state, "初始化模拟数据", "导入84名模拟参赛者；四个组别人数为17、19、24、24。");
  return state;
}

export function addAudit(state, action, detail, source = "admin") {
  state.audit.unshift({
    id: randomId("audit"),
    at: new Date().toISOString(),
    action,
    detail,
    source
  });
  state.audit = state.audit.slice(0, 500);
}

export function recomputePlayerUnits(state) {
  for (const player of state.players) {
    const unit = findUnitByDepartment(player.department, state.units);
    if (!player.unitOverridden) player.unitId = unit?.id ?? null;
    if (player.alumni && !player.pointsUnitOverridden) {
      player.pointsUnitId = unit?.id ?? player.pointsUnitId ?? null;
    }
  }
}

export function playerName(state, playerId) {
  return state.players.find((player) => player.id === playerId)?.name ?? "待定";
}

export function playerUnitName(state, playerId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return "";
  if (player.alumni && player.pointsUnitId) {
    return findUnitById(player.pointsUnitId, state.units)?.name ?? player.department;
  }
  return player.unitId
    ? findUnitById(player.unitId, state.units)?.name ?? player.department
    : `${player.department} · 外院系`;
}

export function validateRoster(state) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const groupsByName = new Map();

  for (const player of state.players) {
    if (!player.name?.trim()) errors.push(`选手 ${player.id} 姓名为空。`);
    if (!GROUP_BY_KEY[player.group]) errors.push(`${player.name || player.id} 的组别不合法。`);
    const key = `${normalizeText(player.name)}|${player.group}`;
    if (seen.has(key)) {
      errors.push(`“${player.name}”在${GROUP_BY_KEY[player.group]?.name ?? player.group}中重复。`);
    } else {
      seen.set(key, player.id);
    }
    const normalizedName = normalizeText(player.name);
    if (!groupsByName.has(normalizedName)) groupsByName.set(normalizedName, new Set());
    groupsByName.get(normalizedName).add(player.group);
  }

  for (const [name, groups] of groupsByName.entries()) {
    if (name && groups.size > 1) {
      warnings.push(`选手“${name}”出现在多个组别，请核对是否重复参赛。`);
    }
  }

  for (const group of GROUP_DEFS) {
    const players = state.players.filter((player) => player.group === group.key);
    if (players.length !== group.initialSize) {
      warnings.push(`${group.name}当前 ${players.length} 人，初始赛制配置为 ${group.initialSize} 人。`);
    }
    if (group.level === "advanced") {
      const seeds = players.filter((player) => player.seed);
      if (players.length !== 24 || seeds.length !== 8) {
        warnings.push(`${group.name}需要 24 人和 8 名种子才能生成标准签表（当前 ${players.length} 人 / ${seeds.length} 种）。`);
      }
      const seedUnits = seeds.map((player) => player.unitId).filter(Boolean);
      if (new Set(seedUnits).size !== seedUnits.length) {
        errors.push(`${group.name}的种子选手来自重复参赛单位。`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function createPlayer(input, units) {
  const unit = findUnitByDepartment(input.department, units);
  return {
    id: randomId("p"),
    name: String(input.name ?? "").trim(),
    department: String(input.department ?? "").trim(),
    unitId: unit?.id ?? null,
    pointsUnitId: unit?.id ?? null,
    group: input.group,
    alumni: Boolean(input.alumni),
    seed: Boolean(input.seed),
    createdAt: new Date().toISOString()
  };
}
