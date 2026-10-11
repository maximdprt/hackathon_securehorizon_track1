"use client";

// AVAGUARD: one protected transaction at a time, in the vendored City (not from builders-hub). The Director
// (sim/Director.ts) tweens `motion`; this reads it every frame (no React state per frame) to drive our car along our
// street's lanes, and plays the analysis at the toll. It registers how the Director moves the camera (their Rig, by a
// Shot), flashes the C-Chain (their HubTower, HUB_KICK) and shakes. Mounted in City3D.tsx inside <Rise>.
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, MeshLambertMaterial, NormalBlending, Raycaster, ShaderMaterial, Vector3, type Object3D } from "three";
import gsap from "gsap";
import type { City } from "@/components/explorer-v2/network/city";
import type { CameraHandle, Route } from "@/components/explorer-v2/network/icm-map";
import { registerScene, type Shot as GuardShotName } from "@/sim/Director";
import { motion, sim, useSim } from "@/sim/store";
import { HUB_KICK } from "./HubTower";
import type { RouteStreets } from "./lanes";
import type { CityModel } from "./model";
import { HUB3, MASS3, type Theme } from "./palette";
import type { Shot } from "./Rig";
import { TIME } from "./shaders";
import { guardGeoOf, poseAt, type GuardGeo } from "./guardGeo";
import { Crown, ProofStack, Word } from "./Parcel";
import { CityYard } from "./CityYard";
import { HumanLot } from "./HumanLot";
import { GuardCar, type CarMats } from "./GuardCar";
import { Road } from "./Road";
import { HOME_AZ, SENTINEL_ONLY } from "@/components/explorer-v2/network/avaguard";
import { Door, OPEN, ParkingTip, ProofTip } from "./Door";

/** a payment plays on the stage (shotsOf) unless the page says ?stage=0 */
const STAGE = typeof window === "undefined" || new URLSearchParams(window.location.search).get("stage") !== "0";

type Props = { model: CityModel; city: City; routes: Route[]; streets: RouteStreets[]; theme: Theme; still: boolean; onShot: (s: Shot | null) => void; cameraRef?: RefObject<CameraHandle | null> };

/** the camera's shots over our parcel, framed by their Rig from points (Rig.tsx Shot). Each looks from aside the
    straight road (from v: the camera stands that way of what it frames), so no tower ever stands between it and the car.
    The stage is the whole protocol at once, as the city's own view comes closer (its turn, HOME_AZ, and a little higher):
    the control tower's door, the gantry, the human post, the yard, the C-Chain's gate, the skyline behind; it is where a
    payment plays when the reader has not taken the camera */
