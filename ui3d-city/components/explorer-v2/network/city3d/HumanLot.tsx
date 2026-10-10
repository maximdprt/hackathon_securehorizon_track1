"use client";

// AVAGUARD: the human lot (not from builders-hub), redrawn as a closed, covered car park in the city's own grade:
// a raised slab with a steel edge, a low wall and a railing round three sides and the front, one controlled gate (its
// gantry, its amber and white barrier, the warden's booth with its beacon), six numbered bays under a carport whose
// roof carries solar panels, wheel stops, aisle arrows and four lamp posts. The barrier lifts as our car comes through;
// the roof clears while a car is inside, so the camera sees it parked. Frame: +x outward (the bays' noses), +z along
// the ring, the gate on the front side (x0). Per-frame values come from `motion` and the store, never React state.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Shape, ShapeGeometry, Vector3 } from "three";
import { motion, sim, useSim } from "@/sim/store";
import { AVAGUARD3, FLEET, GROUND, MASS3, ROOF, type Theme } from "./palette";
import { poseAt, type GuardGeo } from "./guardGeo";
import { Block, Word } from "./Parcel";

const lambert = (c: string) => new MeshLambertMaterial({ color: c });
const glow = (c: string, k = 0.6) => new MeshLambertMaterial({ color: c, emissive: new Color(c), emissiveIntensity: k });

/** a railing between two points of the lot's frame: a low wall, posts, two rails */
function Railing({ a, b, wall, post, rail, h, step, t }: { a: [number, number]; b: [number, number]; wall: MeshLambertMaterial; post: MeshLambertMaterial; rail: MeshLambertMaterial; h: number; step: number; t: number }) {
  const [ax, az] = a;
  const [bx, bz] = b;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.01) return null;
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const wallH = h * 0.32;
  const n = Math.max(1, Math.round(len / step));
  const dims = (l: number, th: number) => (alongX ? { w: l, d: th } : { w: th, d: l });
  return (
    <group>
      <Block {...dims(len, t * 1.6)} h={wallH} x={mx} z={mz} mat={wall} />
      {Array.from({ length: n + 1 }, (_, k) => {
        const f = k / n;
        return <Block key={k} w={t} d={t} h={h} x={ax + (bx - ax) * f} z={az + (bz - az) * f} mat={post} />;
      })}
      {[0.62, 0.97].map((y) => (
        <Block key={y} {...dims(len, t * 0.7)} h={t * 0.6} x={mx} z={mz} y0={h * y - t * 0.3} mat={rail} />
      ))}
    </group>
  );
}

/** a flat arrow on the aisle's floor, pointing along +z */
function arrowGeometry(s: number) {
  const sh = new Shape();
  sh.moveTo(-0.18 * s, -0.5 * s);
  sh.lineTo(0.18 * s, -0.5 * s);
  sh.lineTo(0.18 * s, 0.05 * s);
  sh.lineTo(0.42 * s, 0.05 * s);
  sh.lineTo(0, 0.5 * s);
  sh.lineTo(-0.42 * s, 0.05 * s);
  sh.lineTo(-0.18 * s, 0.05 * s);
  sh.closePath();
  return new ShapeGeometry(sh).rotateX(-Math.PI / 2);
}

