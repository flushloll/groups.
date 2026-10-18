import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const fixture = () => ({
  id: "integration-space",
  name: "Workshop",
  currentId: "live-room",
  rooms: [
    {
      id: "live-room",
      parentId: null,
      title: "Before Luna",
      description: "A shared place",
      objects: [],
      messages: [],
      changes: [],
      prompt: "",
      createdAt: new Date().toISOString(),
    },
  ],
});
let child, directory, base, origin, cookie, otherCookie, editorCookie;
let stderr = "";
const token = randomBytes(40).toString("hex");
const sockets = new Set();
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function start() {
  stderr = "";
  child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: new URL(base).port,
      GROUPS_DATA_DIR: directory,
      GROUPS_ORIGINS: origin,
      BETTER_AUTH_URL: base,
      GROUPS_MCP_TOKEN: token,
      GROUPS_AI_MODEL: "",
      GROUPS_AI_PROVIDER: "compatible",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Server did not start: ${stderr}`)),
      12000,
    );
    child.stdout.on("data", (data) => {
      if (data.toString().includes("Groups is listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${stderr}`));
    });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise((resolve) => {
    current.once("exit", resolve);
    current.kill("SIGTERM");
  });
}
async function request(path, activeCookie, body, method = "POST") {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      Origin: origin,
      ...(activeCookie ? { Cookie: activeCookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}
async function guest() {
  const response = await request("/api/auth/sign-in/anonymous", null, {});
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
async function connect(activeCookie, workspace) {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
    headers: { Cookie: activeCookie, Origin: origin },
  });
  sockets.add(ws);
  const events = [];
  const waiters = new Set();
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    events.push(message);
    for (const waiter of waiters)
      if (waiter.predicate(message)) {
        clearTimeout(waiter.timeout);
        waiters.delete(waiter);
        waiter.resolve(message);
      }
  });
  const wait = (predicate) => {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timeout: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Timed out waiting for websocket message"));
        }, 6000),
      };
      waiters.add(waiter);
    });
  };
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "join", workspace }));
  const joined = await wait((event) => event.type === "joined");
  return {
    ws,
    events,
    wait,
    joined,
    send(message) {
      ws.send(JSON.stringify(message));
    },
  };
}
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "groups-foundations-"));
  base = `http://127.0.0.1:${await freePort()}`;
  origin = base;
  await start();
  cookie = await guest();
  otherCookie = await guest();
  editorCookie = await guest();
});
after(async () => {
  for (const ws of sockets) ws.close();
  await stop();
  await rm(directory, { recursive: true, force: true });
});

test("a private space persists ownership and stays hidden from other guests", async () => {
  assert.equal((await request("/api/servers", null)).status, 401);
  const created = await request("/api/spaces", cookie, {
    workspace: fixture(),
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.access.role, "owner");
  assert.equal(created.data.workspace.id, "integration-space");
  assert.equal(
    (await request("/api/spaces/integration-space/join", otherCookie, {}))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/servers", otherCookie)).data.servers.some(
      (space) => space.id === "integration-space",
    ),
    false,
  );
  assert.equal(
    (await request("/api/servers", cookie)).data.servers.some(
      (space) => space.id === "integration-space",
    ),
    true,
  );
  assert.equal(
    (await request("/api/spaces", otherCookie, { workspace: fixture() }))
      .status,
    409,
  );
});

test("invitations grant explicit roles; viewers cannot edit, delegate, publish, or create invitations", async () => {
  const invitation = await request(
    "/api/spaces/integration-space/invites",
    cookie,
    { role: "viewer" },
  );
  assert.equal(invitation.status, 201);
  assert.equal(
    (
      await request("/api/spaces/integration-space/join", otherCookie, {
        invite: invitation.data.token,
      })
    ).data.access.role,
    "viewer",
  );
  const viewer = await connect(otherCookie, fixture());
  assert.equal(viewer.joined.access.canEdit, false);
  viewer.send({
    type: "patch",
    patchId: "viewer-edit",
    patch: { rooms: [{ id: "live-room", fields: { title: "Unauthorized" } }] },
  });
  assert.match(
    (await viewer.wait((event) => event.patchId === "viewer-edit")).message,
    /viewer/,
  );
  viewer.send({ type: "develop", roomId: "live-room", turnIds: [] });
  assert.match(
    (await viewer.wait((event) => event.type === "error" && !event.patchId))
      .message,
    /viewer/,
  );
  assert.equal(
    (
      await request(
        "/api/spaces/integration-space/settings",
        otherCookie,
        {
          visibility: "public",
          joinRole: "contributor",
          description: "Overwritten",
        },
        "PATCH",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/spaces/integration-space/invites", otherCookie, {
        role: "contributor",
      })
    ).status,
    403,
  );
  viewer.send({
    type: "transcript",
    id: "viewer-thought",
    roomId: "live-room",
    text: "Make everything red",
  });
  await viewer.wait(
    (event) => event.type === "ack" && event.id === "viewer-thought",
  );
  const stored = (await request("/api/spaces/integration-space", cookie)).data
    .workspace;
  assert.equal(stored.rooms[0].messages[0].canDirectLuna, false);
  const editInvite = await request(
    "/api/spaces/integration-space/invites",
    cookie,
    { role: "contributor" },
  );
  assert.equal(
    (
      await request("/api/spaces/integration-space/join", editorCookie, {
        invite: editInvite.data.token,
      })
    ).data.access.role,
    "contributor",
  );
});

