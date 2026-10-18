// Point vercel.json's API proxy at the realtime backend.
//   node scripts/configure-vercel.mjs groups-live.fly.dev
import { readFile, writeFile } from "node:fs/promises";

const host = (process.argv[2] || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
  console.error("Usage: node scripts/configure-vercel.mjs <backend-host>");
  process.exit(1);
}
const file = new URL("../vercel.json", import.meta.url);
const config = JSON.parse(await readFile(file, "utf8"));
for (const rewrite of config.rewrites)
  rewrite.destination = rewrite.destination.replace(/^https:\/\/[^/]+/, (match) =>
    match.includes("BACKEND_HOST") || rewrite.source !== "/(.*)" ? `https://${host}` : match,
  );
await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`vercel.json now proxies /api, /mcp and /health to https://${host}`);
console.log(`Set VITE_GROUPS_REALTIME_URL=wss://${host} in the Vercel project.`);
