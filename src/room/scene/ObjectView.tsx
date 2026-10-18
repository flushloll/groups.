import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MODELS, PANELS, restHeight } from "../../../shared/catalog.mjs";
import type { ModelDefinition, ModelPart } from "../../../shared/catalog.mjs";
import type { RoomObject } from "../../assets";
import {
  boxGeometry,
  material,
  partGeometry,
  primitiveGeometry,
  resolveColor,
} from "./geometry";
import { writingTexture } from "./writing";
import { boardTexture } from "./boardTexture";
import type { WritingStyle } from "./writing";

let fontsReady = false;
const fontListeners = new Set<() => void>();
document.fonts?.ready.then(() => {
  fontsReady = true;
  fontListeners.forEach((listener) => listener());
});
/** Canvas text is redrawn once the web font has loaded. */
function useFontsReady() {
  const [ready, setReady] = useState(fontsReady);
  useEffect(() => {
    if (ready) return;
    const listener = () => setReady(true);
    fontListeners.add(listener);
    return () => void fontListeners.delete(listener);
  }, [ready]);
  return ready;
}

function useWriting(
  text: string,
  width: number,
  height: number,
  style: WritingStyle,
  background: string,
) {
  const fonts = useFontsReady();
  const texture = useMemo(
    () => writingTexture(text, width, height, style, background),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, width, height, style, background, fonts],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function AnimatedPart({
  part,
  children,
}: {
  part: ModelPart;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const group = ref.current;
    if (!group) return;
    const t = clock.elapsedTime + seed;
    if (part.anim === "spin") group.rotation.y = t * 0.6;
    else if (part.anim === "bob") group.position.y = Math.sin(t * 1.4) * 0.05;
    else if (part.anim === "flicker") {
      const s = 1 + Math.sin(t * 13) * 0.06 + Math.sin(t * 7.3) * 0.05;
      group.scale.set(1, s, 1);
    }
  });
  return <group ref={ref}>{children}</group>;
}

function Part({
  part,
  color,
  ghost,
}: {
  part: ModelPart;
  color: string;
  ghost?: boolean;
}) {
  const hex = resolveColor(part.c, color);
  const smooth = part.g === "sphere" || (part.g === "cyl" && (part.seg ?? 12) > 16);
  const mesh = (
    <mesh
      geometry={partGeometry(part)}
      material={material(hex, {
        glow: part.glow || 0,
        opacity: part.opacity ?? 1,
        flat: !smooth,
        ghost,
      })}
      position={part.anim ? [0, 0, 0] : part.p}
      rotation={part.anim ? undefined : part.rot}
      scale={part.anim ? undefined : part.k}
      castShadow={!ghost && (part.opacity ?? 1) === 1}
      receiveShadow
    />
  );
  if (!part.anim) return mesh;
  // Animated parts move around their own centre.
  return (
    <group position={part.p} rotation={part.rot} scale={part.k}>
      <AnimatedPart part={part}>
        {/* position handled by the parent group */}
        {mesh}
      </AnimatedPart>
    </group>
  );
}

function Surface({
  model,
  text,
  color,
}: {
  model: ModelDefinition;
  text: string;
  color: string;
}) {
  const surface = model.surface!;
  const style: WritingStyle = surface.light
    ? "screen"
    : model.category === "work" && model.label === "Signpost"
      ? "sign"
      : surface.flat
        ? "panel"
        : "board";
  const background = surface.light
    ? resolveColor("$dark", color)
    : style === "sign"
      ? color
      : surface.flat
        ? resolveColor("$light", color)
        : "#ffffff";
  const texture = useWriting(text, surface.w, surface.h, style, background);
  return (
    <mesh
      position={surface.p}
      rotation={
        surface.flat
          ? [-Math.PI / 2, 0, 0]
          : (surface.rot as [number, number, number] | undefined)
      }
    >
      <planeGeometry args={[surface.w, surface.h]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.9}
        emissive={surface.light ? "#ffffff" : "#000000"}
        emissiveMap={surface.light ? texture : null}
        emissiveIntensity={surface.light ? 0.65 : 0}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}

export function ModelMesh({
  name,
  color,
  text,
  ghost,
}: {
  name: string;
  color: string;
  text?: string;
  ghost?: boolean;
}) {
  const model = MODELS[name];
  if (!model) return null;
  return (
    <group position={[0, -model.size[1] / 2, 0]}>
      {model.parts.map((part, index) => (
        <Part key={index} part={part} color={color} ghost={ghost} />
      ))}
      {model.surface && text && !ghost && (
        <Surface model={model} text={text} color={color} />
      )}
    </group>
  );
}

function PanelMesh({ object, ghost }: { object: RoomObject; ghost?: boolean }) {
  const [w, h, d] = PANELS[object.kind as "note"].size;
  const isNote = object.kind === "note";
  const texture = useWriting(
    object.text || (isNote ? "A thought…" : "Text"),
    w,
    h,
    isNote ? "note" : "panel",
    isNote ? object.color : "#ffffff",
  );
  const sides = material(isNote ? object.color : "#f2efe9", { flat: false, ghost });
  return (
    <group>
      <mesh geometry={boxGeometry(w, h, d)} material={sides} castShadow receiveShadow />
      {!ghost && (
        <mesh position={[0, 0, d / 2 + 0.001]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={texture} roughness={0.92} />
        </mesh>
      )}
    </group>
  );
}

const loader = new THREE.TextureLoader();
function ImageMesh({ object }: { object: RoomObject }) {
  const [w, h, d] = PANELS.image.size;
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!object.image) return;
    let alive = true;
    const loaded = loader.load(object.image, (value) => {
      if (!alive) return value.dispose();
      value.colorSpace = THREE.SRGBColorSpace;
      value.anisotropy = 8;
      setTexture(value);
    });
    return () => {
      alive = false;
      loaded.dispose();
    };
  }, [object.image]);
  return (
    <group>
      <mesh
        geometry={boxGeometry(w + 0.08, h + 0.08, d)}
        material={material("#fbfaf7", { flat: false })}
        castShadow
        receiveShadow
      />
      <mesh position={[0, 0, d / 2 + 0.001]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} color={texture ? "#ffffff" : "#e9e6df"} roughness={0.9} />
      </mesh>
    </group>
  );
}