function shotsOf(g: GuardGeo): Record<GuardShotName | "stage", Shot> {
  const ring = (c: Vector3, r: number, n = 8) => Array.from({ length: n }, (_, i) => new Vector3(c.x + r * Math.cos((i / n) * Math.PI * 2), c.y, c.z + r * Math.sin((i / n) * Math.PI * 2)));
  const from = (r: number, f: number) => {
    const v = g.R.clone().multiplyScalar(r).addScaledVector(g.F, f);
    return Math.PI / 2 - Math.atan2(v.z, v.x);
  };
  const lift = (p: Vector3, y: number) => p.clone().setY(p.y + y);
  const w = g.carW;
  const Y = g.scrapyard;
  return {
    stage: {
      key: "guard:stage",
      points: [g.P(g.dbg?.dHQ ?? 0, 0), lift(g.toll.p, w * 2), g.parking.c, g.parking.gate, g.parking.exit, Y.c, Y.skip, Y.W(-5, 0, 0), Y.W(20, 0, 1), lift(Y.crusher, w * 2), g.gate.p, g.out],
      polar: 0.82,
      cap: 1 / 3.6,
      fill: 0.9,
      slow: true,
      az: HOME_AZ,
    },
    security: { key: "guard:security", points: [lift(g.toll.p, w * 2), g.parking.c, Y.c, Y.skip, g.gate.p, lift(g.P(g.dbg?.dHQ ?? 0, 0), w * 3)], polar: 0.85, cap: 1 / 3.2, fill: 0.9, az: from(1, 0.35) },
    follow: { key: "guard:follow", points: [...g.legs.approach.pts.filter((_, i) => i % 3 === 0).map((p) => lift(p, w)), lift(g.toll.p, w * 1.5), g.stop.p], polar: 0.72, cap: 1 / 5, fill: 0.86, az: from(1, 0.55) },
    toll: { key: "guard:toll", points: [lift(g.toll.p, w * 1.8), ...ring(g.toll.p, g.carL * 1.15)], polar: 0.66, cap: 1 / 6, fill: 0.9, az: from(1, 0.4) },
    // the post from the road's right, outside it: its roof clears while the car waits
    parking: { key: "guard:parking", points: [lift(g.parking.c, w * 2.2), g.parking.gate, g.parking.exit, g.stop.p, ...ring(g.parking.c, g.parking.d * 0.5, 6)], polar: 0.62, cap: 1 / 6, fill: 0.86, az: from(1, 0.2) },
    // the yard from its far side, away from the road: the lane, the baler, the crane and the skip ahead of the camera
    scrapyard: { key: "guard:scrapyard", points: [g.stop.p, Y.W(-5, 0, 0), Y.W(20, 0, 1), Y.W(11, 5, -3), Y.W(2, 0, -6.5), Y.W(20, 0, -6.5)], polar: 0.8, cap: 1 / 7, fill: 0.88, az: from(-1, 0.35) },
    press: { key: "guard:press", points: [Y.W(5.5, 0, -6.5), Y.W(13, 0, -3.2), Y.W(9, 2.5, -5), Y.W(9, 0, 0.5)], polar: 0.6, cap: 1 / 11, fill: 0.86, az: from(-0.6, 0.8) },
    skip: { key: "guard:skip", points: [Y.W(12, 0, -6), Y.W(20, 0, 0), Y.W(16.5, 3, -1.8)], polar: 0.75, cap: 1 / 10, fill: 0.86, az: from(-0.7, 0.7) },
    // the road from the gantry to the C-Chain's gate, from its right side
    cchain: { key: "guard:cchain", points: [g.stop.p, g.parking.exit, g.gate.p, lift(g.gate.p, w * 2)], polar: 0.7, cap: 1 / 5, fill: 0.86, az: from(1, 0.15) },
    // the C-Chain's gate, close: the visa's car going through it
    gate: { key: "guard:gate", points: [lift(g.gate.p, w * 2), ...ring(g.gate.p, g.carW * 3)], polar: 0.66, cap: 1 / 7, fill: 0.9, az: from(1, 0.9) },
  };
}

/** the C-Chain's gate on the road into the hub: two dark pylons with a strip of the C-Chain's red down their inner faces,
    a lintel lit underneath, and a curtain of red light across the opening that brightens as a visa's car goes through it
    (on into the C-Chain's tower, where it is gone: guardGeo legs end at the tower's foot) */
