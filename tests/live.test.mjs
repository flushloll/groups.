import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer as netServer } from "node:net";
import { WebSocket } from "ws";

// A stand-in for an OpenAI-compatible model endpoint. It never costs money and
// lets the whole conversation -> Luna -> shared room path run for real.
const modelRequests = [];
const transcriptionRequests = [];
function reply(body) {
  const user = body.messages.find((message) => message.role === "user");
  const content = Array.isArray(user.content)
    ? user.content.find((part) => part.type === "text").text
    : user.content;
  const input = JSON.parse(content);
  const said = input.newTurns.map((turn) => turn.text).join(" ").toLowerCase();
  if (said.includes("table"))
    return {
      tool_calls: [
        {
          id: "call_build",
          type: "function",
          function: {
            name: "apply_room_operations",
            arguments: JSON.stringify({
              revision: input.context.revision,
              title: "A meeting table",
              description: "I set up a table with two chairs and a note for your agenda.",
              changes: ["Added a table, two chairs and an agenda note"],
              operations: [
                { type: "add", object: { kind: "model", model: "table", color: "#c19a6b", position: [0, 0, -2] } },
                { type: "add", object: { kind: "model", model: "chair", color: "#b98d62", position: [0, 0, -1.2], rotation: [0, Math.PI, 0] } },
                { type: "add", object: { kind: "model", model: "chair", color: "#b98d62", position: [0, 0, -2.8] } },
                { type: "add", object: { kind: "note", color: "#eddfa9", text: "Agenda\n- Plan the launch", position: [2, 1.05, -2.5] } },
              ],
            }),
          },
        },
      ],
    };
  if (said.includes("how are you")) return { content: "I’m here and ready to build whenever you are." };
  return { content: "Nothing to build yet." };
}
let modelServer;
async function startModel() {
  modelServer = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    if (request.url.endsWith("/audio/transcriptions")) {
      transcriptionRequests.push({ auth: request.headers.authorization, type: request.headers["content-type"] });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ text: "hello from my microphone" }));
      return;
    }
    const body = JSON.parse(raw);
    modelRequests.push(body);
    const message = reply(body);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        id: `chatcmpl-${modelRequests.length}`,
        object: "chat.completion",
        created: 0,
        model: "mock",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) },
            finish_reason: message.tool_calls ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  return modelServer.address().port;
}

