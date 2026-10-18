import test from "node:test";
import assert from "node:assert/strict";
import * as schema from "../server/schema.mjs";
import { serializeWorkspace } from "../server/assets.mjs";

export const seed = (id = "fixture") => ({
  id,
  name: "A shared idea",
  currentId: "live-room",
  rooms: [
    {
      id: "live-room",
      parentId: null,
      title: "The beginning",
      description: "An open room",
      objects: [
        {
          id: "note-one",
          kind: "note",
          position: [0, 1, 0],
          color: "#eddfa9",
          text: "Keep this thought",
        },
      ],
      messages: [],
      changes: [],
      prompt: "",
      createdAt: "2026-10-17T12:00:00.000Z",
    },
  ],
});
const patchObject = (workspace, object) =>
  schema.applyPatch(workspace, {
    rooms: [{ id: "live-room", objects: { upserts: [object], removes: [] } }],
  });

test("legacy rooms migrate to separate assets and instances without losing content", () => {
  const workspace = schema.workspace(seed());
  assert.equal(workspace.schemaVersion, 2);
  assert.equal(workspace.assets[0].kind, "document");
  assert.equal(workspace.assets[0].content.text, "Keep this thought");
  const stored = serializeWorkspace(workspace);
  assert.equal(stored.rooms[0].objects, undefined);
  assert.equal(stored.rooms[0].instances[0].text, undefined);
  assert.deepEqual(
    schema.workspace(JSON.parse(JSON.stringify(stored))),
    workspace,
  );
});

test("moving an instance preserves content identity and revision", () => {
  const workspace = schema.workspace(seed());
  const moved = patchObject(workspace, {
    ...workspace.rooms[0].objects[0],
    position: [2, 1, 3],
  });
  assert.deepEqual(moved.assets, workspace.assets);
  assert.deepEqual(moved.rooms[0].objects[0].position, [2, 1, 3]);
});

test("editing content increments its revision and rejects stale overwrites", () => {
  const workspace = schema.workspace(seed());
  const object = workspace.rooms[0].objects[0];
  const edited = patchObject(workspace, {
    ...object,
    text: "A better thought",
  });
  assert.equal(edited.assets[0].revision, 2);
  assert.equal(edited.rooms[0].objects[0].assetId, object.assetId);
  assert.throws(
    () => patchObject(edited, { ...object, text: "Overwrite newer work" }),
    /changed/,
  );
});

test("shared content updates all instances without changing their placements", () => {
  const workspace = schema.workspace(seed());
  const other = {
    ...workspace.rooms[0],
    id: "second-room",
    objects: [
      {
        ...workspace.rooms[0].objects[0],
        id: "second-instance",
        position: [4, 1, 0],
      },
    ],
  };
  const shared = schema.workspace({
    ...workspace,
    rooms: [...workspace.rooms, other],
  });
  const edited = patchObject(shared, {
    ...shared.rooms[0].objects[0],
    text: "Shared update",
  });
  assert.equal(edited.rooms[1].objects[0].text, "Shared update");
  assert.deepEqual(edited.rooms[1].objects[0].position, [4, 1, 0]);
  assert.equal(edited.assets.length, 1);
});

test("duplicates get independent content and unsupported executable types are rejected", () => {
  const workspace = schema.workspace(seed());
  const duplicate = { ...workspace.rooms[0].objects[0], id: "duplicate" };
  const copied = schema.applyPatch(workspace, {
    rooms: [
      { id: "live-room", objects: { upserts: [duplicate], removes: [] } },
    ],
  });
  assert.equal(copied.assets.length, 2);
  assert.notEqual(
    copied.rooms[0].objects[0].assetId,
    copied.rooms[0].objects[1].assetId,
  );
  assert.throws(
    () =>
      schema.object({ ...duplicate, kind: "host-script", code: "anything" }),
    /Invalid room object/,
  );
});