function BoardMesh({ object, ghost }: { object: RoomObject; ghost?: boolean }) {
  const [w, h, d] = PANELS.board.size;
  const fonts = useFontsReady();
  const elements = object.board?.elements;
  const texture = useMemo(
    () => (ghost ? null : boardTexture(elements || [], object.text || "Board")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements, object.text, ghost, fonts],
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  return (
    <group>
      <mesh geometry={boxGeometry(w + 0.1, h + 0.1, d)} material={material(object.color, { flat: false, ghost })} castShadow receiveShadow />
      {texture && (
        <mesh position={[0, 0, d / 2 + 0.001]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={texture} roughness={0.9} />
        </mesh>
      )}
      <mesh geometry={boxGeometry(w * 0.6, 0.05, 0.12)} material={material(object.color, { flat: false, ghost })} position={[0, -h / 2 - 0.03, 0.05]} />
    </group>
  );
}

function StrokeMesh({ object }: { object: RoomObject }) {
  const geometry = useMemo(() => {
    const points = (object.points || []).map(
      (point) => new THREE.Vector3(...point),
    );
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(
      curve,
      Math.min(400, points.length * 3),
      0.04,
      6,
      false,
    );
  }, [object.points]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} material={material(object.color, { flat: false })} receiveShadow />
  );
}

export function ObjectBody({
  object,
  ghost,
}: {
  object: RoomObject;
  ghost?: boolean;
}) {
  if (object.kind === "model")
    return (
      <ModelMesh
        name={object.model || ""}
        color={object.color}
        text={object.text}
        ghost={ghost}
      />
    );
  if (object.kind === "note" || object.kind === "text")
    return <PanelMesh object={object} ghost={ghost} />;
  if (object.kind === "image") return <ImageMesh object={object} />;
  if (object.kind === "board") return <BoardMesh object={object} ghost={ghost} />;
  if (object.kind === "stroke") return <StrokeMesh object={object} />;
  const geometry = primitiveGeometry[object.kind]();
  return (
    <mesh
      geometry={geometry}
      material={material(object.color, {
        flat: object.kind === "pyramid",
        ghost,
      })}
      castShadow={!ghost}
      receiveShadow
    />
  );
}

export function objectTransform(object: RoomObject) {
  const scale = object.scale ?? 1;
  const stretch = object.stretch || [1, 1, 1];
  return {
    position: [
      object.position[0],
      object.position[1] === 0 && object.kind !== "stroke"
        ? restHeight(object)
        : object.position[1],
      object.position[2],
    ] as [number, number, number],
    rotation: (object.rotation || [0, 0, 0]) as [number, number, number],
    scale: [scale * stretch[0], scale * stretch[1], scale * stretch[2]] as [
      number,
      number,
      number,
    ],
  };
}

/** A room object, positioned. Physics poses are applied by the parent each frame. */
export const ObjectView = memo(function ObjectView({
  object,
  register,
}: {
  object: RoomObject;
  register: (id: string, group: THREE.Group | null) => void;
}) {
  const transform = objectTransform(object);
  const solid =
    object.kind !== "stroke" &&
    object.physics !== "none" &&
    object.physics !== "sensor";
  return (
    <group
      ref={(group) => register(object.id, group)}
      userData={{ objectId: object.id, solid }}
      position={object.kind === "stroke" ? [0, 0, 0] : transform.position}
      rotation={object.kind === "stroke" ? undefined : transform.rotation}
      scale={object.kind === "stroke" ? 1 : transform.scale}
    >
      <ObjectBody object={object} />
    </group>
  );
});
