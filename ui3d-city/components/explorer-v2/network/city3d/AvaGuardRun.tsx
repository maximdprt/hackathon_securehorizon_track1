"use client";

// AVAGUARD: one protected transaction at a time, in the vendored City (not from builders-hub). The Director
// (sim/Director.ts) tweens `motion`; this reads it every frame (no React state per frame) to drive our car along our
// street's lanes, and plays the analysis at the toll. It registers how the Director moves the camera (their Rig, by a
// Shot), flashes the C-Chain (their HubTower, HUB_KICK) and shakes. Mounted in City3D.tsx inside <Rise>.
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, Vector3 } from "three";
import gsap from "gsap";
import type { City } from "@/components/explorer-v2/network/city";
import type { CameraHandle, Route } from "@/components/explorer-v2/network/icm-map";
import { registerScene, type Shot as GuardShotName } from "@/sim/Director";
import { motion, sim, useSim } from "@/sim/store";
import { STATE, shortAddr, toneOf } from "@/sim/types";
import { cn } from "@/lib/utils";
import { HUB_KICK } from "./HubTower";
import { HALO } from "./Labels";
import type { RouteStreets } from "./lanes";
import type { CityModel } from "./model";
import { AVAGUARD3, FLEET, type Theme } from "./palette";
import type { Shot } from "./Rig";
import { TIME } from "./shaders";
import { CANOPY_H, EQUATOR, PODS, ROOF, podGeometry } from "./Traffic";
import { guardGeoOf, poseAt, type GuardGeo } from "./guardGeo";
import { Crown, ProofStack, RegistryBin, Scrapyard, Toll } from "./Parcel";
import { HumanLot } from "./HumanLot";
import { GuardCar } from "./GuardCar";
import { CarTip, Door, OPEN, ParkingTip, ProofTip, RegistryTip, ScrapTip, TollTip } from "./Door";

type Props = { model: CityModel; city: City; routes: Route[]; streets: RouteStreets[]; theme: Theme; still: boolean; onShot: (s: Shot | null) => void; cameraRef?: RefObject<CameraHandle | null> };

/** the camera's shots over our parcel, framed by their Rig from points (Rig.tsx Shot) */
function shotsOf(g: GuardGeo): Record<GuardShotName, Shot> {
  const ring = (c: Vector3, r: number, y = 0) => Array.from({ length: 8 }, (_, i) => new Vector3(c.x + r * Math.cos((i / 8) * Math.PI * 2), y, c.z + r * Math.sin((i / 8) * Math.PI * 2)));
  const top = g.hq.base + g.hq.crest;
  // looked at from outside the ward, inward: the HQ and downtown stand behind what the shot shows
  const out = (p: Vector3) => Math.PI / 2 - Math.atan2(p.z, p.x);
  /** halfway between outward and away from a tower beside it */
  const awayFrom = (p: Vector3, b: { x: number; z: number }) => {
    const r = Math.hypot(p.x, p.z) || 1;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    return Math.atan2(p.x / r + dx / d, p.z / r + dz / d);
  };
  return {
    security: { key: "guard:security", points: [new Vector3(g.hq.x, top + 10, g.hq.z), g.toll.p, g.parking.c, g.scrapyard.c, ...ring(new Vector3(g.hq.x, 0, g.hq.z), g.S * 2.6)].map((p) => p.clone()), polar: 0.9, cap: 1 / 3.2, fill: 0.9, az: out(g.toll.p) },
    toll: { key: "guard:toll", points: [g.toll.p.clone().setY(g.S * 1.9), ...ring(g.toll.p, g.S * 1.2)], polar: 0.62, cap: 1 / 6, fill: 0.8, az: out(g.toll.p) },
    // the lot from the side away from the HQ and from outside the ward, high: the HQ's tower stands behind it, never over its bays
    parking: { key: "guard:parking", points: [g.parking.c.clone().setY(g.carW * 2.4), ...ring(g.parking.c, g.parking.w * 0.55)], polar: 0.55, cap: 1 / 6, fill: 0.84, az: awayFrom(g.parking.c, g.hq) },
    scrapyard: { key: "guard:scrapyard", points: [g.scrapyard.c.clone().setY(g.S * 1.1), ...ring(g.scrapyard.c, g.scrapyard.w * 0.75)], polar: 0.7, cap: 1 / 6, fill: 0.86, az: out(g.scrapyard.c) },
    cchain: { key: "guard:cchain", points: [new Vector3(0, g.hubTop * 0.75, 0), g.out.clone(), g.stop.p.clone(), ...ring(new Vector3(0, 0, 0), g.S * 2.4)], polar: 1.0, cap: 1 / 3, fill: 0.88 },
    follow: { key: "guard:follow", points: [...g.legs.approach.pts.filter((_, i) => i % 4 === 0), g.toll.p.clone().setY(g.S * 1.2), new Vector3(g.hq.x, g.hq.base + g.hq.crest * 0.6, g.hq.z)], polar: 0.8, cap: 1 / 4.5, fill: 0.86, az: out(g.toll.p) },
  };
}