test("MCP and Luna's shared commit path update one stable room and preserve a checkpoint", async () => {
  const owner = await connect(cookie, fixture());
  const editor = await connect(editorCookie, fixture());
  const client = new Client({ name: "foundations-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`${base}/mcp?space=integration-space&room=live-room`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    ),
  );
  try {
    const context = await client.callTool({
      name: "get_room_context",
      arguments: {},
    });
    const revision = JSON.parse(context.content[0].text).revision;
    const changed = await client.callTool({
      name: "apply_room_operations",
      arguments: {
        revision,
        title: "A useful shared note",
        description: "Luna added a shared thought",
        changes: ["Added one note"],
        operations: [
          {
            type: "add",
            object: {
              kind: "note",
              text: "Build together",
              color: "#eddfa9",
              position: [0, 1.05, 0],
            },
          },
        ],
      },
    });
    assert.equal(changed.isError, undefined);
    const result = JSON.parse(changed.content[0].text);
    assert.equal(result.roomId, "live-room");
    assert.ok(result.checkpointId);
    assert.equal(result.childId, undefined);
    for (const peer of [owner, editor]) {
      const update = await peer.wait(
        (event) =>
          event.type === "delta" &&
          event.delta?.rooms.some((room) =>
            room.objects?.upserts.some((item) => item.text === "Build together"),
          ),
      );
      assert.equal(update.delta.rooms.length, 1);
      assert.equal(update.delta.rooms[0].id, "live-room");
      assert.equal(update.delta.rooms[0].fields.title, "A useful shared note");
      assert.ok(update.seq > peer.joined.seq);
    }
    const checkpoint = (
      await request(
        `/api/spaces/integration-space/checkpoints/${result.checkpointId}`,
        cookie,
      )
    ).data.checkpoint;
    assert.equal(checkpoint.objects.length, 0);
    const stale = await client.callTool({
      name: "apply_room_operations",
      arguments: {
        revision,
        title: "Stale",
        description: "",
        changes: ["Stale"],
        operations: [
          {
            type: "add",
            object: { kind: "cube", color: "#ffffff", position: [0, 1, 0] },
          },
        ],
      },
    });
    assert.equal(stale.isError, true);
  } finally {
    await client.close();
  }
});

test("publishing makes a user space discoverable and ownership survives a server restart", async () => {
  const published = await request(
    "/api/spaces/integration-space/settings",
    cookie,
    {
      visibility: "public",
      joinRole: "viewer",
      description: "A public workshop",
    },
    "PATCH",
  );
  assert.equal(published.status, 200);
  const listing = (
    await request("/api/servers", otherCookie)
  ).data.servers.find((space) => space.id === "integration-space");
  assert.equal(listing.description, "A public workshop");
  for (const ws of sockets) ws.close();
  await stop();
  await start();
  const restored = await request("/api/spaces/integration-space", cookie);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.access.role, "owner");
  assert.equal(
    restored.data.workspace.rooms[0].objects[0].text,
    "Build together",
  );
  assert.equal(restored.data.workspace.rooms.length, 1);
  assert.equal(
    (
      await request(
        "/api/spaces/integration-space/checkpoints?room=live-room",
        cookie,
      )
    ).data.checkpoints.length,
    1,
  );
  const publicGuest = await guest();
  assert.equal(
    (await request("/api/spaces/integration-space/join", publicGuest, {})).data
      .access.role,
    "viewer",
  );
});

test("movement and falling objects are authoritative, shared, and persisted", async () => {
  const owner = await connect(cookie, fixture());
  const observer = await connect(otherCookie, fixture());
  const first = await owner.wait((event) => event.type === "simulation");
  const id = owner.joined.selfId;
  const at = first.players.find((player) => player.id === id).position;
  owner.send({ type: "presence", presence: { position: [90, 90, 90] } });
  owner.send({
    type: "move",
    roomId: "live-room",
    input: { x: 1, z: 0, yaw: 0, jump: false },
  });
  const moved = await observer.wait(
    (event) =>
      event.type === "simulation" &&
      event.tick > first.tick &&
      event.players.some(
        (player) => player.id === id && player.position[0] > at[0] + 0.3,
      ),
  );
  assert.ok(
    moved.players.find((player) => player.id === id).position[0] < at[0] + 1.5,
    "Client presence cannot teleport the character",
  );
  owner.send({
    type: "patch",
    patchId: "physical-prop",
    patch: {
      rooms: [
        {
          id: "live-room",
          objects: {
            upserts: [
              {
                id: "falling-prop",
                kind: "sphere",
                position: [3, 4, -2],
                color: "#ffaa99",
                physics: "dynamic",
              },
            ],
            removes: [],
          },
        },
      ],
    },
  });
  await owner.wait(
    (event) => event.type === "delta" && event.patchId === "physical-prop",
  );
  await observer.wait(
    (event) =>
      event.type === "simulation" &&
      event.objects.some(
        (object) => object.id === "falling-prop" && object.position[1] < 0.8,
      ),
  );
  await owner.wait(
    (event) =>
      event.type === "delta" &&
      event.delta?.rooms[0].objects?.upserts.some(
        (object) => object.id === "falling-prop" && object.position[1] < 0.8,
      ),
  );
  const saved = (
    await request("/api/spaces/integration-space", cookie)
  ).data.workspace.rooms[0].objects.find(
    (object) => object.id === "falling-prop",
  );
  assert.ok(saved.position[1] < 0.8);
  assert.equal(saved.physics, "dynamic");
});
