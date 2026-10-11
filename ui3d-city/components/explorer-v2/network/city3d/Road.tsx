"use client";

// AVAGUARD: the ring road carrying on up the tower's block to our control tower (guardGeo.ts road), drawn as the city
// draws its streets: the same paving (FLEET.roadHi) and the same white dashes down its middle (FLEET.mark), and a fine
// line of light down each edge, so the protocol's road reads from the city's home view, from the control tower to the
// C-Chain. While a visa drives it (sim routeLit) its middle and its edges light in the visa's green, as the City's lit
// lane did. No other road: the car takes the ring road itself to the yard.
import { useEffect, useMemo } from "react";
import { DoubleSide, MeshBasicMaterial, Vector3 } from "three";
import { useSim } from "@/sim/store";
import { AVAGUARD3, FLEET, type Theme } from "./palette";
import type { GuardGeo } from "./guardGeo";

/** a flat strip along a polyline, `hw` each side of it, `dy` over it */
function ribbon(pts: Vector3[], hw: number, dy: number) {
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
}

function Strip({ geo, material }: { geo: { position: Float32Array; index: Uint32Array }; material: MeshBasicMaterial }) {
  return (
    <mesh material={material} renderOrder={-1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geo.position, 3]} />
        <bufferAttribute attach="index" args={[geo.index, 1]} />
      </bufferGeometry>
    </mesh>
  );
}

export function Road({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { road, dashes, center, edges } = useMemo(() => {
    // the road's axis, from the ring road's outer edge to the tower's door, on the ground the car drives
    const along = [...geo.legs.approach.pts, ...geo.legs.scanPass.pts.slice(1), ...geo.legs.toCChain.pts.slice(1)];
    const dOf = (p: Vector3) => -p.dot(geo.F);
    const pts = along.filter((p) => dOf(p) >= geo.road.d0 && dOf(p) <= geo.road.d1 + geo.carW);
    // the dashes, as the ring road's: a dash, a gap
    const dash = geo.carW * 0.9;
    const dashes: Vector3[][] = [];
    let run: Vector3[] = [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) s += pts[i].distanceTo(pts[i - 1]);
      const on = Math.floor(s / dash) % 2 === 0;
      if (on) run.push(pts[i]);
      else if (run.length > 1) {
        dashes.push(run);
        run = [];
      } else run = [];
    }
    if (run.length > 1) dashes.push(run);
    // the edges' lines, a hair in from the paving's edge
    const side = (o: number) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return new Vector3(p.x - ((b.z - a.z) / len) * o, p.y, p.z + ((b.x - a.x) / len) * o);
    });
    const edgeW = Math.max(0.2, geo.carW * 0.045);
    const inset = geo.road.half - edgeW * 1.6;
    return {
      road: ribbon(pts, geo.road.half, 0.03),
      dashes: dashes.map((d) => ribbon(d, Math.max(0.25, geo.carW * 0.06), 0.06)),
      center: ribbon(pts, Math.max(0.3, geo.carW * 0.09), 0.07),
      edges: [ribbon(side(inset), edgeW, 0.065), ribbon(side(-inset), edgeW, 0.065)],
    };
  }, [geo]);
  const lit = useSim((s) => s.routeLit);
  const mats = useMemo(
    () => ({
      paving: new MeshBasicMaterial({ color: FLEET.roadHi[theme], toneMapped: false, side: DoubleSide }),
      mark: new MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: theme === "dark" ? 0.3 : 0.95, toneMapped: false, side: DoubleSide, depthWrite: false }),
      lit: new MeshBasicMaterial({ color: AVAGUARD3.allow[theme], transparent: true, opacity: 0.95, toneMapped: false, side: DoubleSide, depthWrite: false }),
      // the edges' light: a cool white at night, strong enough to draw the road from afar; a steel line by day
      edge: new MeshBasicMaterial({ color: theme === "dark" ? "#CFE0F2" : "#8E8E93", transparent: true, opacity: theme === "dark" ? 0.75 : 0.8, toneMapped: false, side: DoubleSide, depthWrite: false }),
    }),
    [theme],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return (
    <group>
      <Strip geo={road} material={mats.paving} />
      {lit ? <Strip geo={center} material={mats.lit} /> : dashes.map((d, i) => <Strip key={i} geo={d} material={mats.mark} />)}
      {edges.map((e, i) => (
        <Strip key={i} geo={e} material={lit ? mats.lit : mats.edge} />
      ))}
    </group>
  );
}
