import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { applyPlan, revision } from "../server/room-tools.mjs";
import * as schema from "../server/schema.mjs";

// Transpile the browser sync helpers with the project's compiler.
const source = readFileSync(new URL("../src/state/sync.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const file = join(mkdtempSync(join(tmpdir(), "groups-sync-")), "sync.mjs");
writeFileSync(
  file,
  outputText.replace("../../shared/board.mjs", new URL("../shared/board.mjs", import.meta.url).href),
);
const { applyDelta, applyPatch } = await import(file);

const room = (objects = [], messages = []) => ({
  id: "r",
  parentId: null,
  title: "Room",
  description: "",
  objects,
  messages,
  changes: [],
  prompt: "",
  createdAt: "2026-10-18T00:00:00.000Z",
});
const workspace = (objects, messages) => ({ id: "w", name: "W", currentId: "r", rooms: [room(objects, messages)] });

test("client deltas upsert, remove and keep untouched objects by reference", () => {
  const keep = { id: "keep", kind: "cube", position: [0, 0, 0], color: "#ffffff" };
  const drop = { id: "drop", kind: "cube", position: [1, 0, 0], color: "#ffffff" };
  const before = workspace([keep, drop]);
  const after = applyDelta(before, {
    name: "Renamed",
    rooms: [
      {
        id: "r",
        fields: { title: "New" },
        objects: { upserts: [{ id: "add", kind: "sphere", position: [2, 0, 0], color: "#000000" }], removes: ["drop"] },
        messages: { upserts: [{ id: "m", role: "ai", text: "hi", time: "2026-10-18T00:00:00.000Z" }], removes: [] },
      },
    ],
  });
  assert.equal(after.name, "Renamed");
  assert.equal(after.rooms[0].title, "New");
  assert.deepEqual(after.rooms[0].objects.map((o) => o.id), ["keep", "add"]);
  assert.equal(after.rooms[0].objects[0], keep, "unchanged objects keep identity for memoised rendering");
  assert.equal(after.rooms[0].messages.length, 1);
  assert.equal(applyDelta(before, null), before);
});

test("optimistic partial updates merge fields and board elements like the server", () => {
  const board = {
    id: "b",
    kind: "board",
    position: [0, 1.4, 0],
    color: "#ffffff",
    board: { elements: [{ id: "e", type: "text", version: 2, x: 0, y: 0, width: 1, height: 1 }] },
  };
  const next = applyPatch(workspace([board]), {
    rooms: [
      {
        id: "r",
        objects: {
          updates: [
            {
              id: "b",
              fields: {
                color: "#123456",
                board: {
                  elements: [
                    { id: "e", type: "text", version: 1, x: 9, y: 0, width: 1, height: 1 },
                    { id: "f", type: "rectangle", version: 1, x: 5, y: 0, width: 1, height: 1 },
                  ],
                },
              },
            },
          ],
        },
      },
    ],
  });
  const merged = next.rooms[0].objects[0];
  assert.equal(merged.color, "#123456");
  assert.deepEqual(merged.board.elements.map((e) => [e.id, e.x]), [
    ["e", 0],
    ["f", 5],
  ]);
});

test("Luna can create a board with sticky notes and add to it later", () => {
  const start = schema.workspace(workspace([]));
  const created = applyPlan(start, "r", {
    revision: revision(start.rooms[0]),
    title: "Retro",
    description: "I set up a retro board.",
    changes: ["Added a retro board"],
    operations: [
      { type: "add", object: { kind: "board", text: "Retro", color: "#d8cfc0", position: [0, 1.4, -4], notes: ["Went well", "To improve"] } },
    ],
  });
  const board = created.objects[0];
  assert.equal(board.physics, "fixed");
  const texts = board.board.elements.filter((e) => e.type === "text").map((e) => e.text);
  assert.deepEqual(texts, ["Retro", "Went well", "To improve"]);
  const next = schema.workspace({ ...start, rooms: [{ ...start.rooms[0], objects: created.objects }] });
  const added = applyPlan(next, "r", {
    revision: revision(next.rooms[0]),
    title: "Retro",
    description: "Added an idea.",
    changes: ["Added a note"],
    operations: [{ type: "update", id: board.id, fields: { notes: ["Try pairing"] } }],
  });
  const elements = added.objects[0].board.elements;
  assert.equal(elements.filter((e) => e.type === "text").length, 4);
  const newest = elements.at(-1);
  const lowest = Math.max(...board.board.elements.map((e) => e.y + e.height));
  assert.ok(newest.y > lowest, "new notes go below existing content");
});
