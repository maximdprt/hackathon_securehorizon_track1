"use client";

// AVAGUARD: our one car is the City's car (city3d/carModel.ts, the fleet's model in Traffic.tsx), drawn once instead of
// instanced: its six parts, its body in the transaction's state (blue in analysis, green visa, red refusal, amber
// human), the fleet's soft shadow under it and a faint halo on the road. Its frost (a refusal) and x-ray (the scan) stay.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, ShaderMaterial, Vector3, type Material } from "three";
import { motion, useSim } from "@/sim/store";
import { STATE } from "@/sim/types";
import { CarTip, Door, OPEN } from "./Door";
import { AVAGUARD3, type Theme } from "./palette";
import { poseAt, type GuardGeo } from "./guardGeo";
import { CAR_LENGTH, CAR_PARTS, CAR_SCALE, useCarGeometries, type CarPart } from "./carModel";

const SHADOW = {
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */ `uniform float uShade; varying vec2 vUv; void main() { float r = length( ( vUv - 0.5 ) * 2.0 ); gl_FragColor = vec4( 0.0, 0.0, 0.0, ( 1.0 - smoothstep( 0.3, 1.0, r ) ) * uShade ); }`,
};

export function GuardCar({ geo, theme }: { geo: GuardGeo; theme: Theme }) {
  const w = geo.carW;
  const dark = theme === "dark";
  const root = useRef<Group>(null);
  const car = useRef<Group>(null);
  const cube = useRef<Mesh>(null);
  const parts = useRef<Partial<Record<CarPart, Mesh>>>({});
  const carGeos = useCarGeometries();
  // the body's paint: the state's colour, a little softened by the fleet's shell (Traffic.tsx)
  const shell = useMemo(() => new Color(dark ? "#3B484B" : "#A2AFB2"), [dark]);
  const mats = useMemo(() => {
    const glass = new MeshPhongMaterial({ color: new Color("#0E1520"), specular: new Color("#5C6674"), shininess: 80 });
    glass.userData.cityEnv = 0.35;
    const car: Record<CarPart, Material> = {
      Paint: new MeshLambertMaterial({ color: STATE.verify.hex }),
      Dark: new MeshLambertMaterial({ color: new Color("#15191F") }),
      Glass: glass,
      Metal: new MeshLambertMaterial({ color: new Color("#7D858F") }),
      LightFront: new MeshBasicMaterial({ color: new Color("#FFF3DA") }),
      LightRear: new MeshBasicMaterial({ color: new Color("#FF2A1F") }),
    };
    return {
      car,
      shadow: new ShaderMaterial({ uniforms: { uShade: { value: dark ? 0.42 : 0.26 } }, ...SHADOW, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      halo: new MeshBasicMaterial({ color: STATE.verify.hex, transparent: true, opacity: 0.2, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      xray: new MeshBasicMaterial({ color: STATE.verify.hex, wireframe: true, transparent: true, opacity: 0.8, toneMapped: false }),
      cube: new MeshLambertMaterial({ color: dark ? "#4A5559" : "#9AA5AF" }),
    };
  }, [dark]);
  const paint = mats.car.Paint as MeshLambertMaterial;
  const frost = useMemo(() => new Color("#DCE8F7"), []);
  const tone = useMemo(() => new Color(), []);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const r = root.current;
    if (!r) return;
    r.visible = motion.visible && motion.leg !== "none";
    if (!r.visible) return;
    const path = geo.legs[motion.leg as keyof GuardGeo["legs"]];
    if (!path) return;
    const { p, yaw } = poseAt(path, motion.u, tmp);
    if (!motion.cube) {
      r.position.copy(p);
      r.rotation.y = -yaw;
    }
    // the body and the halo in the state's colour; in analysis the body breathes, as a light that is reading
    const hex = STATE[motion.tone].hex;
    tone.set(hex);
    if (motion.tone === "verify") tone.multiplyScalar(0.8 + 0.2 * Math.sin(clock.elapsedTime * 5));
    mats.halo.color.set(hex);
    mats.xray.color.set(hex);
    const xr = motion.xray > 0.5;
    for (const name of CAR_PARTS) {
      const m = parts.current[name];
      if (m) m.material = xr ? mats.xray : mats.car[name];
    }
    // the refusal's frost: the body goes icy, edged in red
    paint.color.copy(tone).lerp(shell, 0.2).lerp(frost, motion.frost);
    paint.emissive.set(AVAGUARD3.block[theme]).multiplyScalar(motion.frost * 0.25);
    if (car.current) car.current.visible = !motion.cube;
    if (cube.current) {
      cube.current.visible = motion.cube;
      if (motion.cube) {
        // squashed under the press, then thrown in an arc into the registry's container
        const from = geo.scrapyard.crusher;
        const to = geo.scrapyard.bin;
        const k = motion.dump;
        r.position.set(from.x + (to.x - from.x) * k, from.y + Math.sin(k * Math.PI) * w * 3 + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
      }
    }
  });

  const tx = useSim((s) => s.tx);
  const k = w * CAR_SCALE;
  return (
    <group ref={root} visible={false}>
      <Door name="guard:car" at={[0, w * 1.6, 0]} tip={tx ? <CarTip tx={tx} /> : null} onOpen={() => tx && OPEN.car(tx.tx_id)}>
        <group ref={car}>
          {/* the car: its six parts, in widths of the pod, at the fleet's scale */}
          <group scale={[k, k, k]}>
            {CAR_PARTS.map((name) => (
              <mesh
                key={name}
                ref={(m) => {
                  if (m) parts.current[name] = m;
                }}
                geometry={carGeos[name]}
                material={mats.car[name]}
                castShadow={name === "Paint"}
              />
            ))}
          </group>
          {/* the soft shadow under it, a little longer and wider, as the fleet's */}
          <mesh material={mats.shadow} position={[0, 0.012 * w + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[CAR_LENGTH * 1.1 * k, 1.3 * k, 1]}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          {/* our one addition: a faint halo on the road, in the state's colour, so the eye finds it in the traffic */}
          <mesh material={mats.halo} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w * 1.55, 32]} />
          </mesh>
        </group>
        <mesh ref={cube} material={mats.cube} position={[0, w * 0.4, 0]} visible={false}>
          <boxGeometry args={[w * 0.9, w * 0.8, w * 0.9]} />
        </mesh>
      </Door>
    </group>
  );
}
