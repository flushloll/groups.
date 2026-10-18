import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ROOM } from "../../../shared/catalog.mjs";
import type { RoomObject } from "../../assets";
import type { CameraMode, Participant, RoomEnvironment } from "../../types";
import { liveFrame, useApp } from "../../state/store";
import {
  addObjects,
  sendMovement,
  updateObject,
} from "../../state/connection";
import { ObjectBody, ObjectView, objectTransform } from "./ObjectView";
import { RoomShell } from "./RoomShell";
import { Avatars } from "./Avatars";

const { halfX: X, halfZ: Z } = ROOM;
const OVERVIEW_POSITION = new THREE.Vector3(17, 15, 21);
const EDITABLE = 'input, textarea, select, [contenteditable="true"], [role="dialog"]';

type Registry = Map<string, THREE.Group>;
/** Shared, per-frame interaction state that should not re-render React. */
const pointer = {
  floor: null as THREE.Vector3 | null,
  hoverId: null as string | null,
  brush: [] as [number, number, number][],
  brushVersion: 0,
};

function snap(value: number) {
  return useApp.getState().grid ? Math.round(value * 2) / 2 : value;
}

// --- Objects ------------------------------------------------------------------

function Objects({
  objects,
  registry,
}: {
  objects: RoomObject[];
  registry: React.RefObject<Registry>;
}) {
  const register = useCallback(
    (id: string, group: THREE.Group | null) => {
      if (group) registry.current.set(id, group);
      else registry.current.delete(id);
    },
    [registry],
  );
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const frame = liveFrame.simulation;
    if (!frame) return;
    const blend = 1 - Math.exp(-18 * delta);
    for (const pose of frame.objects) {
      if (pose.id === liveFrame.dragging) continue;
      const group = registry.current.get(pose.id);
      if (!group) continue;
      group.position.lerp(position.set(...pose.position), blend);
      group.quaternion.slerp(quaternion.fromArray(pose.quaternion), blend);
    }
  });
  return (
    <group name="objects">
      {objects.map((object) => (
        <ObjectView key={object.id} object={object} register={register} />
      ))}
    </group>
  );
}

function Outline({
  registry,
  which,
  color,
}: {
  registry: React.RefObject<Registry>;
  which: () => string | null;
  color: string;
}) {
  const helper = useMemo(() => {
    const value = new THREE.Box3Helper(new THREE.Box3(), color);
    (value.material as THREE.LineBasicMaterial).transparent = true;
    (value.material as THREE.LineBasicMaterial).opacity = 0.75;
    (value.material as THREE.LineBasicMaterial).depthTest = false;
    value.renderOrder = 10;
    return value;
  }, [color]);
  useFrame(() => {
    const id = which();
    const group = id ? registry.current.get(id) : null;
    helper.visible = Boolean(group);
    if (group) helper.box.setFromObject(group).expandByScalar(0.04);
  });
  return <primitive object={helper} />;
}

function Ghost() {
  const tool = useApp((state) => state.tool);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.visible = Boolean(pointer.floor);
    if (pointer.floor) {
      const y = ref.current.userData.restY as number;
      ref.current.position.set(snap(pointer.floor.x), y, snap(pointer.floor.z));
    }
  });
  if (tool.type !== "place") return null;
  const object = { ...tool.object, id: "ghost", position: [0, 0, 0] } as RoomObject;
  const transform = objectTransform(object);
  return (
    <group ref={ref} userData={{ restY: transform.position[1] }} scale={transform.scale} rotation={transform.rotation}>
      <ObjectBody object={object} ghost />
    </group>
  );
}

function BrushPreview() {
  const color = useApp((state) => state.color);
  const line = useMemo(() => {
    const value = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color }),
    );
    value.frustumCulled = false;
    return value;
  }, [color]);
  const version = useRef(-1);
  useFrame(() => {
    if (version.current === pointer.brushVersion) return;
    version.current = pointer.brushVersion;
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(
      pointer.brush.map((point) => new THREE.Vector3(...point)),
    );
  });
  useEffect(() => () => line.geometry.dispose(), [line]);
  return <primitive object={line} />;
}

// --- Camera and movement ------------------------------------------------------------

