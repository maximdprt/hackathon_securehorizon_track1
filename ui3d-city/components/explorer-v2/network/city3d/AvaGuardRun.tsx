"use client";

// AVAGUARD: one protected transaction at a time, in the vendored City (not from builders-hub). The Director
// (sim/Director.ts) tweens `motion`; this reads it every frame (no React state per frame) to drive our car along our
// street's lanes, and plays the analysis at the toll. It registers how the Director moves the camera (their Rig, by a
// Shot), flashes the C-Chain (their HubTower, HUB_KICK) and shakes. Mounted in City3D.tsx inside <Rise>.
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import gsap from "gsap";
import type { City } from "@/components/explorer-v2/network/city";
import type { CameraHandle, Route } from "@/components/explorer-v2/network/icm-map";
import { registerScene, type Shot as GuardShotName } from "@/sim/Director";
import { sim } from "@/sim/store";
import { HUB_KICK } from "./HubTower";
import type { RouteStreets } from "./lanes";
import type { CityModel } from "./model";
import type { Theme } from "./palette";
import type { Shot } from "./Rig";
import { TIME } from "./shaders";
import { guardGeoOf, poseAt, type GuardGeo } from "./guardGeo";
import { Crown, ProofStack, Word } from "./Parcel";
import { CityYard } from "./CityYard";
import { HumanLot } from "./HumanLot";
import { GuardCar, type CarMats } from "./GuardCar";
import { Road } from "./Road";
import { SENTINEL_ONLY } from "@/components/explorer-v2/network/avaguard";
import { Door, OPEN, ParkingTip, ProofTip } from "./Door";

type Props = { model: CityModel; city: City; routes: Route[]; streets: RouteStreets[]; theme: Theme; still: boolean; onShot: (s: Shot | null) => void; cameraRef?: RefObject<CameraHandle | null> };

/** the camera's shots over our parcel, framed by their Rig from points (Rig.tsx Shot) */
function shotsOf(g: GuardGeo): Record<GuardShotName, Shot> {
  const ring = (c: Vector3, r: number, y = 0) => Array.from({ length: 8 }, (_, i) => new Vector3(c.x + r * Math.cos((i / 8) * Math.PI * 2), y, c.z + r * Math.sin((i / 8) * Math.PI * 2)));
  const top = g.hq.base + g.hq.crest;
  // looked at from outside the ward, inward: the HQ and downtown stand behind what the shot shows
  const out = (p: Vector3) => Math.PI / 2 - Math.atan2(p.z, p.x);
  // the road's shots look the other way, from downtown's side and a little aside (never through the hub's tower): the
  // car comes toward the camera, through the gantry, the HQ tower standing behind it instead of in front of it
  const road = out(g.toll.p) + Math.PI - 0.85;
  /** halfway between outward and away from a tower beside it */
  const awayFrom = (p: Vector3, b: { x: number; z: number }) => {
    const r = Math.hypot(p.x, p.z) || 1;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    return Math.atan2(p.x / r + dx / d, p.z / r + dz / d);
  };
  return {
    security: { key: "guard:security", points: [new Vector3(g.hq.x, top + 10, g.hq.z), g.toll.p, g.parking.c, g.scrapyard.c, ...ring(new Vector3(g.hq.x, 0, g.hq.z), g.S * 2.6)].map((p) => p.clone()), polar: 0.9, cap: 1 / 3.2, fill: 0.9, az: road },
    // SENTINEL (deployed): a lower, closer look at the gantry, the car scanned under it
    toll: { key: "guard:toll", points: [g.toll.p.clone().setY(g.S * 1.1), ...ring(g.toll.p, g.S * 0.95)], polar: 0.6, cap: 1 / 5.4, fill: 0.92, az: road },
    // the lot from the side away from the HQ and from outside the ward, high: the HQ's tower stands behind it, never over its bays
    parking: { key: "guard:parking", points: [g.parking.c.clone().setY(g.carW * 2.4), ...ring(g.parking.c, g.parking.w * 0.55)], polar: 0.55, cap: 1 / 6, fill: 0.84, az: awayFrom(g.parking.c, g.hq) },
    // the yard from its lane's side (the reference's cameras look at the baler over the lane)
    scrapyard: { key: "guard:scrapyard", points: [g.scrapyard.W(2, 0, -6.5), g.scrapyard.W(20, 0, 1), g.scrapyard.W(11, 5, -3), g.scrapyard.W(2, 0, 1), g.scrapyard.W(20, 0, -6.5)], polar: 0.95, cap: 1 / 8, fill: 0.9, az: Math.atan2(g.scrapyard.zHat.x, g.scrapyard.zHat.z) },
    press: { key: "guard:press", points: [g.scrapyard.W(5.5, 0, -6.5), g.scrapyard.W(13, 0, -3.2), g.scrapyard.W(9, 2.5, -5)], polar: 0.55, cap: 1 / 12, fill: 0.86, az: Math.atan2(g.scrapyard.zHat.x, g.scrapyard.zHat.z) },
    skip: { key: "guard:skip", points: [g.scrapyard.W(12, 0, -6), g.scrapyard.W(20, 0, 0), g.scrapyard.W(16.5, 3, -1.8)], polar: 0.85, cap: 1 / 10, fill: 0.86, az: Math.atan2(g.scrapyard.zHat.x, g.scrapyard.zHat.z) },
    // the green road from the gantry to the C-Chain's gate, looked at from outside the city: the hub's tower stands behind the car, never in front
    cchain: { key: "guard:cchain", points: [...g.legs.toCChain.pts.filter((_, i) => i % 3 === 0), g.gate.p.clone(), g.stop.p.clone()].map((p) => p.clone().setY(p.y + g.carW)), polar: 0.75, cap: 1 / 5, fill: 0.86, az: out(g.legs.toCChain.pts[Math.floor(g.legs.toCChain.pts.length / 2)]) },
    // the C-Chain's gate, close: the visa's car going through it
    gate: { key: "guard:gate", points: [g.gate.p.clone().setY(g.carW * 2), ...ring(g.gate.p, g.carW * 3.2)], polar: 0.7, cap: 1 / 7, fill: 0.9, az: out(g.gate.p) + Math.PI - 0.6 },
    follow: { key: "guard:follow", points: [...g.legs.approach.pts.filter((_, i) => i % 4 === 0), g.toll.p.clone().setY(g.S * 1.2), new Vector3(g.hq.x, g.hq.base + g.hq.crest * 0.6, g.hq.z)], polar: 0.8, cap: 1 / 4.5, fill: 0.86, az: road },
  };
}

