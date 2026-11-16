import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientId = "178c6fc778ccc68e1d6a";
const repoName = "mihou-thu-squash-2026";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function collectFiles(directory, relative = "") {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relative, entry.name);
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === ".agents" ||
      entry.name === ".codex" ||
      entry.name === ".netlify" ||
      entry.name === "outputs" ||
      relativePath.startsWith("work/")
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`GitHub 返回了非 JSON 响应：${response.status}`);
  }
  return { response, body };
}

const tokenFile = path.join(root, "work", ".github-deploy-token");
let token = process.env.GITHUB_TOKEN || "";
if (!token) {
  try {
    token = (await fs.readFile(tokenFile, "utf8")).trim();
  } catch {
    token = "";
  }
}

if (!token) {
  const device = await requestJson("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "MiHoo-Sites-Deploy"
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "repo read:user"
    })
  });

  if (!device.response.ok || !device.body.device_code) {
    throw new Error(`无法启动 GitHub 授权：${device.body.error_description || device.response.status}`);
  }

  console.log("");
  console.log("GITHUB_VERIFICATION_URL=" + device.body.verification_uri);
  console.log("GITHUB_DEVICE_CODE=" + device.body.user_code);
  console.log("GITHUB_AUTH_EXPIRES_IN=" + device.body.expires_in);
  console.log("");
  console.log("请在浏览器打开验证地址并输入一次性代码。完成后脚本会自动创建私有仓库并推送。");

  let interval = Math.max(5, Number(device.body.interval) || 5);
  const deadline = Date.now() + Number(device.body.expires_in) * 1000;

  while (Date.now() < deadline && !token) {
    await sleep(interval * 1000);
    const tokenResponse = await requestJson("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "MiHoo-Sites-Deploy"
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: device.body.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    if (tokenResponse.body.access_token) {
      token = tokenResponse.body.access_token;
      break;
    }
    if (tokenResponse.body.error === "authorization_pending") continue;
    if (tokenResponse.body.error === "slow_down") {
      interval += 5;
      continue;
    }
    throw new Error(
      `GitHub 授权失败：${tokenResponse.body.error_description || tokenResponse.body.error || "未知错误"}`
    );
  }

  if (!token) throw new Error("GitHub 授权代码已过期，请重新运行部署脚本。");
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  await fs.writeFile(tokenFile, token, { mode: 0o600 });
}

const user = await requestJson("https://api.github.com/user", {
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "MiHoo-Sites-Deploy"
  }
});
if (!user.response.ok) throw new Error("无法读取 GitHub 账户信息。");

const create = await requestJson("https://api.github.com/user/repos", {
  method: "POST",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "MiHoo-Sites-Deploy"
  },
  body: JSON.stringify({
    name: repoName,
    description: "MiHoo 清华大学九系壁球俱乐部联赛赛程管理系统",
    private: true,
    auto_init: true
  })
});

let repository = create.body;
if (!create.response.ok) {
  const existing = await requestJson(
    `https://api.github.com/repos/${encodeURIComponent(user.body.login)}/${repoName}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "MiHoo-Sites-Deploy"
      }
    }
  );
  if (!existing.response.ok) {
    throw new Error(`创建 GitHub 仓库失败：${create.body.message || create.response.status}`);
  }
  repository = existing.body;
}

const apiHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "User-Agent": "MiHoo-Sites-Deploy"
};
const initialRef = await requestJson(
  `https://api.github.com/repos/${user.body.login}/${repoName}/git/ref/heads/main`,
  { headers: apiHeaders }
);
if (!initialRef.response.ok) {
  const initialize = await requestJson(
    `https://api.github.com/repos/${user.body.login}/${repoName}/contents/README.md`,
    {
      method: "PUT",
      headers: apiHeaders,
      body: JSON.stringify({
        message: "Initialize deployment repository",
        content: Buffer.from("# MiHoo Squash League\n").toString("base64")
      })
    }
  );
  if (!initialize.response.ok) {
    throw new Error(`初始化 GitHub 主分支失败：${initialize.body.message || initialize.response.status}`);
  }
}
const filePaths = (await collectFiles(root)).filter((file) => file !== ".git");
const tree = [];
for (let index = 0; index < filePaths.length; index += 8) {
  const batch = filePaths.slice(index, index + 8);
  const entries = await Promise.all(
    batch.map(async (filePath) => {
      const content = await fs.readFile(path.join(root, filePath));
      const blob = await requestJson(
        `https://api.github.com/repos/${user.body.login}/${repoName}/git/blobs`,
        {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify({
            content: content.toString("base64"),
            encoding: "base64"
          })
        }
      );
      if (!blob.response.ok) throw new Error(`上传 ${filePath} 失败：${blob.body.message}`);
      return {
        path: filePath.replaceAll("\\", "/"),
        mode: "100644",
        type: "blob",
        sha: blob.body.sha
      };
    })
  );
  tree.push(...entries);
}

const createdTree = await requestJson(
  `https://api.github.com/repos/${user.body.login}/${repoName}/git/trees`,
  {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({ tree })
  }
);
if (!createdTree.response.ok) {
  throw new Error(`创建 Git tree 失败：${createdTree.body.message || createdTree.response.status}`);
}

const existingRef = await requestJson(
  `https://api.github.com/repos/${user.body.login}/${repoName}/git/ref/heads/main`,
  { headers: apiHeaders }
);
const parents = existingRef.response.ok ? [existingRef.body.object.sha] : [];
const commit = await requestJson(
  `https://api.github.com/repos/${user.body.login}/${repoName}/git/commits`,
  {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({
      message: "Deploy MiHoo squash league system",
      tree: createdTree.body.sha,
      parents
    })
  }
);
if (!commit.response.ok) {
  throw new Error(`创建 GitHub 提交失败：${commit.body.message || commit.response.status}`);
}

if (parents.length) {
  const update = await requestJson(
    `https://api.github.com/repos/${user.body.login}/${repoName}/git/refs/heads/main`,
    {
      method: "PATCH",
      headers: apiHeaders,
      body: JSON.stringify({ sha: commit.body.sha, force: true })
    }
  );
  if (!update.response.ok) throw new Error(`更新 GitHub 分支失败：${update.body.message}`);
} else {
  const createRef = await requestJson(
    `https://api.github.com/repos/${user.body.login}/${repoName}/git/refs`,
    {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ ref: "refs/heads/main", sha: commit.body.sha })
    }
  );
  if (!createRef.response.ok) throw new Error(`创建 GitHub 分支失败：${createRef.body.message}`);
}

await requestJson(`https://api.github.com/repos/${user.body.login}/${repoName}`, {
  method: "PATCH",
  headers: apiHeaders,
  body: JSON.stringify({ default_branch: "main" })
});

console.log("GITHUB_REPO_URL=" + repository.html_url);
console.log("GitHub 源码仓库已创建并推送完成。");
