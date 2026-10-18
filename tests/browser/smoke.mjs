// Browser smoke test: runs the production build against throwaway data and a
// mock model, drives the main flows in Chrome, and saves screenshots.
//
//   npm run build && npm run test:browser
//
// Uses CHROME_PATH, or a standard Chrome/Chromium install location.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = resolve(import.meta.dirname, "../..");
const shots = resolve(root, "tests/browser/screenshots");
const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const executablePath = candidates.find((path) => existsSync(path));
if (!executablePath) {
  console.error("Set CHROME_PATH to a Chrome or Chromium executable.");
  process.exit(1);
}
if (!existsSync(resolve(root, "dist/index.html"))) {
  console.error("Run npm run build first.");
  process.exit(1);
}
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// Mock OpenAI-compatible model: builds a meeting corner when asked.
const model = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const user = body.messages.find((message) => message.role === "user");
  const text = Array.isArray(user.content) ? user.content.find((part) => part.type === "text").text : user.content;
  const input = JSON.parse(text);
  const plan = {
    revision: input.context.revision,
    title: "Planning corner",
    description: "I set up a table, chairs and a whiteboard with your plan.",
    changes: ["Added a planning corner"],
    operations: [
      { type: "add", object: { kind: "model", model: "table", color: "#c19a6b", position: [0, 0, -2] } },
      { type: "add", object: { kind: "model", model: "chair", color: "#b98d62", position: [0, 0, -1.2], rotation: [0, Math.PI, 0], physics: "fixed" } },
      { type: "add", object: { kind: "model", model: "whiteboard", color: "#9aa0a8", position: [0, 0, -4], text: "Plan\n- Build\n- Test\n- Ship" } },
      { type: "add", object: { kind: "board", color: "#d8cfc0", position: [3.5, 1.4, -4], text: "Ideas", notes: ["Onboarding", "Pricing"] } },
    ],
  };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    id: "mock", object: "chat.completion", created: 0, model: "mock",
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call", type: "function", function: { name: "apply_room_operations", arguments: JSON.stringify(plan) } }] } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
});
await new Promise((done) => model.listen(0, "127.0.0.1", done));
const data = await mkdtemp(resolve(tmpdir(), "groups-browser-"));
const port = 3950;
const origin = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    GROUPS_DATA_DIR: data,
    GROUPS_ORIGINS: origin,
    BETTER_AUTH_URL: origin,
    GROUPS_AI_PROVIDER: "compatible",
    GROUPS_AI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
    GROUPS_AI_MODEL: "mock",
    GROUPS_AI_IMAGES: "false",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((done) => server.stdout.on("data", (chunk) => String(chunk).includes("listening") && done()));
await mkdir(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: "networkidle0" });
  await page.screenshot({ path: `${shots}/1-opening.png` });
  await page.click(".experience-primary");
  await wait(800);
  await page.click(".lobby-create-row button");
  await page.type("#space-name", "Browser check");
  await page.click(".create-space-dialog .experience-primary");
  await page.waitForSelector(".room-canvas canvas", { timeout: 20000 });
  await wait(2500);
  await page.type(".composer textarea", "Luna, set up a planning corner");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".message.from-luna"), { timeout: 20000 });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("3");
  await wait(2500);
  await page.screenshot({ path: `${shots}/2-luna-built.png` });
  const objects = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get("space");
    return (await (await fetch(`/api/spaces/${id}`)).json()).workspace.rooms[0].objects;
  });
  assert.ok(objects.some((object) => object.model === "whiteboard"), "Luna's whiteboard is in the room");
  assert.ok(objects.some((object) => object.kind === "board"), "Luna's board is in the room");
  await page.keyboard.press("l");
  await page.waitForSelector(".library-item");
  await wait(1500);
  await page.screenshot({ path: `${shots}/3-library.png` });
  assert.deepEqual(errors, [], "no page errors");
  console.log(`Browser smoke test passed. Screenshots: ${shots}`);
} finally {
  await browser.close();
  server.kill("SIGTERM");
  model.close();
  await rm(data, { recursive: true, force: true });
}
