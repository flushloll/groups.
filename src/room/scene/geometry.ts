import * as THREE from "three";
import type { ModelPart } from "../../../shared/catalog.mjs";

// Geometries and materials are shared by every object with the same shape or
// colour. The set is bounded by the catalog and palette, so they live for the
// lifetime of the page.
const geometries = new Map<string, THREE.BufferGeometry>();
const materials = new Map<string, THREE.Material>();

function cached(key: string, make: () => THREE.BufferGeometry) {
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = make();
    geometries.set(key, geometry);
  }
  return geometry;
}

/** Triangular prism with its ridge along z, apex up. Matches the physics hull. */
function prism(w: number, h: number, d: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(0, h / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -d / 2);
  return geometry;
}
/** Ramp rising toward -z. Matches the physics hull. */
function wedge(w: number, h: number, d: number) {
  const shape = new THREE.Shape();
  shape.moveTo(d / 2, -h / 2);
  shape.lineTo(-d / 2, -h / 2);
  shape.lineTo(-d / 2, h / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: w,
    bevelEnabled: false,
  });
  // Profile was drawn in (z, y); turn it so the high edge is at -z.
  geometry.translate(0, 0, -w / 2);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}
function star(r: number, t: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.45 : r;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: true,
    bevelSize: t * 0.25,
    bevelThickness: t * 0.25,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -t / 2);
  return geometry;
}

export function partGeometry(part: ModelPart) {
  switch (part.g) {
    case "box":
      return cached(`box:${part.s}`, () => new THREE.BoxGeometry(...part.s));
    case "prism":
      return cached(`prism:${part.s}`, () => prism(...part.s));
    case "wedge":
      return cached(`wedge:${part.s}`, () => wedge(...part.s));
    case "cyl":
      return cached(
        `cyl:${part.r}:${part.r2}:${part.h}:${part.seg}`,
        () =>
          new THREE.CylinderGeometry(
            part.r,
            part.r2 ?? part.r,
            part.h,
            part.seg ?? 12,
          ),
      );
    case "cone":
      return cached(
        `cone:${part.r}:${part.h}:${part.seg}`,
        () => new THREE.ConeGeometry(part.r, part.h, part.seg ?? 12),
      );
    case "capsule":
      return cached(
        `capsule:${part.r}:${part.h}`,
        () => new THREE.CapsuleGeometry(part.r, Math.max(0.01, part.h - part.r * 2), 4, 10),
      );
    case "sphere":
      return cached(
        `sphere:${part.r}:${part.seg}`,
        () =>
          new THREE.SphereGeometry(
            part.r,
            part.seg ?? 16,
            Math.max(6, Math.round((part.seg ?? 16) * 0.7)),
          ),
      );
    case "ico":
      return cached(`ico:${part.r}`, () => new THREE.IcosahedronGeometry(part.r, 0));
    case "dodeca":
      return cached(`dodeca:${part.r}`, () => new THREE.DodecahedronGeometry(part.r, 0));
    case "torus":
      return cached(
        `torus:${part.r}:${part.t}:${part.seg}`,
        () => new THREE.TorusGeometry(part.r, part.t, 8, part.seg ?? 24),
      );
    case "star":
      return cached(`star:${part.r}:${part.t}`, () => star(part.r, part.t));
  }
}

export const primitiveGeometry = {
  cube: () => cached("p:cube", () => new THREE.BoxGeometry(1.3, 1.3, 1.3)),
  sphere: () => cached("p:sphere", () => new THREE.SphereGeometry(0.72, 40, 28)),
  pyramid: () =>
    cached("p:pyramid", () => {
      const geometry = new THREE.ConeGeometry(0.95, 1.65, 4);
      geometry.rotateY(Math.PI / 4);
      return geometry;
    }),
  cylinder: () =>
    cached("p:cylinder", () => new THREE.CylinderGeometry(0.6, 0.6, 1.5, 40)),
  cone: () => cached("p:cone", () => new THREE.ConeGeometry(0.65, 1.6, 40)),
};

export function boxGeometry(w: number, h: number, d: number) {
  return cached(`box:${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
}

const color = new THREE.Color();
export function shade(hex: string, amount: number) {
  color.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${color.getHexString()}`;
}
export function resolveColor(role: string, base: string) {
  if (role === "$") return base;
  if (role === "$dark") return shade(base, -0.14);
  if (role === "$light") return shade(base, 0.12);
  return role;
}

export function material(
  hex: string,
  { glow = 0, opacity = 1, flat = true, ghost = false } = {},
) {
  const key = `${hex}:${glow}:${opacity}:${flat}:${ghost}`;
  let value = materials.get(key);
  if (!value) {
    value = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.82,
      metalness: 0.02,
      flatShading: flat,
      emissive: glow ? hex : "#000000",
      emissiveIntensity: glow,
      transparent: ghost || opacity < 1,
      opacity: ghost ? 0.45 : opacity,
      depthWrite: !ghost,
    });
    materials.set(key, value);
  }
  return value;
}
