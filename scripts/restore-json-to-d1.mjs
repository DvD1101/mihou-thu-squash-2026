import { promises as fs } from "node:fs";
import path from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "2a4f953de03da3ed457a2aac3fa4536b";
const databaseName = "mihoo_event_state";
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const inputPath = process.argv[2];

if (!apiToken) throw new Error("请先设置 CLOUDFLARE_API_TOKEN。");
if (!inputPath) throw new Error("用法：npm run cloudflare:restore -- ./path/to/state.json");

const state = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
if (!state.meta?.eventId || !Array.isArray(state.players) || !Array.isArray(state.matches)) {
  throw new Error("输入文件不是完整赛事状态 JSON。");
}

async function cloudflare(pathname, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(body.errors?.map((entry) => entry.message).join("；") || `Cloudflare ${response.status}`);
  }
  return body.result;
}

const databases = await cloudflare(`/accounts/${accountId}/d1/database`);
const database = databases.find((entry) => entry.name === databaseName);
if (!database) throw new Error(`未找到 D1 数据库 ${databaseName}`);

async function query(sql, params = []) {
  return cloudflare(`/accounts/${accountId}/d1/database/${database.uuid}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params })
  });
}

await query(
  `CREATE TABLE IF NOT EXISTS event_state (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    previous_version INTEGER,
    previous_updated_at TEXT,
    previous_payload TEXT
  )`
);
await query(
  `INSERT INTO event_state
    (id, version, updated_at, payload, previous_version, previous_updated_at, previous_payload)
   VALUES ('main', ?, ?, ?, NULL, NULL, NULL)
   ON CONFLICT(id) DO UPDATE SET
     version = excluded.version,
     updated_at = excluded.updated_at,
     payload = excluded.payload,
     previous_version = NULL,
     previous_updated_at = NULL,
     previous_payload = NULL`,
  [state.meta.version, state.meta.updatedAt, JSON.stringify(state)]
);

console.log(
  JSON.stringify({
    restored: true,
    databaseId: database.uuid,
    version: state.meta.version,
    players: state.players.length,
    matches: state.matches.length
  })
);
