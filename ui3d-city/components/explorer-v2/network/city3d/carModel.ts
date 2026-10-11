"use client";

// AVAGUARD: the car every vehicle of the City wears (not from builders-hub): public/models/car_lod.glb, from three.js's
// example Ferrari 458 ("Ferrari 458 Italia" by vicent091036, Sketchfab), simplified by scripts/make-car-lod.mjs: no
// emblem, no texture, flat normals, six meshes, one a material (PROMPT_voitures_City.md). In widths of the pod
// (Traffic.tsx): 2.2 long along x, its front toward +x, 1 wide along z, from 0 under its wheels to about 0.6 up.
import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { BufferGeometry, Mesh, Object3D } from "three";

/** the model; "/models/car_lod_lite.glb" (2 000 triangles) if the fleet grows past about 250 */
export const CAR_URL = "/models/car_lod.glb";
/** its size against the pod: under 1, so it stays small and its details do not read */
export const CAR_SCALE = 0.85;
/** true if the cars drive backwards on their lanes */
export const CAR_FLIP = false;
/** its length, in widths of the pod */
export const CAR_LENGTH = 2.2;

export const CAR_PARTS = ["Paint", "Dark", "Glass", "Metal", "LightFront", "LightRear"] as const;
export type CarPart = (typeof CAR_PARTS)[number];

/** the six parts' geometries, cloned out of drei's cache (the fleet adds its attributes to them); it suspends while the model loads */
export function useCarGeometries(): Record<CarPart, BufferGeometry> {
  const { scene } = useGLTF(CAR_URL);
  return useMemo(() => {
    const out = {} as Record<CarPart, BufferGeometry>;
    for (const name of CAR_PARTS) {
      let found: Mesh | null = null;
      scene.traverse((o: Object3D) => {
        if (!found && (o as Mesh).isMesh && (o.name === name || o.parent?.name === name)) found = o as Mesh;
      });
      const g = (found as Mesh | null)?.geometry.clone();
      if (!g) throw new Error(`car model: no ${name} mesh in ${CAR_URL}`);
      if (CAR_FLIP) g.rotateY(Math.PI);
      out[name] = g;
    }
    return out;
  }, [scene]);
}

useGLTF.preload(CAR_URL);
