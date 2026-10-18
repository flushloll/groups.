import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomPhysics, STEP } from "../server/physics.mjs";
import { ROOM } from "../shared/catalog.mjs";

const prop = (id, physics, position, kind = "cube") => ({
  id,
  kind,
  physics,
  position,
  color: "#ffffff",
  scale: 1,
});
function advance(world, count, input) {
  for (let i = 0; i < count; i++) {
    if (input)
      world.input("player", { yaw: 0, jump: false, ...input }, i * STEP * 1000);
    world.step(i * STEP * 1000);
  }
}

test("Rapier applies gravity, settles props on the floor, and preserves their final transform", () => {
  const objects = [
    prop("falling", "dynamic", [2, 4, 0]),
    prop("anchored", "fixed", [-2, 4, 0]),
  ];
  const world = new RoomPhysics(objects);
  try {
    advance(world, 300);
    const state = world.snapshot().objects[0];
    assert.ok(Math.abs(state.position[1] - 0.65) < 0.02);
    assert.equal(world.objects.get("anchored").body.translation().y, 4);
    const saved = world.flushObjects(objects);
    assert.notEqual(saved, objects);
    assert.ok(saved[0].rotation.every(Number.isFinite));
    world.sync(saved);
    assert.equal(
      world.flushObjects(saved),
      saved,
      "Saving must not wake or recreate the body",
    );
    const restored = new RoomPhysics(saved);
    advance(restored, 30);
    assert.ok(
      Math.abs(restored.snapshot().objects[0].position[1] - 0.65) < 0.02,
    );
    restored.free();
  } finally {
    world.free();
  }
});

test("the capsule stops at solids and room edges while sensors and visual assets stay nonblocking", () => {
  for (const profile of ["fixed", "kinematic", "sensor", "none"]) {
    const world = new RoomPhysics([prop("barrier", profile, [0, 0.65, 0.8])]);
    try {
      world.addPlayer("player");
      advance(world, 100, { x: 0, z: -1 });
      const z = world.playerState("player").position[2];
      if (profile === "fixed" || profile === "kinematic")
        assert.ok(z > 1.75, `${profile}: ${z}`);
      else assert.ok(z < 0, `${profile}: ${z}`);
      advance(world, 300, { x: 1, z: 0 });
      assert.ok(world.playerState("player").position[0] < ROOM.halfX - 0.3);
    } finally {
      world.free();
    }
  }
});

test("movement is bounded, diagonal speed is normalized, stale input stops, and jumping returns to ground", () => {
  const world = new RoomPhysics();
  try {
    world.addPlayer("player");
    advance(world, 30);
    const start = world.playerState("player").position;
    advance(world, 30, { x: 1, z: -1 });
    const end = world.playerState("player").position;
    const straight = new RoomPhysics();
    straight.addPlayer("player");
    advance(straight, 30);
    const straightStart = straight.playerState("player").position;
    advance(straight, 30, { x: 1, z: 0 });
    const straightEnd = straight.playerState("player").position;
    const diagonalDistance = Math.hypot(end[0] - start[0], end[2] - start[2]);
    assert.ok(
      Math.abs(diagonalDistance - (straightEnd[0] - straightStart[0])) < 0.08,
    );
    assert.ok(diagonalDistance > 1.6 && diagonalDistance < 1.72);
    straight.free();
    assert.throws(
      () => world.input("player", { x: 100, z: 0, yaw: 0, jump: false }),
      /Invalid/,
    );
    const beforeStale = world.playerState("player").position;
    for (let i = 0; i < 40; i++) world.step(10000 + i * STEP * 1000);
    assert.ok(
      Math.abs(world.playerState("player").position[0] - beforeStale[0]) < 0.01,
    );
    world.input("player", { x: 0, z: 0, yaw: 0, jump: true }, 12000);
    world.step(12000);
    for (let i = 1; i < 20; i++) world.step(12000 + i * STEP * 1000);
    assert.ok(world.playerState("player").position[1] > 0.8);
    for (let i = 20; i < 120; i++) world.step(12000 + i * STEP * 1000);
    assert.ok(world.playerState("player").position[1] < 0.04);
    assert.equal(world.playerState("player").grounded, true);
  } finally {
    world.free();
  }
});

test("spawns avoid occupied capsules, physical props can be pushed, and worlds clean up independently", () => {
  const world = new RoomPhysics([prop("pushable", "dynamic", [0, 0.65, 0.8])]);
  const separate = new RoomPhysics();
  try {
    world.addPlayer("player");
    world.addPlayer("other");
    assert.notDeepEqual(
      world.playerState("player").position,
      world.playerState("other").position,
    );
    advance(world, 120, { x: 0, z: -1 });
    assert.ok(world.snapshot().objects[0].position[2] < 0.3);
    assert.equal(separate.snapshot().objects.length, 0);
    world.removePlayer("other");
    world.sync([]);
    assert.equal(world.snapshot().objects.length, 0);
    assert.equal(world.players.size, 1);
  } finally {
    world.free();
    separate.free();
  }
});

test("every catalog model builds colliders that rest at its catalog height", async () => {
  const { MODELS, restHeight } = await import("../shared/catalog.mjs");
  for (const [name, model] of Object.entries(MODELS)) {
    if (model.colliders?.length === 0 || name === "planet") continue;
    const object = {
      id: name,
      kind: "model",
      model: name,
      physics: "dynamic",
      position: [0, 4, 0],
      color: "#ffffff",
      scale: 1,
    };
    const world = new RoomPhysics([object]);
    try {
      for (let i = 0; i < 360; i++) world.step(i * STEP * 1000);
      const state = world.snapshot().objects[0];
      const upright = Math.abs(state.quaternion[3]) > 0.97;
      if (upright)
        assert.ok(
          Math.abs(state.position[1] - restHeight(object)) < 0.08,
          `${name} rests at ${state.position[1].toFixed(3)}, expected ${restHeight(object).toFixed(3)}`,
        );
      assert.ok(state.position[1] > 0 && state.position[1] < 4, name);
    } finally {
      world.free();
    }
  }
});

test("people walk through a doorway opening but not through a wall", () => {
  for (const [model, passes] of [
    ["doorway", true],
    ["wall", false],
  ]) {
    const world = new RoomPhysics([
      { id: model, kind: "model", model, physics: "fixed", position: [0, 0, 0], color: "#ffffff" },
    ]);
    try {
      world.addPlayer("player");
      advance(world, 30);
      advance(world, 120, { x: 0, z: -1 });
      const z = world.playerState("player").position[2];
      if (passes) assert.ok(z < -1, `${model}: ${z}`);
      else assert.ok(z > 0.2, `${model}: ${z}`);
    } finally {
      world.free();
    }
  }
});
