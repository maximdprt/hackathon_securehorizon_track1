"use client";

// AVAGUARD: our one car is the City's own pod (city3d/Traffic.tsx), drawn once instead of instanced: the same flattened
// capsule shell on its equator, the same pale canopy drawn out as the VEH_POD shader draws it, the same thin light strip
// along each flank (the fleet's `strip` patch), the same soft shadow. Only the strip's colour is ours: the transaction's
// state (blue in analysis, green visa, red refusal, amber human). Its frost (a refusal) and x-ray (the scan) stay.
import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, Color, EdgesGeometry, Group, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, Plane, ShaderMaterial, Vector3, type WebGLProgramParametersWithUniforms } from "three";
import { motion, useSim } from "@/sim/store";
import { STATE } from "@/sim/types";
import { CarTip, Door, OPEN } from "./Door";
import { AVAGUARD3, type Theme } from "./palette";
import { poseAt, type GuardGeo } from "./guardGeo";
import { YARD_FROM, type PodMats } from "./CityYard";
import { CANOPY_H, EQUATOR, PODS, ROOF, STRIP_HALF, STRIP_Y, podGeometry } from "./Traffic";

/** a pod drawn out to `length` widths as the VEH_POD shader does it: only its straight flanks stretch, its ends keep their shape */
export function stretched(length: number) {
  const g = podGeometry();
  const p = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    if (Math.abs(x) > 0.5999) p.setX(i, x + Math.sign(x) * (length - 2.2) * 0.5);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** the fleet's flank strip (Traffic.tsx strip()), its colour a uniform instead of an instance attribute */
function withStrip(m: MeshLambertMaterial, glow: { value: Color }) {
  m.onBeforeCompile = (s: WebGLProgramParametersWithUniforms) => {
    s.uniforms.uGlow = glow;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPod;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvPod = vec3( position );");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uGlow;\nvarying vec3 vPod;")
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
float podPx = fwidth( vPod.y );
float podHalf = clamp( 0.55 * podPx, ${STRIP_HALF.toFixed(3)}, 0.07 );
float podBand = ( 1.0 - smoothstep( podHalf, podHalf + podPx * 1.2, abs( vPod.y - ${STRIP_Y.toFixed(3)} ) ) ) * ( 1.0 - smoothstep( 0.7, 0.8, abs( vPod.x ) ) );
diffuseColor.rgb = mix( diffuseColor.rgb, uGlow, podBand );`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * podBand;");
  };
  m.customProgramCacheKey = () => "avaguard-pod-body";
  return m;
}

const SHADOW = {
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */ `uniform float uShade; varying vec2 vUv; void main() { float r = length( ( vUv - 0.5 ) * 2.0 ); gl_FragColor = vec4( 0.0, 0.0, 0.0, ( 1.0 - smoothstep( 0.3, 1.0, r ) ) * uShade ); }`,
};

/* the scan's hologram: the reference's fresnel (docs/reference/avaguard-fx.html), no scanlines, no noise */
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

export function GuardCar({ geo, theme, share }: { geo: GuardGeo; theme: Theme; share?: MutableRefObject<PodMats> }) {
  const w = geo.carW;
  const pod = PODS.van;
  const dark = theme === "dark";
  const root = useRef<Group>(null);
  const car = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const canopy = useRef<Mesh>(null);
  // the fleet's shell and canopy, as Traffic.tsx paints a lit route's pod
  const shell = useMemo(() => new Color(dark ? "#3B484B" : "#A2AFB2"), [dark]);
  const glow = useMemo(() => ({ value: new Color(STATE.verify.hex) }), []);
  const mats = useMemo(() => {
    const canopyMat = new MeshPhongMaterial({ color: new Color("#EBF0FA"), specular: new Color("#5C6674"), shininess: 60 });
    canopyMat.userData.cityEnv = 0.35;
    return {
      body: withStrip(new MeshLambertMaterial({ color: shell.clone() }), glow),
      canopy: canopyMat,
      shadow: new ShaderMaterial({ uniforms: { uShade: { value: dark ? 0.42 : 0.26 } }, ...SHADOW, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      halo: new MeshBasicMaterial({ color: STATE.verify.hex, transparent: true, opacity: 0.2, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      holo: new ShaderMaterial({ uniforms: { uColor: { value: new Color("#8fb8ff") } }, vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, clipping: true }),
      wire: new LineBasicMaterial({ color: "#bcd6ff", transparent: true, opacity: 0.55 }),
    };
  }, [shell, glow, dark]);
  // the beam's two planes, in the world: the solid keeps what has not passed it, the hologram what has
  const clip = useMemo(() => ({ solid: new Plane(new Vector3(-1, 0, 0), 1e9), holo: new Plane(new Vector3(1, 0, 0), -1e9) }), []);
  useMemo(() => {
    mats.body.clippingPlanes = [clip.solid];
    mats.canopy.clippingPlanes = [clip.solid];
    mats.holo.clippingPlanes = [clip.holo];
    mats.wire.clippingPlanes = [clip.holo];
    if (share) share.current = { body: mats.body, canopy: mats.canopy };
  }, [mats, clip, share]);
  const geos = useMemo(() => {
    const body = stretched(pod.length);
    const canopy = stretched(pod.canopy.length / pod.canopy.width);
    return { body, canopy, bodyEdges: new EdgesGeometry(body, 28), canopyEdges: new EdgesGeometry(canopy, 28) };
  }, [pod]);
  const holo = useRef<Group>(null);
  const beamDir = useMemo(() => new Vector3(), []);
  const frost = useMemo(() => new Color("#DCE8F7"), []);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const r = root.current;
    if (!r) return;
    // from PICK on, the yard's own car (CityYard) carries on in the crane's jaws
    r.visible = motion.visible && motion.leg !== "none" && motion.yard < YARD_FROM;
    if (!r.visible) return;
    const path = geo.legs[motion.leg as keyof GuardGeo["legs"]];
    if (!path) return;
    const { p, yaw } = poseAt(path, motion.u, tmp);
    r.position.copy(p);
    r.rotation.y = -yaw;
    // the X-ray: driving through the beam, what has passed is a hologram; then the whole car, a moment; else solid
    beamDir.set(Math.cos(geo.toll.yaw), 0, Math.sin(geo.toll.yaw));
    const v = motion.leg === "scanPass" ? beamDir.dot(geo.toll.p) : motion.xray > 0.5 ? -1e9 : 1e9;
    clip.solid.normal.copy(beamDir).negate();
    clip.solid.constant = v;
    clip.holo.normal.copy(beamDir);
    clip.holo.constant = -v;
    if (holo.current) holo.current.visible = v < 1e8;
    // the strip and the halo in the state's colour; in analysis the strip breathes, as a light that is reading
    const tone = STATE[motion.tone].hex;
    glow.value.set(tone);
    if (motion.tone === "verify") glow.value.multiplyScalar(0.75 + 0.25 * Math.sin(clock.elapsedTime * 5));
    mats.halo.color.set(tone);
    // the refusal's frost: the shell goes icy, edged in red
    mats.body.color.copy(shell).lerp(frost, motion.frost);
    mats.body.emissive.set(AVAGUARD3.block[theme]).multiplyScalar(motion.frost * 0.25);
  });

  const tx = useSim((s) => s.tx);
  const cw = pod.canopy.width;
  return (
    <group ref={root} visible={false}>
      <Door name="guard:car" at={[0, w * 1.6, 0]} tip={tx ? <CarTip tx={tx} /> : null} onOpen={() => tx && OPEN.car(tx.tx_id)}>
        <group ref={car}>
          {/* the shell: a width across, 2.2 long, on its equator */}
          <mesh ref={body} geometry={geos.body} material={mats.body} position={[0, EQUATOR * w, 0]} scale={[w, w, w]} castShadow />
          {/* the canopy: the pod's shape at its width, CANOPY_H tall, drawn out to its length, set on the roof */}
          <mesh ref={canopy} geometry={geos.canopy} material={mats.canopy} position={[pod.canopy.x * w, (ROOF - 0.055) * w, 0]} scale={[cw * w, CANOPY_H * cw * w, cw * w]} />
          {/* its hologram, the same shapes, clipped the other way */}
          <group ref={holo} visible={false}>
            <mesh geometry={geos.body} material={mats.holo} position={[0, EQUATOR * w, 0]} scale={[w, w, w]} />
            <lineSegments geometry={geos.bodyEdges} material={mats.wire} position={[0, EQUATOR * w, 0]} scale={[w, w, w]} />
            <mesh geometry={geos.canopy} material={mats.holo} position={[pod.canopy.x * w, (ROOF - 0.055) * w, 0]} scale={[cw * w, CANOPY_H * cw * w, cw * w]} />
            <lineSegments geometry={geos.canopyEdges} material={mats.wire} position={[pod.canopy.x * w, (ROOF - 0.055) * w, 0]} scale={[cw * w, CANOPY_H * cw * w, cw * w]} />
          </group>
          {/* the soft shadow under it, a little longer and wider, as the fleet's */}
          <mesh material={mats.shadow} position={[0, 0.012 * w + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[pod.length * 1.1 * w, 1.3 * w, 1]}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          {/* our one addition: a faint halo on the road, in the state's colour, so the eye finds it in the traffic */}
          <mesh material={mats.halo} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w * 1.55, 32]} />
          </mesh>
        </group>
      </Door>
    </group>
  );
}
