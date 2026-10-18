// Shared spatial vocabulary for the renderer, the physics service and Luna.
// Everything is plain data so that the browser, Node and the model prompt agree
// on what an object is, how large it is and how it collides.
//
// Units are metres. A player is about 1.7 m tall. Part positions are measured
// from the model's bottom centre; an instance's position is its centre, so a
// model resting on the floor has y = size[1] / 2 (times scale and stretch).

export const ROOM = { halfX: 10, halfZ: 8, wallHeight: 5 };

export const PRIMITIVES = {
  cube: { label: "Cube", size: [1.3, 1.3, 1.3] },
  sphere: { label: "Sphere", size: [1.44, 1.44, 1.44] },
  pyramid: { label: "Pyramid", size: [1.34, 1.65, 1.34] },
  cylinder: { label: "Cylinder", size: [1.2, 1.5, 1.2] },
  cone: { label: "Cone", size: [1.3, 1.6, 1.3] },
};

export const PANELS = {
  text: { label: "Text panel", size: [2.5, 1.25, 0.045] },
  note: { label: "Sticky note", size: [1.85, 1.55, 0.045] },
  image: { label: "Image", size: [1.85, 1.55, 0.045] },
  board: { label: "Board", size: [3.2, 2, 0.06] },
};

const WOOD = "#a07a55";
const DARK_WOOD = "#6f5440";
const LEAF = "#7fa070";
const STONE = "#a9a6a0";
const METAL = "#8d939b";
const CREAM = "#f3ede1";
const GLASS = "#bcd8e6";
const INK = "#2f333a";

// Part shorthands. c is a colour or a role: "$" (instance colour), "$dark", "$light".
const box = (p, s, c = "$", extra = {}) => ({ g: "box", p, s, c, ...extra });
const cyl = (p, r, h, c = "$", extra = {}) => ({ g: "cyl", p, r, h, c, ...extra });
const ball = (p, r, c = "$", extra = {}) => ({ g: "sphere", p, r, c, ...extra });
const cone = (p, r, h, c = "$", extra = {}) => ({ g: "cone", p, r, h, c, ...extra });
const ico = (p, r, c = "$", extra = {}) => ({ g: "ico", p, r, c, ...extra });
const dodeca = (p, r, c = "$", extra = {}) => ({ g: "dodeca", p, r, c, ...extra });
const torus = (p, r, t, c = "$", extra = {}) => ({ g: "torus", p, r, t, c, ...extra });
const capsule = (p, r, h, c = "$", extra = {}) => ({ g: "capsule", p, r, h, c, ...extra });
const prism = (p, s, c = "$", extra = {}) => ({ g: "prism", p, s, c, ...extra });
const wedge = (p, s, c = "$", extra = {}) => ({ g: "wedge", p, s, c, ...extra });
const star = (p, r, t, c = "$", extra = {}) => ({ g: "star", p, r, t, c, ...extra });

const legs = (w, d, h, t, c = "$dark") =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => box([(x * (w - t)) / 2, h / 2, (z * (d - t)) / 2], [t, h, t], c));
const ring = (count, radius, make) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return make(Math.cos(a) * radius, Math.sin(a) * radius, a, i);
  });

/**
 * physics: default profile when a person adds the model.
 * colliders: optional list; defaults to one box of the full size.
 * surface: optional text surface {p, w, h} facing +z where the instance text is drawn.
 */
