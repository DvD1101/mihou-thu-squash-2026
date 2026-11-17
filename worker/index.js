let schemaReady = false;
const EVENT_BASE = "/events/2026-thu-nine-school";

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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

function serveStatic(request, url, env) {
  if (url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }
  if (env.ASSETS) return env.ASSETS.fetch(new Request(url.toString(), request));
  const embedded = globalThis.__MIHOU_STATIC_ASSETS__;
  if (!embedded) return new Response("Static assets are not initialized.", { status: 503 });
  let pathname = url.pathname;
  if (pathname === "/" || pathname === "/view" || pathname.startsWith("/admin/")) {
    pathname = "/index.html";
  }
  const looksLikeAsset =
    /\.[a-z0-9]+$/i.test(pathname) || pathname.startsWith("/src/");
  if (!embedded[pathname] && !looksLikeAsset) pathname = "/index.html";
  let asset = embedded[pathname];
  if (!asset) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  const extension = pathname.slice(pathname.lastIndexOf("."));
  if (pathname === "/index.html") {
    asset = asset
      .replaceAll('href="/styles.css"', `href="${EVENT_BASE}/styles.css"`)
      .replaceAll('href="/src/', `href="${EVENT_BASE}/src/`)
      .replaceAll('src="/src/', `src="${EVENT_BASE}/src/`);
  }
  return new Response(request.method === "HEAD" ? null : asset, {
    status: 200,
    headers: {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" || extension === ".js" || extension === ".css"
        ? "no-cache"
        : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    }
  });
}

function renderLanding() {
  return new Response(
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MiHoo Squash</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f3f6; color: #21152f; }
    main { width: min(720px, calc(100% - 40px)); padding: 52px; border: 1px solid #dedce3; border-radius: 24px; background: white; box-shadow: 0 18px 60px rgba(33,21,47,.12); }
    .mark { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 20px; background: #472861; color: white; font: 700 20px Georgia, serif; }
    h1 { margin: 24px 0 10px; font: 700 clamp(32px, 6vw, 54px)/1.15 "Songti SC", serif; }
    p { color: #6d6b74; line-height: 1.8; }
    a { display: inline-flex; margin-top: 20px; padding: 12px 18px; border-radius: 10px; background: #5b3f8c; color: white; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <div class="mark">MH</div>
    <h1>MiHoo Squash</h1>
    <p>MiHoo 官方网站正在建设中。</p>
    <p>2026 清华大学九系壁球俱乐部联赛赛程系统已开放。</p>
    <a href="${EVENT_BASE}/view">进入赛事页面</a>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } }
  );
}

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS event_state (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      previous_version INTEGER,
      previous_updated_at TEXT,
      previous_payload TEXT
    )`
  ).run();
  const initial = createInitialState();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO event_state
      (id, version, updated_at, payload)
     VALUES ('main', ?, ?, ?)`
  )
    .bind(initial.meta.version, initial.meta.updatedAt, JSON.stringify(initial))
    .run();
  schemaReady = true;
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

async function readState(env, { previous = false } = {}) {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT version, updated_at, payload, previous_version, previous_updated_at, previous_payload
     FROM event_state WHERE id = 'main'`
  ).first();
  if (!row) throw new Error("赛事数据尚未初始化。");
  if (previous) {
    if (!row.previous_payload) return null;
    return JSON.parse(row.previous_payload);
  }
  return {
    row,
    state: JSON.parse(row.payload)
  };
}

async function handleApi(request, env, url) {
  if (url.pathname === "/api/health") {
    const current = await readState(env);
    return json({
      ok: true,
      platform: "cloudflare",
      version: current.row.version,
      players: current.state.players.length,
      matches: current.state.matches.length
    });
  }

  const viewerToken = url.searchParams.get("token") ?? "";
  const bearer = request.headers.get("Authorization")?.startsWith("Bearer ")
    ? request.headers.get("Authorization").slice(7)
    : "";
  const suppliedToken = viewerToken || bearer;
  if (suppliedToken && !timingSafeEqualText(suppliedToken, env.ADMIN_TOKEN)) {
    return json({ error: "管理员链接无效。" }, 403);
  }
  const admin = Boolean(suppliedToken);

  if (url.pathname === "/api/state" && request.method === "GET") {
    const current = await readState(env);
    return json({
      state: current.state,
      role: admin ? "admin" : "viewer",
      adminPath: admin ? `${EVENT_BASE}/admin/${env.ADMIN_TOKEN}` : null,
      transport: "poll",
      pollIntervalMs: 20000
    });
  }

  if (url.pathname === "/api/previous" && request.method === "GET") {
    if (!admin) return json({ error: "需要管理员权限。" }, 403);
    const previous = await readState(env, { previous: true });
    if (!previous) return json({ error: "尚无可恢复的上一版数据。" }, 404);
    return json({ state: previous });
  }

  if (url.pathname === "/api/state" && request.method === "POST") {
    if (!admin) return json({ error: "没有编辑权限。观众链接只能查看。" }, 403);
    const text = await request.text();
    if (text.length > 20 * 1024 * 1024) return json({ error: "请求内容超过20MB。" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "请求 JSON 无效。" }, 400);
    }
    validateState(body.state);
    const current = await readState(env);
    const expectedVersion = Number(body.expectedVersion);
    if (expectedVersion !== Number(current.row.version)) {
      return json(
        {
          error: "赛事数据已被另一窗口更新，请重新载入后再操作。",
          currentVersion: current.row.version
        },
        409
      );
    }
    const next = body.state;
    next.meta.version = Number(current.row.version) + 1;
    next.meta.updatedAt = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE event_state
       SET version = version + 1,
           updated_at = ?,
           payload = ?,
           previous_version = version,
           previous_updated_at = updated_at,
           previous_payload = payload
       WHERE id = 'main' AND version = ?`
    )
      .bind(next.meta.updatedAt, JSON.stringify(next), expectedVersion)
      .run();
    if (!result.meta?.changes) {
      const latest = await readState(env);
      return json(
        {
          error: "赛事数据已被另一窗口更新，请重新载入后再操作。",
          currentVersion: latest.row.version
        },
        409
      );
    }
    return json({
      ok: true,
      state: next,
      version: next.meta.version
    });
  }

  if (url.pathname === "/api/events") {
    return json({ error: "当前免费部署使用自动轮询，请使用 /api/state。" }, 410);
  }

  return json({ error: "接口不存在。" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const hostname = url.hostname;
      if (hostname === "mihoosquash.com") {
        const canonical = new URL(request.url);
        canonical.hostname = `www.${hostname}`;
        return Response.redirect(canonical.toString(), 308);
      }
      if (url.pathname === "/view" || url.pathname.startsWith("/admin/")) {
        return Response.redirect(`${url.origin}${EVENT_BASE}${url.pathname}${url.search}${url.hash}`, 308);
      }
      if (url.pathname === "/") return renderLanding();
      if (url.pathname === EVENT_BASE) {
        return Response.redirect(`${url.origin}${EVENT_BASE}/${url.search}`, 308);
      }
      if (!url.pathname.startsWith(`${EVENT_BASE}/`)) {
        return new Response("Not found", { status: 404 });
      }
      const relativeUrl = new URL(request.url);
      relativeUrl.pathname = url.pathname.slice(EVENT_BASE.length) || "/";
      if (relativeUrl.pathname.startsWith("/api/")) {
        return await handleApi(request, env, relativeUrl);
      }
      return serveStatic(request, relativeUrl, env);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "服务器内部错误。" }, 500);
    }
  }
};
