"use client";

// AVAGUARD: the main road, from the deployed sentinel-city-3d (Parcel.tsx Road): a dark asphalt ribbon along the car's
// way, HQ -> toll -> C-Chain, with a glowing centre line, so the toll clearly straddles one road from spawn to the
// blockchain. The line turns green while a visa drives it (sim routeLit), as the City's lit lane did.
import { useMemo } from "react";
import { MeshBasicMaterial } from "three";
import { useSim } from "@/sim/store";
import { AVAGUARD3, type Theme } from "./palette";
import type { GuardGeo } from "./guardGeo";

export function Road({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { road, center } = useMemo(() => {
    const a = geo.legs.approach.pts;
    const b = geo.legs.toCChain.pts;
    const pts = [...a, ...b.slice(a.length && b[0].distanceTo(a[a.length - 1]) < 0.5 ? 1 : 0)];
    // the ribbon just over the ground the car drives on (the block's top inside our block, the street outside)
    const ribbon = (hw: number, dy: number) => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const pa = pts[Math.max(0, i - 1)];
        const pb = pts[Math.min(pts.length - 1, i + 1)];
        const tx = pb.x - pa.x;
        const tz = pb.z - pa.z;
        const len = Math.hypot(tx, tz) || 1;
        const nx = -tz / len;
        const nz = tx / len;
        const p = pts[i];
        pos.push(p.x + nx * hw, p.y + dy, p.z + nz * hw, p.x - nx * hw, p.y + dy, p.z - nz * hw);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      return { position: new Float32Array(pos), index: new Uint32Array(idx) };
    };
    return { road: ribbon(geo.carW * 1.6, 0.01), center: ribbon(Math.max(0.32, geo.carW * 0.13), 0.04) };
  }, [geo]);
  const lit = useSim((s) => s.routeLit);
  const asphalt = useMemo(() => new MeshBasicMaterial({ color: theme === "dark" ? "#3A424E" : "#C3CEDB", toneMapped: false }), [theme]);
  const line = useMemo(() => new MeshBasicMaterial({ color: (lit ? AVAGUARD3.allow : AVAGUARD3.verify)[theme], transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }), [theme, lit]);
  return (
    <group>
      <mesh material={asphalt} renderOrder={-1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[road.position, 3]} />
          <bufferAttribute attach="index" args={[road.index, 1]} />
        </bufferGeometry>
      </mesh>
      <mesh material={line}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[center.position, 3]} />
          <bufferAttribute attach="index" args={[center.index, 1]} />
        </bufferGeometry>
      </mesh>
    </group>
  );
}