function CameraRig({ mode, roomId }: { mode: CameraMode; roomId: string }) {
  const { camera, scene } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const followDistance = useRef(5.6);
  const lastInput = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const follow = mode !== "overview";
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = mode === "first" ? 72 : mode === "third" ? 62 : 38;
    perspective.updateProjectionMatrix();
    if (!follow) {
      camera.position.copy(OVERVIEW_POSITION);
      controls.current?.target.set(0, 0.8, -0.5);
      controls.current?.update();
    } else {
      liveFrame.lookPitch = mode === "first" ? -0.05 : -0.32;
    }
  }, [mode, follow, camera, roomId]);
  useEffect(() => {
    liveFrame.lookYaw = 0;
  }, [roomId]);
  useEffect(() => {
    const canvas = document.querySelector(".room-canvas canvas");
    const onWheel = (event: Event) => {
      if (mode !== "third") return;
      event.preventDefault();
      followDistance.current = THREE.MathUtils.clamp(
        followDistance.current + (event as WheelEvent).deltaY * 0.004,
        1.6,
        8,
      );
    };
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas?.removeEventListener("wheel", onWheel);
  }, [mode]);
  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (now - lastInput.current >= 0.05) {
      lastInput.current = now;
      const held = (key: string) => liveFrame.keys.has(key);
      const typing = Boolean(document.activeElement?.closest(EDITABLE));
      const walk = follow && !typing;
      const forward =
        (held("w") || held("arrowup") ? 1 : 0) - (held("s") || held("arrowdown") ? 1 : 0);
      const right =
        (held("d") || held("arrowright") ? 1 : 0) - (held("a") || held("arrowleft") ? 1 : 0);
      const magnitude = Math.max(1, Math.hypot(forward, right));
      const yaw = liveFrame.lookYaw;
      sendMovement({
        x: walk ? (right * Math.cos(yaw) - forward * Math.sin(yaw)) / magnitude : 0,
        z: walk ? (-right * Math.sin(yaw) - forward * Math.cos(yaw)) / magnitude : 0,
        yaw,
        jump: walk && held(" "),
      });
    }
    if (!follow) return;
    const [x, y, z] = liveFrame.selfPosition;
    eye.set(x, y + (mode === "first" ? 1.45 : 1.75), z);
    euler.set(liveFrame.lookPitch, liveFrame.lookYaw, 0);
    if (mode === "first") {
      camera.position.copy(eye);
      camera.quaternion.setFromEuler(euler);
      return;
    }
    offset.set(0, 0, followDistance.current).applyEuler(euler);
    // Keep the camera in front of walls and solid objects.
    ray.set(eye, offset.clone().normalize());
    ray.far = followDistance.current;
    const hit = ray
      .intersectObjects(scene.children, true)
      .find((item) => {
        let node: THREE.Object3D | null = item.object;
        while (node) {
          if (node.userData.solid) return true;
          node = node.parent;
        }
        return false;
      });
    if (hit) offset.setLength(Math.max(0.3, hit.distance - 0.2));
    camera.position.copy(eye).add(offset);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -X - 4, X + 4);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -Z + 0.25, Z + 6);
    camera.position.y = Math.max(0.3, camera.position.y);
    camera.lookAt(eye);
  });
  return follow ? null : (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={5}
      maxDistance={48}
      maxPolarAngle={Math.PI / 2 - 0.05}
      minPolarAngle={0.15}
      target={[0, 0.8, -0.5]}
    />
  );
}

// --- Pointer interaction ----------------------------------------------------------------

type Gesture = {
  x: number;
  y: number;
  moved: boolean;
  mode: "drag" | "brush" | "place" | "look" | "pick" | "orbit";
  id?: string;
  offset?: THREE.Vector3;
  yaw: number;
  pitch: number;
};

