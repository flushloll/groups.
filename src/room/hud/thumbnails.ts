import * as THREE from "three";
import { MODELS, PRIMITIVES } from "../../../shared/catalog.mjs";
import {
  material,
  partGeometry,
  primitiveGeometry,
  resolveColor,
} from "../scene/geometry";

// One small offscreen renderer draws every library thumbnail once and caches
// the image, so the library never needs dozens of WebGL contexts.
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const cache = new Map<string, string>();
const queue: (() => void)[] = [];
let draining = false;

function setup() {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    return false;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(192, 192);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#d8d2c4", 1.6));
  const sun = new THREE.DirectionalLight("#fff5e6", 2.4);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  return true;
}

function build(kind: string): THREE.Object3D {
  const group = new THREE.Group();
  if (kind === "board") {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.1, 0.06), material("#d8cfc0", { flat: false })));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), material("#fdfcf8", { flat: false }));
    face.position.z = 0.031;
    group.add(face);
    ["#ffec99", "#b2f2bb", "#a5d8ff", "#ffc9c9"].forEach((color, index) => {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), material(color, { flat: false }));
      note.position.set(-1.05 + index * 0.7, 0.3 - (index % 2) * 0.6, 0.033);
      group.add(note);
    });
    return group;
  }
  if (kind in PRIMITIVES) {
    group.add(
      new THREE.Mesh(
        primitiveGeometry[kind as keyof typeof primitiveGeometry](),
        material("#b9aedb", { flat: kind === "pyramid" }),
      ),
    );
    return group;
  }
  const model = MODELS[kind];
  for (const part of model.parts) {
    const mesh = new THREE.Mesh(
      partGeometry(part),
      material(resolveColor(part.c, model.color), {
        glow: part.glow || 0,
        opacity: part.opacity ?? 1,
        flat: part.g !== "sphere",
      }),
    );
    mesh.position.set(...part.p);
    if (part.rot) mesh.rotation.set(...part.rot);
    if (part.k) mesh.scale.set(...part.k);
    group.add(mesh);
  }
  group.position.y = -model.size[1] / 2;
  const wrapper = new THREE.Group();
  wrapper.add(group);
  return wrapper;
}

function render(kind: string) {
  if (!setup() || !renderer || !scene || !camera) return "";
  const object = build(kind);
  object.rotation.y = -0.6;
  scene.add(object);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.62 + 0.02;
  const distance = radius / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(centre.x + distance * 0.55, centre.y + distance * 0.45, centre.z + distance * 0.7);
  camera.lookAt(centre);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  scene.remove(object);
  return url;
}

function drain() {
  if (draining) return;
  draining = true;
  const step = () => {
    const job = queue.shift();
    if (!job) {
      draining = false;
      return;
    }
    job();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Resolves with a cached PNG data URL of a catalog model or primitive. */
export function thumbnail(kind: string): Promise<string> {
  const existing = cache.get(kind);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve) => {
    queue.push(() => {
      if (!cache.has(kind)) cache.set(kind, render(kind));
      resolve(cache.get(kind)!);
    });
    drain();
  });
}
