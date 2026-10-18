import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Props = {
  selection: number;
  browsing: boolean;
  themes?: number[];
  count?: number;
  onSelect: (index: number) => void;
};
const palette = {
  ink: "#435348",
  cream: "#f5edda",
  orange: "#df8059",
  yellow: "#e9c85e",
  sage: "#8ca58a",
  purple: "#a397bb",
  blue: "#88b7c2",
};

export default function LobbyWorld(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight("#fff9e9", "#8ba38e", 3.2));
    const light = new THREE.DirectionalLight("#fff2d4", 3.5);
    light.position.set(3, 10, 6);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = -16;
    light.shadow.camera.right = 16;
    light.shadow.camera.top = 10;
    light.shadow.camera.bottom = -10;
    light.shadow.normalBias = 0.06;
    scene.add(light);
    const material = (color: string) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.92,
        flatShading: true,
      });
    const pieces: {
      mesh: THREE.Object3D;
      position: THREE.Vector3;
      scale: THREE.Vector3;
      rotationY: number;
      index: number;
    }[] = [];
    const worlds: THREE.Group[] = [];
    const figures: THREE.Group[] = [];
    const make = (
      parent: THREE.Group,
      geometry: THREE.BufferGeometry,
      color: string,
      x: number,
      y: number,
      z: number,
      assemble = true,
    ) => {
      const mesh = new THREE.Mesh(geometry, material(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 35),
        new THREE.LineBasicMaterial({
          color: palette.ink,
          transparent: true,
          opacity: 0.12,
        }),
      );
      mesh.add(edges);
      if (assemble)
        pieces.push({
          mesh,
          position: mesh.position.clone(),
          scale: mesh.scale.clone(),
          rotationY: mesh.rotation.y,
          index: pieces.length,
        });
      return mesh;
    };
    const box = (
      p: THREE.Group,
      w: number,
      h: number,
      d: number,
      c: string,
      x: number,
      y: number,
      z: number,
    ) => make(p, new THREE.BoxGeometry(w, h, d), c, x, y, z);
    const ball = (
      p: THREE.Group,
      r: number,
      c: string,
      x: number,
      y: number,
      z: number,
    ) => make(p, new THREE.IcosahedronGeometry(r, 1), c, x, y, z);
    const tree = (p: THREE.Group, x: number, z: number, r = 0.6) => {
      make(
        p,
        new THREE.CylinderGeometry(0.09, 0.13, 1.2, 6),
        "#a78966",
        x,
        0.6,
        z,
      );
      ball(p, r, palette.sage, x, 1.5, z);
      ball(p, r * 0.7, "#b0c39a", x + 0.25, 1.85, z - 0.1);
    };
    for (let i = 0; i < 3; i++) {
      const theme = props.themes?.[i] ?? i;
      const world = new THREE.Group();
      world.position.x = (i - 1) * 9;
      world.userData.serverIndex = i;
      worlds.push(world);
      scene.add(world);
      const land = make(
        world,
        new THREE.CylinderGeometry(3.2, 2.9, 0.48, 48),
        theme === 1 ? "#aac099" : palette.cream,
        0,
        -0.24,
        0,
        false,
      );
      land.userData.serverIndex = i;
      make(
        world,
        new THREE.CylinderGeometry(2.9, 2.5, 0.3, 32),
        theme === 2 ? palette.purple : "#7c9682",
        0,
        -0.63,
        0,
        false,
      );
      if (theme !== 1) {
        box(
          world,
          4.3,
          2.4,
          0.12,
          theme === 0 ? "#dfdfd0" : "#ddd5e5",
          -0.45,
          1.2,
          -1.8,
        );
        box(world, 0.12, 2.4, 2.8, "#f8f2e4", -2.55, 1.2, -0.45);
        box(world, 1.1, 1.6, 0.04, "#b9cbc0", -1.35, 1.3, -1.72);
        box(world, 0.84, 1.32, 0.05, "#f8f3e8", -1.35, 1.3, -1.68);
        box(world, 0.05, 1.32, 0.06, "#c6bd9f", -1.35, 1.3, -1.63);
        box(world, 0.84, 0.05, 0.06, "#c6bd9f", -1.35, 1.3, -1.63);
      }
      if (theme === 0) {
        box(world, 1.8, 0.14, 1.05, palette.orange, 0, 0.91, 0);
        for (const x of [-0.66, 0.66])
          for (const z of [-0.32, 0.32])
            box(world, 0.12, 0.85, 0.12, "#bfa887", x, 0.43, z);
        for (const [x, z] of [
          [-1.1, 0.45],
          [1.1, 0.45],
          [0.1, -1],
        ]) {
          box(world, 0.58, 0.12, 0.6, palette.sage, x, 0.5, z);
          box(world, 0.58, 0.56, 0.1, palette.sage, x, 0.8, z - 0.25);
          for (const dx of [-0.2, 0.2])
            box(world, 0.06, 0.45, 0.06, palette.ink, x + dx, 0.22, z);
        }
        box(world, 0.45, 0.025, 0.3, "#faf8ef", -0.2, 1, 0.1).rotation.y = 0.25;
        ball(world, 0.14, palette.yellow, 0.5, 1.1, -0.15);
        tree(world, 1.7, -0.9, 0.5);
        make(
          world,
          new THREE.CylinderGeometry(0.35, 0.25, 0.45, 10),
          palette.orange,
          1.7,
          0.22,
          -0.9,
        );
      } else if (theme === 1) {
        const pond = ball(world, 1.1, palette.blue, 0.8, 0.04, 0.7);
        pond.scale.set(1, 0.11, 0.8);
        tree(world, -1.4, -0.9, 0.85);
        tree(world, 0.6, -1.8, 0.65);
        tree(world, 1.8, -0.75, 0.5);
        for (let n = 0; n < 6; n++)
          box(
            world,
            0.5,
            0.06,
            0.35,
            "#e7dfc9",
            -1 + Math.sin(n * 0.7) * 0.45,
            0.03,
            1.8 - n * 0.5,
          ).rotation.y = n * 0.2;
        for (let n = 0; n < 10; n++) {
          const angle = n * 2.399,
            r = 1.5 + (n % 3) * 0.22;
          ball(
            world,
            0.1,
            n % 2 ? palette.orange : palette.yellow,
            Math.cos(angle) * r,
            0.16,
            Math.sin(angle) * r,
          );
        }
      } else {
        const arch = make(
          world,
          new THREE.TorusGeometry(0.75, 0.18, 7, 24, Math.PI),
          palette.orange,
          -0.4,
          1,
          -0.1,
        );
        arch.rotation.z = 0;
        box(world, 0.36, 1, 0.36, palette.orange, -1.15, 0.5, -0.1);
        box(world, 0.36, 1, 0.36, palette.orange, 0.35, 0.5, -0.1);
        box(world, 0.7, 0.7, 0.7, palette.purple, 1.2, 0.35, 0.65).rotation.y =
          0.25;
        ball(world, 0.42, palette.yellow, 1.2, 1.12, 0.65);
        make(
          world,
          new THREE.ConeGeometry(0.47, 0.8, 4),
          palette.sage,
          -1.15,
          0.4,
          1.25,
        ).rotation.y = 0.3;
        ball(world, 0.3, palette.blue, 0.15, 0.3, 1.7);
      }
      const person = new THREE.Group();
      make(
        person,
        new THREE.CapsuleGeometry(0.13, 0.28, 3, 6),
        theme === 0 ? palette.yellow : palette.orange,
        0,
        0.37,
        0,
        false,
      );
      make(
        person,
        new THREE.SphereGeometry(0.15, 10, 8),
        "#ddbc95",
        0,
        0.76,
        0,
        false,
      );
      for (const x of [-0.08, 0.08])
        make(
          person,
          new THREE.BoxGeometry(0.1, 0.23, 0.12),
          palette.ink,
          x,
          0.11,
          0,
          false,
        );
      person.position.set(0.6, 0, 1.9);
      world.add(person);
      figures.push(person);
      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = 128;
      shadowCanvas.height = 128;
      const ctx = shadowCanvas.getContext("2d")!;
      const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
      gradient.addColorStop(0, "rgba(55,70,54,.22)");
      gradient.addColorStop(1, "rgba(55,70,54,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(shadowCanvas),
          transparent: true,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(world.position.x, -1.4, 0);
      scene.add(shadow);
    }
    for (const piece of pieces) {
      piece.scale.copy(piece.mesh.scale);
      piece.rotationY = piece.mesh.rotation.y;
    }
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const onMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const onClick = () => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(worlds, true)[0];
      if (hit) {
        let object: THREE.Object3D | null = hit.object;
        while (object && object.userData.serverIndex === undefined)
          object = object.parent;
        if (object) latest.current.onSelect(object.userData.serverIndex);
      }
    };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("click", onClick);
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;
    let focus = -9;
    const target = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      const elapsed = (performance.now() - start) / 1000;
      focus = reduced
        ? (latest.current.selection - 1) * 9
        : THREE.MathUtils.lerp(
            focus,
            (latest.current.selection - 1) * 9,
            0.055,
          );
      const entrance = reduced ? 1 : Math.min(1, elapsed / 2.4);
      for (const piece of pieces) {
        const progress = reduced
          ? 1
          : THREE.MathUtils.smoothstep(
              elapsed - (piece.index % 16) * 0.045,
              0,
              1.6,
            );
        piece.mesh.position.copy(piece.position);
        piece.mesh.position.y += (1 - progress) * (5 + (piece.index % 4));
        piece.mesh.rotation.y = piece.rotationY + (1 - progress) * 0.6;
        piece.mesh.scale
          .copy(piece.scale)
          .multiplyScalar(Math.max(0.001, progress));
      }
      worlds.forEach((world, i) => {
        world.visible = latest.current.browsing
          ? i < (latest.current.count ?? 3) &&
            Math.abs(world.position.x - focus) < 7
          : i === latest.current.selection;
        world.rotation.y = reduced ? 0 : Math.sin(elapsed * 0.18 + i) * 0.055;
        world.position.y = reduced ? 0 : Math.sin(elapsed * 0.65 + i) * 0.07;
      });
      figures.forEach((figure, i) => {
        if (reduced) return;
        figure.position.x = 0.6 + Math.sin(elapsed * 0.45 + i) * 0.35;
        figure.rotation.y = Math.cos(elapsed * 0.45 + i) * 0.4;
      });
      target.set(focus, 0.6, 0);
      cameraPosition.set(
        focus + 7 + (reduced ? 0 : pointer.x * 0.35),
        7.4 + (1 - entrance) * 5,
        11.5 + (1 - entrance) * 9,
      );
      if (reduced) camera.position.copy(cameraPosition);
      else camera.position.lerp(cameraPosition, 0.07);
      camera.lookAt(target);
      renderer.render(scene, camera);
    };
    camera.position.set(-2, 12, 20);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("click", onClick);
      scene.traverse((item) => {
        const mesh = item as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          materials.forEach((mat) => {
            (mat as THREE.MeshBasicMaterial).map?.dispose();
            mat.dispose();
          });
        }
      });
      light.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [props.themes?.join(",")]);
  return (
    <div className="lobby-world" ref={host}>
      {unavailable && (
        <div className="world-fallback" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
