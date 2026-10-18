import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import * as schema from "./schema.mjs";
import { intelligenceStatus, interpretConversation } from "./intelligence.mjs";
import { applyPlan } from "./room-tools.mjs";
import { AccessError } from "./store.mjs";
import { editRoomObjects } from "./assets.mjs";
import { RoomPhysics, STEP } from "./physics.mjs";

export const ROOM_CAPACITY = 10;
// Luna waits for this much quiet after ordinary conversation before building.
const QUIET_MS = Number(process.env.GROUPS_LUNA_QUIET_MS || 4500);
const DIRECT_MS = 350;
const RUN_DEADLINE_MS = 120000;
const MAX_TURN_CHARACTERS = 60000;

/** The authoritative live service: one session per loaded space. */
export function createLive({ store, auth }) {
  const sessions = new Map();
  const pendingLoads = new Map();
  const runs = new Map();

  function send(socket, message) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > schema.LIMITS.workspaceBytes * 2) {
      socket.close(1013, "Connection is too slow.");
      return;
    }
    socket.send(JSON.stringify(message));
  }
  function broadcast(session, message) {
    for (const socket of session.clients.keys()) send(socket, message);
  }
  function roster(session) {
    return [...session.clients.values()].map((client) => client.participant);
  }
  function broadcastPresence(session) {
    broadcast(session, { type: "presence", peers: roster(session) });
  }
  function occupancy(spaceId, roomId) {
    const session = sessions.get(spaceId);
    return session
      ? roster(session).filter((peer) => peer.roomId === roomId).length
      : 0;
  }
  function hasCapacity(session, roomId, except) {
    return (
      [...session.clients.values()].filter(
        (client) => client !== except && client.participant.roomId === roomId,
      ).length < ROOM_CAPACITY
    );
  }
  function liveRoom(session, roomId) {
    const room = session.workspace.rooms.find((item) => item.id === roomId);
    schema.assert(room, "This room could not be found.");
    return room;
  }

  /** Persist a new canonical workspace and send everyone only what changed. */
  async function publish(session, next, { checkpoint, ...extra } = {}) {
    const delta = schema.workspaceDelta(session.workspace, next);
    await store.save(next, checkpoint);
    session.workspace = next;
    syncPhysics(session);
    if (!delta && !extra.patchId) return;
    session.seq++;
    broadcast(session, { type: "delta", seq: session.seq, delta, ...extra });
  }
  function fullState(session) {
    return { seq: session.seq, workspace: session.workspace };
  }
  function syncPhysics(session) {
    for (const [id, simulation] of session.physics) {
      const room = session.workspace.rooms.find((room) => room.id === id);
      if (room) simulation.sync(room.objects);
    }
  }
  function simulationFor(session, roomId) {
    if (!session.physics.has(roomId))
      session.physics.set(
        roomId,
        new RoomPhysics(liveRoom(session, roomId).objects),
      );
    return session.physics.get(roomId);
  }
  async function flushPhysics(session) {
    let changed = false;
    const rooms = session.workspace.rooms.map((room) => {
      const objects =
        session.physics.get(room.id)?.flushObjects(room.objects) ||
        room.objects;
      if (objects === room.objects) return room;
      changed = true;
      return { ...room, objects };
    });
    if (changed) await publish(session, { ...session.workspace, rooms });
  }
  function releaseIdleWorlds(session) {
    for (const [id, simulation] of session.physics)
      if (!simulation.players.size) {
        simulation.free();
        session.physics.delete(id);
      }
  }
  function enqueue(session, operation) {
    const result = session.queue.then(operation);
    session.queue = result.catch(() => {});
    return result;
  }
  async function loadSession(workspaceId) {
    schema.id(workspaceId);
    if (sessions.has(workspaceId)) return sessions.get(workspaceId);
    if (pendingLoads.has(workspaceId)) return pendingLoads.get(workspaceId);
    const loading = (async () => {
      const workspace = await store.workspace(workspaceId);
      if (!workspace)
        throw new AccessError("This space could not be found.", 404);
      const session = {
        workspace,
        seq: 0,
        clients: new Map(),
        patches: new Map(),
        turns: new Map(),
        turnAuthors: new Map(),
        luna: new Map(),
        queue: Promise.resolve(),
        physics: new Map(),
      };
      sessions.set(workspaceId, session);
      return session;
    })();
    pendingLoads.set(workspaceId, loading);
    try {
      return await loading;
    } finally {
      pendingLoads.delete(workspaceId);
    }
  }
  async function getSession(workspaceId) {
    schema.id(workspaceId);
    if (sessions.has(workspaceId)) return sessions.get(workspaceId);
    return store.get(workspaceId) ? loadSession(workspaceId) : null;
  }
  function remember(map, key, value, limit = 4000) {
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  }

  /** Append messages, keeping the newest within the room limit. */
  function withMessages(room, messages) {
    const all = [...room.messages, ...messages];
    const kept = all.slice(-(schema.LIMITS.messages - 50));
    const ids = new Set(kept.map((item) => item.id));
    return {
      ...room,
      messages: all.length > schema.LIMITS.messages - 50 ? kept : all,
      sourceTurnIds: (room.sourceTurnIds || []).filter((id) => ids.has(id)),
    };
  }
  function updateRoom(session, roomId, update) {
    return schema.workspace({
      ...session.workspace,
      rooms: session.workspace.rooms.map((room) =>
        room.id === roomId ? update(room) : room,
      ),
    });
  }

  // --- Luna ---------------------------------------------------------------

  function lunaState(session, roomId) {
    if (!session.luna.has(roomId))
      session.luna.set(roomId, {
        timer: null,
        running: false,
        again: false,
        direct: false,
      });
    return session.luna.get(roomId);
  }
  function eligibleTurns(room) {
    const consumed = new Set(room.sourceTurnIds || []);
    const turns = room.messages.filter(
      (item) =>
        item.role === "you" &&
        item.canDirectLuna !== false &&
        !consumed.has(item.id),
    );
    let length = 0;
    return turns.filter((turn) => {
      length += turn.text.length + 1;
      return length <= MAX_TURN_CHARACTERS;
    });
  }
  function speakingIn(session, roomId) {
    return roster(session).some(
      (peer) => peer.roomId === roomId && peer.speaking && !peer.muted,
    );
  }
  function editorUserId(session, roomId, turns) {
    for (const turn of [...turns].reverse()) {
      const userId = session.turnAuthors.get(turn.id);
      if (userId) return userId;
    }
    for (const client of session.clients.values()) {
      if (client.participant.roomId !== roomId) continue;
      try {
        if (store.access(session.workspace.id, client.userId).canEdit)
          return client.userId;
      } catch {
        /* A closing client may have lost access. */
      }
    }
    return null;
  }
  function scheduleLuna(session, roomId, { direct = false } = {}) {
    if (!intelligenceStatus().available) return;
    const state = lunaState(session, roomId);
    state.direct ||= direct;
    if (state.running) {
      state.again = true;
      return;
    }
    clearTimeout(state.timer);
    state.timer = setTimeout(
      () => attemptLuna(session, roomId),
      state.direct ? DIRECT_MS : QUIET_MS,
    );
    state.timer.unref?.();
  }
  function attemptLuna(session, roomId) {
    const state = lunaState(session, roomId);
    state.timer = null;
    if (!sessions.has(session.workspace.id)) return;
    if (!state.direct && speakingIn(session, roomId)) {
      state.timer = setTimeout(() => attemptLuna(session, roomId), 1500);
      state.timer.unref?.();
      return;
    }
    const direct = state.direct;
    state.direct = false;
    void runLuna(session, roomId, { direct }).catch((error) =>
      console.error("Luna run failed:", error.message),
    );
  }
  async function runLuna(session, roomId, { direct, userId } = {}) {
    const state = lunaState(session, roomId);
    const key = `${session.workspace.id}:${roomId}`;
    if (state.running || runs.has(key)) {
      state.again = true;
      return;
    }
    const room = liveRoom(session, roomId);
    const turns = eligibleTurns(room);
    if (!turns.length) return;
    const actorId = userId || editorUserId(session, roomId, turns);
    if (!actorId) return;
    state.running = true;
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), RUN_DEADLINE_MS);
    runs.set(key, abort);
    const turnIds = turns.map((turn) => turn.id);
    broadcast(session, { type: "development", status: "thinking", roomId });
    try {
      const { plan, explanation, baseline } = await interpretConversation(
        structuredClone(session.workspace),
        roomId,
        turns,
        (status) => broadcast(session, { type: "development", status, roomId }),
        abort.signal,
      );
      if (plan) {
        const result = await commitDevelopment(
          session,
          roomId,
          plan,
          turnIds,
          "Luna",
          actorId,
          baseline,
        );
        await enqueue(session, async () =>
          publish(
            session,
            updateRoom(session, roomId, (current) =>
              withMessages(current, [
                {
                  id: randomUUID(),
                  role: "ai",
                  author: "Luna",
                  text: (plan.description || plan.title).slice(0, 2000),
                  time: new Date().toISOString(),
                  status: "changed",
                  checkpointId: result.checkpointId,
                },
              ]),
            ),
          ),
        );
      } else {
        // Considered turns are consumed so small talk is not reconsidered forever.
        await enqueue(session, async () =>
          publish(
            session,
            updateRoom(session, roomId, (current) =>
              withMessages(
                {
                  ...current,
                  sourceTurnIds: [
                    ...new Set([...(current.sourceTurnIds || []), ...turnIds]),
                  ],
                },
                direct && explanation
                  ? [
                      {
                        id: randomUUID(),
                        role: "ai",
                        author: "Luna",
                        text: explanation.slice(0, 2000),
                        time: new Date().toISOString(),
                        status: "unchanged",
                      },
                    ]
                  : [],
              ),
            ),
          ),
        );
        broadcast(session, {
          type: "development",
          status: "unchanged",
          roomId,
          message: direct ? explanation : "",
        });
      }
    } catch (error) {
      console.error("Room development failed:", error.name, error.message);
      broadcast(session, {
        type: "development",
        status: "error",
        roomId,
        message: !intelligenceStatus().available
          ? error.message
          : error.name === "AbortError"
            ? "Luna took too long. Your conversation is saved; ask again."
            : /changed|conflict|already|exist/i.test(error.message)
              ? error.message
              : "Luna couldn’t finish that. Your conversation is saved. Check the model connection and try again.",
      });
    } finally {
      clearTimeout(deadline);
      runs.delete(key);
      state.running = false;
      if (state.again && sessions.has(session.workspace.id)) {
        state.again = false;
        if (eligibleTurns(liveRoom(session, roomId)).length)
          scheduleLuna(session, roomId);
      }
    }
  }
  /** Shared commit path for built-in Luna and external MCP assistants. */
  function commitDevelopment(
    session,
    roomId,
    plan,
    turnIds = [],
    actor = "Luna",
    userId,
    baseline,
  ) {
    return enqueue(session, async () => {
      if (userId && !store.access(session.workspace.id, userId).canEdit)
        throw new AccessError("Your role no longer allows room editing.");
      const source = liveRoom(session, roomId);
      const result = applyPlan(
        session.workspace,
        roomId,
        plan,
        turnIds,
        baseline,
      );
      const updated = editRoomObjects(session.workspace, roomId, result.objects);
      const next = schema.workspace({
        ...updated,
        rooms: updated.rooms.map((room) =>
          room.id !== roomId
            ? room
            : {
                ...room,
                title: result.title,
                description: result.description,
                changes: result.changes,
                prompt: result.prompt,
                environment: result.environment,
                sourceTurnIds: [
                  ...new Set([...(source.sourceTurnIds || []), ...turnIds]),
                ],
              },
        ),
      });
      const checkpoint = store.makeCheckpoint(source, actor);
      await publish(session, next, { checkpoint });
      broadcast(session, {
        type: "development",
        status: "complete",
        roomId,
        checkpointId: checkpoint.id,
        message: result.description,
      });
      return {
        roomId,
        checkpointId: checkpoint.id,
        title: result.title,
        changes: result.changes,
      };
    });
  }

  function commitName(session, name) {
    return enqueue(session, async () =>
      await publish(session, schema.workspace({ ...session.workspace, name })),
    );
  }

  // --- Checkpoints ----------------------------------------------------------

  function saveCheckpoint(session, roomId, actor) {
    return enqueue(session, async () => {
      await flushPhysics(session);
      const room = liveRoom(session, roomId);
      const checkpoint = store.makeCheckpoint(room, actor);
      await store.save(session.workspace, checkpoint);
      return checkpoint;
    });
  }
  function restoreCheckpoint(session, checkpointId, actor) {
    return enqueue(session, async () => {
      await flushPhysics(session);
      const snapshot = await store.checkpoint(session.workspace.id, checkpointId);
      if (!snapshot)
        throw new AccessError("This checkpoint could not be found.", 404);
      const room = liveRoom(session, snapshot.roomId);
      const before = store.makeCheckpoint(
        room,
        actor,
        `Before restoring “${snapshot.title}”`,
      );
      // Restored content becomes the newest revision of each asset.
      const objects = snapshot.objects.map(({ assetRevision, ...object }) =>
        schema.object(object),
      );
      const updated = editRoomObjects(session.workspace, room.id, objects);
      const next = schema.workspace({
        ...updated,
        rooms: updated.rooms.map((item) =>
          item.id !== room.id
            ? item
            : {
                ...item,
                title: snapshot.title,
                description: snapshot.description,
                environment: snapshot.environment,
                changes: [`Restored “${snapshot.title}”`],
              },
        ),
      });
      await publish(session, next, { checkpoint: before });
      broadcast(session, {
        type: "development",
        status: "restored",
        roomId: room.id,
        checkpointId: before.id,
        message: `${actor} restored “${snapshot.title}”.`,
      });
      return { roomId: room.id, checkpointId: before.id };
    });
  }

  // --- Access changes ---------------------------------------------------------

  function notifyAccess(spaceId) {
    const session = sessions.get(spaceId);
    if (!session) return;
    for (const [socket, client] of session.clients) {
      try {
        const access = store.access(spaceId, client.userId);
        send(socket, { type: "access", access });
        const simulation = session.physics.get(client.participant.roomId);
        const player = simulation?.players.get(client.participant.id);
        if (player) player.canPush = access.canEdit;
      } catch {
        socket.close(1008, "Space access changed.");
      }
    }
    broadcastPresence(session);
  }
  function closeSpace(spaceId, reason) {
    const session = sessions.get(spaceId);
    if (!session) return;
    for (const socket of session.clients.keys()) socket.close(1008, reason);
    for (const state of session.luna.values()) clearTimeout(state.timer);
    for (const simulation of session.physics.values()) simulation.free();
    session.physics.clear();
    sessions.delete(spaceId);
  }

  // --- Connections --------------------------------------------------------------

  function handleConnection(socket, request) {
    let session;
    let client;
    let queue = Promise.resolve();
    let alive = true;
    let windowStart = Date.now();
    let messagesInWindow = 0;
    const joinDeadline = setTimeout(
      () => socket.close(1008, "Join a workspace first."),
      15000,
    );
    socket.on("pong", () => {
      alive = true;
    });
    socket.heartbeat = async () => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
      if (client) {
        try {
          await auth.session(request);
          store.access(session.workspace.id, client.userId);
        } catch {
          socket.close(1008, "Space session expired.");
        }
      }
    };

    async function appendTurn(message, source) {
      const access = store.access(session.workspace.id, client.userId);
      const turnId = schema.id(message.id);
      const roomId = schema.id(message.roomId);
      const room = liveRoom(session, roomId);
      // Speech queued before a reconnect is delivered exactly once.
      if (session.turns.has(turnId) || room.messages.some((m) => m.id === turnId)) {
        send(socket, { type: "ack", id: turnId });
        return;
      }
      const text = schema.text(message.text, 10000).trim();
      schema.assert(text.length > 0, "Empty message.");
      const toLuna =
        source === "text"
          ? message.toLuna === true || /^\s*@?luna\b[\s,:!?]/i.test(text)
          : /\b(hey|okay|ok|hi)?\s*luna\b/i.test(text);
      const turn = {
        id: turnId,
        role: "you",
        text,
        author: client.participant.name,
        canDirectLuna: access.canEdit,
        source,
        ...(toLuna ? { toLuna: true } : {}),
        time: new Date().toISOString(),
      };
      await publish(
        session,
        updateRoom(session, roomId, (current) => withMessages(current, [turn])),
      );
      remember(session.turns, turnId, true);
      remember(session.turnAuthors, turnId, client.userId);
      send(socket, { type: "ack", id: turnId });
      if (!access.canEdit) return;
      if (toLuna) scheduleLuna(session, roomId, { direct: true });
      else if (liveRoom(session, roomId).autoBuild !== false)
        scheduleLuna(session, roomId);
    }

    async function handle(message) {
      schema.assert(schema.record(message), "Invalid session message.");
      if (message.type === "join") {
        schema.assert(!client, "Already in a workspace.");
        const identity = await auth.session(request);
        const access = store.access(
          schema.id(message.workspace?.id),
          identity.user.id,
        );
        session = await loadSession(message.workspace.id);
        await enqueue(session, async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          const roomId = session.workspace.currentId;
          if (!hasCapacity(session, roomId)) {
            send(socket, {
              type: "error",
              code: "full",
              message:
                "This room has ten people. Try joining again when a place opens.",
            });
            socket.close(1008, "Room full");
            return;
          }
          client = {
            userId: identity.user.id,
            expiresAt: new Date(identity.session.expiresAt).getTime(),
            participant: {
              id: randomUUID(),
              name: identity.user.name,
              roomId,
              position: [0, 0, 0],
              muted: true,
              speaking: false,
              ...(typeof message.color === "string" &&
              /^#[a-fA-F0-9]{6}$/.test(message.color)
                ? { color: message.color }
                : {}),
            },
          };
          session.clients.set(socket, client);
          Object.assign(
            client.participant,
            simulationFor(session, roomId).addPlayer(
              client.participant.id,
              access.canEdit,
            ),
          );
          clearTimeout(joinDeadline);
          send(socket, {
            type: "joined",
            selfId: client.participant.id,
            peers: roster(session),
            roomId,
            access,
            lunaBusy: runs.has(`${session.workspace.id}:${roomId}`),
            ...fullState(session),
          });
          broadcastPresence(session);
        });
        return;
      }
      schema.assert(session && client, "Join a workspace first.");
      if (["patch", "develop", "transcript", "chat", "profile"].includes(message.type))
        await auth.session(request);
      if (Date.now() >= client.expiresAt) {
        socket.close(1008, "Session expired.");
        return;
      }
      const access = store.access(session.workspace.id, client.userId);
      if (["patch", "develop"].includes(message.type) && !access.canEdit)
        throw new AccessError(
          "You’re exploring as a viewer. An editing invitation lets you contribute.",
        );
      if (message.type === "move") {
        // A stale packet from another room never moves the character.
        if (message.roomId !== client.participant.roomId) return;
        const simulation = simulationFor(session, client.participant.roomId);
        simulation.players.get(client.participant.id).canPush = access.canEdit;
        simulation.input(client.participant.id, message.input);
        return;
      }
      if (message.type === "develop") {
        const roomId = schema.id(message.roomId);
        const room = liveRoom(session, roomId);
        if (!eligibleTurns(room).length) {
          send(socket, {
            type: "development",
            status: "error",
            roomId,
            message: "Say or type what you’d like Luna to make first.",
          });
          return;
        }
        if (!intelligenceStatus().available)
          throw new Error(
            "Luna is offline. Add a model connection in the server configuration.",
          );
        void runLuna(session, roomId, { direct: true, userId: client.userId });
        return;
      }
      if (message.type === "resync") {
        send(socket, { type: "workspace", ...fullState(session) });
        return;
      }
      await enqueue(session, async () => {
        if (!session.clients.has(socket)) return;
        const access = store.access(session.workspace.id, client.userId);
        if (message.type === "patch") {
          if (!access.canEdit)
            throw new AccessError("Your role no longer allows room editing.");
          if (message.patch?.name !== undefined && !access.canManage)
            throw new AccessError(
              "Only the owner or a moderator can rename this space.",
            );
          for (const change of message.patch?.rooms || [])
            schema.assert(
              !change.messages && !change.create,
              "Conversation history is managed by the server.",
            );
          const patchId = schema.id(message.patchId);
          if (session.patches.has(patchId)) {
            send(socket, {
              type: "delta",
              seq: session.seq,
              delta: null,
              patchId,
              peerId: client.participant.id,
            });
            return;
          }
          const next = schema.applyPatch(session.workspace, message.patch);
          remember(session.patches, patchId, true);
          await publish(session, next, { patchId, peerId: client.participant.id });
          const autoBuild = message.patch.rooms.find(
            (change) => change.fields?.autoBuild === true,
          );
          if (autoBuild) scheduleLuna(session, autoBuild.id);
        } else if (message.type === "presence") {
          const next = schema.presence(message.presence, client.participant);
          if (
            message.presence.color !== undefined &&
            /^#[a-fA-F0-9]{6}$/.test(message.presence.color)
          )
            next.color = message.presence.color;
          schema.assert(
            next.roomId === client.participant.roomId ||
              session.workspace.rooms.some((item) => item.id === next.roomId),
            "Unknown room.",
          );
          if (!hasCapacity(session, next.roomId, client)) {
            send(socket, {
              type: "error",
              code: "room_full",
              roomId: client.participant.roomId,
              message: "That room is full.",
            });
            return;
          }
          if (next.roomId !== client.participant.roomId) {
            session.physics
              .get(client.participant.roomId)
              ?.removePlayer(client.participant.id);
            Object.assign(
              next,
              simulationFor(session, next.roomId).addPlayer(
                next.id,
                access.canEdit,
              ),
            );
            await flushPhysics(session);
            releaseIdleWorlds(session);
          }
          const stoppedSpeaking =
            client.participant.speaking && !next.speaking;
          client.participant = next;
          broadcastPresence(session);
          if (stoppedSpeaking) {
            const state = lunaState(session, next.roomId);
            if (state.timer && !state.direct) scheduleLuna(session, next.roomId);
          }
        } else if (message.type === "profile") {
          const identity = await auth.session(request);
          client.participant = {
            ...client.participant,
            name: identity.user.name,
          };
          broadcastPresence(session);
        } else if (message.type === "transcript") {
          await appendTurn(message, "voice");
        } else if (message.type === "chat") {
          await appendTurn(message, "text");
        } else if (message.type === "signal") {
          const target = schema.id(message.target);
          schema.assert(
            schema.record(message.data) &&
              Buffer.byteLength(JSON.stringify(message.data)) <= 64000,
            "Invalid audio signal.",
          );
          for (const [peerSocket, peer] of session.clients)
            if (
              peer.participant.id === target &&
              peer.participant.roomId === client.participant.roomId
            )
              send(peerSocket, {
                type: "signal",
                peerId: client.participant.id,
                data: message.data,
              });
        } else throw new Error("Unknown session message.");
      });
    }
    socket.on("message", (data, binary) => {
      if (Date.now() - windowStart > 10000) {
        windowStart = Date.now();
        messagesInWindow = 0;
      }
      if (++messagesInWindow > 600) {
        socket.close(1008, "Too many messages.");
        return;
      }
      queue = queue.then(async () => {
        let message;
        try {
          schema.assert(!binary, "Use JSON session messages.");
          message = JSON.parse(data.toString());
          await handle(message);
        } catch (error) {
          console.error("Session message rejected:", error.message);
          const isPatch = message?.type === "patch";
          const isTurn = ["transcript", "chat"].includes(message?.type);
          send(socket, {
            type: "error",
            code:
              message?.type === "join" && error.status
                ? "access_denied"
                : isPatch
                  ? "patch_rejected"
                  : isTurn
                    ? "turn_rejected"
                    : "invalid",
            ...(isPatch && typeof message.patchId === "string"
              ? {
                  patchId: message.patchId,
                  ...(session ? fullState(session) : {}),
                }
              : {}),
            ...(isTurn && typeof message.id === "string"
              ? { turnId: message.id }
              : {}),
            message: error.code
              ? "Your change could not be saved. Try again."
              : error.message,
          });
          if (message?.type === "join" && error.status)
            socket.close(1008, "Space access denied.");
        }
      });
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(joinDeadline);
      if (session?.clients.delete(socket)) {
        session.physics
          .get(client.participant.roomId)
          ?.removePlayer(client.participant.id);
        broadcastPresence(session);
        void enqueue(session, async () => {
          await flushPhysics(session);
          releaseIdleWorlds(session);
        }).catch((error) =>
          console.error("Physics save failed:", error.message),
        );
      }
    });
  }

  // --- Simulation loop ------------------------------------------------------------

  let physicsTime = performance.now();
  let physicsAccumulator = 0;
  let physicsFrames = 0;
  const physicsTimer = setInterval(() => {
    const now = performance.now();
    physicsAccumulator += Math.min((now - physicsTime) / 1000, 0.1);
    physicsTime = now;
    while (physicsAccumulator >= STEP) {
      physicsAccumulator -= STEP;
      physicsFrames++;
      for (const session of sessions.values())
        for (const [roomId, simulation] of session.physics) {
          if (!simulation.players.size) continue;
          simulation.step();
          if (physicsFrames % 3 !== 0) continue;
          const state = simulation.snapshot();
          const frame = JSON.stringify({ type: "simulation", roomId, ...state });
          const positions = new Map(state.players.map((p) => [p.id, p]));
          for (const [socket, client] of session.clients) {
            const player = positions.get(client.participant.id);
            if (!player) continue;
            Object.assign(client.participant, player);
            if (
              socket.readyState === WebSocket.OPEN &&
              socket.bufferedAmount < 256 * 1024
            )
              socket.send(frame);
          }
        }
      if (physicsFrames % 120 === 0)
        for (const session of sessions.values()) {
          if (session.physics.size && !session.flushingPhysics) {
            session.flushingPhysics = true;
            void enqueue(session, async () => flushPhysics(session))
              .catch((error) =>
                console.error("Physics save failed:", error.message),
              )
              .finally(() => {
                session.flushingPhysics = false;
              });
          }
        }
    }
  }, 1000 / 60);
  physicsTimer.unref();

  async function shutdown() {
    clearInterval(physicsTimer);
    for (const controller of runs.values()) controller.abort();
    await Promise.allSettled([...pendingLoads.values()]);
    await Promise.allSettled(
      [...sessions.values()].map((session) => session.queue),
    );
    for (const session of sessions.values()) {
      for (const state of session.luna.values()) clearTimeout(state.timer);
      await flushPhysics(session);
      for (const simulation of session.physics.values()) simulation.free();
      session.physics.clear();
    }
  }

  return {
    sessions,
    getSession,
    occupancy,
    commitDevelopment,
    commitName,
    saveCheckpoint,
    restoreCheckpoint,
    notifyAccess,
    closeSpace,
    handleConnection,
    shutdown,
  };
}