/* ------------------------------------------------------------------ */
/* the analysis at the toll                                            */
/* ------------------------------------------------------------------ */

/** the smart contract, unfolding over the toll; its dangerous line freezes in a red frame with RISQUE */
function ContractHolo({ geo }: { geo: GuardGeo }) {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  if (!tx || phase !== "analysis" || step < 1 || step > 6) return null;
  const code = tx.contract_code?.length ? tx.contract_code : [tx.contract.line];
  const flagged = step >= 2;
  return (
    <Html position={geo.toll.p.clone().setY(geo.S * 1.5)} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
      <div className="w-[340px] origin-bottom animate-in fade-in-0 zoom-in-y-50 rounded-xl border border-[#6FA8FF]/40 bg-zinc-950/80 p-3 font-mono text-[11px] leading-relaxed text-[#cfe1ff] shadow-[0_0_30px_rgba(111,168,255,0.25)] backdrop-blur">
        <div className="mb-1 flex justify-between text-[9.5px] font-bold uppercase tracking-[0.16em] text-[#6FA8FF]">
          <span>Contrat · {tx.contract.method}</span>
          <span>{shortAddr(tx.to.address)}</span>
        </div>
        {code.map((line, i) => {
          const risky = flagged && tx.contract.risky && line.trim() === tx.contract.line.trim();
          return (
            <div key={i} className={cn("flex items-center justify-between gap-2 truncate rounded px-1", risky && "bg-[#FF5D57]/15 text-white outline outline-2 outline-[#FF5D57]")}>
              <span className="truncate">{line}</span>
              {risky && <span className="shrink-0 rounded bg-[#FF5D57] px-1 text-[9px] font-bold text-white">RISQUE</span>}
            </div>
          );
        })}
      </div>
    </Html>
  );
}