function Interaction({
  registry,
  objects,
  onOpen,
}: {
  registry: React.RefObject<Registry>;
  objects: RoomObject[];
  onOpen: (id: string) => void;
}) {
  const { gl, camera, scene, controls } = useThree();
  const latest = useRef({ objects, onOpen });
  latest.current = { objects, onOpen };
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02);
    const point = new THREE.Vector3();
    let gesture: Gesture | null = null;
    const aim = (event: PointerEvent | MouseEvent) => {
      const bounds = canvas.getBoundingClientRect();
      ndc.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
    };
    const floorPoint = () => {
      if (!raycaster.ray.intersectPlane(plane, point)) return null;
      if (Math.abs(point.x) > X - 0.1 || Math.abs(point.z) > Z - 0.1) return null;
      return point.clone();
    };
    const box = new THREE.Box3();
    const hitPoint = new THREE.Vector3();
    const hitObject = (loose = false) => {
      const root = scene.getObjectByName("objects");
      if (!root) return null;
      for (const hit of raycaster.intersectObjects(root.children, true)) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          if (node.userData.objectId) return node.userData.objectId as string;
          node = node.parent;
        }
      }
      if (!loose) return null;
      // Thin or open objects (boards, chairs, frames) are easier to grab by their bounds.
      let best: string | null = null;
      let nearest = Infinity;
      for (const child of root.children) {
        const id = child.userData.objectId as string | undefined;
        if (!id) continue;
        box.setFromObject(child).expandByScalar(0.08);
        if (box.isEmpty() || !raycaster.ray.intersectBox(box, hitPoint)) continue;
        const distance = hitPoint.distanceTo(raycaster.ray.origin);
        if (distance < nearest) {
          nearest = distance;
          best = id;
        }
      }
      return best;
    };
    const setOrbit = (enabled: boolean) => {
      if (controls) (controls as unknown as { enabled: boolean }).enabled = enabled;
    };
    const cursor = () => {
      const { tool } = useApp.getState();
      canvas.style.cursor =
        tool.type !== "select"
          ? "crosshair"
          : pointer.hoverId
            ? "pointer"
            : useApp.getState().cameraMode === "overview"
              ? "grab"
              : "default";
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      aim(event);
      const state = useApp.getState();
      const canEdit = Boolean(state.access?.canEdit) && state.status === "connected";
      const follow = state.cameraMode !== "overview";
      const id = state.tool.type === "select" ? hitObject(true) : null;
      const floor = floorPoint();
      const base = {
        x: event.clientX,
        y: event.clientY,
        moved: false,
        yaw: liveFrame.lookYaw,
        pitch: liveFrame.lookPitch,
      };
      if (state.tool.type === "brush" && canEdit) {
        gesture = { ...base, mode: "brush" };
        pointer.brush = floor ? [[floor.x, 0.03, floor.z]] : [];
        pointer.brushVersion++;
      } else if (state.tool.type === "place" && canEdit) {
        gesture = { ...base, mode: "place" };
      } else if (id && canEdit) {
        const group = registry.current.get(id);
        const object = latest.current.objects.find((item) => item.id === id);
        gesture = {
          ...base,
          mode: object?.kind === "stroke" ? "pick" : "drag",
          id,
          offset: group && floor ? group.position.clone().sub(floor) : undefined,
        };
        state.set({ selectedId: id });
      } else if (id) {
        gesture = { ...base, mode: "pick", id };
      } else {
        gesture = { ...base, mode: follow ? "look" : "orbit" };
      }
      if (gesture.mode !== "orbit") {
        setOrbit(false);
        canvas.setPointerCapture(event.pointerId);
      }
    };
    const move = (event: PointerEvent) => {
      aim(event);
      if (!gesture) {
        pointer.floor = floorPoint();
        const hovered = useApp.getState().tool.type === "select" ? hitObject() : null;
        pointer.hoverId = hovered;
        cursor();
        return;
      }
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4)
        gesture.moved = true;
      if (gesture.mode === "look") {
        const yaw = gesture.yaw - (event.clientX - gesture.x) * 0.0045;
        liveFrame.lookYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        liveFrame.lookPitch = THREE.MathUtils.clamp(
          gesture.pitch - (event.clientY - gesture.y) * 0.0045,
          -1.25,
          1.1,
        );
        return;
      }
      const floor = floorPoint();
      pointer.floor = floor;
      if (gesture.mode === "drag" && gesture.moved && gesture.id && floor) {
        const group = registry.current.get(gesture.id);
        if (!group) return;
        liveFrame.dragging = gesture.id;
        const offset = gesture.offset || new THREE.Vector3();
        group.position.x = THREE.MathUtils.clamp(snap(floor.x + offset.x), -X + 0.3, X - 0.3);
        group.position.z = THREE.MathUtils.clamp(snap(floor.z + offset.z), -Z + 0.3, Z - 0.3);
      } else if (gesture.mode === "brush" && floor) {
        const last = pointer.brush[pointer.brush.length - 1];
        if (!last || Math.hypot(floor.x - last[0], floor.z - last[2]) > 0.05) {
          pointer.brush = [...pointer.brush, [floor.x, 0.03, floor.z]];
          pointer.brushVersion++;
        }
      }
    };
    const up = (event: PointerEvent) => {
      if (!gesture) return;
      const done = gesture;
      gesture = null;
      aim(event);
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      setOrbit(useApp.getState().cameraMode === "overview");
      const state = useApp.getState();
      if (done.mode === "brush") {
        if (pointer.brush.length > 1)
          addObjects([
            {
              id: crypto.randomUUID(),
              kind: "stroke",
              color: state.color,
              position: [0, 0, 0],
              points: pointer.brush.slice(0, 5000),
            },
          ]);
        pointer.brush = [];
        pointer.brushVersion++;
        return;
      }
      if (done.mode === "drag" && done.moved && done.id) {
        const group = registry.current.get(done.id);
        const object = latest.current.objects.find((item) => item.id === done.id);
        liveFrame.dragging = null;
        if (group && object) {
          const y =
            object.position[1] === 0 && object.physics !== "dynamic"
              ? 0
              : object.physics === "dynamic"
                ? Math.max(group.position.y, 0.05)
                : object.position[1];
          updateObject(done.id, {
            position: [group.position.x, y, group.position.z],
          });
        }
        return;
      }
      if (done.moved) return;
      if (done.mode === "place" && state.tool.type === "place") {
        const floor = floorPoint();
        if (!floor) return;
        const id = crypto.randomUUID();
        addObjects([
          {
            ...state.tool.object,
            id,
            position: [snap(floor.x), 0, snap(floor.z)],
          } as RoomObject,
        ]);
        if (event.shiftKey) return;
        state.set({ tool: { type: "select" }, selectedId: id });
        return;
      }
      if (done.mode === "pick" || done.mode === "drag") {
        state.set({ selectedId: done.id || null });
        return;
      }
      if (state.tool.type === "select") state.set({ selectedId: null });
    };
    const leave = () => {
      pointer.floor = null;
      pointer.hoverId = null;
    };
    const dblclick = (event: MouseEvent) => {
      aim(event);
      const id = hitObject(true);
      if (id) latest.current.onOpen(id);
    };
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("dblclick", dblclick);
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("dblclick", dblclick);
    };
  }, [gl, camera, scene, controls, registry]);
  return null;
}

