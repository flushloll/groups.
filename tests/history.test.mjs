import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
// Use the project's compiler so tests also run on Node builds without type stripping.
const source = readFileSync(
  new URL("../src/objectHistory.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const { replayEdit } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const before = {
  id: "note",
  kind: "note",
  text: "Original",
  position: [0, 1, 0],
  color: "#ffffff",
  assetId: "asset",
  assetRevision: 1,
};
const after = { ...before, text: "Edited" };
const record = { before: [before], after: [after] };

test("undo restores local content using its current asset revision", () => {
  const current = {
    position: [0, 1, 0],
    kind: "note",
    text: "Edited",
    id: "note",
    color: "#ffffff",
    physics: "fixed",
    assetId: "asset",
    assetRevision: 2,
  };
  const reversed = replayEdit([current], record, "undo");
  assert.equal(reversed[0].text, "Original");
  assert.equal(reversed[0].assetRevision, 2);
  const redone = replayEdit(
    [{ ...reversed[0], assetRevision: 3 }],
    record,
    "redo",
  );
  assert.equal(redone[0].text, "Edited");
  assert.equal(redone[0].assetRevision, 3);
});

test("undo retains unrelated objects added by another participant", () => {
  const remote = {
    ...before,
    id: "remote-object",
    text: "Someone else’s work",
  };
  const reversed = replayEdit(
    [{ ...after, assetRevision: 2 }, remote],
    record,
    "undo",
  );
  assert.deepEqual(reversed[1], remote);
});

test("undo refuses to overwrite a subsequent edit by another participant", () => {
  assert.throws(
    () =>
      replayEdit(
        [{ ...after, text: "Newer shared work", assetRevision: 3 }],
        record,
        "undo",
      ),
    /Someone changed/,
  );
});
