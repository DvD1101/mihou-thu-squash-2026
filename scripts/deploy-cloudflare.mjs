import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptName = "mihoo-squash-2026";
const databaseName = "mihoo_event_state";
const zoneName = "mihoosquash.com";
const eventBasePath = "/events/2026-thu-nine-school";
const wrangler = path.join(root, "work", "tools", "cloudflare", "node_modules", "wrangler", "bin", "wrangler.js");
const configHome = path.join(root, "work", "tools", "config");
const tokenPath = path.join(root, "work", ".cloudflare-deploy-token");
const adminTokenPath = path.join(root, "work", ".mihou-admin-token");

try {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-cloudflare-worker.mjs")], {
    cwd: root,
    stdio: "inherit"
  });
} catch {
  process.exit(1);
}

let apiToken = "";
try {
  apiToken = (await fs.readFile(tokenPath, "utf8")).trim();
  if (!/^[\x21-\x7e]+$/.test(apiToken) || apiToken.length > 200) apiToken = "";
} catch {
  apiToken = "";
}
if (!apiToken) {
  const authOutput = execFileSync(process.execPath, [wrangler, "auth", "token"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, XDG_CONFIG_HOME: configHome }
  });
  apiToken =
    authOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 40 && /^[\x21-\x7e]+$/.test(line))
      .sort((left, right) => right.length - left.length)[0] ?? "";
}
if (!apiToken) {
  throw new Error("Cloudflare 登录状态无效，请先执行 Wrangler 设备登录。");
}
{
  if (apiToken.length < 20) throw new Error("Cloudflare 登录状态无效，请先执行 Wrangler 设备登录。");
  await fs.writeFile(tokenPath, apiToken, { mode: 0o600 });
}

const apiBase = "https://api.cloudflare.com/client/v4";
async function api(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare 返回了非 JSON 响应 (${response.status})。`);
  }
  if (!response.ok || body.success === false) {
    const message = body.errors?.map((item) => item.message).join("；") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API 失败：${message}`);
  }
  return body.result;
}

const accounts = await api("/accounts");
if (!accounts.length) throw new Error("当前 Cloudflare 账号没有可部署的账户。");
const account = accounts[0];

const databases = await api(`/accounts/${account.id}/d1/database`);
let database = databases.find((entry) => entry.name === databaseName);
if (!database) {
  database = await api(`/accounts/${account.id}/d1/database`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: databaseName })
  });
}

let adminToken = "";
try {
  adminToken = (await fs.readFile(adminTokenPath, "utf8")).trim();
} catch {
  adminToken = crypto.randomBytes(32).toString("base64url");
  await fs.writeFile(adminTokenPath, adminToken, { mode: 0o600 });
}

const workerCode = await fs.readFile(path.join(root, "work", "cloudflare", "worker.js"), "utf8");
const metadata = {
  main_module: "worker.js",
  compatibility_date: "2026-11-16",
  bindings: [
    { type: "d1", name: "DB", id: database.uuid },
    { type: "secret_text", name: "ADMIN_TOKEN", text: adminToken }
  ]
};
const form = new FormData();
form.append(
  "metadata",
  new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  "metadata.json"
);
form.append(
  "worker.js",
  new Blob([workerCode], { type: "application/javascript+module" }),
  "worker.js"
);

const uploadResponse = await fetch(
  `${apiBase}/accounts/${account.id}/workers/scripts/${scriptName}`,
  {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form
  }
);
const uploadText = await uploadResponse.text();
let uploadBody;
try {
  uploadBody = JSON.parse(uploadText);
} catch {
  throw new Error(`Worker 上传返回非 JSON 响应 (${uploadResponse.status})。`);
}
if (!uploadResponse.ok || uploadBody.success === false) {
  throw new Error(
    `Worker 上传失败：${uploadBody.errors?.map((item) => item.message).join("；") || uploadResponse.status}`
  );
}

await api(`/accounts/${account.id}/workers/scripts/${scriptName}/subdomain`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true, previews_enabled: false })
});
let subdomain;
try {
  subdomain = await api(`/accounts/${account.id}/workers/subdomain`);
} catch {
  const requestedSubdomain = `mihou2026${crypto.randomBytes(3).toString("hex")}`;
  subdomain = await api(`/accounts/${account.id}/workers/subdomain`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subdomain: requestedSubdomain })
  });
}
const baseUrl = `https://${scriptName}.${subdomain.subdomain}.workers.dev`;
const zones = await api(`/zones?name=${encodeURIComponent(zoneName)}`);
const zone = zones.find((entry) => entry.name === zoneName && entry.status === "active");
if (!zone) throw new Error(`Cloudflare Zone ${zoneName} 未激活，无法绑定自定义域名。`);
for (const hostname of [zoneName, `www.${zoneName}`]) {
  await api(`/accounts/${account.id}/workers/domains`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environment: "production",
      hostname,
      service: scriptName,
      zone_id: zone.id
    })
  });
}

console.log(
  JSON.stringify({
    ok: true,
    account: account.name,
    databaseId: database.uuid,
    baseUrl,
    viewerUrl: `https://www.${zoneName}${eventBasePath}/view`,
    adminUrl: `https://www.${zoneName}${eventBasePath}/admin/${adminToken}`
  })
);
