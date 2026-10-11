"use client";

// AVAGUARD: our parcel's equipment (not from builders-hub), on the city's own grade (palette.ts MASS3, GROUND, ROOF,
// AVAGUARD3), so it reads as part of the same white model: the toll on our street where it leaves our block (the human
// lot is HumanLot.tsx), the scrapyard with its crusher and the hackers' registry, and the proof column at the HQ's foot. Its words are
// DOM words over the scene, in the districts' own style (Labels.tsx HALO).
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
/* the toll                                                            */
/* ------------------------------------------------------------------ */

export function Toll({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { p, yaw, span } = geo.toll;
  const S = geo.S;
  // SENTINEL (from the deployed sentinel-city-3d): a bigger gantry, the car stopped centred under it
  const H = Math.max(S * 1.25, geo.carW * 3.2);
  const post = Math.max(1.4, S * 0.09);
  const mats = useMemo(
    () => ({ frame: lambert(AVAGUARD3.gate[theme]), wall: lambert(MASS3.wall[theme]), band: basic(AVAGUARD3.band[theme]), red: lambert(AVAGUARD3.barrier[theme]), white: lambert("#F4F6F9"), scan: new MeshBasicMaterial({ color: AVAGUARD3.verify[theme], transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: DoubleSide }), floor: new MeshBasicMaterial({ color: AVAGUARD3.verify[theme], transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false, side: DoubleSide }) }),
    [theme],
  );
  const arm = useRef<Group>(null);
  const curtain = useRef<Mesh>(null);
  const floor = useRef<Mesh>(null);
  const armRed = useRef<MeshLambertMaterial>(mats.red);
  armRed.current = mats.red;
  useFrame(({ clock }) => {
    if (arm.current) arm.current.rotation.x = -motion.barrier * 1.38;
    const blink = motion.blink && Math.sin(clock.elapsedTime * 14) > 0;
    mats.red.emissive.set(blink ? AVAGUARD3.barrier[theme] : "#000000");
    // the scanner's light sweeps the stopped car from its nose to its tail
    const on = motion.scan > 0 && motion.scan < 1;
    if (curtain.current) {
      curtain.current.visible = on;
      // the light curtain sweeps the car from nose to tail, the car stopped centred under the gantry
      curtain.current.position.x = (0.5 - motion.scan) * geo.carL * 1.15;
    }
    if (floor.current) (floor.current.material as MeshBasicMaterial).opacity = on ? 0.45 + 0.2 * Math.sin(clock.elapsedTime * 20) : 0.18;
  });
  // local frame: +x along the lane (the car's way), +z to its right; the gantry spans the lane
  return (
    <group position={p} rotation={[0, -yaw, 0]}>
      {[-1, 1].map((s) => (
        <Block key={s} w={post} h={H} d={post} z={(s * span) / 2} mat={mats.frame} />
      ))}
      <Block w={post * 1.6} h={post * 1.2} d={span + post} y0={H} mat={mats.frame} />
      <Block w={post * 1.65} h={post * 0.35} d={span * 0.7} y0={H + post * 0.15} x={-post * 0.05} mat={mats.band} />
      {/* the booth on the lane's right */}
      <Block w={post * 3} h={H * 0.45} d={post * 2.2} z={span / 2 + post * 1.8} mat={mats.wall} />
      {/* the barrier: a striped arm hinged at the left post */}
      <group ref={arm} position={[post * 1.2, H * 0.18, -span / 2]}>
        {Array.from({ length: 6 }, (_, k) => (
          <Block key={k} w={post * 0.4} h={post * 0.4} d={span / 6} z={(k + 0.5) * (span / 6)} mat={k % 2 ? mats.white : mats.red} />
        ))}
      </group>
      {/* the floor scanner, and its light curtain */}
      <mesh ref={floor} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.floor}>
        <planeGeometry args={[geo.carL * 1.4, span * 0.8]} />
      </mesh>
      <mesh ref={curtain} position={[0, H * 0.48, 0]} material={mats.scan} visible={false}>
        <boxGeometry args={[Math.max(0.5, geo.carL * 0.1), H * 0.92, span * 0.95]} />
      </mesh>
      <Word at={[0, H + post * 3.4, 0]} tone={AVAGUARD3.band[theme]} small>
        Contrôle Sentinel
      </Word>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the scrapyard                                                       */
/* ------------------------------------------------------------------ */

export function Scrapyard({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { c, yaw, w, d, crusher, bin } = geo.scrapyard;
  const S = geo.S;
  const mats = useMemo(
    () => ({ pad: lambert(GROUND.pad[theme]), fence: lambert(ROOF.steel[theme]), frame: lambert(AVAGUARD3.gate[theme]), press: lambert(MASS3.frame[theme]), red: new MeshLambertMaterial({ color: AVAGUARD3.registry[theme], emissive: new Color(AVAGUARD3.registry[theme]), emissiveIntensity: 0 }), bin: lambert(MASS3.wall[theme]), cube: lambert(ROOF.cone[theme]) }),
    [theme],
  );
  const press = useRef<Group>(null);
  const crushTop = geo.carW * 2.4;
  useFrame(() => {
    if (press.current) press.current.position.y = crushTop - motion.press * (crushTop - geo.carW * 0.55);
    mats.red.emissiveIntensity = motion.registryFlash * 1.4;
  });
  // the pile of earlier attacks, a few crushed cubes beside the container
  const pile = useMemo(() => Array.from({ length: 7 }, (_, k) => ({ x: (k % 3) * geo.carW * 0.75, z: Math.floor(k / 3) * geo.carW * 0.75, y: k > 4 ? geo.carW * 0.7 : 0, r: k * 0.7 })), [geo.carW]);
  const local = (v: Vector3) => {
    const dx = v.x - c.x;
    const dz = v.z - c.z;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    return [dx * cs + dz * sn, 0, -dx * sn + dz * cs] as [number, number, number];
  };
  const cr = local(crusher);
  const bn = local(bin);
  const posts = useMemo(() => {
    const out: [number, number][] = [];
    const step = Math.max(2, S * 0.18);
    for (let x = -w / 2; x <= w / 2; x += step) out.push([x, -d / 2], [x, d / 2]);
    for (let z = -d / 2 + step; z < d / 2; z += step) out.push([w / 2, z], [-w / 2, z]);
    return out;
  }, [w, d, S]);
  const fenceH = Math.max(1.5, S * 0.12);
  return (
    <group position={c} rotation={[0, -yaw, 0]}>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.pad} receiveShadow>
        <planeGeometry args={[w, d]} />
      </mesh>
      {posts.map(([x, z], k) => (
        <Block key={k} w={0.25} h={fenceH} d={0.25} x={x} z={z} mat={mats.fence} />
      ))}
      {/* the crusher: a gantry over its anvil, the press hanging from it */}
      <group position={cr}>
        <Block w={geo.carL * 1.3} h={geo.carW * 0.25} d={geo.carW * 1.6} mat={mats.frame} />
        {[-1, 1].map((s) => (
          <Block key={s} w={geo.carW * 0.3} h={crushTop + geo.carW * 0.9} d={geo.carW * 0.3} z={s * geo.carW * 0.95} mat={mats.frame} />
        ))}
        <Block w={geo.carW * 0.5} h={geo.carW * 0.35} d={geo.carW * 2.2} y0={crushTop + geo.carW * 0.9} mat={mats.frame} />
        <group ref={press} position={[0, crushTop, 0]}>
          <Block w={geo.carL * 1.15} h={geo.carW * 0.35} d={geo.carW * 1.4} mat={mats.press} />
          <Block w={geo.carL * 1.17} h={geo.carW * 0.06} d={geo.carW * 1.42} mat={mats.red} />
        </group>
      </group>
      {pile.map((q, k) => (
        <mesh key={k} position={[bn[0] - geo.carL * 1.4 + q.x, q.y + geo.carW * 0.35, bn[2] + q.z - geo.carW * 0.4]} rotation={[0, q.r, 0]} material={mats.cube}>
          <boxGeometry args={[geo.carW * 0.7, geo.carW * 0.7, geo.carW * 0.7]} />
        </mesh>
      ))}
      <Word at={[0, fenceH + geo.carW * 3.5, 0]}>Déchetterie</Word>
    </group>
  );
}

/** the scrapyard's frame, where its container stands: shared by the yard and the registry's container */
export function yardLocal(geo: GuardGeo, v: Vector3): [number, number, number] {
  const { c, yaw } = geo.scrapyard;
  const dx = v.x - c.x;
  const dz = v.z - c.z;
  return [dx * Math.cos(yaw) + dz * Math.sin(yaw), 0, -dx * Math.sin(yaw) + dz * Math.cos(yaw)];
}

/** the hackers' registry: an open container at the yard's far side, its rim in the refusal's red; a door of its own */
export function RegistryBin({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { c, yaw, bin } = geo.scrapyard;
  const mats = useMemo(() => ({ bin: lambert(MASS3.wall[theme]), red: new MeshLambertMaterial({ color: AVAGUARD3.registry[theme], emissive: new Color(AVAGUARD3.registry[theme]), emissiveIntensity: 0 }) }), [theme]);
  useFrame(() => {
    mats.red.emissiveIntensity = motion.registryFlash * 1.4;
  });
  return (
    <group position={c} rotation={[0, -yaw, 0]}>
      <group position={yardLocal(geo, bin)}>
        <Block w={geo.carL * 1.3} h={geo.carW * 1.1} d={geo.carW * 1.6} mat={mats.bin} />
        <Block w={geo.carL * 1.32} h={geo.carW * 0.12} d={geo.carW * 1.62} y0={geo.carW * 1.1} mat={mats.red} />
        <Word at={[0, geo.carW * 2.6, 0]} tone={AVAGUARD3.registry[theme]} small>
          Registre des hackers
        </Word>
      </group>
    </group>
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