// --- Keyboard movement ----------------------------------------------------------------

function useMovementKeys() {
  useEffect(() => {
    const keys = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "];
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.(EDITABLE)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!keys.includes(key)) return;
      if (useApp.getState().cameraMode === "overview" && key.startsWith("arrow")) return;
      event.preventDefault();
      liveFrame.keys.add(key);
    };
    const up = (event: KeyboardEvent) => liveFrame.keys.delete(event.key.toLowerCase());
    const clear = () => liveFrame.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);
}

// --- Scene ------------------------------------------------------------------------------

export default function Scene({
  objects,
  environment,
  participants,
  roomId,
  onOpen,
  onReady,
}: {
  objects: RoomObject[];
  environment?: RoomEnvironment;
  participants: Participant[];
  roomId: string;
  onOpen: (id: string) => void;
  onReady: () => void;
}) {
  const registry = useRef<Registry>(new Map());
  const cameraMode = useApp((state) => state.cameraMode);
  const grid = useApp((state) => state.grid);
  const selfId = useApp((state) => state.selfId);
  useMovementKeys();
  const selected = useCallback(() => useApp.getState().selectedId, []);
  const hovered = useCallback(
    () => (pointer.hoverId !== useApp.getState().selectedId ? pointer.hoverId : null),
    [],
  );
  return (
    <Canvas
      className="room-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ position: OVERVIEW_POSITION.toArray(), fov: 62, near: 0.1, far: 220 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.domElement.setAttribute("aria-label", "Shared 3D room");
        gl.domElement.tabIndex = 0;
        onReady();
      }}
    >
      <Suspense fallback={null}>
        <RoomShell environment={environment} grid={false} />
        {grid && (
          <Grid
            args={[X * 2, Z * 2]}
            position={[0, 0.012, 0]}
            cellSize={0.5}
            sectionSize={2}
            cellColor="#cfcbc2"
            sectionColor="#b9b4a9"
            cellThickness={0.6}
            sectionThickness={1}
            fadeDistance={60}
          />
        )}
        <Objects objects={objects} registry={registry} />
        <Avatars participants={participants} selfId={selfId} firstPerson={cameraMode === "first"} />
        <Outline registry={registry} which={selected} color="#e0a43b" />
        <Outline registry={registry} which={hovered} color="#9fb2a6" />
        <Ghost />
        <BrushPreview />
        <CameraRig mode={cameraMode} roomId={roomId} />
        <Interaction registry={registry} objects={objects} onOpen={onOpen} />
      </Suspense>
    </Canvas>
  );
}