export const MODELS = {
  // Nature
  tree: {
    label: "Tree",
    category: "nature",
    color: LEAF,
    size: [1.8, 3.4, 1.8],
    colliders: [{ type: "cyl", p: [0, 0.8, 0], r: 0.2, h: 1.6 }],
    parts: [
      cyl([0, 0.75, 0], 0.15, 1.5, WOOD, { r2: 0.19 }),
      ico([0, 2.15, 0], 0.85),
      ico([0.25, 2.8, 0.1], 0.55, "$light"),
      ico([-0.35, 2.55, -0.2], 0.5, "$dark"),
    ],
  },
  pine: {
    label: "Pine tree",
    category: "nature",
    color: "#5e8a66",
    size: [1.5, 3.6, 1.5],
    colliders: [{ type: "cyl", p: [0, 0.6, 0], r: 0.18, h: 1.2 }],
    parts: [
      cyl([0, 0.4, 0], 0.13, 0.8, DARK_WOOD),
      cone([0, 1.35, 0], 0.75, 1.3, "$", { seg: 7 }),
      cone([0, 2.1, 0], 0.58, 1.15, "$light", { seg: 7 }),
      cone([0, 2.9, 0], 0.4, 1.0, "$", { seg: 7 }),
    ],
  },
  palm: {
    label: "Palm tree",
    category: "nature",
    color: "#6f9b5c",
    size: [2.4, 3.7, 2.4],
    colliders: [{ type: "cyl", p: [0, 1.5, 0], r: 0.18, h: 3 }],
    parts: [
      cyl([0, 0.5, 0], 0.16, 1, "#b08b62", { r2: 0.19 }),
      cyl([0.04, 1.45, 0], 0.14, 1, "#a8835a", { r2: 0.16, rot: [0, 0, -0.06] }),
      cyl([0.12, 2.4, 0], 0.12, 1, "#b08b62", { r2: 0.14, rot: [0, 0, -0.1] }),
      cyl([0.2, 3.15, 0], 0.11, 0.6, "#a8835a", { r2: 0.12, rot: [0, 0, -0.12] }),
      ...ring(6, 0.55, (x, z, a) =>
        box([0.22 + x, 3.35, z], [1.15, 0.04, 0.32], a % 2 ? "$" : "$light", { rot: [0, -a, -0.38] }),
      ),
      ball([0.22, 3.42, 0], 0.13, "#7a5a3a"),
    ],
  },
  bush: {
    label: "Bush",
    category: "nature",
    color: "#7aa36d",
    size: [1.3, 0.9, 1.2],
    parts: [
      ico([0, 0.42, 0], 0.48, "$", { k: [1.25, 0.85, 1.1] }),
      ico([0.32, 0.5, 0.12], 0.32, "$light"),
      ico([-0.3, 0.45, -0.1], 0.3, "$dark"),
    ],
  },
  flower: {
    label: "Flower",
    category: "nature",
    color: "#e597a8",
    physics: "none",
    size: [0.36, 0.7, 0.36],
    parts: [
      cyl([0, 0.28, 0], 0.018, 0.56, "#6d9a5a"),
      box([0.07, 0.25, 0], [0.14, 0.02, 0.06], "#7fae69", { rot: [0, 0, 0.5] }),
      ball([0, 0.6, 0], 0.06, "#f1cf62"),
      ...ring(6, 0.085, (x, z) => ball([x, 0.6, z], 0.065, "$", { k: [1, 0.55, 1] })),
    ],
  },
  grass: {
    label: "Grass tuft",
    category: "nature",
    color: "#86ad6a",
    physics: "none",
    size: [0.5, 0.45, 0.5],
    parts: ring(7, 0.12, (x, z, a, i) =>
      cone([x, 0.2, z], 0.05, 0.4 + (i % 3) * 0.05, i % 2 ? "$" : "$light", { seg: 4, rot: [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3] }),
    ),
  },
  rock: {
    label: "Rock",
    category: "nature",
    color: STONE,
    size: [1, 0.62, 0.86],
    parts: [
      dodeca([0, 0.31, 0], 0.5, "$", { k: [1, 0.62, 0.86] }),
      dodeca([0.36, 0.14, 0.24], 0.17, "$dark"),
    ],
  },
  mushroom: {
    label: "Mushroom",
    category: "nature",
    color: "#d0574a",
    size: [0.62, 0.66, 0.62],
    parts: [
      cyl([0, 0.22, 0], 0.08, 0.44, CREAM, { r2: 0.1 }),
      ball([0, 0.46, 0], 0.31, "$", { k: [1, 0.6, 1] }),
      ball([0.14, 0.6, 0.12], 0.05, "#fff9ef"),
      ball([-0.12, 0.62, 0.02], 0.04, "#fff9ef"),
      ball([0.02, 0.6, -0.16], 0.045, "#fff9ef"),
    ],
  },
  cactus: {
    label: "Cactus",
    category: "nature",
    color: "#6e9d63",
    size: [0.9, 1.7, 0.45],
    colliders: [{ type: "cyl", p: [0, 0.85, 0], r: 0.22, h: 1.7 }],
    parts: [
      capsule([0, 0.82, 0], 0.2, 1.24),
      capsule([0.33, 1.0, 0], 0.11, 0.36, "$light"),
      cyl([0.2, 0.84, 0], 0.08, 0.2, "$light", { rot: [0, 0, Math.PI / 2] }),
      capsule([-0.32, 1.22, 0], 0.1, 0.3),
      cyl([-0.2, 1.06, 0], 0.07, 0.2, "$", { rot: [0, 0, Math.PI / 2] }),
    ],
  },
  log: {
    label: "Log",
    category: "nature",
    color: WOOD,
    physics: "dynamic",
    size: [1.6, 0.44, 0.44],
    parts: [
      cyl([0, 0.22, 0], 0.22, 1.6, "$", { rot: [0, 0, Math.PI / 2], seg: 10 }),
      cyl([0.801, 0.22, 0], 0.18, 0.01, "#d6b68c", { rot: [0, 0, Math.PI / 2], seg: 10 }),
    ],
  },
  stump: {
    label: "Tree stump",
    category: "nature",
    color: WOOD,
    size: [0.72, 0.5, 0.72],
    parts: [
      cyl([0, 0.25, 0], 0.32, 0.5, "$", { r2: 0.36, seg: 10 }),
      cyl([0, 0.505, 0], 0.28, 0.01, "#d6b68c", { seg: 10 }),
    ],
  },
  pond: {
    label: "Pond",
    category: "nature",
    color: "#8db9cf",
    physics: "none",
    size: [2.6, 0.08, 1.9],
    colliders: [],
    parts: [
      cyl([0, 0.02, 0], 1.3, 0.04, STONE, { k: [1, 1, 0.73], seg: 14 }),
      cyl([0, 0.05, 0], 1.18, 0.03, "$", { k: [1, 1, 0.72], seg: 14 }),
    ],
  },
  // Furniture
  chair: {
    label: "Chair",
    category: "furniture",
    color: "#b98d62",
    physics: "dynamic",
    size: [0.5, 0.95, 0.5],
    parts: [
      box([0, 0.46, 0], [0.5, 0.06, 0.5]),
      ...legs(0.5, 0.5, 0.43, 0.05),
      box([0, 0.73, -0.225], [0.5, 0.46, 0.05]),
    ],
  },
  armchair: {
    label: "Armchair",
    category: "furniture",
    color: "#c58f74",
    size: [0.95, 0.9, 0.9],
    parts: [
      box([0, 0.22, 0], [0.95, 0.36, 0.88]),
      box([0, 0.45, 0.06], [0.66, 0.12, 0.66], "$light"),
      box([0, 0.64, -0.34], [0.95, 0.52, 0.2]),
      box([-0.4, 0.52, 0.04], [0.15, 0.24, 0.8]),
      box([0.4, 0.52, 0.04], [0.15, 0.24, 0.8]),
      ...legs(0.85, 0.8, 0.06, 0.06, DARK_WOOD),
    ],
  },
  sofa: {
    label: "Sofa",
    category: "furniture",
    color: "#8fa3b8",
    size: [2.1, 0.86, 0.92],
    parts: [
      box([0, 0.24, 0], [2.1, 0.36, 0.9]),
      box([-0.46, 0.47, 0.07], [0.88, 0.14, 0.64], "$light"),
      box([0.46, 0.47, 0.07], [0.88, 0.14, 0.64], "$light"),
      box([0, 0.62, -0.35], [2.1, 0.48, 0.2]),
      box([-0.96, 0.53, 0.02], [0.18, 0.26, 0.86]),
      box([0.96, 0.53, 0.02], [0.18, 0.26, 0.86]),
      ...legs(2, 0.82, 0.06, 0.06, DARK_WOOD),
    ],
  },
  table: {
    label: "Table",
    category: "furniture",
    color: "#c19a6b",
    size: [1.6, 0.76, 0.9],
    surface: { p: [0, 0.762, 0], w: 1.3, h: 0.6, flat: true },
    parts: [box([0, 0.73, 0], [1.6, 0.06, 0.9]), ...legs(1.5, 0.8, 0.7, 0.07)],
  },
  round_table: {
    label: "Round table",
    category: "furniture",
    color: "#c19a6b",
    size: [1.1, 0.76, 1.1],
    parts: [
      cyl([0, 0.735, 0], 0.55, 0.05, "$", { seg: 24 }),
      cyl([0, 0.36, 0], 0.06, 0.7, "$dark"),
      cyl([0, 0.02, 0], 0.3, 0.04, "$dark", { seg: 18 }),
    ],
  },
  coffee_table: {
    label: "Coffee table",
    category: "furniture",
    color: "#a8835e",
    size: [1.1, 0.42, 0.6],
    parts: [
      box([0, 0.39, 0], [1.1, 0.06, 0.6]),
      box([0, 0.12, 0], [1, 0.03, 0.5], "$light"),
      ...legs(1.04, 0.54, 0.36, 0.05, "$dark"),
    ],
  },
  desk: {
    label: "Desk",
    category: "furniture",
    color: "#d2b48c",
    size: [1.4, 0.76, 0.7],
    parts: [
      box([0, 0.735, 0], [1.4, 0.05, 0.7]),
      box([-0.48, 0.355, 0], [0.42, 0.71, 0.66], "$dark"),
      box([-0.48, 0.55, 0.335], [0.34, 0.2, 0.01], "$light"),
      box([-0.48, 0.25, 0.335], [0.34, 0.3, 0.01], "$light"),
      box([0.66, 0.355, 0.3], [0.05, 0.71, 0.05], "$dark"),
      box([0.66, 0.355, -0.3], [0.05, 0.71, 0.05], "$dark"),
    ],
  },
  stool: {
    label: "Stool",
    category: "furniture",
    color: "#b98d62",
    physics: "dynamic",
    size: [0.4, 0.65, 0.4],
    parts: [cyl([0, 0.625, 0], 0.2, 0.05, "$", { seg: 16 }), ...legs(0.32, 0.32, 0.6, 0.04, "$dark")],
  },
  bench: {
    label: "Bench",
    category: "furniture",
    color: "#a58059",
    size: [1.6, 0.5, 0.45],
    parts: [
      box([0, 0.455, 0], [1.6, 0.07, 0.45]),
      box([-0.65, 0.21, 0], [0.08, 0.42, 0.4], "$dark"),
      box([0.65, 0.21, 0], [0.08, 0.42, 0.4], "$dark"),
    ],
  },
  bed: {
    label: "Bed",
    category: "furniture",
    color: "#9fb4c8",
    size: [1.5, 0.95, 2.12],
    parts: [
      box([0, 0.15, 0], [1.5, 0.3, 2.1], WOOD),
      box([0, 0.4, 0.02], [1.4, 0.2, 2], "#f6f3ec"),
      box([0, 0.55, -0.74], [0.9, 0.1, 0.36], "#ffffff"),
      box([0, 0.51, 0.38], [1.42, 0.06, 1.24]),
      box([0, 0.47, -1.02], [1.5, 0.94, 0.08], WOOD),
    ],
  },
  bookshelf: {
    label: "Bookshelf",
    category: "furniture",
    color: "#a07a55",
    size: [1.2, 1.9, 0.4],
    parts: [
      box([-0.575, 0.95, 0], [0.05, 1.9, 0.4]),
      box([0.575, 0.95, 0], [0.05, 1.9, 0.4]),
      box([0, 0.95, -0.19], [1.2, 1.9, 0.02], "$dark"),
      ...[0.02, 0.48, 0.94, 1.4, 1.88].map((y) => box([0, y, 0], [1.1, 0.04, 0.38])),
      ...[0.04, 0.5, 0.96].flatMap((y, row) =>
        [
          [-0.42, 0.11, 0.3, "#c86f5a"],
          [-0.3, 0.09, 0.34, "#5f7fa3"],
          [-0.2, 0.08, 0.28, "#e0b65a"],
          [-0.08, 0.12, 0.36, "#6f9b74"],
          [0.12, 0.1, 0.31, "#8f6fa8"],
          [0.24, 0.07, 0.27, "#d98a5f"],
          [0.38, 0.12, 0.33, "#4d6a7a"],
        ]
          .filter((_, i) => (i + row) % 4 !== 3)
          .map(([x, w, h, c]) => box([x + row * 0.03, y + h / 2, 0.02], [w, h, 0.26], c)),
      ),
    ],
  },
  cabinet: {
    label: "Cabinet",
    category: "furniture",
    color: "#cbb79c",
    size: [1, 0.9, 0.5],
    parts: [
      box([0, 0.46, 0], [1, 0.84, 0.5]),
      box([0, 0.885, 0], [1.04, 0.03, 0.54], "$dark"),
      box([-0.25, 0.46, 0.252], [0.46, 0.74, 0.01], "$light"),
      box([0.25, 0.46, 0.252], [0.46, 0.74, 0.01], "$light"),
      box([-0.05, 0.5, 0.265], [0.02, 0.14, 0.02], METAL),
      box([0.05, 0.5, 0.265], [0.02, 0.14, 0.02], METAL),
      ...legs(0.9, 0.42, 0.04, 0.05, "$dark"),
    ],
  },
  floor_lamp: {
    label: "Floor lamp",
    category: "furniture",
    color: "#f2e3c4",
    size: [0.45, 1.75, 0.45],
    colliders: [{ type: "cyl", p: [0, 0.875, 0], r: 0.18, h: 1.75 }],
    parts: [
      cyl([0, 0.02, 0], 0.18, 0.04, INK, { seg: 18 }),
      cyl([0, 0.78, 0], 0.018, 1.5, INK),
      cyl([0, 1.58, 0], 0.13, 0.32, "$", { r2: 0.22, seg: 18, glow: 0.7 }),
    ],
  },
  desk_lamp: {
    label: "Desk lamp",
    category: "furniture",
    color: "#e7c35c",
    physics: "dynamic",
    size: [0.3, 0.5, 0.3],
    parts: [
      cyl([0, 0.015, 0], 0.11, 0.03, INK, { seg: 16 }),
      cyl([0, 0.2, -0.04], 0.012, 0.38, INK, { rot: [0.2, 0, 0] }),
      cyl([0, 0.4, 0.04], 0.05, 0.14, "$", { r2: 0.1, rot: [0.8, 0, 0], glow: 0.45 }),
    ],
  },
  potted_plant: {
    label: "Potted plant",
    category: "furniture",
    color: "#76a26a",
    physics: "dynamic",
    size: [0.55, 1.05, 0.55],
    parts: [
      cyl([0, 0.18, 0], 0.21, 0.36, "#c7714f", { r2: 0.16, seg: 14 }),
      cyl([0, 0.355, 0], 0.19, 0.02, "#5c4434", { seg: 14 }),
      ico([0, 0.62, 0], 0.26),
      ico([0.12, 0.84, 0.05], 0.18, "$light"),
      ico([-0.12, 0.78, -0.06], 0.16, "$dark"),
    ],
  },
  rug: {
    label: "Rug",
    category: "furniture",
    color: "#d9a88f",
    physics: "none",
    size: [2.4, 0.02, 1.6],
    colliders: [],
    parts: [box([0, 0.008, 0], [2.4, 0.016, 1.6]), box([0, 0.012, 0], [2.0, 0.016, 1.2], "$light")],
  },
  round_rug: {
    label: "Round rug",
    category: "furniture",
    color: "#a9b8a0",
    physics: "none",
    size: [2, 0.02, 2],
    colliders: [],
    parts: [cyl([0, 0.008, 0], 1, 0.016, "$", { seg: 32 }), cyl([0, 0.012, 0], 0.78, 0.016, "$light", { seg: 32 })],
  },
  // Work and creative surfaces. Instance text appears on their surface.
  whiteboard: {
    label: "Whiteboard",
    category: "work",
    color: "#9aa0a8",
    size: [1.9, 1.95, 0.5],
    surface: { p: [0, 1.32, 0.026], w: 1.74, h: 1.04 },
    parts: [
      box([0, 1.32, 0], [1.86, 1.12, 0.05]),
      box([0, 1.32, 0.005], [1.78, 1.06, 0.045], "#ffffff"),
      box([-0.88, 0.67, 0], [0.05, 1.34, 0.05]),
      box([0.88, 0.67, 0], [0.05, 1.34, 0.05]),
      box([-0.88, 0.02, 0], [0.06, 0.04, 0.5], INK),
      box([0.88, 0.02, 0], [0.06, 0.04, 0.5], INK),
      box([0, 0.74, 0.05], [1.5, 0.03, 0.08]),
    ],
  },
  easel: {
    label: "Easel",
    category: "work",
    color: "#b4885c",
    size: [0.8, 1.75, 0.65],
    surface: { p: [0, 1.15, 0.045], w: 0.64, h: 0.84, rot: [-0.12, 0, 0] },
    parts: [
      box([-0.28, 0.85, 0.08], [0.05, 1.72, 0.05], "$", { rot: [-0.12, 0, 0.14] }),
      box([0.28, 0.85, 0.08], [0.05, 1.72, 0.05], "$", { rot: [-0.12, 0, -0.14] }),
      box([0, 0.8, -0.18], [0.05, 1.62, 0.05], "$", { rot: [0.32, 0, 0] }),
      box([0, 0.68, 0.17], [0.7, 0.04, 0.08], "$dark"),
      box([0, 1.15, 0.02], [0.72, 0.92, 0.04], "#fbf8f1", { rot: [-0.12, 0, 0] }),
    ],
  },
  screen: {
    label: "Display screen",
    category: "work",
    color: "#6d8fb5",
    size: [1.7, 1.55, 0.45],
    surface: { p: [0, 1.05, 0.036], w: 1.56, h: 0.86, light: true },
    parts: [
      box([0, 0.02, 0], [0.6, 0.04, 0.45], INK),
      box([0, 0.38, -0.05], [0.08, 0.72, 0.06], INK),
      box([0, 1.05, 0], [1.7, 0.98, 0.07], INK),
      box([0, 1.05, 0.032], [1.58, 0.88, 0.01], "$", { glow: 0.55 }),
    ],
  },
  monitor: {
    label: "Monitor",
    category: "work",
    color: "#7aa0c7",
    physics: "dynamic",
    size: [0.62, 0.48, 0.2],
    surface: { p: [0, 0.3, 0.021], w: 0.56, h: 0.3, light: true },
    parts: [
      box([0, 0.01, 0], [0.24, 0.02, 0.18], INK),
      box([0, 0.1, -0.03], [0.04, 0.18, 0.03], INK),
      box([0, 0.3, 0], [0.62, 0.36, 0.035], INK),
      box([0, 0.3, 0.018], [0.57, 0.31, 0.005], "$", { glow: 0.5 }),
    ],
  },
  laptop: {
    label: "Laptop",
    category: "work",
    color: "#c9ced6",
    physics: "dynamic",
    size: [0.36, 0.24, 0.3],
    parts: [
      box([0, 0.01, 0.03], [0.36, 0.02, 0.24]),
      box([0, 0.13, -0.1], [0.36, 0.23, 0.012], "$", { rot: [-0.3, 0, 0] }),
      box([0, 0.13, -0.093], [0.32, 0.19, 0.004], "#4f6d8f", { rot: [-0.3, 0, 0], glow: 0.45 }),
    ],
  },
  podium: {
    label: "Podium",
    category: "work",
    color: "#8a6a52",
    size: [0.7, 1.15, 0.55],
    parts: [
      box([0, 0.5, 0], [0.62, 1, 0.48]),
      wedge([0, 1.07, 0], [0.7, 0.14, 0.55], "$dark"),
      box([0, 0.03, 0], [0.7, 0.06, 0.55], "$dark"),
    ],
  },
  signpost: {
    label: "Signpost",
    category: "work",
    color: "#e0b25f",
    size: [1, 1.9, 0.12],
    colliders: [{ type: "cyl", p: [0, 0.95, 0], r: 0.06, h: 1.9 }],
    surface: { p: [0, 1.58, 0.026], w: 0.9, h: 0.38 },
    parts: [
      cyl([0, 0.95, -0.04], 0.04, 1.9, WOOD),
      box([0, 1.58, 0], [1, 0.46, 0.05]),
    ],
  },
  books: {
    label: "Stack of books",
    category: "work",
    color: "#c86f5a",
    physics: "dynamic",
    size: [0.32, 0.18, 0.24],
    parts: [
      box([0, 0.03, 0], [0.32, 0.06, 0.24]),
      box([0.01, 0.09, 0], [0.28, 0.06, 0.22], "#5f7fa3", { rot: [0, 0.12, 0] }),
      box([-0.01, 0.15, 0], [0.26, 0.06, 0.2], "#e0b65a", { rot: [0, -0.08, 0] }),
    ],
  },
  mug: {
    label: "Mug",
    category: "work",
    color: "#e8e1d4",
    physics: "dynamic",
    size: [0.14, 0.12, 0.1],
    parts: [
      cyl([0, 0.06, 0], 0.045, 0.12, "$", { seg: 14 }),
      torus([0.05, 0.06, 0], 0.028, 0.008, "$", { rot: [0, 0, 0] }),
      cyl([0, 0.115, 0], 0.04, 0.005, "#6b4a35", { seg: 14 }),
    ],
  },
  globe: {
    label: "Globe",
    category: "work",
    color: "#6fa3c4",
    physics: "dynamic",
    size: [0.4, 0.52, 0.4],
    parts: [
      cyl([0, 0.015, 0], 0.13, 0.03, WOOD, { seg: 14 }),
      cyl([0, 0.07, 0], 0.02, 0.1, WOOD),
      ball([0, 0.3, 0], 0.17, "$", { seg: 14, anim: "spin" }),
      ico([0.06, 0.36, 0.09], 0.07, "#8fb06b", { anim: "spin", k: [1, 0.6, 0.5] }),
      torus([0, 0.3, 0], 0.19, 0.008, "#c7a35a", { rot: [0, Math.PI / 2, 0.4] }),
    ],
  },
  wall_clock: {
    label: "Wall clock",
    category: "work",
    color: "#f4efe6",
    size: [0.5, 0.5, 0.06],
    parts: [
      cyl([0, 0.25, 0], 0.25, 0.05, INK, { rot: [Math.PI / 2, 0, 0], seg: 28 }),
      cyl([0, 0.25, 0.015], 0.22, 0.03, "$", { rot: [Math.PI / 2, 0, 0], seg: 28 }),
      box([0, 0.31, 0.034], [0.015, 0.13, 0.005], INK),
      box([0.05, 0.25, 0.036], [0.1, 0.012, 0.005], INK),
    ],
  },
  piano: {
    label: "Piano",
    category: "work",
    color: "#2e2b2f",
    size: [1.5, 1.2, 0.62],
    parts: [
      box([0, 0.75, -0.12], [1.5, 0.9, 0.38]),
      box([0, 0.72, 0.13], [1.5, 0.06, 0.34]),
      box([0, 0.76, 0.17], [1.4, 0.02, 0.24], "#f7f4ee"),
      ...Array.from({ length: 10 }, (_, i) =>
        box([-0.63 + i * 0.14 + (i % 3 === 2 ? 0.07 : 0), 0.785, 0.12], [0.05, 0.03, 0.13], "#1c1a1d"),
      ),
      box([-0.71, 0.36, 0.13], [0.06, 0.72, 0.3]),
      box([0.71, 0.36, 0.13], [0.06, 0.72, 0.3]),
      box([0, 0.3, -0.12], [1.5, 0.6, 0.38], "$dark"),
    ],
  },
  speaker: {
    label: "Speaker",
    category: "work",
    color: "#3b3d44",
    physics: "dynamic",
    size: [0.34, 0.6, 0.3],
    parts: [
      box([0, 0.3, 0], [0.34, 0.6, 0.3]),
      cyl([0, 0.4, 0.151], 0.1, 0.01, "#6c7079", { rot: [Math.PI / 2, 0, 0], seg: 18 }),
      cyl([0, 0.17, 0.151], 0.06, 0.01, "#6c7079", { rot: [Math.PI / 2, 0, 0], seg: 18 }),
    ],
  },
  // Structures
  wall: {
    label: "Wall",
    category: "structure",
    color: "#ebe7df",
    size: [3, 2.5, 0.2],
    parts: [box([0, 1.25, 0], [3, 2.5, 0.2]), box([0, 0.05, 0], [3.02, 0.1, 0.22], "$dark")],
  },
  arch: {
    label: "Arch",
    category: "structure",
    color: "#e6dccb",
    size: [2.2, 2.7, 0.45],
    colliders: [
      { type: "box", p: [-0.88, 1.1, 0], s: [0.44, 2.2, 0.45] },
      { type: "box", p: [0.88, 1.1, 0], s: [0.44, 2.2, 0.45] },
      { type: "box", p: [0, 2.45, 0], s: [2.2, 0.5, 0.45] },
    ],
    parts: [
      box([-0.88, 1.1, 0], [0.44, 2.2, 0.45]),
      box([0.88, 1.1, 0], [0.44, 2.2, 0.45]),
      box([0, 2.45, 0], [2.2, 0.5, 0.45]),
      box([0, 2.73, 0], [2.32, 0.06, 0.52], "$dark"),
    ],
  },
  doorway: {
    label: "Doorway",
    category: "structure",
    color: "#b99a78",
    size: [1.4, 2.35, 0.2],
    colliders: [
      { type: "box", p: [-0.64, 1.1, 0], s: [0.12, 2.2, 0.2] },
      { type: "box", p: [0.64, 1.1, 0], s: [0.12, 2.2, 0.2] },
      { type: "box", p: [0, 2.27, 0], s: [1.4, 0.16, 0.2] },
    ],
    parts: [
      box([-0.64, 1.1, 0], [0.12, 2.2, 0.2]),
      box([0.64, 1.1, 0], [0.12, 2.2, 0.2]),
      box([0, 2.27, 0], [1.4, 0.16, 0.2]),
    ],
  },
  window: {
    label: "Window",
    category: "structure",
    color: "#f2efe8",
    size: [1.4, 1.2, 0.14],
    parts: [
      box([0, 0.6, 0], [1.3, 1.1, 0.03], GLASS, { opacity: 0.45, glow: 0.2 }),
      box([0, 0.04, 0], [1.4, 0.08, 0.14]),
      box([0, 1.16, 0], [1.4, 0.08, 0.14]),
      box([-0.66, 0.6, 0], [0.08, 1.2, 0.14]),
      box([0.66, 0.6, 0], [0.08, 1.2, 0.14]),
      box([0, 0.6, 0], [0.05, 1.1, 0.08]),
      box([0, 0.6, 0], [1.3, 0.05, 0.08]),
    ],
  },
  fence: {
    label: "Fence",
    category: "structure",
    color: "#d8c4a4",
    size: [2, 0.9, 0.1],
    parts: [
      ...[-0.95, 0, 0.95].map((x) => box([x, 0.45, 0], [0.09, 0.9, 0.09])),
      box([0, 0.33, 0], [2, 0.07, 0.04], "$dark"),
      box([0, 0.68, 0], [2, 0.07, 0.04], "$dark"),
    ],
  },
  stairs: {
    label: "Stairs",
    category: "structure",
    color: "#d9d2c6",
    size: [1.2, 1.2, 1.8],
    colliders: Array.from({ length: 6 }, (_, i) => ({
      type: "box",
      p: [0, (0.2 * (i + 1)) / 2, 0.75 - i * 0.3],
      s: [1.2, 0.2 * (i + 1), 0.3],
    })),
    parts: Array.from({ length: 6 }, (_, i) =>
      box([0, (0.2 * (i + 1)) / 2, 0.75 - i * 0.3], [1.2, 0.2 * (i + 1), 0.3], i % 2 ? "$" : "$light"),
    ),
  },
  ramp: {
    label: "Ramp",
    category: "structure",
    color: "#cfc6b8",
    size: [1.2, 0.6, 2],
    colliders: [{ type: "wedge", p: [0, 0.3, 0], s: [1.2, 0.6, 2] }],
    parts: [wedge([0, 0.3, 0], [1.2, 0.6, 2])],
  },
  column: {
    label: "Column",
    category: "structure",
    color: "#e9e4da",
    size: [0.62, 3, 0.62],
    colliders: [{ type: "cyl", p: [0, 1.5, 0], r: 0.3, h: 3 }],
    parts: [
      box([0, 0.08, 0], [0.62, 0.16, 0.62]),
      cyl([0, 1.5, 0], 0.22, 2.68, "$", { seg: 12 }),
      box([0, 2.92, 0], [0.62, 0.16, 0.62]),
    ],
  },
  platform: {
    label: "Platform",
    category: "structure",
    color: "#d8cfc0",
    size: [2.4, 0.3, 2.4],
    parts: [box([0, 0.15, 0], [2.4, 0.3, 2.4]), box([0, 0.305, 0], [2.3, 0.01, 2.3], "$light")],
  },
  tent: {
    label: "Tent",
    category: "structure",
    color: "#e09a5f",
    size: [2, 1.5, 2.2],
    colliders: [{ type: "prism", p: [0, 0.75, 0], s: [2, 1.5, 2.2] }],
    parts: [
      prism([0, 0.75, 0], [2, 1.5, 2.2]),
      prism([0, 0.42, 1.101], [0.7, 0.84, 0.01], "#4a3a30"),
      cyl([0, 1.62, 1.1], 0.02, 0.3, DARK_WOOD),
    ],
  },
  cabin: {
    label: "Cabin",
    category: "structure",
    color: "#e6d6bd",
    size: [2.8, 2.7, 2.6],
    colliders: [
      { type: "box", p: [0, 0.85, 0], s: [2.4, 1.7, 2.2] },
      { type: "prism", p: [0, 2.2, 0], s: [2.8, 1, 2.6] },
    ],
    surface: { p: [0, 1.95, 1.311], w: 1, h: 0.3 },
    parts: [
      box([0, 0.85, 0], [2.4, 1.7, 2.2]),
      prism([0, 2.2, 0], [2.8, 1, 2.6], "#b5654a"),
      box([0, 0.55, 1.105], [0.55, 1.1, 0.03], DARK_WOOD),
      box([-0.75, 1.0, 1.105], [0.45, 0.45, 0.03], GLASS, { glow: 0.35 }),
      box([0.75, 1.0, 1.105], [0.45, 0.45, 0.03], GLASS, { glow: 0.35 }),
      box([0.6, 2.35, -0.4], [0.3, 0.7, 0.3], "#9b8c80"),
    ],
  },
  fountain: {
    label: "Fountain",
    category: "structure",
    color: "#8ec3d8",
    size: [1.8, 1.3, 1.8],
    colliders: [{ type: "cyl", p: [0, 0.4, 0], r: 0.9, h: 0.8 }],
    parts: [
      cyl([0, 0.18, 0], 0.9, 0.36, STONE, { seg: 20 }),
      cyl([0, 0.34, 0], 0.8, 0.04, "$", { seg: 20, glow: 0.15 }),
      cyl([0, 0.72, 0], 0.11, 0.8, STONE, { seg: 10 }),
      cyl([0, 1.12, 0], 0.36, 0.14, STONE, { r2: 0.16, seg: 16 }),
      cyl([0, 1.19, 0], 0.32, 0.02, "$", { seg: 16, glow: 0.2 }),
      ball([0, 1.26, 0], 0.07, "$", { glow: 0.3, anim: "bob" }),
    ],
  },
  // Playful props
  campfire: {
    label: "Campfire",
    category: "fun",
    color: "#f08a3c",
    size: [0.95, 0.65, 0.95],
    colliders: [{ type: "cyl", p: [0, 0.1, 0], r: 0.45, h: 0.2 }],
    parts: [
      ...ring(7, 0.38, (x, z) => dodeca([x, 0.07, z], 0.1, STONE)),
      box([0, 0.08, 0], [0.6, 0.08, 0.08], DARK_WOOD, { rot: [0, 0.5, 0.15] }),
      box([0, 0.08, 0], [0.6, 0.08, 0.08], WOOD, { rot: [0, -0.6, -0.15] }),
      box([0, 0.1, 0], [0.55, 0.08, 0.08], DARK_WOOD, { rot: [0, 1.6, 0.1] }),
      cone([0, 0.32, 0], 0.2, 0.5, "$", { seg: 6, glow: 1, anim: "flicker" }),
      cone([0.05, 0.27, 0.04], 0.12, 0.34, "#f6cf5a", { seg: 6, glow: 1, anim: "flicker" }),
    ],
  },
  lantern: {
    label: "Lantern",
    category: "fun",
    color: "#f2c76b",
    physics: "dynamic",
    size: [0.26, 0.48, 0.26],
    parts: [
      box([0, 0.02, 0], [0.24, 0.04, 0.24], INK),
      box([0, 0.2, 0], [0.18, 0.32, 0.18], "$", { glow: 1, opacity: 0.85 }),
      cone([0, 0.42, 0], 0.17, 0.12, INK, { seg: 4, rot: [0, Math.PI / 4, 0] }),
      torus([0, 0.48, 0], 0.04, 0.008, INK),
    ],
  },
  street_lamp: {
    label: "Street lamp",
    category: "fun",
    color: "#f6dc94",
    size: [0.5, 3, 0.5],
    colliders: [{ type: "cyl", p: [0, 1.5, 0], r: 0.1, h: 3 }],
    parts: [
      cyl([0, 0.08, 0], 0.18, 0.16, INK, { seg: 10 }),
      cyl([0, 1.45, 0], 0.05, 2.7, INK, { seg: 10 }),
      box([0, 2.85, 0], [0.32, 0.26, 0.32], "$", { glow: 1, opacity: 0.9 }),
      cone([0, 3.04, 0], 0.27, 0.14, INK, { seg: 4, rot: [0, Math.PI / 4, 0] }),
    ],
  },
  crate: {
    label: "Crate",
    category: "fun",
    color: "#c49a6c",
    physics: "dynamic",
    size: [0.8, 0.8, 0.8],
    parts: [
      box([0, 0.4, 0], [0.76, 0.76, 0.76]),
      ...[-1, 1].flatMap((side) => [
        box([0, 0.4, side * 0.385], [0.8, 0.1, 0.03], "$dark"),
        box([side * 0.385, 0.4, 0], [0.03, 0.1, 0.8], "$dark"),
        box([0, side * 0.36 + 0.4, 0], [0.8, 0.08, 0.8], "$dark"),
      ]),
    ],
  },
  barrel: {
    label: "Barrel",
    category: "fun",
    color: "#a8774f",
    physics: "dynamic",
    size: [0.62, 0.9, 0.62],
    colliders: [{ type: "cyl", p: [0, 0.45, 0], r: 0.31, h: 0.9 }],
    parts: [
      cyl([0, 0.45, 0], 0.3, 0.9, "$", { seg: 14 }),
      torus([0, 0.2, 0], 0.3, 0.02, METAL, { rot: [Math.PI / 2, 0, 0] }),
      torus([0, 0.7, 0], 0.3, 0.02, METAL, { rot: [Math.PI / 2, 0, 0] }),
    ],
  },
  balloon: {
    label: "Balloon",
    category: "fun",
    color: "#e36d6d",
    physics: "none",
    size: [0.52, 1.9, 0.52],
    colliders: [],
    parts: [
      cyl([0, 0.65, 0], 0.005, 1.3, "#ffffff"),
      ball([0, 1.6, 0], 0.26, "$", { k: [1, 1.18, 1], anim: "bob" }),
      cone([0, 1.28, 0], 0.04, 0.06, "$", { rot: [Math.PI, 0, 0], anim: "bob" }),
    ],
  },
  gift: {
    label: "Gift",
    category: "fun",
    color: "#7f9fd1",
    physics: "dynamic",
    size: [0.5, 0.56, 0.5],
    parts: [
      box([0, 0.24, 0], [0.5, 0.48, 0.5]),
      box([0, 0.24, 0], [0.52, 0.49, 0.08], "#f2d36b"),
      box([0, 0.24, 0], [0.08, 0.49, 0.52], "#f2d36b"),
      torus([0.06, 0.52, 0], 0.06, 0.02, "#f2d36b", { rot: [0, 0, 0.4] }),
      torus([-0.06, 0.52, 0], 0.06, 0.02, "#f2d36b", { rot: [0, 0, -0.4] }),
    ],
  },
  trophy: {
    label: "Trophy",
    category: "fun",
    color: "#e2b84f",
    physics: "dynamic",
    size: [0.3, 0.46, 0.3],
    parts: [
      box([0, 0.04, 0], [0.22, 0.08, 0.22], INK),
      cyl([0, 0.16, 0], 0.025, 0.16, "$"),
      cyl([0, 0.34, 0], 0.12, 0.2, "$", { r2: 0.05, seg: 16 }),
      torus([0.13, 0.35, 0], 0.05, 0.012, "$", { rot: [0, 0, 0] }),
      torus([-0.13, 0.35, 0], 0.05, 0.012, "$", { rot: [0, 0, 0] }),
    ],
  },
  rocket: {
    label: "Rocket",
    category: "fun",
    color: "#e0605a",
    size: [1, 2.6, 1],
    colliders: [{ type: "cyl", p: [0, 1.3, 0], r: 0.4, h: 2.6 }],
    parts: [
      cyl([0, 1.1, 0], 0.32, 1.6, "#f4f2ee", { seg: 16 }),
      cone([0, 2.25, 0], 0.32, 0.7, "$", { seg: 16 }),
      cyl([0, 1.45, 0.29], 0.11, 0.06, GLASS, { rot: [Math.PI / 2, 0, 0], glow: 0.4 }),
      ...ring(3, 0.36, (x, z, a) => box([x, 0.4, z], [0.06, 0.6, 0.36], "$", { rot: [0, -a, 0] })),
      cone([0, 0.18, 0], 0.18, 0.36, "#f6b24e", { rot: [Math.PI, 0, 0], glow: 0.9, anim: "flicker" }),
    ],
  },
  car: {
    label: "Toy car",
    category: "fun",
    color: "#e8795a",
    physics: "dynamic",
    size: [1.8, 0.95, 0.95],
    parts: [
      box([0, 0.42, 0], [1.8, 0.4, 0.9]),
      box([-0.1, 0.78, 0], [0.95, 0.34, 0.82], "$light"),
      box([-0.1, 0.78, 0], [0.97, 0.26, 0.84], GLASS, { opacity: 0.7 }),
      ...[
        [-0.55, -0.42],
        [0.55, -0.42],
        [-0.55, 0.42],
        [0.55, 0.42],
      ].map(([x, z]) => cyl([x, 0.2, z], 0.2, 0.14, INK, { rot: [Math.PI / 2, 0, 0], seg: 14 })),
      box([0.9, 0.45, 0.28], [0.02, 0.1, 0.16], "#fff7d6", { glow: 0.8 }),
      box([0.9, 0.45, -0.28], [0.02, 0.1, 0.16], "#fff7d6", { glow: 0.8 }),
    ],
  },
  telescope: {
    label: "Telescope",
    category: "fun",
    color: "#5e6f91",
    size: [0.9, 1.5, 0.7],
    colliders: [{ type: "box", p: [0, 0.6, 0], s: [0.6, 1.2, 0.6] }],
    parts: [
      ...ring(3, 0.25, (x, z) => box([x / 2, 0.55, z / 2], [0.04, 1.1, 0.04], DARK_WOOD, { rot: [z * 0.9, 0, -x * 0.9] })),
      cyl([0.05, 1.18, 0], 0.08, 0.95, "$", { rot: [0, 0, -1.0], seg: 14 }),
      cyl([0.43, 1.42, 0], 0.1, 0.12, "$dark", { rot: [0, 0, -1.0], seg: 14 }),
    ],
  },
  planet: {
    label: "Planet",
    category: "fun",
    color: "#d9a066",
    size: [1.4, 1.4, 1.4],
    colliders: [{ type: "ball", p: [0, 0.7, 0], r: 0.48 }],
    parts: [
      ball([0, 0.7, 0], 0.48, "$", { seg: 20, anim: "spin" }),
      torus([0, 0.7, 0], 0.66, 0.05, "$light", { rot: [Math.PI / 2 - 0.4, 0, 0.2], seg: 40 }),
    ],
  },
  star: {
    label: "Star",
    category: "fun",
    color: "#f4cf5b",
    physics: "none",
    size: [1, 1, 0.24],
    colliders: [],
    parts: [star([0, 0.5, 0], 0.5, 0.2, "$", { glow: 0.7, anim: "spin" })],
  },
  cloud: {
    label: "Cloud",
    category: "fun",
    color: "#ffffff",
    physics: "none",
    size: [2, 0.9, 1.2],
    colliders: [],
    parts: [
      ico([0, 0.45, 0], 0.45, "$", { anim: "bob" }),
      ico([0.55, 0.36, 0.05], 0.34, "$", { anim: "bob" }),
      ico([-0.55, 0.36, -0.05], 0.36, "$", { anim: "bob" }),
      ico([0.2, 0.62, -0.15], 0.3, "$", { anim: "bob" }),
    ],
  },
  snowman: {
    label: "Snowman",
    category: "fun",
    color: "#fbfbfd",
    size: [0.8, 1.7, 0.8],
    colliders: [{ type: "cyl", p: [0, 0.85, 0], r: 0.38, h: 1.7 }],
    parts: [
      ball([0, 0.38, 0], 0.4, "$", { seg: 16 }),
      ball([0, 0.98, 0], 0.29, "$", { seg: 16 }),
      ball([0, 1.42, 0], 0.2, "$", { seg: 16 }),
      cone([0, 1.42, 0.24], 0.04, 0.18, "#ef8a3a", { rot: [Math.PI / 2, 0, 0] }),
      cyl([0, 1.66, 0], 0.15, 0.2, INK, { seg: 14 }),
      cyl([0, 1.57, 0], 0.22, 0.02, INK, { seg: 14 }),
      torus([0, 1.24, 0], 0.17, 0.04, "#d0574a", { rot: [Math.PI / 2, 0, 0] }),
    ],
  },
};

