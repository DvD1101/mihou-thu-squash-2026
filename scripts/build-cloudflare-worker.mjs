import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

async function collect(directory, relative = "") {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...(await collect(directory, relativePath)));
    else if (entry.isFile()) result.push(relativePath);
  }
  return result;
}

const assetMap = {};
for (const relativePath of await collect(publicDir)) {
  assetMap[`/${relativePath}`] = await fs.readFile(path.join(publicDir, relativePath), "utf8");
}

const worker = await fs.readFile(path.join(root, "worker", "index.js"), "utf8");
const output = `globalThis.__MIHOU_STATIC_ASSETS__ = ${JSON.stringify(assetMap)};\n${worker}`;
const outputDir = path.join(root, "work", "cloudflare");
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "worker.js"), output, "utf8");
console.log(JSON.stringify({
  worker: path.join(outputDir, "worker.js"),
  assets: Object.keys(assetMap).length,
  bytes: Buffer.byteLength(output)
}));