const fixture = () => ({
  id: "live-space",
  name: "Studio",
  currentId: "studio-room",
  rooms: [
    {
      id: "studio-room",
      parentId: null,
      title: "Studio",
      description: "",
      objects: [],
      messages: [],
      changes: [],
      prompt: "",
      createdAt: new Date().toISOString(),
    },
  ],
});
let child, directory, base, origin, owner, viewerCookie;
let stderr = "";
const sockets = new Set();
async function freePort() {
  const server = netServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function request(path, cookie, body, method = "POST") {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function guest() {
  const response = await fetch(`${base}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{}",
  });
  return response.headers.get("set-cookie").split(";")[0];
}
async function connect(cookie) {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
    headers: { Cookie: cookie, Origin: origin },
  });
  sockets.add(ws);
  const events = [];
  const waiters = new Set();
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "simulation") return;
    events.push(message);
    for (const waiter of waiters)
      if (waiter.predicate(message)) {
        clearTimeout(waiter.timeout);
        waiters.delete(waiter);
        waiter.resolve(message);
      }
  });
  const wait = (predicate, ms = 8000) => {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timeout: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Timed out waiting for websocket message"));
        }, ms),
      };
      waiters.add(waiter);
    });
  };
  const closed = new Promise((resolve) => ws.once("close", (code, reason) => resolve(reason.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "join", workspace: { id: "live-space" } }));
  const joined = await wait((event) => event.type === "joined");
  return { ws, events, wait, joined, closed, send: (message) => ws.send(JSON.stringify(message)) };
}
const messagesIn = (event) =>
  event.type === "delta" ? event.delta?.rooms.flatMap((room) => room.messages?.upserts || []) || [] : [];

before(async () => {
  const modelPort = await startModel();
  directory = await mkdtemp(resolve(tmpdir(), "groups-live-"));
  base = `http://127.0.0.1:${await freePort()}`;
  origin = base;
  child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: new URL(base).port,
      GROUPS_DATA_DIR: directory,
      GROUPS_ORIGINS: origin,
      BETTER_AUTH_URL: base,
      GROUPS_AI_PROVIDER: "compatible",
      GROUPS_AI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      GROUPS_AI_MODEL: "mock-model",
      GROUPS_AI_IMAGES: "false",
      GROUPS_LUNA_QUIET_MS: "300",
      GROUPS_TRANSCRIPTION: "openai",
      GROUPS_TRANSCRIPTION_API_KEY: "test-key",
      GROUPS_TRANSCRIPTION_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (data) => (stderr += data.toString()));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 12000);
    child.stdout.on("data", (data) => {
      if (data.toString().includes("Groups is listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  owner = await guest();
  viewerCookie = await guest();
  assert.equal((await request("/api/spaces", owner, { workspace: fixture() })).status, 201);
});
after(async () => {
  for (const ws of sockets) ws.close();
  if (child?.exitCode === null)
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
    });
  modelServer?.close();
  await rm(directory, { recursive: true, force: true });
});

test("asking Luna in chat builds catalog objects in the live room and posts a reply", async () => {
  const peer = await connect(owner);
  peer.send({ type: "chat", id: "ask-table", roomId: "studio-room", text: "Luna, can you set up a table with two chairs?" });
  await peer.wait((event) => event.type === "ack" && event.id === "ask-table");
  const turn = await peer.wait((event) => messagesIn(event).some((m) => m.id === "ask-table"));
  const stored = messagesIn(turn).find((m) => m.id === "ask-table");
  assert.equal(stored.source, "text");
  assert.equal(stored.toLuna, true);
  const built = await peer.wait((event) =>
    event.type === "delta" && event.delta?.rooms[0].objects?.upserts.some((o) => o.model === "table"),
  );
  const objects = built.delta.rooms[0].objects.upserts;
  assert.equal(objects.filter((o) => o.model === "chair").length, 2);
  assert.equal(objects.find((o) => o.model === "chair").physics, "dynamic", "catalog defaults apply");
  assert.match(objects.find((o) => o.kind === "note").text, /Agenda/);
  const answer = await peer.wait((event) => messagesIn(event).some((m) => m.role === "ai"));
  const luna = messagesIn(answer).find((m) => m.role === "ai");
  assert.equal(luna.status, "changed");
  assert.ok(luna.checkpointId);
  assert.match(luna.text, /table/);
  const tools = modelRequests[0].tools.map((tool) => tool.function.name);
  assert.ok(tools.includes("apply_room_operations"));
  assert.match(JSON.stringify(modelRequests[0].messages), /Catalog models/);
});

test("ordinary talk is considered after quiet time without a reply; direct questions get one", async () => {
  const peer = await connect(owner);
  const before = modelRequests.length;
  peer.send({ type: "chat", id: "small-talk", roomId: "studio-room", text: "nice weather today" });
  const consumed = await peer.wait((event) =>
    event.type === "delta" && event.delta?.rooms[0].fields?.sourceTurnIds?.includes("small-talk"),
  );
  assert.equal(messagesIn(consumed).filter((m) => m.role === "ai").length, 0);
  assert.equal(modelRequests.length, before + 1);
  peer.send({ type: "chat", id: "question", roomId: "studio-room", text: "how are you?", toLuna: true });
  const answer = await peer.wait((event) =>
    messagesIn(event).some((m) => m.role === "ai" && m.status === "unchanged"),
  );
  assert.match(messagesIn(answer).find((m) => m.role === "ai").text, /ready to build/);
});

test("viewers can talk but never trigger Luna", async () => {
  const invite = await request("/api/spaces/live-space/invites", owner, { role: "viewer" });
  await request("/api/spaces/live-space/join", viewerCookie, { invite: invite.data.token });
  const viewer = await connect(viewerCookie);
  const before = modelRequests.length;
  viewer.send({ type: "chat", id: "viewer-ask", roomId: "studio-room", text: "Luna, build a table here", toLuna: true });
  const turn = await viewer.wait((event) => messagesIn(event).some((m) => m.id === "viewer-ask"));
  assert.equal(messagesIn(turn).find((m) => m.id === "viewer-ask").canDirectLuna, false);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(modelRequests.length, before);
  viewer.ws.close();
});

test("partial updates from two people merge on one object", async () => {
  const peer = await connect(owner);
  const table = peer.joined.workspace.rooms[0].objects.find((o) => o.model === "table");
  peer.send({
    type: "patch",
    patchId: "recolor",
    patch: { rooms: [{ id: "studio-room", objects: { updates: [{ id: table.id, fields: { color: "#336699" } }] } }] },
  });
  peer.send({
    type: "patch",
    patchId: "move",
    patch: { rooms: [{ id: "studio-room", objects: { updates: [{ id: table.id, fields: { position: [1, 0, -2] } }] } }] },
  });
  await peer.wait((event) => event.patchId === "move");
  const stored = (await request("/api/spaces/live-space", owner)).data.workspace.rooms[0].objects.find(
    (o) => o.id === table.id,
  );
  assert.equal(stored.color, "#336699");
  assert.deepEqual(stored.position, [1, 0, -2]);
  peer.send({
    type: "patch",
    patchId: "bad-field",
    patch: { rooms: [{ id: "studio-room", objects: { updates: [{ id: table.id, fields: { kind: "cube" } }] } }] },
  });
  assert.equal((await peer.wait((event) => event.patchId === "bad-field")).code, "patch_rejected");
});

test("restoring a checkpoint brings back its scene and saves the current one first", async () => {
  const peer = await connect(owner);
  const saved = await request("/api/spaces/live-space/checkpoints", owner, { roomId: "studio-room" });
  assert.equal(saved.status, 201);
  const count = saved.data.checkpoint.objects.length;
  const ids = peer.joined.workspace.rooms[0].objects.map((o) => o.id);
  peer.send({
    type: "patch",
    patchId: "clear-room",
    patch: { rooms: [{ id: "studio-room", objects: { upserts: [], removes: ids } }] },
  });
  await peer.wait((event) => event.patchId === "clear-room");
  const restored = await request(`/api/spaces/live-space/checkpoints/${saved.data.checkpoint.id}/restore`, owner, {});
  assert.equal(restored.status, 200);
  await peer.wait((event) => event.type === "development" && event.status === "restored");
  const room = (await request("/api/spaces/live-space", owner)).data.workspace.rooms[0];
  assert.equal(room.objects.length, count);
  const list = (await request("/api/spaces/live-space/checkpoints?room=studio-room", owner)).data.checkpoints;
  assert.ok(list.some((item) => item.title.startsWith("Before restoring") && item.objectCount === 0));
  assert.equal(
    (await request(`/api/spaces/live-space/checkpoints/${saved.data.checkpoint.id}/restore`, viewerCookie, {})).status,
    403,
  );
});

test("voice clips are transcribed on the server for browsers without recognition", async () => {
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.transcription.available, true);
  const clip = await fetch(`${base}/api/spaces/live-space/transcribe`, {
    method: "POST",
    headers: { Origin: origin, Cookie: owner, "Content-Type": "audio/webm" },
    body: Buffer.alloc(4000, 1),
  });
  assert.equal(clip.status, 200);
  assert.equal((await clip.json()).text, "hello from my microphone");
  assert.equal(transcriptionRequests.at(-1).auth, "Bearer test-key");
  assert.match(transcriptionRequests.at(-1).type, /multipart\/form-data/);
  const wrong = await fetch(`${base}/api/spaces/live-space/transcribe`, {
    method: "POST",
    headers: { Origin: origin, Cookie: owner, "Content-Type": "text/plain" },
    body: "nope",
  });
  assert.equal(wrong.status, 415);
});

test("a short-lived ticket opens the realtime socket without cookies", async () => {
  const issued = await (await fetch(`${base}/api/ws-ticket`, { headers: { Cookie: owner } })).json();
  const { ticket } = issued;
  assert.equal(issued.url, null, "no public realtime address is configured in tests");
  assert.equal((await fetch(`${base}/api/ws-ticket`)).status, 401);
  const open = (value) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`${base.replace("http:", "ws:")}/ws?ticket=${encodeURIComponent(value)}`, {
        headers: { Origin: origin },
      });
      sockets.add(ws);
      ws.on("error", () => resolve("refused"));
      ws.on("open", () => ws.send(JSON.stringify({ type: "join", workspace: { id: "live-space" } })));
      ws.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === "joined") resolve(message.access.role);
      });
    });
  assert.equal(await open(ticket), "owner");
  assert.equal(await open(`${ticket.split(".")[0]}.forged`), "refused");
});

