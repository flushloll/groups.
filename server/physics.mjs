import RAPIER from "@dimforge/rapier3d-compat";
import {
  MODELS,
  PANELS,
  PRIMITIVES,
  ROOM,
  objectSize,
  restHeight,
} from "../shared/catalog.mjs";

await RAPIER.init();
export const STEP = 1 / 60;
const HALF_PLAYER = 0.85;
const signature = (o) =>
  JSON.stringify([
    o.kind,
    o.model,
    o.position,
    o.rotation,
    o.scale,
    o.stretch,
    o.physics,
  ]);
const xyz = (v) => [v.x, v.y, v.z];
const quaternion = ([x, y, z] = [0, 0, 0]) => {
  const [a, b, c, d, e, f] = [
    Math.cos(x / 2),
    Math.sin(x / 2),
    Math.cos(y / 2),
    Math.sin(y / 2),
    Math.cos(z / 2),
    Math.sin(z / 2),
  ];
  return {
    x: b * c * e + a * d * f,
    y: a * d * e - b * c * f,
    z: a * c * f + b * d * e,
    w: a * c * e - b * d * f,
  };
};
function euler({ x, y, z, w }) {
  const m13 = 2 * (x * z + y * w);
  return Math.abs(m13) < 0.9999999
    ? [
        Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)),
        Math.asin(Math.max(-1, Math.min(1, m13))),
        Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z)),
      ]
    : [
        Math.atan2(2 * (y * z + x * w), 1 - 2 * (x * x + z * z)),
        Math.asin(Math.max(-1, Math.min(1, m13))),
        0,
      ];
}


const hull = (points) => RAPIER.ColliderDesc.convexHull(new Float32Array(points));
function ellipsoid([w, h, d], rings = 6, segments = 10) {
  const points = [0, h / 2, 0, 0, -h / 2, 0];
  for (let i = 1; i < rings; i++) {
    const phi = (i / rings) * Math.PI;
    for (let j = 0; j < segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      points.push(
        (Math.sin(phi) * Math.cos(theta) * w) / 2,
        (Math.cos(phi) * h) / 2,
        (Math.sin(phi) * Math.sin(theta) * d) / 2,
      );
    }
  }
  return points;
}
function tube([w, h, d], top = 1, segments = 12) {
  const points = [];
  for (let j = 0; j < segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    const x = (Math.cos(theta) * w) / 2;
    const z = (Math.sin(theta) * d) / 2;
    points.push(x, -h / 2, z);
    if (top > 0) points.push(x * top, h / 2, z * top);
  }
  if (top === 0) points.push(0, h / 2, 0);
  return points;
}
export function prismPoints([w, h, d]) {
  return [
    -w / 2, -h / 2, -d / 2, w / 2, -h / 2, -d / 2, 0, h / 2, -d / 2,
    -w / 2, -h / 2, d / 2, w / 2, -h / 2, d / 2, 0, h / 2, d / 2,
  ];
}
export function wedgePoints([w, h, d]) {
  return [
    -w / 2, -h / 2, -d / 2, w / 2, -h / 2, -d / 2, -w / 2, -h / 2, d / 2,
    w / 2, -h / 2, d / 2, -w / 2, h / 2, -d / 2, w / 2, h / 2, -d / 2,
  ];
}
const uniformXZ = ([x, , z]) => Math.abs(x - z) < 1e-6;
/** Collider descriptions in the body's local frame (origin at the object centre). */
function colliders(object) {
  const size = objectSize(object);
  const [w, h, d] = size;
  if (object.kind === "model") {
    const model = MODELS[object.model];
    if (!model) return [];
    const factor = size.map((value, axis) => value / model.size[axis]);
    const list = model.colliders || [
      { type: "box", p: [0, model.size[1] / 2, 0], s: model.size },
    ];
    return list.map((item) => {
      const at = [
        item.p[0] * factor[0],
        (item.p[1] - model.size[1] / 2) * factor[1],
        item.p[2] * factor[2],
      ];
      let shape;
      if (item.type === "box")
        shape = RAPIER.ColliderDesc.cuboid(
          ...item.s.map((value, axis) => (value * factor[axis]) / 2),
        );
      else if (item.type === "prism")
        shape = hull(prismPoints(item.s.map((v, i) => v * factor[i])));
      else if (item.type === "wedge")
        shape = hull(wedgePoints(item.s.map((v, i) => v * factor[i])));
      else if (item.type === "ball")
        shape = uniformXZ(factor) && Math.abs(factor[0] - factor[1]) < 1e-6
          ? RAPIER.ColliderDesc.ball(item.r * factor[0])
          : hull(ellipsoid([item.r * 2 * factor[0], item.r * 2 * factor[1], item.r * 2 * factor[2]]));
      else
        shape = uniformXZ(factor)
          ? RAPIER.ColliderDesc.cylinder((item.h * factor[1]) / 2, item.r * factor[0])
          : hull(tube([item.r * 2 * factor[0], item.h * factor[1], item.r * 2 * factor[2]]));
      return shape.setTranslation(...at);
    });
  }
  if (object.kind === "cube" || PANELS[object.kind])
    return [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)];
  if (object.kind === "sphere")
    return [
      Math.abs(w - h) < 1e-6 && Math.abs(w - d) < 1e-6
        ? RAPIER.ColliderDesc.ball(w / 2)
        : hull(ellipsoid(size)),
    ];
  if (object.kind === "cylinder")
    return [
      uniformXZ(size)
        ? RAPIER.ColliderDesc.cylinder(h / 2, w / 2)
        : hull(tube(size)),
    ];
  if (object.kind === "cone")
    return [
      uniformXZ(size)
        ? RAPIER.ColliderDesc.cone(h / 2, w / 2)
        : hull(tube(size, 0)),
    ];
  if (object.kind === "pyramid") {
    // Matches Three's four-sided cone with its local 45-degree rotation.
    const [x, z] = [w / 2, d / 2];
    return [
      hull([0, h / 2, 0, -x, -h / 2, -z, x, -h / 2, -z, x, -h / 2, z, -x, -h / 2, z]),
    ];
  }
  return PRIMITIVES[object.kind] ? [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)] : [];
}

