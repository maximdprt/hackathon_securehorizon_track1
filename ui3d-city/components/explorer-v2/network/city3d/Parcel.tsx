"use client";

// AVAGUARD: our parcel's small pieces (not from builders-hub), on the city's own grade (palette.ts MASS3, ROOF, AVAGUARD3):
// the words over the scene in the districts' own style (Labels.tsx HALO), the proof column at the HQ's foot and the HQ's
// crown. The X-ray gantry and the baler yard are CityYard.tsx; the human lot is HumanLot.tsx.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BoxGeometry, Color, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from "three";
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

/** how many proofs the column shows (the latest), its blocks' share of the pad's size, and the gap between two */
const PROOFS = 8;
const CUBE = 0.52;
const GAP = 0.07;

/* the proof column at the HQ's foot: a glass column on a stepped plinth, eight blocks high, that stands even before its
   first proof, so it reads as the ledger it is; each decision lays one block in it, green for a visa, red for a refusal,
   lit from within at night, the latest on top; its words over it name the latest block */
export function ProofStack({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const blocks = useSim((s) => s.blocks);
  const size = Math.max(1.6, geo.S * 0.12);
  const cube = size * CUBE;
  const pitch = cube * (1 + GAP);
  const base = size * 0.5;
  const tall = PROOFS * pitch + cube * GAP;
  const dark = theme === "dark";
  const mats = useMemo(() => {
    const lit = (c: string, k: number) => new MeshLambertMaterial({ color: c, emissive: new Color(c), emissiveIntensity: k });
    return {
      allow: lit(AVAGUARD3.proof[theme], dark ? 0.55 : 0.12),
      block: lit(AVAGUARD3.registry[theme], dark ? 0.55 : 0.12),
      base: lambert(MASS3.frame[theme]),
      step: lambert(MASS3.wall[theme]),
      glass: new MeshBasicMaterial({ color: AVAGUARD3.proof[theme], transparent: true, opacity: dark ? 0.07 : 0.1, depthWrite: false, side: DoubleSide }),
      edge: new LineBasicMaterial({ color: AVAGUARD3.proof[theme], transparent: true, opacity: dark ? 0.42 : 0.6 }),
      line: basic(AVAGUARD3.proof[theme]),
    };
  }, [theme, dark]);
  const column = useMemo(() => new EdgesGeometry(new BoxGeometry(cube * 1.24, tall, cube * 1.24)), [cube, tall]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(() => () => column.dispose(), [column]);
  const shown = blocks.slice(-PROOFS);
  return (
    <group position={geo.proof}>
      {/* the plinth, stepped, its top edged with a fine rim of the proof's green */}
      <Block w={size * 2} h={size * 0.25} d={size * 2} mat={mats.base} />
      <Block w={size * 1.5} h={size * 0.25} d={size * 1.5} y0={size * 0.25} mat={mats.step} />
      <Block w={size * 1.52} h={size * 0.035} d={size * 1.52} y0={size * 0.5} mat={mats.line} />
      <Block w={size * 1.4} h={size * 0.04} d={size * 1.4} y0={size * 0.5} mat={mats.step} />
      {/* the glass column the blocks stack in, and its edges */}
      <mesh position={[0, base + tall / 2, 0]} material={mats.glass} renderOrder={2}>
        <boxGeometry args={[cube * 1.24, tall, cube * 1.24]} />
      </mesh>
      <lineSegments geometry={column} material={mats.edge} position={[0, base + tall / 2, 0]} />
      <Block w={cube * 1.4} h={size * 0.08} d={cube * 1.4} y0={base + tall} mat={mats.base} />
      {shown.map((b, i) => (
        <mesh key={b.n} position={[0, base + cube * GAP + pitch * i + cube / 2, 0]} material={b.tone === "allow" ? mats.allow : mats.block}>
          <boxGeometry args={[cube, cube, cube]} />
        </mesh>
      ))}
      <Word at={[0, base + tall + size * 1.1, 0]} tone={AVAGUARD3.proof[theme]} small>
        Preuve on-chain{blocks.length ? ` · #${blocks[blocks.length - 1].n}` : ""}
      </Word>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the departure                                                       */
/* ------------------------------------------------------------------ */

/* where a payment leaves the control tower: a low canopy over the road at the tower's corner, its roof on two side walls,
   open toward the gantry, the protocol's green in a fine strip along its mouth and a faint pool of it on the road there.
   The car starts under it, its tail still in the tower, and rolls out: it never shows through a wall */
export function Departure({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { p, yaw, depth, w } = geo.departure;
  const dark = theme === "dark";
  const h = geo.carW * 1.55;
  const t = Math.max(0.35, geo.carW * 0.14);
  const mats = useMemo(
    () => ({
      shell: lambert(MASS3.frame[theme]),
      soffit: lambert(MASS3.wall[theme]),
      strip: basic(AVAGUARD3.crown[theme]),
      pool: new MeshBasicMaterial({ color: AVAGUARD3.crown[theme], transparent: true, opacity: dark ? 0.16 : 0.1, depthWrite: false, toneMapped: false }),
    }),
    [theme, dark],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  // its frame: +x down the road (toward the gantry), z across it; it reaches back into the tower's corner as far as its
  // walls meet the tower's two faces (the corner is a right angle on the road's axis), so it stands against the tower
  const back = w / 2 + t;
  const len = depth + back;
  const mid = depth / 2 - back / 2;
  return (
    <group name="guard:departure" position={p} rotation={[0, -yaw, 0]}>
      {[-1, 1].map((side) => (
        <Block key={side} w={len} h={h} d={t} x={mid} z={(side * (w - t)) / 2} mat={mats.shell} />
      ))}
      <Block w={len} h={t * 0.8} d={w} x={mid} y0={h} mat={mats.shell} />
      <Block w={len - t} h={0.05} d={w - 2 * t} x={mid} y0={h - 0.05} mat={mats.soffit} />
      {/* the green strip along its mouth, under the roof's edge */}
      <Block w={t * 0.6} h={t * 0.35} d={w - 2 * t} x={depth - t * 0.3} y0={h - t * 0.35} mat={mats.strip} />
      <mesh position={[depth + geo.carW * 0.2, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.pool} renderOrder={1}>
        <planeGeometry args={[geo.carW * 2.2, w * 0.9]} />
      </mesh>
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


