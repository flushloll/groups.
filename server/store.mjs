import { randomBytes, createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeWorkspace } from "./assets.mjs";
import * as schema from "./schema.mjs";
import { openDatabase } from "./database.mjs";
import {
  LEGACY_ENVIRONMENT,
  publicServers,
  serverWorkspace,
  themeEnvironments,
} from "./servers.mjs";

export class AccessError extends Error {
  constructor(message = "You don’t have access to this space.", status = 403) {
    super(message);
    this.status = status;
  }
}
export const canEdit = (role) =>
  ["owner", "moderator", "contributor"].includes(role);
export const canManage = (role) => ["owner", "moderator"].includes(role);
const CHECKPOINT_LIMIT = 150;
const digest = (token) => createHash("sha256").update(token).digest("hex");
const SPACE_FIELDS =
  "id, name, description, visibility, join_role, color, theme, owner_id, updated_at";

/**
 * Durable state. Space metadata and memberships are cached in memory (one
 * server process owns them), so permission checks and directory listings stay
 * synchronous; every change is committed to the database before the cache.
 */
export async function openStore(directory) {
  const db = await openDatabase(directory);

  async function loadSecret() {
    if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
    if (db.kind === "sqlite") {
      const filename = resolve(directory, "auth-secret");
      try {
        return await readFile(filename, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const secret = randomBytes(48).toString("base64url");
        await writeFile(filename, secret, { mode: 0o600, flag: "wx" });
        return secret;
      }
    }
    // Hosted disks are ephemeral; keep the generated secret with the data.
    await db.run(
      "INSERT INTO groups_meta (key, value) VALUES ('auth-secret', ?) ON CONFLICT (key) DO NOTHING",
      [randomBytes(48).toString("base64url")],
    );
    return (await db.query("SELECT value FROM groups_meta WHERE key = 'auth-secret'"))[0].value;
  }
  const secret = await loadSecret();

  const spaces = new Map();
  const memberships = new Map();
  const membersOf = (spaceId) => {
    if (!memberships.has(spaceId)) memberships.set(spaceId, new Map());
    return memberships.get(spaceId);
  };
  for (const row of await db.query(
    `SELECT ${SPACE_FIELDS}, ${db.currentRoom} AS room_id FROM spaces`,
  ))
    spaces.set(row.id, row);
  for (const row of await db.query("SELECT space_id, user_id, role FROM memberships"))
    membersOf(row.space_id).set(row.user_id, row.role);

  function get(id) {
    return spaces.get(schema.id(id));
  }
  async function readWorkspace(id) {
    const row = (await db.query("SELECT workspace FROM spaces WHERE id = ?", [id]))[0];
    return row ? JSON.parse(row.workspace) : null;
  }
  async function insert(workspace, settings, ownerId = null) {
    const checked = schema.workspace(workspace);
    const row = {
      id: checked.id,
      name: checked.name,
      description: settings.description || "A space to think together.",
      visibility: settings.visibility || "private",
      join_role: settings.joinRole || "viewer",
      color: settings.color || "#789b7e",
      theme: settings.theme || "quiet",
      owner_id: ownerId,
      updated_at: new Date().toISOString(),
      room_id: checked.currentId,
    };
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO spaces VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        row.id,
        row.name,
        row.description,
        row.visibility,
        row.join_role,
        row.color,
        row.theme,
        row.owner_id,
        JSON.stringify(serializeWorkspace(checked)),
        row.updated_at,
      ]);
      if (ownerId)
        await tx.run("INSERT INTO memberships VALUES (?, ?, 'owner')", [checked.id, ownerId]);
    });
    spaces.set(row.id, row);
    if (ownerId) membersOf(row.id).set(ownerId, "owner");
    return checked;
  }
  async function insertCheckpoint(tx, spaceId, checkpoint) {
    await tx.run("INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      checkpoint.id,
      spaceId,
      checkpoint.roomId,
      checkpoint.title,
      checkpoint.createdAt,
      checkpoint.actor,
      checkpoint.objects.length,
      JSON.stringify(checkpoint),
    ]);
  }

  // Local data from earlier versions: legacy JSON files and forked room branches.
  if (db.kind === "sqlite") {
    // Import without changing the original files. Existing link-shared spaces retain their behavior.
    for (const filename of await readdir(directory)) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(filename)) continue;
      const workspace = schema.workspace(
        JSON.parse(await readFile(resolve(directory, filename), "utf8")),
      );
      if (!spaces.has(workspace.id))
        await insert(workspace, { visibility: "unlisted", joinRole: "contributor" });
    }
    // Earlier versions forked a new room for every model change. Each space now
    // has one live room; fold those branches into checkpoints of it, once.
    for (const id of spaces.keys()) {
      const stored = await readWorkspace(id);
      if (stored.rooms.length < 2) continue;
      const workspace = schema.workspace(stored);
      const live = workspace.rooms.find((room) => room.id === workspace.currentId);
      const earlier = workspace.rooms
        .filter((room) => room.id !== live.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const next = schema.workspace({ ...workspace, rooms: [{ ...live, parentId: null }] });
      await db.transaction(async (tx) => {
        for (const room of earlier)
          await insertCheckpoint(tx, id, {
            ...structuredClone(room),
            id: randomUUID(),
            roomId: live.id,
            parentId: null,
            actor: "Earlier version",
            createdAt: room.createdAt,
          });
        await tx.run("UPDATE spaces SET workspace = ? WHERE id = ?", [
          JSON.stringify(serializeWorkspace(next)),
          id,
        ]);
      });
    }
  }
  for (const server of publicServers) {
    if (!spaces.has(server.id)) {
      await insert(serverWorkspace(server), {
        ...server,
        visibility: "public",
        joinRole: "contributor",
      });
      continue;
    }
    const space = spaces.get(server.id);
    if (space.owner_id === null) {
      await db.run(
        "UPDATE spaces SET visibility = 'public', color = ?, theme = ? WHERE id = ? AND owner_id IS NULL",
        [server.color, server.theme, server.id],
      );
      Object.assign(space, { visibility: "public", color: server.color, theme: server.theme });
    }
    // Untouched built-in rooms adopt their theme's atmosphere.
    const stored = await readWorkspace(server.id);
    const room = stored.rooms.find((item) => item.id === stored.currentId);
    const environment = room?.environment;
    if (
      room &&
      !(room.instances || room.objects || []).length &&
      environment &&
      !environment.setting &&
      ["background", "floor", "walls", "light"].every(
        (key) => environment[key] === LEGACY_ENVIRONMENT[key],
      )
    ) {
      room.environment = themeEnvironments[server.theme] || environment;
      await db.run("UPDATE spaces SET workspace = ? WHERE id = ?", [
        JSON.stringify(stored),
        server.id,
      ]);
    }
  }

  function role(space, userId) {
    return (
      memberships.get(space.id)?.get(userId) ||
      (space.visibility !== "private" ? space.join_role : null)
    );
  }
  function access(id, userId) {
    const space = get(id);
    if (!space) throw new AccessError("This space could not be found.", 404);
    const currentRole = role(space, userId);
    if (!currentRole) throw new AccessError();
    return {
      role: currentRole,
      owned: space.owner_id === userId,
      canEdit: canEdit(currentRole),
      canManage: canManage(currentRole),
      visibility: space.visibility,
    };
  }
  async function workspace(id) {
    const stored = await readWorkspace(schema.id(id));
    return stored ? schema.workspace(stored) : null;
  }

  return {
    kind: db.kind,
    authDatabase: db.authDatabase,
    secret,
    get,
    access,
    workspace,
    async create(value, userId, settings = {}) {
      if (spaces.has(value.id)) throw new AccessError("This space already exists.", 409);
      if (!["private", "unlisted", "public"].includes(settings.visibility || "private"))
        throw new AccessError("Invalid visibility.", 400);
      return insert(value, settings, userId);
    },
    async save(next, checkpoint) {
      const updated = new Date().toISOString();
      await db.transaction(async (tx) => {
        await tx.run(
          "UPDATE spaces SET workspace = ?, name = ?, updated_at = ? WHERE id = ?",
          [JSON.stringify(serializeWorkspace(next)), next.name, updated, next.id],
        );
        if (checkpoint) {
          await insertCheckpoint(tx, next.id, checkpoint);
          // Retain the most recent checkpoints per room.
          await tx.run(
            `DELETE FROM checkpoints WHERE space_id = ? AND room_id = ? AND id NOT IN (
              SELECT id FROM checkpoints WHERE space_id = ? AND room_id = ? ORDER BY created_at DESC LIMIT ?)`,
            [next.id, checkpoint.roomId, next.id, checkpoint.roomId, CHECKPOINT_LIMIT],
          );
        }
      });
      const space = spaces.get(next.id);
      if (space) Object.assign(space, { name: next.name, updated_at: updated, room_id: next.currentId });
    },
    list(userId, query = "") {
      const needle = query.toLowerCase();
      return [...spaces.values()]
        .filter((space) => {
          const member = memberships.get(space.id)?.has(userId);
          return (
            (space.visibility === "public" || member) &&
            `${space.name}\n${space.description}`.toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => {
          const owned = (space) => (memberships.get(space.id)?.get(userId) === "owner" ? 0 : 1);
          return owned(a) - owned(b) || a.name.localeCompare(b.name);
        })
        .slice(0, 100)
        .map((space) => ({
          id: space.id,
          name: space.name,
          description: space.description,
          visibility: space.visibility,
          color: space.color,
          theme: space.theme,
          roomId: space.room_id,
          role: role(space, userId),
          owned: space.owner_id === userId,
          member: Boolean(memberships.get(space.id)?.has(userId)),
        }));
    },
    async settings(id, userId, settings) {
      if (!access(id, userId).canManage)
        throw new AccessError("Only the space owner or a moderator can change its settings.");
      schema.assert(
        ["private", "unlisted", "public"].includes(settings.visibility),
        "Invalid visibility.",
      );
      schema.assert(["viewer", "contributor"].includes(settings.joinRole), "Invalid visitor role.");
      const description = schema.text(settings.description, 500).trim();
      const space = spaces.get(id);
      const next = {
        name: space.name,
        visibility: settings.visibility,
        join_role: settings.joinRole,
        description,
        color: space.color,
      };
      if (settings.name !== undefined) {
        next.name = schema.text(settings.name, 80).trim();
        schema.assert(next.name.length > 0, "A space needs a name.");
      }
      if (settings.color !== undefined) {
        schema.assert(/^#[a-fA-F0-9]{6}$/.test(settings.color), "Invalid color.");
        next.color = settings.color;
      }
      await db.run(
        "UPDATE spaces SET name = ?, visibility = ?, join_role = ?, description = ?, color = ? WHERE id = ?",
        [next.name, next.visibility, next.join_role, next.description, next.color, id],
      );
      Object.assign(space, next);
    },
    async remove(id, userId) {
      const space = get(id);
      if (!space) throw new AccessError("This space could not be found.", 404);
      if (space.owner_id !== userId) throw new AccessError("Only the owner can delete this space.");
      await db.transaction(async (tx) => {
        for (const table of ["checkpoints", "invitations", "memberships"])
          await tx.run(`DELETE FROM ${table} WHERE space_id = ?`, [id]);
        await tx.run("DELETE FROM spaces WHERE id = ?", [id]);
      });
      spaces.delete(id);
      memberships.delete(id);
    },
    async members(id, userId) {
      if (!access(id, userId).canManage)
        throw new AccessError("Only the owner or a moderator can see members.");
      const rows = await db.query(
        `SELECT m.user_id AS id, m.role, COALESCE(u.name, 'Guest') AS name FROM memberships m
         LEFT JOIN "user" u ON u.id = m.user_id WHERE m.space_id = ?
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 WHEN 'contributor' THEN 2 ELSE 3 END, name`,
        [id],
      );
      return rows.map((member) => ({ ...member, self: member.id === userId }));
    },
    async setMember(id, userId, memberId, nextRole) {
      const actor = access(id, userId);
      if (!actor.canManage)
        throw new AccessError("Only the owner or a moderator can manage members.");
      const current = memberships.get(id)?.get(memberId);
      if (!current) throw new AccessError("This member could not be found.", 404);
      if (current === "owner") throw new AccessError("The owner’s role cannot be changed.");
      if (actor.role !== "owner" && (current === "moderator" || nextRole === "moderator"))
        throw new AccessError("Only the owner can manage moderators.");
      if (nextRole === null) {
        await db.run("DELETE FROM memberships WHERE space_id = ? AND user_id = ?", [id, memberId]);
        membersOf(id).delete(memberId);
      } else {
        schema.assert(["viewer", "contributor", "moderator"].includes(nextRole), "Invalid role.");
        await db.run("UPDATE memberships SET role = ? WHERE space_id = ? AND user_id = ?", [
          nextRole,
          id,
          memberId,
        ]);
        membersOf(id).set(memberId, nextRole);
      }
    },
    async invite(id, userId, requestedRole = "viewer") {
      if (!access(id, userId).canManage)
        throw new AccessError("Only the owner or a moderator can create invitations.");
      schema.assert(["viewer", "contributor"].includes(requestedRole), "Invalid invitation role.");
      const token = randomBytes(32).toString("base64url");
      await db.run("INSERT INTO invitations VALUES (?, ?, ?, ?)", [
        digest(token),
        id,
        requestedRole,
        Date.now() + 7 * 86400000,
      ]);
      return token;
    },
    async redeem(id, userId, token) {
      schema.text(token, 100);
      const invite = (
        await db.query(
          "SELECT role FROM invitations WHERE token_hash = ? AND space_id = ? AND expires_at > ?",
          [digest(token), id, Date.now()],
        )
      )[0];
      if (!invite) throw new AccessError("This invitation has expired or is invalid.");
      const current = memberships.get(id)?.get(userId);
      if (!current || (current === "viewer" && invite.role === "contributor")) {
        await db.run(
          "INSERT INTO memberships VALUES (?, ?, ?) ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role",
          [id, userId, invite.role],
        );
        membersOf(id).set(userId, invite.role);
      }
    },
    async checkpoints(id, roomId) {
      return db.query(
        `SELECT id, room_id AS "roomId", title, created_at AS "createdAt", actor, object_count AS "objectCount"
         FROM checkpoints WHERE space_id = ? AND room_id = ? ORDER BY created_at DESC LIMIT 150`,
        [id, roomId],
      );
    },
    async checkpoint(id, checkpointId) {
      const row = (
        await db.query("SELECT snapshot FROM checkpoints WHERE space_id = ? AND id = ?", [
          id,
          checkpointId,
        ])
      )[0];
      return row ? JSON.parse(row.snapshot) : null;
    },
    /** Scene summary for lobby previews: placement and type, never image data. */
    async preview(id) {
      const value = await workspace(id);
      if (!value) return null;
      const room = value.rooms.find((item) => item.id === value.currentId);
      return {
        title: room.title,
        environment: room.environment,
        objects: room.objects
          .filter((object) => object.kind !== "image")
          .slice(0, 300)
          .map(({ image, assetId, assetRevision, text, ...object }) => ({
            ...object,
            ...(text && ["note", "text"].includes(object.kind) ? { text: text.slice(0, 120) } : {}),
          })),
      };
    },
    /** Current display name for a user id (ticket-authenticated sockets). */
    async user(id) {
      return (await db.query('SELECT id, name FROM "user" WHERE id = ?', [id]))[0] || null;
    },
    makeCheckpoint(room, actor = "You", title = room.title) {
      return {
        ...structuredClone(room),
        title,
        id: randomUUID(),
        roomId: room.id,
        actor,
        createdAt: new Date().toISOString(),
      };
    },
    close() {
      return db.close();
    },
  };
}