test("owners rename, manage members, revoke access and delete spaces", async () => {
  const peer = await connect(owner);
  const viewer = await connect(viewerCookie);
  const renamed = await request(
    "/api/spaces/live-space/settings",
    owner,
    { name: "Launch studio", visibility: "private", joinRole: "viewer", description: "Plans" },
    "PATCH",
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.settings.name, "Launch studio");
  await peer.wait((event) => event.type === "delta" && event.delta?.name === "Launch studio");
  const members = (await request("/api/spaces/live-space/members", owner)).data.members;
  assert.deepEqual(members.map((m) => m.role), ["owner", "viewer"]);
  assert.equal((await request("/api/spaces/live-space/members", viewerCookie)).status, 403);
  const target = members.find((m) => m.role === "viewer");
  const promoted = await request(`/api/spaces/live-space/members/${target.id}`, owner, { role: "contributor" }, "PATCH");
  assert.equal(promoted.data.members.find((m) => m.id === target.id).role, "contributor");
  await viewer.wait((event) => event.type === "access" && event.access.canEdit === true);
  await request(`/api/spaces/live-space/members/${target.id}`, owner, undefined, "DELETE");
  assert.match(await viewer.closed, /access/i);
  assert.equal((await request("/api/spaces/live-space/join", viewerCookie, {})).status, 403);
  assert.equal((await request("/api/spaces/live-space", viewerCookie, undefined, "DELETE")).status, 403);
  assert.equal((await request("/api/spaces/the-commons", owner, undefined, "DELETE")).status, 403);
  assert.equal((await request("/api/spaces/live-space", owner, undefined, "DELETE")).status, 200);
  assert.match(await peer.closed, /deleted/);
  assert.equal((await request("/api/spaces/live-space", owner)).status, 404);
});

