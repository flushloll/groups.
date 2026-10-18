import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { RoomObject } from "../assets";
import type { RoomEnvironment } from "../types";
import { RoomShell } from "../room/scene/RoomShell";
import { ObjectBody, objectTransform } from "../room/scene/ObjectView";

/** A slowly turning miniature of a space's real contents. */
export default function SpacePreview({
  objects,
  environment,
}: {
  objects: RoomObject[];
  environment?: RoomEnvironment;
}) {
  return (
    <Canvas
      className="space-preview"
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [19, 15, 22], fov: 36 }}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.domElement.setAttribute("aria-hidden", "true");
      }}
    >
      <Suspense fallback={null}>
        <RoomShell environment={environment} grid={false} />
        {objects.map((object) => {
          const transform = objectTransform(object);
          return (
            <group
              key={object.id}
              position={object.kind === "stroke" ? [0, 0, 0] : transform.position}
              rotation={object.kind === "stroke" ? undefined : transform.rotation}
              scale={object.kind === "stroke" ? 1 : transform.scale}
            >
              <ObjectBody object={object} />
            </group>
          );
        })}
        <OrbitControls
          autoRotate
          autoRotateSpeed={0.5}
          enablePan={false}
          enableZoom={false}
          maxPolarAngle={Math.PI / 2.4}
          minPolarAngle={0.5}
          target={[0, 0.6, 0]}
        />
      </Suspense>
    </Canvas>
  );
}
