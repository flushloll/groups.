import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Participant } from "../../types";
import { liveFrame } from "../../state/store";
import { shade } from "./geometry";

export const AVATAR_COLORS = [
  "#7fb3a3",
  "#b59ad6",
  "#e0a96d",
  "#7fa7d4",
  "#d98f9f",
  "#9cbf6e",
  "#e6c35c",
  "#8f8fd6",
];
export function avatarColor(participant: Pick<Participant, "id" | "color">) {
  if (participant.color) return participant.color;
  const hash = Array.from(participant.id).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) | 0,
    7,
  );
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const target = new THREE.Vector3();
function Avatar({
  participant,
  self,
  hidden,
}: {
  participant: Participant;
  self: boolean;
  hidden: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const heading = useRef(participant.yaw || 0);
  const last = useRef(new THREE.Vector3(...participant.position));
  const color = avatarColor(participant);
  const light = useMemo(() => shade(color, 0.1), [color]);
  useFrame(({ clock }, delta) => {
    const group = root.current;
    if (!group) return;
    const frame = liveFrame.simulation;
    const state = frame?.players.find((player) => player.id === participant.id);
    target.set(...(state?.position || participant.position));
    group.position.lerp(target, 1 - Math.exp(-14 * delta));
    if (self) liveFrame.selfPosition = [group.position.x, group.position.y, group.position.z];
    const dx = group.position.x - last.current.x;
    const dz = group.position.z - last.current.z;
    const speed = Math.hypot(dx, dz) / Math.max(delta, 1e-3);
    last.current.copy(group.position);
    if (speed > 0.4) {
      const wanted = Math.atan2(-dx, -dz);
      let diff = wanted - heading.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      heading.current += diff * (1 - Math.exp(-12 * delta));
    }
    group.rotation.y = heading.current;
    if (body.current) {
      const step = speed > 0.4 ? Math.abs(Math.sin(clock.elapsedTime * 11)) * 0.06 : 0;
      body.current.position.y = step;
    }
    const level = liveFrame.voiceLevels.get(participant.id) || 0;
    const speaking = participant.speaking && !participant.muted;
    if (ring.current) {
      const pulse = speaking ? 1.08 + Math.min(0.35, level * 3) + Math.sin(clock.elapsedTime * 9) * 0.05 : 1;
      ring.current.scale.setScalar(pulse);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = speaking ? 0.85 : 0.22;
    }
  });
  return (
    <group ref={root} position={participant.position} visible={!hidden}>
      <group ref={body}>
        <mesh position={[0, 0.62, 0]} castShadow>
          <capsuleGeometry args={[0.26, 0.5, 4, 12]} />
          <meshStandardMaterial color={color} roughness={0.6} flatShading />
        </mesh>
        <mesh position={[0, 1.34, 0]} castShadow>
          <icosahedronGeometry args={[0.27, 1]} />
          <meshStandardMaterial color={light} roughness={0.55} flatShading />
        </mesh>
        {[-0.09, 0.09].map((x) => (
          <mesh key={x} position={[x, 1.38, -0.235]}>
            <sphereGeometry args={[0.035, 8, 6]} />
            <meshBasicMaterial color="#25282e" />
          </mesh>
        ))}
        <mesh position={[0, 0.98, -0.2]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[0.36, 0.08, 0.12]} />
          <meshStandardMaterial color={shade(color, -0.12)} flatShading />
        </mesh>
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.38, 0.43, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {!self && !hidden && (
        <Html position={[0, 1.95, 0]} center distanceFactor={9} zIndexRange={[20, 0]}>
          <div className={`name-tag ${participant.speaking && !participant.muted ? "is-speaking" : ""}`}>
            <i style={{ background: color }} />
            {participant.name}
          </div>
        </Html>
      )}
    </group>
  );
}

export function Avatars({
  participants,
  selfId,
  firstPerson,
}: {
  participants: Participant[];
  selfId: string;
  firstPerson: boolean;
}) {
  return (
    <group>
      {participants.map((participant) => (
        <Avatar
          key={participant.id}
          participant={participant}
          self={participant.id === selfId}
          hidden={participant.id === selfId && firstPerson}
        />
      ))}
    </group>
  );
}