/** the C-Chain's gate on the lane into the hub: two red pillars and a lintel across the lane; a visa's car goes through
    it and is gone (GuardCar cuts it at the gate's plane) */
function CChainGate({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { p, yaw, w } = geo.gate;
  const h = geo.carW * 1.7;
  const t = geo.carW * 0.22;
  const red = theme === "dark" ? "#FF4D57" : "#E6212F";
  return (
    <group position={p} rotation={[0, -yaw, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, h / 2, (side * (w + t)) / 2]} castShadow>
          <boxGeometry args={[t, h, t]} />
          <meshLambertMaterial color={red} />
        </mesh>
      ))}
      <mesh position={[0, h + t / 2, 0]} castShadow>
        <boxGeometry args={[t, t, w + t * 2]} />
        <meshLambertMaterial color={red} />
      </mesh>
      <Word at={[0, h + geo.carW * 0.9, 0]} tone={red} small>
        C-Chain · entrée
      </Word>
    </group>
  );
}

export function AvaGuardRun({ model, city, routes, streets, theme, still, onShot, cameraRef }: Props) {
  const geo = useMemo(() => guardGeoOf(model, city, routes, streets), [model, city, routes, streets]);
  // the city car's materials, shared with the yard's car so the hand-over at PICK does not show
  const carMats = useRef<CarMats | null>(null);
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
    (window as unknown as { __guard?: unknown }).__guard = geo && {
      dbg: geo.dbg,
      S: geo.S,
      carW: geo.carW,
      carL: geo.carL,
      k: geo.k,
      hq: [geo.hq.x, geo.hq.z],
      toll: geo.toll.p.toArray(),
      stop: geo.stop.p.toArray(),
      parking: geo.parking.c.toArray(),
      scrapyard: geo.scrapyard.c.toArray(),
      yard: { lane: [geo.scrapyard.W(-5, 0, 0).toArray(), geo.scrapyard.pick.toArray()], baler: geo.scrapyard.W(9, 0, -5).toArray(), skip: geo.scrapyard.skip.toArray() },
      city: { core: city.core, rings: city.rings, lot: city.lot, blocks: city.blocks.map((b) => [Math.round(b.r0), Math.round(b.r1), +b.a0.toFixed(3), +b.a1.toFixed(3)]) },
      legs: Object.fromEntries(Object.entries(geo.legs).map(([k, v]) => [k, Math.round(v.len)])),
    };
  }, [shots, geo, onShot, cameraRef, city]);

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
      // high on the red tower: our HQ stands in front of its foot from the home view
      hub: [0.86, 0.75, 0.55].map((k) => new Vector3(0, geo.hubTop * k, 0)),
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
      {SENTINEL_ONLY && <Road geo={geo} theme={theme} />}
      <Crown geo={geo} theme={theme} />
      {/* each piece of the parcel is a door to its screen (Door.tsx, sim/nav.ts) */}
      <Door name="guard:parking" at={[geo.parking.c.x, geo.S * 0.5, geo.parking.c.z]} tip={<ParkingTip />} onOpen={OPEN.parking}>
        <HumanLot geo={geo} theme={theme} />
      </Door>
      <Door name="guard:proof" at={[geo.proof.x, geo.S * 0.4, geo.proof.z]} tip={<ProofTip />} onOpen={OPEN.proof}>
        <ProofStack geo={geo} theme={theme} />
      </Door>
      <CChainGate geo={geo} theme={theme} />
      {/* the car's model loads apart (carModel.ts), the city stands meanwhile; the yard's car wears the hero car's materials */}
      <Suspense fallback={null}>
        <GuardCar geo={geo} theme={theme} share={carMats} />
        <CityYard geo={geo} theme={theme} carMats={carMats} />
      </Suspense>
    </group>
  );
}
