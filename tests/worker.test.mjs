import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createDemoState } from "../public/src/model.js";

class FakeD1 {
  constructor() {
    this.row = null;
  }

  prepare(sql) {
    const database = this;
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async run() {
        if (sql.includes("CREATE TABLE")) return { meta: { changes: 0 } };
        if (sql.includes("INSERT OR IGNORE")) {
          if (!database.row) {
            database.row = {
              version: Number(values[0]),
              updated_at: values[1],
              payload: values[2],
              previous_version: null,
              previous_updated_at: null,
              previous_payload: null
            };
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.includes("UPDATE event_state")) {
          if (!database.row || database.row.version !== Number(values[2])) {
            return { meta: { changes: 0 } };
          }
          database.row = {
            version: database.row.version + 1,
            updated_at: values[0],
            payload: values[1],
            previous_version: database.row.version,
            previous_updated_at: database.row.updated_at,
            previous_payload: database.row.payload
          };
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      async first() {
        if (sql.includes("SELECT version")) return database.row;
        return null;
      }
    };
  }
}

function environment() {
  return {
    ADMIN_TOKEN: "worker-test-admin-token-long-enough",
    DB: new FakeD1(),
    ASSETS: {
      fetch(request) {
        const url = new URL(request.url);
        return new Response(url.pathname === "/view" ? "viewer-index" : "asset");
      }
    }
  };
}

test("Cloudflare Worker 支持观众读取、管理员写入和权限拒绝", async () => {
  const env = environment();
  const base = "https://example.com/events/2026-thu-nine-school";

  const viewer = await worker.fetch(new Request(`${base}/api/state`), env);
  const viewerBody = await viewer.json();
  assert.equal(viewer.status, 200);
  assert.equal(viewerBody.role, "viewer");
  assert.equal(viewerBody.adminPath, null);
  assert.equal(viewerBody.transport, "poll");
  assert.equal(viewerBody.state.players.length, 0);

  const unauthorized = await worker.fetch(
    new Request(`${base}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 0, state: createDemoState() })
    }),
    env
  );
  assert.equal(unauthorized.status, 403);

  const adminQuery = `?token=${encodeURIComponent(env.ADMIN_TOKEN)}`;
  const admin = await worker.fetch(new Request(`${base}/api/state${adminQuery}`), env);
  const adminBody = await admin.json();
  assert.equal(adminBody.role, "admin");
  assert.match(adminBody.adminPath, /^\/events\/2026-thu-nine-school\/admin\//);

  const next = createDemoState();
  next.meta.version = 0;
  const saved = await worker.fetch(
    new Request(`${base}/api/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ADMIN_TOKEN}`
      },
      body: JSON.stringify({ expectedVersion: 0, state: next })
    }),
    env
  );
  const savedBody = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(savedBody.state.meta.version, 1);

  const conflict = await worker.fetch(
    new Request(`${base}/api/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ADMIN_TOKEN}`
      },
      body: JSON.stringify({ expectedVersion: 0, state: next })
    }),
    env
  );
  assert.equal(conflict.status, 409);

  const asset = await worker.fetch(new Request(`${base}/view`), env);
  assert.equal(await asset.text(), "viewer-index");
});