/** One authoritative world per occupied room. No model or client supplies code or velocity. */
export class RoomPhysics {
  constructor(objects = []) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.objects = new Map();
    this.players = new Map();
    this.tick = 0;
    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.22, 0.2, false);
    this.controller.enableSnapToGround(0.25);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(25);
    // All four edges contain the playable room, including the open diorama sides.
    const { halfX: X, halfZ: Z } = ROOM;
    for (const [half, at] of [
      [
        [X, 0.25, Z],
        [0, -0.25, 0],
      ],
      [
        [0.15, 15, Z + 0.15],
        [-X - 0.15, 14, 0],
      ],
      [
        [0.15, 15, Z + 0.15],
        [X + 0.15, 14, 0],
      ],
      [
        [X, 15, 0.15],
        [0, 14, -Z - 0.15],
      ],
      [
        [X, 15, 0.15],
        [0, 14, Z + 0.15],
      ],
    ])
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(...half)
          .setTranslation(...at)
          .setFriction(0.8),
      );
    this.sync(objects);
    this.world.step();
  }

  sync(objects) {
    const ids = new Set(objects.map((o) => o.id));
    for (const [id, item] of this.objects)
      if (!ids.has(id)) {
        this.world.removeRigidBody(item.body);
        this.objects.delete(id);
      }
    for (const object of objects) {
      const key = signature(object);
      const old = this.objects.get(object.id);
      if (old?.key === key) continue;
      if (old) this.world.removeRigidBody(old.body);
      this.objects.delete(object.id);
      const profile = object.physics || "fixed";
      if (profile === "none" || object.kind === "stroke") continue;
      const shapes = colliders(object);
      if (!shapes.length) continue;
      const desc =
        profile === "dynamic"
          ? RAPIER.RigidBodyDesc.dynamic()
              .setCcdEnabled(true)
              .setLinearDamping(0.3)
              .setAngularDamping(0.5)
          : profile === "kinematic"
            ? RAPIER.RigidBodyDesc.kinematicPositionBased()
            : RAPIER.RigidBodyDesc.fixed();
      const [x, y, z] = object.position;
      const limitX = ROOM.halfX - 0.5;
      const limitZ = ROOM.halfZ - 0.5;
      const body = this.world.createRigidBody(
        desc
          .setTranslation(
            profile === "dynamic" ? Math.max(-limitX, Math.min(limitX, x)) : x,
            y === 0 ? restHeight(object) : y,
            profile === "dynamic" ? Math.max(-limitZ, Math.min(limitZ, z)) : z,
          )
          .setRotation(quaternion(object.rotation)),
      );
      for (const shape of shapes)
        this.world.createCollider(
          shape
            .setFriction(0.65)
            .setRestitution(0.2)
            .setSensor(profile === "sensor"),
          body,
        );
      this.objects.set(object.id, { body, key, profile });
    }
  }

  addPlayer(id, canPush = true) {
    // Test the full capsule, so a newly built object cannot occupy the spawn point.
    const shape = new RAPIER.Capsule(0.53, 0.32);
    let at = { x: 0, y: HALF_PLAYER + 0.05, z: 3 };
    let found = false;
    const spanX = ROOM.halfX - 1;
    for (const y of [0.9, 2.9, 5, 10, 22]) {
      for (let z = 3; z >= -(ROOM.halfZ - 1); z -= 1.2) {
        for (let x = 0; x <= spanX * 2; x += 1.2) {
          const candidate = { x: x <= spanX ? x : spanX - x, y, z };
          let blocked = false;
          this.world.intersectionsWithShape(
            candidate,
            { x: 0, y: 0, z: 0, w: 1 },
            shape,
            () => {
              blocked = true;
              return false;
            },
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          );
          if (!blocked) {
            at = candidate;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        at.x,
        at.y,
        at.z,
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.53, 0.32),
      body,
    );
    this.players.set(id, {
      body,
      collider,
      canPush,
      vertical: 0,
      grounded: false,
      input: { x: 0, z: 0, yaw: 0 },
      lastInput: 0,
      jumpHeld: false,
      jump: false,
    });
    this.world.step();
    return this.playerState(id);
  }
  removePlayer(id) {
    const player = this.players.get(id);
    if (player) this.world.removeRigidBody(player.body);
    this.players.delete(id);
  }
  input(id, value, now = Date.now()) {
    if (
      !value ||
      ![value.x, value.z, value.yaw].every(Number.isFinite) ||
      Math.abs(value.x) > 1 ||
      Math.abs(value.z) > 1 ||
      Math.abs(value.yaw) > Math.PI * 2 ||
      typeof value.jump !== "boolean"
    )
      throw new Error("Invalid movement input.");
    const player = this.players.get(id);
    if (!player) return;
    player.jump ||= value.jump && !player.jumpHeld;
    player.jumpHeld = value.jump;
    player.input = { x: value.x, z: value.z, yaw: value.yaw };
    player.lastInput = now;
  }
  step(now = Date.now()) {
    for (const player of this.players.values()) {
      this.controller.setApplyImpulsesToDynamicBodies(player.canPush);
      const input =
        now - player.lastInput < 300 ? player.input : { x: 0, z: 0 };
      const norm = Math.max(1, Math.hypot(input.x, input.z));
      if (player.jump && player.grounded) player.vertical = 4.8;
      player.jump = false;
      player.vertical = Math.max(-20, player.vertical - 9.81 * STEP);
      const desired = {
        x: (input.x / norm) * 3.4 * STEP,
        y: player.vertical * STEP,
        z: (input.z / norm) * 3.4 * STEP,
      };
      this.controller.computeColliderMovement(
        player.collider,
        desired,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      let movement = this.controller.computedMovement();
      // Resting contact with the floor occasionally swallows a whole step of
      // horizontal motion; retry without the downward component.
      const wanted = Math.hypot(desired.x, desired.z);
      if (
        player.grounded &&
        wanted > 0 &&
        Math.hypot(movement.x, movement.z) < wanted * 0.1
      ) {
        this.controller.computeColliderMovement(
          player.collider,
          { ...desired, y: 0 },
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        movement = this.controller.computedMovement();
      }
      player.grounded = this.controller.computedGrounded();
      if (player.grounded && player.vertical < 0) player.vertical = 0;
      if (player.vertical > 0 && movement.y < player.vertical * STEP - 0.001)
        player.vertical = 0;
      const p = player.body.translation();
      player.body.setNextKinematicTranslation({
        x: p.x + movement.x,
        y: p.y + movement.y,
        z: p.z + movement.z,
      });
    }
    this.world.step();
    for (const item of this.objects.values())
      if (item.profile === "dynamic") {
        const at = item.body.translation();
        if (
          ![at.x, at.y, at.z].every(Number.isFinite) ||
          at.y < -5 ||
          at.y > 35 ||
          Math.abs(at.x) > ROOM.halfX + 2 ||
          Math.abs(at.z) > ROOM.halfZ + 2
        ) {
          item.body.setTranslation({ x: 0, y: 3, z: 0 }, true);
          item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    this.tick++;
  }
  playerState(id) {
    const p = this.players.get(id);
    const at = p.body.translation();
    return {
      id,
      position: [at.x, at.y - HALF_PLAYER, at.z],
      yaw: p.input.yaw,
      grounded: p.grounded,
    };
  }
  snapshot() {
    return {
      tick: this.tick,
      players: [...this.players.keys()].map((id) => this.playerState(id)),
      objects: [...this.objects]
        .filter(([, o]) => o.profile === "dynamic")
        .map(([id, o]) => {
          const q = o.body.rotation();
          return {
            id,
            position: xyz(o.body.translation()),
            quaternion: [q.x, q.y, q.z, q.w],
          };
        }),
    };
  }
  flushObjects(objects) {
    let changed = false;
    const next = objects.map((object) => {
      const item = this.objects.get(object.id);
      if (!item || item.profile !== "dynamic" || item.key !== signature(object))
        return object;
      const position = xyz(item.body.translation());
      const rotation = euler(item.body.rotation());
      if (
        position.every((n, i) => Math.abs(n - object.position[i]) < 0.002) &&
        rotation.every(
          (n, i) => Math.abs(n - (object.rotation?.[i] || 0)) < 0.002,
        )
      )
        return object;
      changed = true;
      const result = { ...object, position, rotation };
      item.key = signature(result);
      return result;
    });
    return changed ? next : objects;
  }
  free() {
    this.world.free();
  }
}
