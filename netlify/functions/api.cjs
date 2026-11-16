const { getStore, connectLambda } = require("@netlify/blobs");

const units = [
  { id: "u_cs", name: "计算机系", aliases: ["计算机系", "计算机科学与技术系"], active: true },
  { id: "u_arch", name: "建筑学院", aliases: ["建筑学院", "建筑系"], active: true },
  { id: "u_civil", name: "土木建管系", aliases: ["土木工程系", "建设管理系", "土木建管系"], active: true },
  { id: "u_env", name: "环境学院", aliases: ["环境学院", "环境科学与工程系"], active: true },
  { id: "u_me", name: "机械工程系", aliases: ["机械工程系", "机械系"], active: true },
  { id: "u_energy", name: "能源与动力工程系", aliases: ["能源与动力工程系", "能动系"], active: true },
  {
    id: "u_med",
    name: "医学院·万科卫健学院",
    aliases: ["医学院", "万科公共卫生与健康学院", "万科卫健学院", "医学院·万科卫健学院"],
    active: true
  },
  { id: "u_sem", name: "经济管理学院", aliases: ["经济管理学院", "经管学院"], active: true }
];

function createInitialState() {
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
    units,
    players: [],
    draws: {
      new_men: { status: "empty", groups: [], knockoutCreated: false },
      new_women: { status: "empty", groups: [], knockoutCreated: false },
      advanced_men: { status: "empty", preview: null, generated: false },
      advanced_women: { status: "empty", preview: null, generated: false }
    },
    matches: [],
    groupResolutions: {},
    settings: {
      restMinutes: 10,
      dayWindows: [
        { label: "上午", start: "09:00", end: "12:00" },
        { label: "下午", start: "14:00", end: "18:00" }
      ],
      durations: { new: 7, advanced: 17, advancedWarmupMinutes: 2 },
      pointsByPlace: { 1: 10, 2: 8, 3: 6, 4: 5, 5: 3, 6: 2, 7: 1, 8: 0 },
      teamRankingMode: "sum",
      drawLocked: false
    },
    audit: [],
    revisions: []
  };
}

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

function timingSafeEqualText(left, right) {
  const leftValue = String(left ?? "");
  const rightValue = String(right ?? "");
  if (leftValue.length !== rightValue.length) return false;
  let mismatch = 0;
  for (let index = 0; index < leftValue.length; index += 1) {
    mismatch |= leftValue.charCodeAt(index) ^ rightValue.charCodeAt(index);
  }
  return mismatch === 0;
}

function validateState(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("保存内容无效。");
  if (!candidate.meta?.eventId) throw new Error("缺少赛事标识。");
  if (!Array.isArray(candidate.players) || !Array.isArray(candidate.matches)) {
    throw new Error("名单或比赛数据结构无效。");
  }
  if (candidate.players.length > 5000 || candidate.matches.length > 5000) {
    throw new Error("数据量超出系统上限。");
  }
  const playerIds = new Set();
  for (const player of candidate.players) {
    if (!player.id || playerIds.has(player.id)) throw new Error("选手 ID 缺失或重复。");
    playerIds.add(player.id);
  }
  const matchIds = new Set();
  for (const match of candidate.matches) {
    if (!match.id || matchIds.has(match.id)) throw new Error("比赛 ID 缺失或重复。");
    matchIds.add(match.id);
  }
}

async function getStoreClient() {
  return getStore({
    name: "mihou-event-v1",
    consistency: "strong"
  });
}

async function getCurrent(store) {
  const entry = await store.getWithMetadata("event", { type: "json" });
  if (entry) return entry;
  const initial = createInitialState();
  const created = await store.setJSON("event", initial, { onlyIfNew: true });
  if (!created.modified) {
    const concurrent = await store.getWithMetadata("event", { type: "json" });
    if (concurrent) return concurrent;
  }
  return {
    data: initial,
    etag: created.etag,
    metadata: {}
  };
}

exports.handler = async (event) => {
  try {
    connectLambda(event);
    const url = new URL(event.rawUrl);
    const path = url.pathname;
    const queryToken = url.searchParams.get("token") ?? "";
    const headerValue =
      event.headers.authorization ||
      event.headers.Authorization ||
      "";
    const bearer = headerValue.startsWith("Bearer ") ? headerValue.slice(7) : "";
    const suppliedToken = queryToken || bearer;
    if (suppliedToken && !timingSafeEqualText(suppliedToken, process.env.ADMIN_TOKEN)) {
      return json({ error: "管理员链接无效。" }, 403);
    }
    const admin = Boolean(suppliedToken);
    const store = await getStoreClient();

    if (path === "/api/health") {
      const current = await getCurrent(store);
      return json({
        ok: true,
        platform: "netlify",
        version: current.data.meta.version,
        players: current.data.players.length,
        matches: current.data.matches.length
      });
    }

    if (path === "/api/state" && event.httpMethod === "GET") {
      const current = await getCurrent(store);
      return json({
        state: current.data,
        role: admin ? "admin" : "viewer",
        adminPath: admin ? `/admin/${process.env.ADMIN_TOKEN}` : null,
        transport: "poll",
        pollIntervalMs: 5000
      });
    }

    if (path === "/api/previous" && event.httpMethod === "GET") {
      if (!admin) return json({ error: "需要管理员权限。" }, 403);
      const previous = await store.get("previous", { type: "json" });
      if (!previous) return json({ error: "尚无可恢复的上一版数据。" }, 404);
      return json({ state: previous });
    }

    if (path === "/api/state" && event.httpMethod === "POST") {
      if (!admin) return json({ error: "没有编辑权限。观众链接只能查看。" }, 403);
      const text = event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64").toString("utf8")
        : event.body || "";
      if (text.length > 20 * 1024 * 1024) return json({ error: "请求内容超过20MB。" }, 413);
      const body = JSON.parse(text);
      validateState(body.state);
      const current = await getCurrent(store);
      if (Number(body.expectedVersion) !== Number(current.data.meta.version)) {
        return json(
          {
            error: "赛事数据已被另一窗口更新，请重新载入后再操作。",
            currentVersion: current.data.meta.version
          },
          409
        );
      }
      const next = body.state;
      next.meta.version = Number(current.data.meta.version) + 1;
      next.meta.updatedAt = new Date().toISOString();
      const saved = await store.setJSON("event", next, { onlyIfMatch: current.etag });
      if (!saved.modified) {
        return json(
          {
            error: "赛事数据已被另一窗口更新，请重新载入后再操作。",
            currentVersion: current.data.meta.version
          },
          409
        );
      }
      await store.setJSON("previous", current.data, {
        metadata: { version: current.data.meta.version }
      });
      return json({ ok: true, state: next, version: next.meta.version });
    }

    return json({ error: "接口不存在。" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || "服务器内部错误。" }, 500);
  }
};
