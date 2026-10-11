"use client";

// AVAGUARD: the roads of our parcel: one straight road from the control tower through the gantry to the C-Chain's
// gate, with a centre line that turns green while a visa drives it (sim routeLit), and the branches the protocol takes
// off it, to the yard on the left and through the human post on the right, the same asphalt.
import { useMemo } from "react";
import { DoubleSide, MeshBasicMaterial } from "three";
import { useSim } from "@/sim/store";
import { AVAGUARD3, type Theme } from "./palette";
import type { GuardGeo } from "./guardGeo";

export function Road({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { road, center, branches } = useMemo(() => {
    const main = [...geo.legs.approach.pts, ...geo.legs.scanPass.pts.slice(1), ...geo.legs.toCChain.pts.slice(1)];
    // the ribbon just over the ground the car drives on
    const ribbon = (pts: typeof main, hw: number, dy: number) => {
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
    const L = geo.legs;
    return {
      road: ribbon(main, geo.carW * 1.6, 0.01),
      center: ribbon(main, Math.max(0.32, geo.carW * 0.13), 0.04),
      branches: [L.toScrapyard.pts, L.toParking.pts, L.parkToCChain.pts, L.parkToScrapyard.pts].map((pts) => ribbon(pts, geo.carW * 0.9, 0.012)),
    };
  }, [geo]);
  const lit = useSim((s) => s.routeLit);
  const asphalt = useMemo(() => new MeshBasicMaterial({ color: theme === "dark" ? "#0E1014" : "#2A2E35", toneMapped: false, side: DoubleSide }), [theme]);
  const line = useMemo(() => new MeshBasicMaterial({ color: (lit ? AVAGUARD3.allow : AVAGUARD3.verify)[theme], transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false, side: DoubleSide }), [theme, lit]);
  return (
    <group>
      <mesh material={asphalt} renderOrder={-1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[road.position, 3]} />
          <bufferAttribute attach="index" args={[road.index, 1]} />
        </bufferGeometry>
      </mesh>
      {branches.map((b, i) => (
        <mesh key={i} material={asphalt} renderOrder={-1}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[b.position, 3]} />
            <bufferAttribute attach="index" args={[b.index, 1]} />
          </bufferGeometry>
        </mesh>
      ))}
      <mesh material={line}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[center.position, 3]} />
          <bufferAttribute attach="index" args={[center.index, 1]} />
        </bufferGeometry>
      </mesh>
    </group>
  );
}