test("board edits from two people merge element by element", async () => {
  const space = {
    ...fixture(),
    id: "board-space",
    rooms: [{ ...fixture().rooms[0], id: "board-room" }],
    currentId: "board-room",
  };
  space.rooms[0].objects = [
    { id: "board", kind: "board", position: [0, 1.4, -3], color: "#d8cfc0", text: "Retro", board: { elements: [] } },
  ];
  assert.equal((await request("/api/spaces", owner, { workspace: space })).status, 201);
  const join = (cookie) =>
    new Promise((resolve) => {
      const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", { headers: { Cookie: cookie, Origin: origin } });
      sockets.add(ws);
      const events = [];
      ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      ws.on("open", () => ws.send(JSON.stringify({ type: "join", workspace: { id: "board-space" } })));
      const timer = setInterval(() => {
        if (events.some((e) => e.type === "joined")) {
          clearInterval(timer);
          resolve({ ws, events });
        }
      }, 20);
    });
  const a = await join(owner);
  const element = (id, version, x) => ({ id, type: "rectangle", version, versionNonce: 1, x, y: 0, width: 10, height: 10 });
  const edit = (client, patchId, elements) =>
    client.ws.send(
      JSON.stringify({
        type: "patch",
        patchId,
        patch: { rooms: [{ id: "board-room", objects: { updates: [{ id: "board", fields: { board: { elements } } }] } }] },
      }),
    );
  edit(a, "a1", [element("one", 1, 0)]);
  edit(a, "a2", [element("two", 1, 50)]);
  edit(a, "a3", [element("one", 3, 99)]);
  edit(a, "a4", [element("one", 2, -5)]);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const board = (await request("/api/spaces/board-space", owner)).data.workspace.rooms[0].objects[0];
  assert.deepEqual(
    board.board.elements.map((e) => [e.id, e.version, e.x]),
    [
      ["one", 3, 99],
      ["two", 1, 50],
    ],
  );
  assert.ok(a.events.some((e) => e.type === "delta" && e.patchId === "a4"));
});
