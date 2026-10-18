import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ROOM } from "../../../shared/catalog.mjs";
import type { RoomEnvironment } from "../../types";

export const DEFAULT_ENVIRONMENT: RoomEnvironment = {
  background: "#f3f1ea",
  floor: "#faf8f2",
  walls: "#fffdf7",
  light: "#fff4e0",
  soundscape: "quiet",
  setting: "room",
};

const { halfX: X, halfZ: Z, wallHeight: H } = ROOM;

/** Floor, walls and light for the live room, easing between atmospheres. */
export function RoomShell({
  environment = DEFAULT_ENVIRONMENT,
  grid,
}: {
  environment?: RoomEnvironment;
  grid: boolean;
}) {
  const { scene } = useThree();
  const floor = useRef<THREE.MeshStandardMaterial>(null);
  const walls = useRef<THREE.MeshStandardMaterial>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const background = useMemo(() => new THREE.Color(environment.background), []);
  const target = useMemo(
    () => ({
      background: new THREE.Color(),
      floor: new THREE.Color(),
      walls: new THREE.Color(),
      light: new THREE.Color(),
    }),
    [],
  );
  const open = environment.setting === "open";
  useFrame((_, delta) => {
    const blend = 1 - Math.exp(-delta * 2.5);
    target.background.set(environment.background);
    target.floor.set(environment.floor);
    target.walls.set(environment.walls);
    target.light.set(environment.light);
    background.lerp(target.background, blend);
    scene.background = background;
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(background);
    floor.current?.color.lerp(target.floor, blend);
    walls.current?.color.lerp(target.walls, blend);
    sun.current?.color.lerp(target.light, blend);
    hemi.current?.groundColor.lerp(target.floor, blend);
  });
  const shadowCamera = useMemo(() => {
    const camera = new THREE.OrthographicCamera(-X - 3, X + 3, Z + 3, -Z - 3, 0.5, 60);
    return camera;
  }, []);
  return (
    <group>
      <fog attach="fog" args={[environment.background, 34, 90]} />
      <hemisphereLight ref={hemi} args={["#ffffff", environment.floor, 1.25]} />
      <directionalLight
        ref={sun}
        position={[7, 15, 12]}
        intensity={3.1}
        color={environment.light}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera={shadowCamera}
        shadow-normalBias={0.04}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-8, 7, -3]} intensity={0.5} color="#e6ecff" />
      <ambientLight intensity={0.18} />
      {open ? (
        <group>
          <mesh position={[0, -0.6, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[Math.hypot(X, Z) * 0.86, Math.hypot(X, Z) * 0.7, 1.2, 9]} />
            <meshStandardMaterial ref={floor} color={environment.floor} flatShading roughness={1} />
          </mesh>
          <mesh position={[0, -1.7, 0]}>
            <cylinderGeometry args={[Math.hypot(X, Z) * 0.68, 2, 3.2, 9]} />
            <meshStandardMaterial color="#9b8a76" flatShading roughness={1} />
          </mesh>
        </group>
      ) : (
        <group>
          <mesh position={[0, -0.15, 0]} receiveShadow>
            <boxGeometry args={[X * 2 + 0.3, 0.22, Z * 2 + 0.3]} />
            <meshStandardMaterial color="#d6cfc1" roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.04, 0]} receiveShadow>
            <boxGeometry args={[X * 2, 0.08, Z * 2]} />
            <meshStandardMaterial ref={floor} color={environment.floor} roughness={0.8} />
          </mesh>
          <group userData={{ solid: true, wall: true }}>
            <mesh position={[0, H / 2, -Z - 0.08]} receiveShadow castShadow>
              <boxGeometry args={[X * 2 + 0.32, H, 0.16]} />
              <meshStandardMaterial ref={walls} color={environment.walls} roughness={0.92} />
            </mesh>
            <mesh position={[-X - 0.08, H / 2, 0]} receiveShadow castShadow>
              <boxGeometry args={[0.16, H, Z * 2]} />
              <meshStandardMaterial color={environment.walls} roughness={0.92} />
            </mesh>
          </group>
          {/* Low edges on the open sides keep the room readable from inside. */}
          <mesh position={[0, 0.06, Z + 0.07]} receiveShadow>
            <boxGeometry args={[X * 2 + 0.3, 0.12, 0.14]} />
            <meshStandardMaterial color="#e5e1d8" />
          </mesh>
          <mesh position={[X + 0.07, 0.06, 0]} receiveShadow>
            <boxGeometry args={[0.14, 0.12, Z * 2 + 0.3]} />
            <meshStandardMaterial color="#e5e1d8" />
          </mesh>
          <mesh position={[0, 0.035, -Z + 0.03]}>
            <boxGeometry args={[X * 2, 0.07, 0.06]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      )}
      {grid && (
        <gridHelper
          args={[X * 2, X * 2, "#c9c6bf", "#dcdad4"]}
          position={[0, 0.01, 0]}
          scale={[1, 1, Z / X]}
        />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.09} />
      </mesh>
    </group>
  );
}
