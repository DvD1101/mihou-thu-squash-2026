import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteId = "9c65fc4a-d01e-435c-8c7e-c0d3ce049f9a";
const repository = "DvD1101/mihou-thu-squash-2026";

const netlifyConfig = JSON.parse(
  await fs.readFile(path.join(root, "work", "tools", "netlify-home", "config", "config.json"), "utf8")
);
const netlifyToken = netlifyConfig.users[netlifyConfig.userId].auth.token;
const githubToken = (await fs.readFile(path.join(root, "work", ".github-deploy-token"), "utf8")).trim();

async function netlify(pathname, options = {}) {
  const response = await fetch(`https://api.netlify.com/api/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${netlifyToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Netlify ${pathname}: ${response.status} ${body.message || text}`);
  }
  return body;
}

async function github(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "MiHoo-Netlify-Deploy",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`GitHub ${pathname}: ${response.status} ${body.message || text}`);
  }
  return body;
}

const repo = await github(`/repos/${repository}`);
const deployKey = await netlify("/deploy_keys", {
  method: "POST",
  body: "{}"
});

const existingKeys = await github(`/repos/${repository}/keys`);
if (!existingKeys.some((entry) => entry.key.trim() === deployKey.public_key.trim())) {
  await github(`/repos/${repository}/keys`, {
    method: "POST",
    body: JSON.stringify({
      title: `Netlify ${siteId}`,
      key: deployKey.public_key,
      read_only: true
    })
  });
}

const linked = await netlify(`/sites/${siteId}`, {
  method: "PUT",
  body: JSON.stringify({
    repo: {
      provider: "github",
      repo: repository,
      private: true,
      branch: "main",
      cmd: "",
      dir: "public",
      deploy_key_id: deployKey.id,
      repo_id: repo.id
    }
  })
});

const hooks = await github(`/repos/${repository}/hooks`);
if (!hooks.some((entry) => entry.config?.url === "https://api.netlify.com/hooks/github")) {
  await github(`/repos/${repository}/hooks`, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push", "pull_request"],
      config: {
        url: "https://api.netlify.com/hooks/github",
        content_type: "json",
        insecure_ssl: "0"
      }
    })
  });
}

let deploy;
try {
  deploy = await netlify(`/sites/${siteId}/builds`, {
    method: "POST",
    body: "{}"
  });
} catch {
  deploy = await netlify(`/sites/${siteId}/deploys`, {
    method: "POST",
    body: "{}"
  });
}

console.log(
  JSON.stringify({
    ok: true,
    siteId,
    url: linked.ssl_url,
    repo: linked.repo?.repo ?? repository,
    build: deploy.id
  })
);