export function HumanLot({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const P = geo.parking;
  const w = geo.carW;
  const { bay, depth, aisle, x0, x1, z0, z1, gateZ, gateW } = P;
  const human = useSim((s) => s.phase === "human");
  const mats = useMemo(
    () => ({
      slab: lambert(GROUND.pad[theme]),
      edge: lambert(ROOF.steel[theme]),
      wall: lambert(MASS3.wall[theme]),
      frame: lambert(MASS3.frame[theme]),
      steel: lambert(ROOF.steel[theme]),
      amber: new MeshBasicMaterial({ color: AVAGUARD3.amber[theme], toneMapped: false }),
      white: lambert("#F4F6F9"),
      line: new MeshBasicMaterial({ color: AVAGUARD3.amber[theme], toneMapped: false }),
      arrow: new MeshBasicMaterial({ color: theme === "dark" ? "#C9CDD6" : "#FFFFFF", transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: DoubleSide }),
      roof: new MeshLambertMaterial({ color: MASS3.wall[theme], transparent: true, opacity: 1 }),
      solar: new MeshLambertMaterial({ color: ROOF.solar[theme], transparent: true, opacity: 1 }),
      solarEdge: new MeshLambertMaterial({ color: ROOF.solarEdge[theme], transparent: true, opacity: 1 }),
      strip: glow(AVAGUARD3.amber[theme], 0.2),
      beacon: glow(AVAGUARD3.amber[theme], 0.2),
      window: glow(FLEET.lamp[theme], theme === "dark" ? 0.55 : 0.1),
      bulb: glow(FLEET.lamp[theme], theme === "dark" ? 1.2 : 0.3),
      halo: new MeshBasicMaterial({ color: AVAGUARD3.amber[theme], transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
      stop: lambert(ROOF.cone[theme]),
    }),
    [theme],
  );
  const arrow = useMemo(() => arrowGeometry(aisle * 0.42), [aisle]);

  const arm = useRef<Group>(null);
  const beacon = useRef<Mesh>(null);
  const lift = useRef(0);
  const roofK = useRef(1);
  const car = useMemo(() => new Vector3(), []);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const inLot = motion.visible && (motion.leg === "toParking" || motion.leg === "fromParking");
    // the barrier lifts while our car is near the gate, then falls back behind it
    let near = false;
    if (inLot) {
      const leg = geo.legs[motion.leg as "toParking" | "fromParking"];
      poseAt(leg, motion.u, car);
      near = car.distanceTo(P.gate) < geo.carL * 1.7;
    }
    const k = Math.min(1, dt * 4);
    lift.current += ((near ? 1 : 0) - lift.current) * k;
    if (arm.current) arm.current.rotation.x = -lift.current * 1.35;
    // the roof clears while a car is inside, so the shot sees it parked
    const busy = inLot || sim.get().phase === "human";
    roofK.current += ((busy ? 0.3 : 1) - roofK.current) * k;
    for (const m of [mats.roof, mats.solar, mats.solarEdge]) {
      m.opacity = roofK.current;
      m.depthWrite = roofK.current > 0.95;
    }
    // a request waits: the strip under the roof breathes, the beacon turns, the bay is ringed in amber
    const waiting = sim.get().phase === "human";
    mats.strip.emissiveIntensity = waiting ? 0.7 + 0.45 * Math.sin(t * 3) : 0.2;
    mats.beacon.emissiveIntensity = waiting ? 0.8 + 0.6 * Math.sin(t * 10) : 0.15;
    mats.halo.opacity = waiting ? 0.22 + 0.12 * Math.sin(t * 3) : 0;
    if (beacon.current) beacon.current.rotation.y = waiting ? t * 6 : 0;
  });

  const slabH = 0.25;
  const y = slabH; // the floor's level, over the slab
  const roofH = w * 2.15;
  const railH = w * 0.95;
  const post = Math.max(0.22, w * 0.07);
  const roofX0 = -depth / 2 - w * 0.3;
  const roofX1 = depth / 2 + w * 0.35;
  const gz0 = gateZ - gateW / 2;
  const gz1 = gateZ + gateW / 2;
  // the booth stands on the gate's far side from the bays, by the front railing
  const side = Math.sign(gateZ) || 1;
  const booth = { x: x0 + w * 0.85, z: gateZ + side * (gateW / 2 + w * 0.62 + post * 2), w: w * 1.3, d: w * 1.25, h: w * 1.05 };
  const corners: [number, number][] = [
    [x0 + post * 2, z0 + post * 2],
    [x0 + post * 2, z1 - post * 2],
    [x1 - post * 2, z0 + post * 2],
    [x1 - post * 2, z1 - post * 2],
  ];

  return (
    <group position={[P.c.x, P.c.y, P.c.z]} rotation={[0, -P.slotYaw, 0]}>
      {/* the slab: a steel edge, the floor over it */}
      <Block w={x1 - x0 + 0.5} h={slabH * 0.9} d={z1 - z0 + 0.5} x={(x0 + x1) / 2} mat={mats.edge} />
      <Block w={x1 - x0} h={slabH} d={z1 - z0} x={(x0 + x1) / 2} mat={mats.slab} />

      {/* the enclosure: back, both sides, and the front either side of the gate */}
      <group position={[0, y, 0]}>
        <Railing a={[x1, z0]} b={[x1, z1]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
        <Railing a={[x0, z0]} b={[x1, z0]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
        <Railing a={[x0, z1]} b={[x1, z1]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
        <Railing a={[x0, z0]} b={[x0, gz0]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
        <Railing a={[x0, gz1]} b={[x0, z1]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
      </group>

      {/* the gate: two pillars, a gantry with its amber band and its word, the barrier hinged at the left pillar */}
      <group position={[x0, y, 0]}>
        {[gz0, gz1].map((z) => (
          <Block key={z} w={post * 2.6} h={w * 1.9} d={post * 2.6} z={z} mat={mats.frame} />
        ))}
        <Block w={post * 2.4} h={post * 2.2} d={gateW + post * 2.6} y0={w * 1.9} z={gateZ} mat={mats.frame} />
        <Block w={post * 2.45} h={post * 0.7} d={gateW * 0.8} y0={w * 1.9 + post * 0.75} z={gateZ} mat={mats.amber} />
        <group ref={arm} position={[-post * 1.6, w * 0.55, gz0 + post * 1.3]}>
          {Array.from({ length: 6 }, (_, k) => (
            <Block key={k} w={post * 0.8} h={post * 0.8} d={(gateW - post * 1.4) / 6} z={(k + 0.5) * ((gateW - post * 1.4) / 6)} mat={k % 2 ? mats.white : mats.amber} />
          ))}
        </group>
        <Word at={[0, w * 1.9 + post * 6, gateZ]} tone={AVAGUARD3.amber[theme]} small near={360}>
          Validation humaine
        </Word>
      </group>

      {/* the warden's booth by the gate, its windows lit, the beacon on its roof */}
      <group position={[booth.x, y, booth.z]}>
        <Block w={booth.w} h={booth.h} d={booth.d} mat={mats.wall} />
        <Block w={booth.w * 1.12} h={post * 0.8} d={booth.d * 1.12} y0={booth.h} mat={mats.frame} />
        <Block w={booth.w * 1.01} h={booth.h * 0.32} d={booth.d * 0.7} y0={booth.h * 0.48} mat={mats.window} />
        <Block w={booth.w * 0.7} h={booth.h * 0.32} d={booth.d * 1.01} y0={booth.h * 0.48} mat={mats.window} />
        <mesh ref={beacon} position={[0, booth.h + post * 0.8 + w * 0.14, 0]} material={mats.beacon}>
          <cylinderGeometry args={[w * 0.13, w * 0.16, w * 0.28, 12]} />
        </mesh>
      </group>

      {/* the bays: amber lines, numbers, wheel stops; the waiting bay ringed */}
      <group position={[0, y + 0.03, 0]}>
        {Array.from({ length: 7 }, (_, k) => (
          <Block key={k} w={depth} h={0.05} d={Math.max(0.22, bay * 0.05)} z={(k - 3) * bay} mat={mats.line} />
        ))}
        <Block w={Math.max(0.22, bay * 0.05)} h={0.05} d={bay * 6} x={-depth / 2} mat={mats.line} />
        {Array.from({ length: 6 }, (_, k) => (
          <Block key={k} w={w * 0.22} h={w * 0.12} d={bay * 0.5} x={depth / 2 - w * 0.35} z={(k - 2.5) * bay} mat={mats.stop} />
        ))}
        {Array.from({ length: 6 }, (_, k) => (
          <Word key={k} at={[-depth / 2 + w * 0.55, 0.2, (k - 2.5) * bay]} tone={AVAGUARD3.amber[theme]} small near={260}>
            {`P${k + 1}`}
          </Word>
        ))}
        <mesh position={[0, 0.06, (2 - 2.5) * bay]} rotation={[-Math.PI / 2, 0, 0]} material={mats.halo}>
          <planeGeometry args={[depth * 0.95, bay * 0.92]} />
        </mesh>
        {/* the aisle's arrows, from the gate toward the bays */}
        {[gateZ - side * bay * 1.1, gateZ - side * bay * 2.6].map((z) => (
          <mesh key={z} geometry={arrow} material={mats.arrow} position={[-depth / 2 - aisle * 0.5, 0.07, z]} rotation={[0, side > 0 ? 0 : Math.PI, 0]} />
        ))}
      </group>

      {/* the carport: posts, a flat roof, its solar panels, the amber strip under its front edge */}
      <group position={[0, y, 0]}>
        {[roofX0 + post, roofX1 - post].flatMap((x) =>
          [-3, -1, 1, 3].map((k) => <Block key={`${x}:${k}`} w={post * 1.6} h={roofH} d={post * 1.6} x={x} z={k * bay} mat={mats.steel} />),
        )}
        <Block w={roofX1 - roofX0} h={w * 0.12} d={bay * 6 + w * 0.5} x={(roofX0 + roofX1) / 2} y0={roofH} mat={mats.roof} />
        <Block w={post} h={w * 0.1} d={bay * 6 + w * 0.3} x={roofX0 + post} y0={roofH - w * 0.1} mat={mats.strip} />
        {[0, 1].map((row) =>
          Array.from({ length: 6 }, (_, k) => {
            const pw = (roofX1 - roofX0) * 0.44;
            const px = roofX0 + (roofX1 - roofX0) * (row ? 0.73 : 0.27);
            return (
              <group key={`${row}:${k}`} position={[px, roofH + w * 0.16, (k - 2.5) * bay]} rotation={[0, 0, 0.12]}>
                <Block w={pw} h={w * 0.03} d={bay * 0.94} mat={mats.solarEdge} />
                <Block w={pw * 0.94} h={w * 0.04} d={bay * 0.88} y0={w * 0.01} mat={mats.solar} />
              </group>
            );
          }),
        )}
      </group>

      {/* four lamp posts at the corners, their heads over the lot */}
      {corners.map(([x, z]) => {
        const inward = new Vector3(x < 0 ? 1 : -1, 0, z < 0 ? 1 : -1).normalize().multiplyScalar(w * 0.45);
        return (
          <group key={`${x}:${z}`} position={[x, y, z]}>
            <Block w={post * 1.3} h={w * 2.7} d={post * 1.3} mat={mats.steel} />
            <Block w={Math.abs(inward.x) + post} h={post} d={Math.abs(inward.z) + post} x={inward.x / 2} z={inward.z / 2} y0={w * 2.7} mat={mats.steel} />
            <mesh position={[inward.x, w * 2.62, inward.z]} material={mats.bulb}>
              <sphereGeometry args={[w * 0.11, 10, 8]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
