import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createDemoState } from "./public/src/model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "work", "data"));
const statePath = path.join(dataDir, "state.json");
const authPath = path.join(dataDir, "auth.json");
const previousPath = path.join(dataDir, "state.previous.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const clients = new Set();
let state;
let adminToken;
let saveQueue = Promise.resolve();

class SaveConflict extends Error {
  constructor() {
    super("赛事数据已被另一窗口更新，请重新载入后再操作。");
    this.statusCode = 409;
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function timingSafeEqualText(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return (
    leftBytes.length === rightBytes.length &&
    crypto.timingSafeEqual(leftBytes, rightBytes)
  );
}

async function persistJson(target, value) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
}

async function initialize() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    adminToken = process.env.ADMIN_TOKEN || (await fs.readFile(authPath, "utf8")).trim();
    if (adminToken.length < 32) throw new Error("管理员令牌长度不足。");
  } catch {
    adminToken = process.env.ADMIN_TOKEN || randomToken();
    await fs.writeFile(authPath, `${adminToken}\n`, { encoding: "utf8", mode: 0o600 });
  }
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    state = createDemoState();
    await persistJson(statePath, state);
  }
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
  );
}

function extractBearer(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function isAdmin(request) {
  const candidate = extractBearer(request);
  return Boolean(candidate) && timingSafeEqualText(candidate, adminToken);
}

function validateSubmittedState(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("保存内容无效。");
  if (!candidate.meta || !candidate.meta.eventId) throw new Error("缺少赛事标识。");
  if (!Array.isArray(candidate.players) || !Array.isArray(candidate.matches)) {
    throw new Error("名单或比赛数据结构无效。");
  }
  if (candidate.players.length > 5000 || candidate.matches.length > 5000) {
    throw new Error("数据量超出系统上限。");
  }
  const playerIds = new Set();
  for (const player of candidate.players) {
    if (!player.id || playerIds.has(player.id)) throw new Error("选手ID缺失或重复。");
    playerIds.add(player.id);
  }
  const matchIds = new Set();
  for (const match of candidate.matches) {
    if (!match.id || matchIds.has(match.id)) throw new Error("比赛ID缺失或重复。");
    matchIds.add(match.id);
  }
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 20 * 1024 * 1024) throw new Error("请求内容超过20MB。");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicState() {
  return state;
}

function broadcast() {
  const payload = `event: revision\ndata: ${JSON.stringify({
    version: state.meta.version,
    updatedAt: state.meta.updatedAt
  })}\n\n`;
  for (const response of clients) {
    try {
      response.write(payload);
    } catch {
      clients.delete(response);
    }
  }
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    json(response, 200, {
      ok: true,
      version: state.meta.version,
      matches: state.matches.length,
      players: state.players.length
    });
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    const token = url.searchParams.get("token");
    if (token && !timingSafeEqualText(token, adminToken)) {
      json(response, 403, { error: "管理员链接无效。" });
      return true;
    }
    const admin = Boolean(token);
    json(response, 200, {
      state: publicState(),
      role: admin ? "admin" : "viewer",
      adminPath: admin ? `/admin/${adminToken}` : null
    });
    return true;
  }

  if (url.pathname === "/api/events" && request.method === "GET") {
    securityHeaders(response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(
      `event: revision\ndata: ${JSON.stringify({
        version: state.meta.version,
        updatedAt: state.meta.updatedAt
      })}\n\n`
    );
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "POST") {
    if (!isAdmin(request)) {
      json(response, 403, { error: "没有编辑权限。观众链接只能查看。" });
      return true;
    }
    const body = await readBody(request);
    if (Number(body.expectedVersion) !== Number(state.meta.version)) {
      json(response, 409, {
        error: "赛事数据已被另一窗口更新，请重新载入后再操作。",
        currentVersion: state.meta.version
      });
      return true;
    }
    validateSubmittedState(body.state);
    const runSave = saveQueue.catch(() => {}).then(async () => {
      if (Number(body.expectedVersion) !== Number(state.meta.version)) {
        throw new SaveConflict();
      }
      try {
        await fs.copyFile(statePath, previousPath);
      } catch {
        // The first save has no previous snapshot.
      }
      const next = body.state;
      next.meta.version = Number(state.meta.version) + 1;
      next.meta.updatedAt = new Date().toISOString();
      await persistJson(statePath, next);
      state = next;
      broadcast();
    });
    saveQueue = runSave.catch(() => {});
    try {
      await runSave;
    } catch (error) {
      if (error instanceof SaveConflict) {
        json(response, 409, {
          error: error.message,
          currentVersion: state.meta.version
        });
        return true;
      }
      throw error;
    }
    json(response, 200, {
      ok: true,
      state,
      version: state.meta.version
    });
    return true;
  }

  if (url.pathname === "/api/previous" && request.method === "GET") {
    if (!extractBearer(request)) {
      json(response, 403, { error: "需要管理员权限。" });
      return true;
    }
    if (!isAdmin(request)) {
      json(response, 403, { error: "管理员令牌无效。" });
      return true;
    }
    try {
      const previous = JSON.parse(await fs.readFile(previousPath, "utf8"));
      json(response, 200, { state: previous });
    } catch {
      json(response, 404, { error: "尚无可恢复的上一版数据。" });
    }
    return true;
  }

  return false;
}

async function serveFile(response, pathname) {
  let relative = pathname;
  if (relative === "/" || relative === "/view" || relative.startsWith("/admin/")) {
    relative = "/index.html";
  }
  if (relative === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  const resolved = path.resolve(publicDir, `.${decoded}`);
  if (!resolved.startsWith(`${publicDir}${path.sep}`) && resolved !== publicDir) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const file = await fs.readFile(resolved);
    const extension = path.extname(resolved).toLowerCase();
    securityHeaders(response);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": file.length,
      "Cache-Control":
        extension === ".html" ? "no-cache" : extension === ".js" || extension === ".css" ? "no-cache" : "public, max-age=3600"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) json(response, 404, { error: "接口不存在。" });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    await serveFile(response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      json(response, 500, { error: error.message || "服务器内部错误。" });
    } else {
      response.end();
    }
  }
});

setInterval(() => {
  for (const response of clients) {
    response.write(`: heartbeat ${Date.now()}\n\n`);
  }
}, 25_000).unref();

await initialize();
server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log("");
  console.log("MiHoo 九系壁球联赛赛程系统已启动");
  console.log(`观众链接: http://${displayHost}:${port}/view`);
  console.log(`管理链接: http://${displayHost}:${port}/admin/${adminToken}`);
  console.log(`数据目录: ${dataDir}`);
  console.log("管理链接具有编辑权限，请仅向赛事核心成员分享。");
  console.log("");
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
