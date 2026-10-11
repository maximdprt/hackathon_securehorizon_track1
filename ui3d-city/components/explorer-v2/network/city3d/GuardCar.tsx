"use client";

// AVAGUARD: our one car, the City's car (city3d/carModel.ts), drawn once at the width of our lane. The protocol reads on
// its body alone (PROMPT, Sentinel Protocole Pub.html): white out of the Sentinel tower, a hologram where it has gone
// through the gantry's beam (clipping planes, no particle), then painted all over in the decision's colour, red, green
// or orange; the glass, the tyres and the lights keep theirs. A visa's car goes through the C-Chain's gate and is gone,
// cut at the gate's plane. From PICK on, the yard's own car (CityYard) carries on in the same materials.
import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, EdgesGeometry, Group, LineBasicMaterial, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, Plane, ShaderMaterial, Vector3, type Material } from "three";
import { motion, useSim, type Paint } from "@/sim/store";
import { CarTip, Door, OPEN } from "./Door";
import type { Theme } from "./palette";
import { poseAt, type GuardGeo } from "./guardGeo";
import { YARD_FROM } from "./CityYard";
import { CAR_LENGTH, CAR_PARTS, useCarGeometries, type CarPart } from "./carModel";

/** the body's paints: white until Sentinel decides, then the decision's colour (the Pub's red, green and orange) */
export const PAINT: Record<Paint, string> = { white: "#F2F4F6", block: "#E0393F", allow: "#3CC46B", human: "#F28A2E" };
export type CarMats = Record<CarPart, Material>;

const SHADOW = {
  vertexShader: /* glsl */ `#include <clipping_planes_pars_vertex>
varying vec2 vUv;
void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 ); gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`,
  fragmentShader: /* glsl */ `#include <clipping_planes_pars_fragment>
uniform float uShade; varying vec2 vUv;
void main() {
#include <clipping_planes_fragment>
float r = length( ( vUv - 0.5 ) * 2.0 ); gl_FragColor = vec4( 0.0, 0.0, 0.0, ( 1.0 - smoothstep( 0.3, 1.0, r ) ) * uShade ); }`,
};

