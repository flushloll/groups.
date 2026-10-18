import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { config } from "dotenv";
import * as schema from "./schema.mjs";
import { intelligenceStatus } from "./intelligence.mjs";
import { handleMcp } from "./mcp.mjs";
import { openStore, AccessError } from "./store.mjs";
import { createAuth } from "./auth.mjs";
import { createLive, ROOM_CAPACITY } from "./live.mjs";
import { transcribe, transcriptionStatus } from "./transcription.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({
  path: [resolve(root, ".env.local"), resolve(root, ".env")],
  quiet: true,
});
const dist = resolve(root, "dist");
const dataDirectory = resolve(
  process.env.GROUPS_DATA_DIR || resolve(root, ".groups-data"),
);
const port = Number(process.env.PORT || 3001);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
await mkdir(dataDirectory, { recursive: true });
const store = await openStore(dataDirectory);
const auth = await createAuth(store);
const live = createLive({ store, auth });

// Public address for realtime sockets when the site is served from another
// origin (e.g. Vercel). Render provides RENDER_EXTERNAL_URL automatically.
function realtimeUrl() {
  const value = process.env.GROUPS_REALTIME_URL || process.env.RENDER_EXTERNAL_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
    return url.origin.replace(/^http/, "ws");
  } catch {
    return null;
  }
}

// Optional TURN/STUN servers for restrictive networks, as a JSON array of RTCIceServer.
function iceServers() {
  try {
    const parsed = JSON.parse(process.env.GROUPS_ICE_SERVERS || "null");
    if (Array.isArray(parsed)) return parsed.slice(0, 8);
  } catch {
    console.error("GROUPS_ICE_SERVERS is not valid JSON; using public STUN.");
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

function json(response, status, data, head = false) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? undefined : JSON.stringify(data));
}
async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > schema.LIMITS.payload)
      throw new AccessError("Request is too large.", 413);
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function spaceSettings(spaceId) {
  const settings = store.get(spaceId);
  return {
    name: settings.name,
    description: settings.description,
    joinRole: settings.join_role,
    visibility: settings.visibility,
    color: settings.color,
  };
}

