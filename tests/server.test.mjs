import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDemoState } from "../public/src/model.js";

test("服务端拒绝观众写入并对并发保存返回版本冲突", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mihou-server-test-"));
  const port = 19121;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATA_DIR: dataDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => {
    child.kill("SIGTERM");
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("服务端启动超时")), 8000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("已启动")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`服务端提前退出：${code}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  const token = (await fs.readFile(path.join(dataDir, "auth.json"), "utf8")).trim();
  const viewerResponse = await fetch(`${base}/api/state`);
  const viewerBody = await viewerResponse.json();
  assert.equal(viewerBody.role, "viewer");
  assert.equal(viewerBody.adminPath, null);
  assert.equal(viewerBody.state.players.length, 84);

  const unauthorized = await fetch(`${base}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion: 0, state: createDemoState() })
  });
  assert.equal(unauthorized.status, 403);

  const makeSave = async () => {
    const state = createDemoState();
    state.meta.version = 0;
    return fetch(`${base}/api/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ expectedVersion: 0, state })
    });
  };

  const results = await Promise.all([makeSave(), makeSave()]);
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [200, 409]
  );
  const adminState = await fetch(`${base}/api/state?token=${encodeURIComponent(token)}`);
  const adminBody = await adminState.json();
  assert.equal(adminBody.role, "admin");
  assert.equal(adminBody.state.meta.version, 1);
  assert.equal(adminBody.state.players.length, 84);
});
