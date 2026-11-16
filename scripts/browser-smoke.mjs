import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightPath =
  "C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightPath);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8788";
const token = (await fs.readFile(path.join(root, "work", "test-data", "auth.json"), "utf8")).trim();
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const downloadedTemplatePath = path.join(root, "work", "downloaded-roster-template.xlsx");

const bootstrap = await fetch(`${baseUrl}/api/state?token=${encodeURIComponent(token)}`);
assert.equal(bootstrap.status, 200);
const bootstrapBody = await bootstrap.json();
const fixture = JSON.parse(
  await fs.readFile(path.join(root, "outputs", "模拟赛事_全部完成.json"), "utf8")
);
fixture.meta.version = bootstrapBody.state.meta.version;
const resetResponse = await fetch(`${baseUrl}/api/state`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({
    expectedVersion: bootstrapBody.state.meta.version,
    state: fixture
  })
});
assert.equal(resetResponse.status, 200);

const browser = await chromium.launch({
  headless: true,
  executablePath: edgePath
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const admin = await context.newPage();
  const browserErrors = [];
  admin.on("pageerror", (error) => browserErrors.push(error.message));
  await admin.goto(`${baseUrl}/admin/${token}?group=advanced_men#bracket`, {
    waitUntil: "domcontentloaded"
  });
  await admin.locator(".brand-title").waitFor();
  assert.match(await admin.locator(".role-chip").innerText(), /管理员模式/);
  assert.ok((await admin.locator(".bracket-card").count()) >= 20);

  const viewer = await context.newPage();
  viewer.on("pageerror", (error) => browserErrors.push(error.message));
  await viewer.goto(`${baseUrl}/view?group=advanced_men#bracket`, {
    waitUntil: "domcontentloaded"
  });
  await viewer.locator(".role-chip").waitFor();
  assert.match(await viewer.locator(".role-chip").innerText(), /观众模式/);

  const cardSelector = '.bracket-card:has-text("AM-R16-1")';
  const adminCard = admin.locator(cardSelector);
  const loserName = await adminCard.locator(".bracket-player.loser .player-main").innerText();
  assert.ok(loserName);
  await adminCard.locator("button.bracket-player.loser").click();
  await admin.locator(".modal").waitFor();
  assert.match(await admin.locator(".modal").innerText(), /将撤销以下已开始或已完成的后续比赛/);
  await admin
    .locator(".winner-choice-card")
    .filter({ hasText: loserName })
    .click();
  await admin.locator(".toast").filter({ hasText: "已确认获胜" }).waitFor();

  await viewer.waitForFunction(
    ({ name }) => {
      const card = [...document.querySelectorAll(".bracket-card")].find((entry) =>
        entry.textContent.includes("AM-R16-1")
      );
      return card?.querySelector(".bracket-player.winner")?.textContent.includes(name);
    },
    { name: loserName },
    { timeout: 10_000 }
  );
  const viewerWinner = await viewer
    .locator(cardSelector)
    .locator(".bracket-player.winner .player-main")
    .innerText();
  assert.equal(viewerWinner, loserName);

  const unauthorizedStatus = await viewer.evaluate(async () => {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 0, state: {} })
    });
    return response.status;
  });
  assert.equal(unauthorizedStatus, 403);

  await admin.reload({ waitUntil: "domcontentloaded" });
  await admin.locator(".bracket-card").first().waitFor();
  const persistedWinner = await admin
    .locator(cardSelector)
    .locator(".bracket-player.winner .player-main")
    .innerText();
  assert.equal(persistedWinner, loserName);

  await admin.goto(`${baseUrl}/admin/${token}?group=new_men#players`, {
    waitUntil: "domcontentloaded"
  });
  await admin.locator('[data-action="template-download"]').waitFor();
  const downloadPromise = admin.waitForEvent("download");
  await admin.locator('[data-action="template-download"]').click();
  const download = await downloadPromise;
  await download.saveAs(downloadedTemplatePath);
  assert.ok((await fs.stat(downloadedTemplatePath)).size > 2000);
  await admin.locator('input[data-file="roster"]').setInputFiles(downloadedTemplatePath);
  await admin.locator(".modal").filter({ hasText: "导入预览" }).waitFor();
  assert.match(await admin.locator(".modal").innerText(), /新手男子/);
  await admin.locator(".modal-close").click();

  await admin.screenshot({
    path: path.join(root, "work", "browser-admin-bracket.png"),
    fullPage: false
  });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => browserErrors.push(error.message));
  for (const target of ["dashboard", "bracket"]) {
    await mobile.goto(`${baseUrl}/view?group=advanced_men#${target}`, {
      waitUntil: "domcontentloaded"
    });
    await mobile.locator(".app-header").waitFor();
    const overflow = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.innerWidth + 1,
      `手机页面 ${target} 横向溢出：${overflow.scrollWidth}/${overflow.innerWidth}`
    );
  }
  await mobile.screenshot({
    path: path.join(root, "work", "browser-mobile-bracket.png"),
    fullPage: false
  });
  await mobileContext.close();

  assert.deepEqual(browserErrors, []);
  console.log(
    JSON.stringify({
      ok: true,
      realtimeViewerWinner: viewerWinner,
      unauthorizedStatus,
      persistedWinner,
      templateBytes: (await fs.stat(downloadedTemplatePath)).size,
      mobileOverflow: false
    })
  );
} finally {
  await browser.close();
}