/* the scan's hologram: the reference's fresnel (avaguard-fx.html), blue, no scanlines, no noise */
const HOLO_VERT = /* glsl */ `#include <clipping_planes_pars_vertex>
varying vec3 vN;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const HOLO_FRAG = /* glsl */ `#include <clipping_planes_pars_fragment>
uniform vec3 uColor;
varying vec3 vN;
void main() {
  #include <clipping_planes_fragment>
  float f = pow(1.0 - abs(vN.z), 2.0);
  gl_FragColor = vec4(uColor * (0.18 + f), 0.45 * (0.25 + f));
}`;

export function GuardCar({ geo, theme, share }: { geo: GuardGeo; theme: Theme; share?: MutableRefObject<CarMats | null> }) {
  const w = geo.carW;
  const dark = theme === "dark";
  const root = useRef<Group>(null);
  const holo = useRef<Group>(null);
  const geos = useCarGeometries();
  const edges = useMemo(() => ({ Paint: new EdgesGeometry(geos.Paint, 35), Glass: new EdgesGeometry(geos.Glass, 35) }), [geos]);
  // the car's materials, as the fleet's (Traffic.tsx), its paint ours
  const mats = useMemo(() => {
    const glass = new MeshPhongMaterial({ color: new Color("#0E1520"), specular: new Color("#5C6674"), shininess: 80 });
    glass.userData.cityEnv = 0.35;
    const car: CarMats = {
      Paint: new MeshLambertMaterial({ color: PAINT.white }),
      Dark: new MeshLambertMaterial({ color: new Color("#15191F") }),
      Glass: glass,
      Metal: new MeshLambertMaterial({ color: new Color("#7D858F") }),
      LightFront: new MeshBasicMaterial({ color: new Color("#FFF3DA") }),
      LightRear: new MeshBasicMaterial({ color: new Color("#FF2A1F") }),
    };
    return {
      car,
      shadow: new ShaderMaterial({ uniforms: { uShade: { value: dark ? 0.42 : 0.26 } }, ...SHADOW, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, clipping: true }),
      holo: new ShaderMaterial({ uniforms: { uColor: { value: new Color("#6FA8FF") } }, vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, clipping: true }),
      wire: new LineBasicMaterial({ color: "#9cc2ff", transparent: true, opacity: 0.6 }),
    };
  }, [dark]);
  const paint = mats.car.Paint as MeshLambertMaterial;
  // the planes, in the world: the solid keeps what has not passed the beam (or the gate), the hologram what has
  const clip = useMemo(() => ({ solid: new Plane(new Vector3(-1, 0, 0), 1e9), holo: new Plane(new Vector3(1, 0, 0), -1e9) }), []);
  useMemo(() => {
    for (const m of Object.values(mats.car)) m.clippingPlanes = [clip.solid];
    mats.shadow.clippingPlanes = [clip.solid];
    mats.holo.clippingPlanes = [clip.holo];
    mats.wire.clippingPlanes = [clip.holo];
    if (share) share.current = mats.car;
    // a debug handle (tools/capture.mjs): the planes and what wears them
    (window as unknown as { __carClip?: unknown }).__carClip = { clip, mats, geo };
  }, [mats, clip, share, geo]);
  const dir = useMemo(() => new Vector3(), []);
  const from = useMemo(() => new Color(), []);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const r = root.current;
    if (!r) return;
    // from PICK on, the yard's own car (CityYard) carries on in the crane's jaws
    r.visible = motion.visible && motion.leg !== "none" && motion.yard < YARD_FROM;
    // the paint, also while the yard's car wears it
    from.set(PAINT[motion.paintFrom]);
    paint.color.copy(from).lerp(new Color(PAINT[motion.paintTo]), Math.min(1, Math.max(0, motion.paint)));
    if (!r.visible) return;
    const path = geo.legs[motion.leg as keyof GuardGeo["legs"]];
    if (!path) return;
    const { p, yaw } = poseAt(path, motion.u, tmp);
    r.position.copy(p);
    r.rotation.y = -yaw;
    // the X-ray: driving through the beam, what has passed is a hologram; then the whole car while Sentinel analyses it.
    // On the way to the C-Chain, the gate's plane cuts what has gone through it. Else solid, whole
    let v = 1e9;
    if (motion.leg === "scanPass") {
      dir.set(Math.cos(geo.toll.yaw), 0, Math.sin(geo.toll.yaw));
      v = dir.dot(geo.toll.p);
    } else if (motion.xray > 0.5) v = -1e9;
    else if (motion.leg === "toCChain" && Math.hypot(p.x - geo.gate.p.x, p.z - geo.gate.p.z) < geo.carL * 1.5) {
      // only at the gate: the lane winds round the hub, a plane further would cut the car on its way
      dir.set(Math.cos(geo.gate.yaw), 0, Math.sin(geo.gate.yaw));
      v = dir.dot(geo.gate.p);
    }
    clip.solid.normal.copy(dir).negate();
    clip.solid.constant = v;
    clip.holo.normal.copy(dir);
    clip.holo.constant = -v;
    if (holo.current) holo.current.visible = motion.leg === "scanPass" || motion.xray > 0.5;
  });

  const tx = useSim((s) => s.tx);
  return (
    <group ref={root} visible={false}>
      <Door name="guard:car" at={[0, w * 1.4, 0]} tip={tx ? <CarTip tx={tx} /> : null} onOpen={() => tx && OPEN.car(tx.tx_id)}>
        <group>
          {/* the car: its six parts, a lane's width across, its front ahead */}
          <group scale={[w, w, w]}>
            {CAR_PARTS.map((name) => (
              <mesh key={name} geometry={geos[name]} material={mats.car[name]} castShadow={name === "Paint"} />
            ))}
          </group>
          {/* its hologram: the same shapes and their edges, clipped the other way */}
          <group ref={holo} visible={false} scale={[w, w, w]}>
            {CAR_PARTS.map((name) => (
              <mesh key={name} geometry={geos[name]} material={mats.holo} />
            ))}
            <lineSegments geometry={edges.Paint} material={mats.wire} />
            <lineSegments geometry={edges.Glass} material={mats.wire} />
          </group>
          {/* the soft shadow under it, as the fleet's */}
          <mesh material={mats.shadow} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[CAR_LENGTH * 1.1 * w, 1.3 * w, 1]}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        </group>
      </Door>
    </group>
  );
}