/** the authority thread: Human -> Agent -> tool -> document, link by link; the pirate link breaks in red */
function AuthorityThread({ geo }: { geo: GuardGeo }) {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const show = !!tx && phase === "analysis" && step >= 2 && step <= 6;
  const chain = tx?.authority_chain ?? [];
  const nodes = useMemo(() => {
    const side = new Vector3(-Math.sin(geo.toll.yaw), 0, Math.cos(geo.toll.yaw)).multiplyScalar(-1);
    const back = new Vector3(Math.cos(geo.toll.yaw), 0, Math.sin(geo.toll.yaw)).multiplyScalar(-1);
    return chain.map((_, i) => geo.stop.p.clone().add(side.clone().multiplyScalar(geo.S * (0.9 + i * 0.05))).add(back.clone().multiplyScalar(geo.S * (0.9 - i * 0.55))).setY(geo.S * (1.15 + 0.12 * i)));
  }, [chain, geo]);
  const lines = useRef<LineSegments>(null);
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array((chain.length + 1) * 6), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array((chain.length + 1) * 6), 3));
    return g;
  }, [chain.length]);
  const lit = useRef(0);
  useFrame(() => {
    if (!show || !lines.current) return;
    const pos = geom.getAttribute("position") as BufferAttribute;
    const col = geom.getAttribute("color") as BufferAttribute;
    const reveal = motion.authority * chain.length;
    lit.current = Math.floor(reveal + 0.001);
    const car = geo.stop.p.clone().setY(geo.carW * 1.2);
    // the order's way: from the car up to the document, then the document up to the human
    const seq = [car, ...[...nodes].reverse()];
    const oks = [...chain].reverse().map((n) => n.ok);
    for (let i = 0; i < seq.length - 1; i++) {
      const k = Math.max(0, Math.min(1, reveal - i));
      const a = seq[i];
      const b = seq[i].clone().lerp(seq[i + 1], oks[i] ? k : Math.min(k, 0.45));
      pos.setXYZ(i * 2, a.x, a.y, a.z);
      pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
      const c = new Color(oks[i] ? STATE.allow.hex : STATE.block.hex);
      col.setXYZ(i * 2, c.r, c.g, c.b);
      col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geom.setDrawRange(0, (seq.length - 1) * 2);
  });
  if (!show) return null;
  return (
    <group>
      <lineSegments ref={lines} geometry={geom}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>
      {nodes.map((p, i) => (
        <group key={i} position={p}>
          <mesh>
            <sphereGeometry args={[geo.carW * 0.28, 14, 10]} />
            <meshBasicMaterial color={chain[i].ok ? STATE.allow.hex : STATE.block.hex} toneMapped={false} />
          </mesh>
          <Html center zIndexRange={[25, 0]} style={{ pointerEvents: "none" }}>
            <div className={cn("ml-16 whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.12em]", HALO)} style={{ color: chain[i].ok ? STATE.allow.hex : STATE.block.hex }}>
              {chain[i].step}
              {!chain[i].ok && tx?.break_note && <div className="mt-0.5 normal-case tracking-normal">{tx.break_note}</div>}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

/** the Snowball nod: 20 samplers in a ring, five waves of rays at the car, the majority colour spreading */
function Snowball({ geo }: { geo: GuardGeo }) {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const show = !!tx && phase === "analysis" && step >= 3 && step <= 6;
  const N = 20;
  const spheres = useRef<InstancedMesh>(null);
  const rays = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(N * 6), 3));
    return new LineSegments(g, new LineBasicMaterial({ color: "#cfe1ff", transparent: true, opacity: 0.6, toneMapped: false }));
  }, []);
  const grey = useMemo(() => new Color("#5d636d"), []);
  const m = useMemo(() => new Matrix4(), []);
  useFrame(({ clock }) => {
    if (!show || !spheres.current || !tx) return;
    const target = new Color(STATE[toneOf(tx.decision)].hex);
    const wave = Math.min(4, Math.floor(motion.snow * 5));
    const share = tx.decision === "HUMAN" ? 0.55 : 1;
    const colored = Math.round(N * share * Math.min(1, ((wave + 1) / 5) ** 1.5) * (motion.snow > 0 ? 1 : 0));
    const c = geo.stop.p;
    const R = geo.S * 1.0;
    const pos = rays.geometry.getAttribute("position") as BufferAttribute;
    const t = clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + t * 0.4;
      const x = c.x + Math.cos(a) * R;
      const z = c.z + Math.sin(a) * R;
      const y = geo.S * 0.55 + Math.sin(t * 2 + i) * geo.carW * 0.2;
      m.makeTranslation(x, y, z);
      spheres.current.setMatrixAt(i, m);
      spheres.current.setColorAt(i, i < colored ? target : grey);
      const firing = step === 3 && (i + wave * 4) % 5 === 0;
      pos.setXYZ(i * 2, x, y, z);
      pos.setXYZ(i * 2 + 1, firing ? c.x : x, firing ? geo.carW : y, firing ? c.z : z);
    }
    pos.needsUpdate = true;
    spheres.current.instanceMatrix.needsUpdate = true;
    if (spheres.current.instanceColor) spheres.current.instanceColor.needsUpdate = true;
  });
  if (!show) return null;
  return (
    <group>
      <instancedMesh ref={spheres} args={[undefined, undefined, N]} frustumCulled={false}>
        <sphereGeometry args={[geo.carW * 0.22, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <primitive object={rays} />
    </group>
  );
}

/** the registry ping: a ray from the toll to the hackers' container, white with no match, red on a match */
function RegistryPing({ geo }: { geo: GuardGeo }) {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const show = !!tx && phase === "analysis" && step === 4;
  const dot = useRef<Mesh>(null);
  const a = useMemo(() => geo.toll.p.clone().setY(geo.S * 0.7), [geo]);
  const b = useMemo(() => geo.scrapyard.bin.clone().setY(geo.carW * 1.4), [geo]);
  const line = useMemo(() => {
    const g = new BufferGeometry().setFromPoints(Array.from({ length: 33 }, (_, i) => a.clone().lerp(b, i / 32).setY(a.y + Math.sin((i / 32) * Math.PI) * geo.S * 0.8 + (b.y - a.y) * (i / 32))));
    return g;
  }, [a, b, geo.S]);
  useFrame(() => {
    if (!dot.current) return;
    const k = motion.ping;
    dot.current.position.copy(a).lerp(b, k).setY(a.y + Math.sin(k * Math.PI) * geo.S * 0.8 + (b.y - a.y) * k);
  });
  if (!show || !tx) return null;
  const hit = !!tx.registry_hit;
  return (
    <group>
      <lineSegments>
        <primitive object={line} attach="geometry" />
        <lineBasicMaterial color={hit ? STATE.block.hex : "#ffffff"} transparent opacity={0.7} toneMapped={false} />
      </lineSegments>
      <mesh ref={dot}>
        <sphereGeometry args={[geo.carW * 0.3, 12, 8]} />
        <meshBasicMaterial color={hit ? STATE.block.hex : "#ffffff"} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** the verdict: green crystals and the visa on the roof, red frost, or amber flakes under an hourglass; the shield at the C-Chain */
function Verdict({ geo }: { geo: GuardGeo }) {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const N = 90;
  const pts = useRef<Group>(null);
  const seeds = useMemo(() => Array.from({ length: N }, () => [Math.random() * Math.PI * 2, Math.random(), Math.random()]), []);
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(N * 3), 3));
    return g;
  }, []);
  const label = useRef<HTMLDivElement>(null);
  const shield = useRef<HTMLDivElement>(null);
  const carAt = useMemo(() => new Vector3(), []);
  useFrame(({ clock }) => {
    if (!tx || !pts.current) return;
    const leg = geo.legs[motion.leg as keyof GuardGeo["legs"]];
    if (leg) poseAt(leg, motion.u, carAt);
    pts.current.position.copy(carAt);
    const pos = geom.getAttribute("position") as BufferAttribute;
    const k = motion.crystals;
    const w = geo.carW;
    for (let i = 0; i < N; i++) {
      const [a, r, h] = seeds[i];
      let x: number, y: number, z: number;
      if (tx.decision === "ALLOW") {
        const fall = Math.min(1, k * (1 + h));
        x = Math.cos(a) * (1 - fall) * w * 3 + Math.cos(a) * r * w * 0.5 * fall;
        z = Math.sin(a) * (1 - fall) * w * 3 + Math.sin(a) * r * w * 0.35 * fall;
        y = (1 - fall) * w * 5 + fall * w * 0.75;
      } else if (tx.decision === "BLOCK") {
        const f = motion.frost;
        const spin = a + (1 - f) * clock.elapsedTime * 3;
        x = Math.cos(spin) * w * (0.7 + r * 0.9);
        z = Math.sin(spin) * w * (0.5 + r * 0.6);
        y = w * (0.2 + h * 1.3);
      } else {
        x = Math.cos(a + clock.elapsedTime * 0.2) * w * (1 + r);
        z = Math.sin(a + clock.elapsedTime * 0.2) * w * (1 + r);
        y = w * (1.6 + h * 1.2) + Math.sin(clock.elapsedTime + a) * w * 0.15;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    if (label.current) label.current.style.opacity = String(Math.min(1, k * 1.5));
    if (shield.current) shield.current.style.opacity = String(motion.shield);
  });
  const shown = !!tx && ((phase === "analysis" && step >= 6) || ["allow", "block", "human", "home"].includes(phase) || motion.crystals > 0);
  if (!tx || !shown) return null;
  const tone = STATE[toneOf(tx.decision)].hex;
  return (
    <group ref={pts}>
      <points geometry={geom}>
        <pointsMaterial color={tone} size={geo.carW * 0.22} sizeAttenuation transparent opacity={0.95} toneMapped={false} />
      </points>
      <Html position={[0, geo.carW * 2.8, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div ref={label} style={{ opacity: 0 }}>
          {tx.decision === "ALLOW" ? (
            <div className="whitespace-nowrap rounded-md border-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: tone, borderColor: tone, background: "rgba(9,9,11,0.7)" }}>
              {tx.onchain?.visa_id ?? "VISA"} · signé KMS
            </div>
          ) : tx.decision === "HUMAN" ? (
            <svg width="26" height="34" viewBox="0 0 44 56" aria-hidden>
              <path d="M6 4 H38 M6 52 H38 M10 4 C10 20 34 24 34 28 C34 32 10 36 10 52 M34 4 C34 20 10 24 10 28 C10 32 34 36 34 52" fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round" />
            </svg>
          ) : (
            <div className="whitespace-nowrap rounded-md border-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: tone, borderColor: tone, background: "rgba(9,9,11,0.7)" }}>
              Refus
            </div>
          )}
        </div>
      </Html>
      <Html position={[0, geo.carW * 4.6, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div ref={shield} style={{ opacity: 0 }} className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#3FD08F]/60 bg-zinc-950/80 px-2.5 py-1 text-[11px] font-medium text-[#3FD08F]">
          <svg width="14" height="14" viewBox="0 0 26 26" aria-hidden>
            <path d="M13 2 L23 6 V13 C23 18.5 18.8 22.6 13 24 C7.2 22.6 3 18.5 3 13 V6 Z" fill="none" stroke="#3FD08F" strokeWidth="2.4" strokeLinejoin="round" />
          </svg>
          Accepté et protégé par AvaGuard+
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */

export function AvaGuardRun({ model, city, routes, streets, theme, still, onShot, cameraRef }: Props) {
  const geo = useMemo(() => guardGeoOf(model, city, routes, streets), [model, city, routes, streets]);
  const shots = useMemo(() => (geo ? shotsOf(geo) : null), [geo]);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const shake = useRef(0);
  const stillRef = useRef(still);
  stillRef.current = still;

  useEffect(() => {
    if (!shots) return;
    registerScene({
      fly: (s) => onShot(shots[s]),
      home: () => {
        onShot(null);
        cameraRef?.current?.home();
      },
      flashTower: () => {
        HUB_KICK.runs.push({ at: TIME.value, out: true });
      },
      shake: () => {
        shake.current = 1;
      },
      still: () => stillRef.current,
    });
    // a debug flight: the ward from straight above (tools/capture.mjs)
    (window as unknown as { __guardTop?: (r: number) => void }).__guardTop = (r) => onShot({ key: `guard:top:${r}`, points: [new Vector3(geo!.hq.x - r, 0, geo!.hq.z - r), new Vector3(geo!.hq.x + r, 0, geo!.hq.z + r)], polar: 0.02, cap: 0.01, fill: 0.95, az: 0 });
    // a test and debug handle: the parcel's places, read by tools/capture.mjs
    (window as unknown as { __guard?: unknown }).__guard = geo && { dbg: geo.dbg, S: geo.S, carW: geo.carW, toll: geo.toll.p.toArray(), parking: geo.parking.c.toArray(), scrapyard: geo.scrapyard.c.toArray(), legs: Object.fromEntries(Object.entries(geo.legs).map(([k, v]) => [k, Math.round(v.len)])) };
  }, [shots, geo, onShot, cameraRef]);

  // a test handle: where each door stands on screen now (tools/capture.mjs and the Playwright suite click them)
  const size = useThree((s) => s.size);
  const el = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (!geo) return;
    // a few points of each door: the first one the canvas itself takes on screen (an HTML label may lie over another)
    const spots: Record<string, Vector3[]> = {
      toll: [geo.toll.p.clone().setY(geo.S * 0.4)],
      parking: [geo.parking.slots[0], geo.parking.slots[1], geo.parking.slots[4], geo.parking.slots[5], geo.parking.c].map((v) => v.clone().setY(v.y + 0.4)),
      scrapyard: [geo.scrapyard.c.clone().setY(geo.scrapyard.c.y + 0.3), geo.scrapyard.crusher.clone().setY(geo.carW * 0.6)],
      registry: [geo.scrapyard.bin.clone().setY(geo.carW * 0.9)],
      proof: [geo.proof.clone().setY(geo.proof.y + Math.max(1.6, geo.S * 0.12) * 0.45)],
      hub: [new Vector3(0, geo.hubTop * 0.55, 0)],
      hq: [new Vector3(geo.hq.x, geo.hq.base + geo.hq.crest * 0.5, geo.hq.z), new Vector3(geo.hq.x, geo.hq.base + geo.hq.crest * 0.3, geo.hq.z)],
      // another chain's tower: tall ones on the city's near side (the camera's home looks from +z), none behind downtown
      chain: [...model.buildings]
        .filter((b) => b.id !== geo.hq.id && b !== model.buildings[model.hub] && b.z > Math.abs(b.x) * 0.3 && Math.hypot(b.x, b.z) > 160)
        .sort((a, b) => b.crest - a.crest)
        .slice(0, 6)
        .map((b) => new Vector3(b.x, b.base + b.crest * 0.6, b.z)),
    };
    (window as unknown as { __doorAt?: (k: string) => [number, number] | null }).__doorAt = (k) => {
      const r = el.getBoundingClientRect();
      let first: [number, number] | null = null;
      for (const v of spots[k] ?? []) {
        const p = v.clone().project(camera);
        const at: [number, number] = [Math.round(r.left + (p.x * 0.5 + 0.5) * size.width), Math.round(r.top + (-p.y * 0.5 + 0.5) * size.height)];
        first ??= at;
        if (document.elementFromPoint(at[0], at[1]) === el) return at;
      }
      return first;
    };
  }, [geo, camera, size, el, model]);

  // a still city draws on demand: keep it drawing while a transaction plays
  useEffect(() => {
    const tick = () => {
      if (sim.get().phase !== "idle") invalidate();
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [invalidate]);

  // a short shake on the press's impact (none in reduced motion)
  const offset = useRef(new Vector3());
  useFrame((_, dt) => {
    camera.position.sub(offset.current);
    offset.current.set(0, 0, 0);
    if (shake.current > 0 && !still) {
      const a = shake.current * (geo?.S ?? 10) * 0.08;
      offset.current.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      camera.position.add(offset.current);
      shake.current = Math.max(0, shake.current - dt / 0.45);
    }
  });

  if (!geo) return null;
  return (
    <group>
      <Crown geo={geo} theme={theme} />
      {/* each piece of the parcel is a door to its screen (Door.tsx, sim/nav.ts) */}
      <Door name="guard:toll" at={[geo.toll.p.x, geo.S * 1.1, geo.toll.p.z]} tip={<TollTip />} onOpen={OPEN.toll}>
        <Toll geo={geo} theme={theme} />
      </Door>
      <Door name="guard:parking" at={[geo.parking.c.x, geo.S * 0.5, geo.parking.c.z]} tip={<ParkingTip />} onOpen={OPEN.parking}>
        <HumanLot geo={geo} theme={theme} />
      </Door>
      <Door name="guard:scrapyard" at={[geo.scrapyard.crusher.x, geo.carW * 3.2, geo.scrapyard.crusher.z]} tip={<ScrapTip />} onOpen={OPEN.scrapyard}>
        <Scrapyard geo={geo} theme={theme} />
      </Door>
      <Door name="guard:registry" at={[geo.scrapyard.bin.x, geo.carW * 2, geo.scrapyard.bin.z]} tip={<RegistryTip />} onOpen={OPEN.registry}>
        <RegistryBin geo={geo} theme={theme} />
      </Door>
      <Door name="guard:proof" at={[geo.proof.x, geo.S * 0.4, geo.proof.z]} tip={<ProofTip />} onOpen={OPEN.proof}>
        <ProofStack geo={geo} theme={theme} />
      </Door>
      <GuardCar geo={geo} theme={theme} />
      <ContractHolo geo={geo} />
      <AuthorityThread geo={geo} />
      <Snowball geo={geo} />
      <RegistryPing geo={geo} />
      <Verdict geo={geo} />
    </group>
  );
}