async function spacesApi(request, response, url) {
  const identity = await auth.session(request);
  const userId = identity.user.id;
  const head = request.method === "HEAD";
  if (!["GET", "HEAD"].includes(request.method)) auth.origin(request);
  if (url.pathname === "/api/servers") {
    if (!["GET", "HEAD"].includes(request.method))
      throw new AccessError("Method not allowed.", 405);
    const listings = store.list(
      userId,
      (url.searchParams.get("q") || "").slice(0, 100),
    );
    json(
      response,
      200,
      {
        servers: listings.map((space) => ({
          ...space,
          capacity: ROOM_CAPACITY,
          members: live.occupancy(space.id, space.roomId),
        })),
      },
      head,
    );
    return;
  }
  if (url.pathname === "/api/spaces" && request.method === "POST") {
    const input = await body(request);
    const created = await store.create(schema.workspace(input.workspace), userId, {
      visibility: input.visibility || "private",
      description: typeof input.description === "string"
        ? input.description.slice(0, 500)
        : undefined,
      color: /^#[a-fA-F0-9]{6}$/.test(input.color || "") ? input.color : undefined,
      theme: schema.SOUNDSCAPES.includes(input.theme) ? input.theme : undefined,
    });
    json(response, 201, {
      workspace: created,
      access: store.access(created.id, userId),
      settings: spaceSettings(created.id),
    });
    return;
  }
  const match =
    /^\/api\/spaces\/([a-zA-Z0-9_-]{1,80})(?:\/(join|settings|invites|checkpoints|preview|members|transcribe)(?:\/([a-zA-Z0-9_-]{1,80})(?:\/(restore))?)?)?$/.exec(
      url.pathname,
    );
  if (!match) throw new AccessError("This endpoint could not be found.", 404);
  const [, spaceId, action, itemId, subaction] = match;
  if (action === "join" && request.method === "POST") {
    const input = await body(request);
    if (input.invite) await store.redeem(spaceId, userId, input.invite);
    const access = store.access(spaceId, userId);
    const session = await live.getSession(spaceId);
    json(response, 200, {
      workspace: session.workspace,
      access,
      settings: spaceSettings(spaceId),
    });
    return;
  }
  const access = store.access(spaceId, userId);
  if (action === "transcribe" && request.method === "POST") {
    json(response, 200, await transcribe(request, userId));
    return;
  }
  if (!action && request.method === "DELETE") {
    await store.remove(spaceId, userId);
    live.closeSpace(spaceId, "This space was deleted.");
    json(response, 200, { deleted: true });
    return;
  }
  if (action === "preview" && ["GET", "HEAD"].includes(request.method)) {
    json(response, 200, { preview: await store.preview(spaceId) }, head);
    return;
  }
  if (action === "settings" && request.method === "PATCH") {
    const input = await body(request);
    await store.settings(spaceId, userId, input);
    const session = await live.getSession(spaceId);
    const name = spaceSettings(spaceId).name;
    if (session.workspace.name !== name)
      await live.commitName(session, name);
    live.notifyAccess(spaceId);
    json(response, 200, {
      access: store.access(spaceId, userId),
      settings: spaceSettings(spaceId),
    });
    return;
  }
  if (action === "members") {
    if (!itemId && request.method === "GET") {
      json(response, 200, { members: await store.members(spaceId, userId) });
      return;
    }
    if (itemId && ["PATCH", "DELETE"].includes(request.method)) {
      const input = request.method === "PATCH" ? await body(request) : {};
      await store.setMember(
        spaceId,
        userId,
        itemId,
        request.method === "DELETE" ? null : input.role,
      );
      live.notifyAccess(spaceId);
      json(response, 200, { members: await store.members(spaceId, userId) });
      return;
    }
  }
  if (action === "invites" && request.method === "POST") {
    const input = await body(request);
    json(response, 201, { token: await store.invite(spaceId, userId, input.role) });
    return;
  }
  if (action === "checkpoints") {
    const session = await live.getSession(spaceId);
    if (itemId && subaction === "restore" && request.method === "POST") {
      if (!access.canEdit)
        throw new AccessError("Only contributors can restore checkpoints.");
      json(
        response,
        200,
        await live.restoreCheckpoint(session, itemId, identity.user.name),
      );
      return;
    }
    if (itemId && !subaction && request.method === "GET") {
      const checkpoint = await store.checkpoint(spaceId, itemId);
      if (!checkpoint)
        throw new AccessError("This checkpoint could not be found.", 404);
      json(response, 200, { checkpoint });
      return;
    }
    if (!itemId && request.method === "GET") {
      const roomId = schema.id(
        url.searchParams.get("room") || session.workspace.currentId,
      );
      json(response, 200, { checkpoints: await store.checkpoints(spaceId, roomId) });
      return;
    }
    if (!itemId && request.method === "POST") {
      if (!access.canEdit)
        throw new AccessError("Only contributors can save checkpoints.");
      const input = await body(request);
      const checkpoint = await live.saveCheckpoint(
        session,
        schema.id(input.roomId || session.workspace.currentId),
        identity.user.name,
      );
      json(response, 201, { checkpoint });
      return;
    }
  }
  if (!action && ["GET", "HEAD"].includes(request.method)) {
    const session = await live.getSession(spaceId);
    json(
      response,
      200,
      {
        workspace: session.workspace,
        access,
        settings: spaceSettings(spaceId),
      },
      head,
    );
    return;
  }
  throw new AccessError("Method not allowed.", 405);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://groups.local");
    if (url.pathname.startsWith("/api/auth/")) {
      await auth.handler(request, response);
      return;
    }
    if (url.pathname === "/mcp") {
      await handleMcp(request, response, url, {
        getSession: live.getSession,
        commit: live.commitDevelopment,
      });
      return;
    }
    if (
      url.pathname.startsWith("/api/spaces") ||
      url.pathname === "/api/servers"
    ) {
      await spacesApi(request, response, url);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (url.pathname === "/health") {
      json(response, 200, { ok: true }, request.method === "HEAD");
      return;
    }
    if (url.pathname === "/api/ws-ticket") {
      const identity = await auth.session(request);
      json(response, 200, { ticket: auth.ticket(identity), url: realtimeUrl() });
      return;
    }
    if (url.pathname === "/api/config") {
      json(
        response,
        200,
        {
          intelligence: intelligenceStatus(),
          transcription: transcriptionStatus(),
          iceServers: iceServers(),
        },
        request.method === "HEAD",
      );
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    let filename = resolve(dist, `.${pathname}`);
    if (!filename.startsWith(dist + sep) && filename !== dist) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let info;
    try {
      info = await stat(filename);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (!info?.isFile()) {
      if (extname(pathname)) {
        response.writeHead(404).end("Not found");
        return;
      }
      filename = resolve(dist, "index.html");
      info = await stat(filename);
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filename)] || "application/octet-stream",
      "Content-Length": info.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": filename.startsWith(resolve(dist, "assets") + sep)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else
      createReadStream(filename)
        .on("error", () => response.destroy())
        .pipe(response);
  } catch (error) {
    if (request.url?.startsWith("/api/")) {
      // Only our own errors carry user-facing messages; library errors may use
      // non-numeric status names, which must never reach writeHead.
      const status = Number.isInteger(error.status)
        ? error.status
        : Number.isInteger(error.statusCode)
          ? error.statusCode
          : error instanceof SyntaxError || error.message?.startsWith("Invalid")
            ? 400
            : 500;
      if (status >= 500) console.error("Request failed:", error.message);
      if (!response.headersSent)
        json(response, status, {
          message:
            error instanceof AccessError || (status < 500 && error.message && !(error instanceof SyntaxError))
              ? error.message
              : status >= 500
                ? "Something went wrong. Please try again."
                : "This request could not be read.",
        });
      return;
    }
    if (!response.headersSent)
      response.writeHead(error.code === "ENOENT" ? 404 : 400);
    response.end(
      error.code === "ENOENT"
        ? "Build the app with npm run build first."
        : "Request could not be served.",
    );
  }
});
const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: schema.LIMITS.payload,
  perMessageDeflate: false,
});
server.on("upgrade", (request, socket, head) => {
  if (request.url?.split("?")[0] !== "/ws") {
    socket.destroy();
    return;
  }
  try {
    auth.origin(request);
    const ticket = new URL(request.url, "http://groups.local").searchParams.get("ticket");
    if (ticket) {
      const redeemed = auth.redeemTicket(ticket);
      if (!redeemed) throw new Error("Invalid ticket.");
      request.groupsTicket = redeemed;
    }
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) =>
    sockets.emit("connection", ws, request),
  );
});
sockets.on("connection", live.handleConnection);
const heartbeat = setInterval(() => {
  for (const socket of sockets.clients) socket.heartbeat();
}, 20000);
heartbeat.unref();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  server.close();
  for (const socket of sockets.clients) socket.close(1001, "Server restarting");
  await live.shutdown();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.listen(port, "0.0.0.0", () =>
  console.log(`Groups is listening on http://localhost:${port}`),
);