function CChainGate({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const { p, yaw, w } = geo.gate;
  const h = geo.carW * 1.9;
  const t = geo.carW * 0.3;
  const dark = theme === "dark";
  const red = HUB3.mark[theme]; // the city's red (palette.ts)
  const mats = useMemo(
    () => ({
      pylon: new MeshLambertMaterial({ color: MASS3.frame[theme] }),
      strip: new MeshBasicMaterial({ color: new Color(red).multiplyScalar(dark ? 1.35 : 1), toneMapped: false }),
      veil: new ShaderMaterial({
        uniforms: { uColor: { value: new Color(red) }, uA: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: dark ? AdditiveBlending : NormalBlending,
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }",
        // strongest at the lintel and at the pylons, a light falling across the opening
        fragmentShader: "uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main() { float e = max( pow( vUv.y, 3.0 ), pow( abs( vUv.x - 0.5 ) * 2.0, 6.0 ) ); gl_FragColor = vec4( uColor, uA * ( 0.25 + 0.75 * e ) ); }",
      }),
    }),
    [theme, red, dark],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  // the curtain: faint at rest, bright while a visa's car comes through
  const at = useMemo(() => new Vector3(), []);
  useFrame((_, dt) => {
    let want = dark ? 0.1 : 0.06;
    if (motion.visible && (motion.leg === "toCChain" || motion.leg === "parkToCChain")) {
      const { p: car } = poseAt(geo.legs[motion.leg], motion.u, at);
      const d = car.distanceTo(p);
      want = Math.max(want, 0.6 * Math.max(0, 1 - d / (geo.carL * 2.2)));
    }
    const u = mats.veil.uniforms.uA;
    u.value += (want - u.value) * Math.min(1, dt * 6);
  });
  return (
    <group position={p} rotation={[0, -yaw, 0]}>
      {[-1, 1].map((side) => (
        <group key={side} position={[0, 0, (side * (w + t)) / 2]}>
          <mesh position={[0, h / 2, 0]} material={mats.pylon} castShadow>
            <boxGeometry args={[t, h, t]} />
          </mesh>
          {/* the strip down its inner face */}
          <mesh position={[0, h * 0.48, -side * (t / 2 + 0.03)]} material={mats.strip}>
            <boxGeometry args={[t * 0.34, h * 0.86, 0.06]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, h + t * 0.45, 0]} material={mats.pylon} castShadow>
        <boxGeometry args={[t * 1.15, t * 0.9, w + t * 2]} />
      </mesh>
      <mesh position={[0, h - 0.04, 0]} material={mats.strip}>
        <boxGeometry args={[t * 0.4, 0.08, w]} />
      </mesh>
      {/* the curtain across the opening */}
      <mesh position={[0, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.veil} renderOrder={3}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <Word at={[0, h + geo.carW * 1.05, 0]} tone={red} small>
        C-Chain · entrée
      </Word>
    </group>
  );
}

export function AvaGuardRun({ model, city, routes, streets, theme, still, onShot, cameraRef }: Props) {
  const geo = useMemo(() => guardGeoOf(model, city), [model, city]);
  // the city car's materials, shared with the yard's car so the hand-over at PICK does not show
  const carMats = useRef<CarMats | null>(null);
  const shots = useMemo(() => (geo ? shotsOf(geo) : null), [geo]);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const shake = useRef(0);
  const stillRef = useRef(still);
  stillRef.current = still;

  /* the camera follows the protocol shot by shot only when asked (a click on the car, or F); else, while a payment plays
     and the reader has not taken the camera, it stands on the stage, the whole protocol in view (?stage=0 leaves it home) */
  const follow = useSim((s) => s.follow);
  const lastShot = useRef<GuardShotName | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const staged = useRef(false);
  useEffect(() => {
    if (!shots) return;
    if (follow) onShot(shots[lastShot.current ?? "follow"]);
    else onShot(staged.current ? shots.stage : null);
  }, [follow, shots, onShot]);

  useEffect(() => {
    if (!shots) return;
    registerScene({
      fly: (s) => {
        lastShot.current = s;
        if (followRef.current) onShot(shots[s]);
        else if (STAGE && !staged.current && !cameraRef?.current?.moved) {
          staged.current = true;
          onShot(shots.stage);
        }
      },
      home: () => {
        lastShot.current = null;
        staged.current = false;
        onShot(null);
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
  const scene = useThree((s) => s.scene);
  const ray = useMemo(() => new Raycaster(), []);
  useEffect(() => {
    if (!geo) return;
    // a few points of each door: the first one the canvas itself takes on screen (an HTML label may lie over another)
    const spots: Record<string, Vector3[]> = {
      toll: [geo.toll.p.clone().setY(geo.S * 0.4)],
      parking: [...geo.parking.slots, geo.parking.wait, geo.parking.c].map((v) => v.clone().setY(v.y + 0.4)),
      scrapyard: [geo.scrapyard.c.clone().setY(geo.scrapyard.c.y + 0.3), geo.scrapyard.crusher.clone().setY(geo.carW * 0.6)],
      // a grid over the skip: the ones the press or the crane does not stand in front of are the ones to click
      registry: Array.from({ length: 6 * 5 }, (_, i) => geo.scrapyard.W(15 + (i % 6) * 0.7, 1.2, -2.8 + Math.floor(i / 6) * 0.5)),
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
        // a spot another building stands in front of (seen from the camera) is not a place to click
        ray.set(camera.position, v.clone().sub(camera.position).normalize());
        ray.camera = camera;
        const hit = ray.intersectObjects(scene.children, true).find((h) => (h.object as { isMesh?: boolean }).isMesh && h.object.visible);
        // our own doors (named guard:*): the first thing hit must be the door itself; the towers: nothing well in front
        const doorName = ["toll", "parking", "scrapyard", "registry", "proof"].includes(k) ? `guard:${k}` : null;
        let owner: Object3D | null = hit?.object ?? null;
        while (owner && !owner.name.startsWith("guard:")) owner = owner.parent;
        if (doorName ? !hit || owner?.name !== doorName || (k === "registry" && camera.position.distanceTo(v) - hit.distance > geo.carW * 1.2) : hit && hit.distance < camera.position.distanceTo(v) - geo.carW * 1.5 && hit.point.distanceTo(v) > geo.S * 0.6) continue;
        const p = v.clone().project(camera);
        const at: [number, number] = [Math.round(r.left + (p.x * 0.5 + 0.5) * size.width), Math.round(r.top + (-p.y * 0.5 + 0.5) * size.height)];
        first ??= at;
        if (document.elementFromPoint(at[0], at[1]) === el) return at;
      }
      return first;
    };
  }, [geo, camera, size, el, model, scene, ray]);

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
      <Road geo={geo} theme={theme} />
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
