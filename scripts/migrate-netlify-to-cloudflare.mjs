import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const netlifyAdminToken = (await fs.readFile(path.join(root, "work", ".netlify-admin-token"), "utf8")).trim();
const cloudflareToken = (await fs.readFile(path.join(root, "work", ".cloudflare-deploy-token"), "utf8")).trim();
const accountId = "2a4f953de03da3ed457a2aac3fa4536b";
const databaseName = "mihoo_event_state";

const netlifyResponse = await fetch(
  `https://mihoo-squash-2026.netlify.app/api/state?token=${encodeURIComponent(netlifyAdminToken)}&_sync=${Date.now()}`,
  { cache: "no-store" }
);
const netlifyBody = await netlifyResponse.json();
if (!netlifyResponse.ok) {
  throw new Error(`读取 Netlify 数据失败：${netlifyBody.error || netlifyResponse.status}`);
}
const state = netlifyBody.state;
await fs.writeFile(
  path.join(root, "outputs", "赛事数据迁移备份_2026-11-17.json"),
  `${JSON.stringify(state, null, 2)}\n`,
  "utf8"
);

async function cloudflare(pathname, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cloudflareToken}`,
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
    ok: true,
    databaseId: database.uuid,
    version: state.meta.version,
    players: state.players.length,
    matches: state.matches.length,
    completed: state.matches.filter((match) => match.winnerId).length
  })
);
