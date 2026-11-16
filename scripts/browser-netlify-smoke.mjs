import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "https://mihou-squash-live-2026.netlify.app";
const adminToken = (await fs.readFile(path.join(root, "work", ".netlify-admin-token"), "utf8")).trim();
const adminUrl = `${baseUrl}/admin/${adminToken}`;
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const initialResponse = await fetch(`${baseUrl}/api/state?token=${encodeURIComponent(adminToken)}`);
assert.equal(initialResponse.status, 200);
const initialBody = await initialResponse.json();
assert.equal(initialBody.role, "admin");
const originalState = initialBody.state;

const browser = await chromium.launch({ headless: true, executablePath: edgePath });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const admin = await context.newPage();
  const viewer = await context.newPage();
  const errors = [];
  admin.on("pageerror", (error) => errors.push(`admin: ${error.message}`));
  viewer.on("pageerror", (error) => errors.push(`viewer: ${error.message}`));

  await admin.goto(`${adminUrl}#dashboard`, { waitUntil: "domcontentloaded" });
  await admin.locator(".brand-title").waitFor();
  assert.match(await admin.locator(".role-chip").innerText(), /管理员模式/);
  assert.match(await admin.locator(".hero h2").innerText(), /清华大学九系壁球俱乐部联赛/);

  await viewer.goto(`${baseUrl}/view#dashboard`, { waitUntil: "domcontentloaded" });
  await viewer.locator(".brand-title").waitFor();
  assert.match(await viewer.locator(".role-chip").innerText(), /观众模式/);

  const editedName = `${originalState.meta.name} · 同步测试`;
  const update = structuredClone(originalState);
  update.meta.name = editedName;
  update.audit.unshift({
    id: "deployment-sync-check",
    at: new Date().toISOString(),
    action: "部署同步测试",
    detail: "验证管理员保存与观众自动同步。",
    source: "admin"
  });
  const saveResponse = await fetch(`${baseUrl}/api/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      expectedVersion: originalState.meta.version,
      state: update
    })
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();

  await viewer.waitForFunction(
    (name) => document.querySelector(".hero h2")?.textContent.includes(name),
    "同步测试",
    { timeout: 12_000 }
  );

  const restore = structuredClone(saved.state);
  restore.meta.name = originalState.meta.name;
  const restoreResponse = await fetch(`${baseUrl}/api/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      expectedVersion: saved.state.meta.version,
      state: restore
    })
  });
  assert.equal(restoreResponse.status, 200);
  await viewer.waitForFunction(
    (name) => document.querySelector(".hero h2")?.textContent === name,
    originalState.meta.name,
    { timeout: 12_000 }
  );

  const anonymousWrite = await fetch(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(anonymousWrite.status, 403);

  await admin.reload({ waitUntil: "domcontentloaded" });
  await admin.locator(".brand-title").waitFor();
  assert.match(await admin.locator(".hero h2").innerText(), /清华大学九系壁球俱乐部联赛/);

  await admin.screenshot({
    path: path.join(root, "work", "netlify-admin-live.png"),
    fullPage: false
  });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
  await mobile.goto(`${baseUrl}/view#bracket`, { waitUntil: "domcontentloaded" });
  await mobile.locator(".app-header").waitFor();
  const overflow = await mobile.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  assert.ok(overflow.scrollWidth <= overflow.innerWidth + 1);
  await mobile.screenshot({
    path: path.join(root, "work", "netlify-mobile-live.png"),
    fullPage: false
  });
  await mobileContext.close();

  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      viewerRole: "viewer",
      adminRole: "admin",
      realtimePolling: true,
      refreshPersistence: true,
      anonymousWriteStatus: anonymousWrite.status,
      mobileOverflow: false,
      finalVersion: (await restoreResponse.json()).version
    })
  );
} finally {
  await browser.close();
}
