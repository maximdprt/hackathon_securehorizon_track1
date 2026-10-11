"use client";

// AVAGUARD: our parcel's small pieces (not from builders-hub), on the city's own grade (palette.ts MASS3, ROOF, AVAGUARD3):
// the words over the scene in the districts' own style (Labels.tsx HALO), the proof column at the HQ's foot and the HQ's
// crown. The X-ray gantry and the baler yard are CityYard.tsx; the human lot is HumanLot.tsx.
import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from "three";
import { cn } from "@/lib/utils";
import { motion, useSim } from "@/sim/store";
import { HALO } from "./Labels";
import { AVAGUARD3, GROUND, MASS3, ROOF, type Theme } from "./palette";
import type { GuardGeo } from "./guardGeo";

const lambert = (c: string) => new MeshLambertMaterial({ color: c });
/** the camera's distance under which the parcel's words show */
const NEAR = 420;
const basic = (c: string) => new MeshBasicMaterial({ color: c, toneMapped: false });

/** a word over the scene, as the city writes its districts */
export function Word({ at, children, tone, small, near = NEAR }: { at: Vector3 | [number, number, number]; children: ReactNode; tone?: string; small?: boolean; near?: number }) {
  // shown close up only: from afar the parcel's words would pile on one another
  const g = useRef<Group>(null);
  const el = useRef<HTMLSpanElement>(null);
  const tmp = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    if (!g.current || !el.current) return;
    const d = camera.position.distanceTo(g.current.getWorldPosition(tmp));
    el.current.style.opacity = String(Math.max(0, Math.min(1, (near * 1.15 - d) / (near * 0.15))));
  });
  return (
    <group ref={g} position={at}>
    <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <span ref={el} className={cn("whitespace-nowrap font-mono font-bold uppercase text-zinc-900 dark:text-zinc-100", small ? "text-[9px] tracking-[0.14em]" : "text-[10.5px] tracking-[0.16em]", HALO)} style={tone ? { color: tone } : undefined}>
        {children}
      </span>
    </Html>
    </group>
  );
}

/** a box resting on y0, centred on x/z in its parent's frame */
export function Block({ w, h, d, x = 0, y0 = 0, z = 0, mat }: { w: number; h: number; d: number; x?: number; y0?: number; z?: number; mat: MeshLambertMaterial | MeshBasicMaterial }) {
  return (
    <mesh position={[x, y0 + h / 2, z]} material={mat} receiveShadow>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* the proof column                                                    */
/* ------------------------------------------------------------------ */

export function ProofStack({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const blocks = useSim((s) => s.blocks);
  const size = Math.max(1.6, geo.S * 0.12);
  const mats = useMemo(() => ({ allow: lambert(AVAGUARD3.proof[theme]), block: lambert(AVAGUARD3.registry[theme]), base: lambert(MASS3.frame[theme]) }), [theme]);
  return (
    <group position={geo.proof}>
      {/* a pedestal, stepped, so the column stands even before its first proof */}
      <Block w={size * 2} h={size * 0.3} d={size * 2} mat={mats.base} />
      <Block w={size * 1.5} h={size * 0.3} d={size * 1.5} y0={size * 0.3} mat={mats.base} />
      <Block w={size * 1.5} h={size * 0.06} d={size * 1.5} y0={size * 0.6} mat={mats.allow} />
      {blocks.map((b, i) => (
        <mesh key={b.n} position={[0, size * 0.66 + size * (i + 0.5) * 1.08, 0]} material={b.tone === "allow" ? mats.allow : mats.block}>
          <boxGeometry args={[size, size, size]} />
        </mesh>
      ))}
      <Word at={[0, size * 0.66 + size * (blocks.length + 1.2) * 1.08, 0]} tone={AVAGUARD3.proof[theme]} small>
        Preuve on-chain{blocks.length ? ` · #${blocks[blocks.length - 1].n}` : ""}
      </Word>
    </group>
  );
}

/** the HQ's one addition: a fine green crown at its top (a discreet emissive ring) */
export function Crown({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const hq = geo.hq;
  const top = hq.base + hq.crest;
  const r = hq.n.w * 0.9;
  const mat = useMemo(() => new MeshBasicMaterial({ color: AVAGUARD3.crown[theme], toneMapped: false }), [theme]);
  return (
    <mesh position={[hq.x, top + 0.6, hq.z]} rotation={[-Math.PI / 2, 0, 0]} material={mat}>
      <torusGeometry args={[r, Math.max(0.25, r * 0.035), 6, 48]} />
    </mesh>
  );
}