export const MODEL_NAMES = Object.keys(MODELS);
export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES);
export const PANEL_NAMES = Object.keys(PANELS);

/** Unscaled base size [w, h, d] of a renderer object. */
export function baseSize(object) {
  if (object.kind === "model") return MODELS[object.model]?.size || [1, 1, 1];
  if (object.kind === "stroke") return [0, 0, 0];
  return (PRIMITIVES[object.kind] || PANELS[object.kind])?.size || [1, 1, 1];
}

/** World-space size [w, h, d] after scale and stretch, before rotation. */
export function objectSize(object) {
  const scale = object.scale ?? 1;
  const stretch = object.stretch || [1, 1, 1];
  return baseSize(object).map((value, axis) => value * scale * stretch[axis]);
}

/** Centre height for an object resting on the floor. */
export function restHeight(object) {
  return objectSize(object)[1] / 2;
}

/** Concise catalog description for model prompts. */
export function catalogGuide() {
  const groups = {};
  for (const [name, model] of Object.entries(MODELS))
    (groups[model.category] ||= []).push(
      `${name} ${model.size.map((n) => +n.toFixed(2)).join("x")}${model.surface ? " [text]" : ""}`,
    );
  return Object.entries(groups)
    .map(([category, items]) => `${category}: ${items.join(", ")}`)
    .join("\n");
}
