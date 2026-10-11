"use client";

// AVAGUARD: the human lot (not from builders-hub), redrawn as a closed, covered car park in the city's own grade:
// a raised slab with a steel edge, a low wall and a railing round it, two controlled gates on its front along the road
// (in toward the tower, out toward the C-Chain: a drive-through aisle, no reversing), the warden's booth by the aisle
// where the car waits, numbered bays under a carport whose roof carries solar panels, wheel stops, aisle arrows and four
// lamp posts. A barrier lifts as our car comes through its gate; the roof clears while a car is inside, so the camera
// sees it waiting. Frame: +x away from the road (the bays' noses), +z toward the tower, the gates on the front side
// (x0). Per-frame values come from `motion` and the store, never React state.
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
  const { bay, depth, aisle, x0, x1, z0, z1, gateZ, exitZ, gateW } = P;
  const nBays = P.slots.length;
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

  const arms = useRef<(Group | null)[]>([null, null]);
  const beacon = useRef<Mesh>(null);
  const lift = useRef([0, 0]);
  const roofK = useRef(1);
  const car = useMemo(() => new Vector3(), []);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const inLot = motion.visible && (motion.leg === "toParking" || motion.leg === "parkToCChain" || motion.leg === "parkToScrapyard");
    // each gate's barrier lifts as our car comes through it, then falls back behind it: the entry's on the way in, the
    // exit's on the way out; while the car waits for a person, both stay down
    const near = [false, false];
    if (inLot) {
      poseAt(geo.legs[motion.leg as "toParking" | "parkToCChain" | "parkToScrapyard"], motion.u, car);
      near[0] = motion.leg === "toParking" && motion.u < 0.999 && car.distanceTo(P.gate) < geo.carL * 1.1;
      near[1] = motion.leg !== "toParking" && car.distanceTo(P.exit) < geo.carL * 1.1;
    }
    const k = Math.min(1, dt * 5);
    for (let i = 0; i < 2; i++) {
      lift.current[i] += ((near[i] ? 1 : 0) - lift.current[i]) * k;
      const a = arms.current[i];
      if (a) a.rotation.x = -lift.current[i] * 1.35;
    }
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
  const gates = [gateZ, exitZ];
  // the aisle, between the front railing and the bays; the booth between the aisle and the bays, where the car waits
  const aisleX = -depth / 2 - aisle / 2;
  const booth = { x: -depth / 2 + w * 0.42, z: 0, w: w * 0.6, d: w * 1.25, h: w * 1.05 };
  // AVAGUARD: the lamps at the back corners, and at the front along the side railings, clear of the gates and the car's turns
  const corners: [number, number][] = [
    [x0 + (x1 - x0) * 0.42, z0 + post * 2],
    [x0 + (x1 - x0) * 0.42, z1 - post * 2],
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
        <Railing a={[x0, z0]} b={[x0, exitZ - gateW / 2]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
        <Railing a={[x0, exitZ + gateW / 2]} b={[x0, gateZ - gateW / 2]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
        <Railing a={[x0, gateZ + gateW / 2]} b={[x0, z1]} wall={mats.wall} post={mats.steel} rail={mats.steel} h={railH} step={bay * 0.5} t={post} />
      </group>

      {/* the two gates: two pillars, a gantry with its amber band, the barrier hinged at a pillar; the word over the entry */}
      {gates.map((gz, gi) => {
        const gz0 = gz - gateW / 2;
        return (
          <group key={gi} position={[x0, y, 0]}>
            {[gz0, gz + gateW / 2].map((z) => (
              <Block key={z} w={post * 2.6} h={w * 1.9} d={post * 2.6} z={z} mat={mats.frame} />
            ))}
            <Block w={post * 2.4} h={post * 2.2} d={gateW + post * 2.6} y0={w * 1.9} z={gz} mat={mats.frame} />
            <Block w={post * 2.45} h={post * 0.7} d={gateW * 0.8} y0={w * 1.9 + post * 0.75} z={gz} mat={mats.amber} />
            <group
              ref={(g) => {
                arms.current[gi] = g;
              }}
              name="barrier"
              position={[-post * 1.6, w * 0.55, gz0 + post * 1.3]}
            >
              {Array.from({ length: 6 }, (_, k) => (
                <Block key={k} w={post * 0.8} h={post * 0.8} d={(gateW - post * 1.4) / 6} z={(k + 0.5) * ((gateW - post * 1.4) / 6)} mat={k % 2 ? mats.white : mats.amber} />
              ))}
            </group>
            {gi === 0 && (
              <Word at={[0, w * 1.9 + post * 6, gz]} tone={AVAGUARD3.amber[theme]} small near={360}>
                Avis humain
              </Word>
            )}
          </group>
        );
      })}

      {/* the warden's booth by the aisle, its windows lit, the beacon on its roof */}
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
        {Array.from({ length: nBays + 1 }, (_, k) => (
          <Block key={k} w={depth} h={0.05} d={Math.max(0.22, bay * 0.05)} z={(k - nBays / 2) * bay} mat={mats.line} />
        ))}
        <Block w={Math.max(0.22, bay * 0.05)} h={0.05} d={bay * nBays} x={-depth / 2} mat={mats.line} />
        {Array.from({ length: nBays }, (_, k) => (
          <Block key={k} w={w * 0.22} h={w * 0.12} d={bay * 0.5} x={depth / 2 - w * 0.35} z={(k - (nBays - 1) / 2) * bay} mat={mats.stop} />
        ))}
        {Array.from({ length: nBays }, (_, k) => (
          <Word key={k} at={[-depth / 2 + w * 0.55, 0.2, (k - (nBays - 1) / 2) * bay]} tone={AVAGUARD3.amber[theme]} small near={260}>
            {`P${k + 1}`}
          </Word>
        ))}
        {/* where the car waits for a human, in the aisle by the booth */}
        <mesh position={[aisleX, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.halo}>
          <planeGeometry args={[aisle * 0.9, geo.carL * 1.1]} />
        </mesh>
        {/* the aisle's arrows, from the entry gate toward the exit */}
        {[gateZ - bay * 0.9, exitZ + bay * 0.9].map((z) => (
          <mesh key={z} geometry={arrow} material={mats.arrow} position={[aisleX, 0.07, z]} rotation={[0, Math.PI, 0]} />
        ))}
      </group>

      {/* the carport: posts, a flat roof, its solar panels, the amber strip under its front edge */}
      <group position={[0, y, 0]}>
        {[roofX0 + post, roofX1 - post].flatMap((x) =>
          [-1, 1].map((k) => <Block key={`${x}:${k}`} w={post * 1.6} h={roofH} d={post * 1.6} x={x} z={(k * nBays * bay) / 2} mat={mats.steel} />),
        )}
        <Block w={roofX1 - roofX0} h={w * 0.12} d={bay * nBays + w * 0.5} x={(roofX0 + roofX1) / 2} y0={roofH} mat={mats.roof} />
        <Block w={post} h={w * 0.1} d={bay * nBays + w * 0.3} x={roofX0 + post} y0={roofH - w * 0.1} mat={mats.strip} />
        {[0, 1].map((row) =>
          Array.from({ length: nBays }, (_, k) => {
            const pw = (roofX1 - roofX0) * 0.44;
            const px = roofX0 + (roofX1 - roofX0) * (row ? 0.73 : 0.27);
            return (
              <group key={`${row}:${k}`} position={[px, roofH + w * 0.16, (k - (nBays - 1) / 2) * bay]} rotation={[0, 0, 0.12]}>
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
