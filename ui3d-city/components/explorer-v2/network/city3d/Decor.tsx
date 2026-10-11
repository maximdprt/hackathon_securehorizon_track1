"use client";

// AVAGUARD: our addition to the vendored City (not from builders-hub): the Sentinel city's protected perimeter, standing.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, NormalBlending, ShaderMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { SENTINEL_ONLY, SENTINEL_RING } from "@/components/explorer-v2/network/avaguard";
import { SIGNAL3, type Theme } from "./palette";
import { PERIMETER } from "./paint";
import { OPENING } from "./warmup";

/* The perimeter Sentinel keeps round the city, what stands of it (its engraving on the plate is painted with the ground,
   paint.ts): a fence of slim black pylons on the rim, white-capped, strung with two fine lines of the accent; over it a
   low wall of the accent's light, faint at its foot and gone a few storeys up, the shield's edge rather than a dome; and
   a few sentinel monoliths out in the band between the city and the rim, black slabs on white plinths, each with one lit
   line of the accent down its inner face, turned to the city they watch. Nothing moves: it stands up with the paint's
   wave as it reaches the rim (Ground.tsx), and keeps still. Five draw calls: the black bodies, the white caps, the lit
   strips, the fence's lines and the wall. It keeps clear of our parcel and the hub's plaza (paint.ts KEEP): the
   monoliths stand at the back, behind the hub from the parcel's side, and nothing on the rim stands taller than a house. */

/** the fence: how many pylons round the rim, their height, their width, and the heights of its two lines */
const PYLONS = 120;
const PYLON_H = 9;
const PYLON_W = 0.9;
const STRANDS = [3.6, 7.2];
/** the wall of light over the fence: its height, and its strength at its foot by day and by night */
const WALL_H = 26;
const WALL_A: Record<Theme, number> = { light: 0.12, dark: 0.16 };
/** a monolith: its width along the rim, its depth toward the city, its plinth, and its lit strip's width and inset from its ends */
const SLAB = { w: 11, d: 2.6 };
const PLINTH = { w: 14, d: 5.2, h: 1.2 };
const STRIP = { w: 0.8, inset: 4 };
/** the lines' width in CSS pixels */
const LINE_PX = 1.3;
/** the paint's wave: where its front reaches the rim, so the perimeter stands up as it is painted (Ground.tsx WAVE) */
const WAVE_AT: [number, number] = [0.8, 0.98];

const DEG = Math.PI / 180;

/** a box standing on the plate, turned so its x runs out from the centre at plan angle a, at radius r */
function standing(w: number, h: number, d: number, r: number, a: number, y = 0, out = 0): BufferGeometry {
  // x radial (d), z tangential (w); rotateY(-a) carries +x to (cos a, 0, sin a)
  return new BoxGeometry(d, h, w)
    .translate(out, y + h / 2, 0)
    .rotateY(-a)
    .translate(r * Math.cos(a), 0, r * Math.sin(a));
}

function wallMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uColor: { value: new Color() }, uA: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    // strongest at its foot, gone by its top, as a light's falloff
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uA;
      varying float vY;
      void main() {
        float a = uA * pow( 1.0 - vY, 2.4 );
        gl_FragColor = vec4( uColor, a );
      }`,
  });
}

export function Decor({ theme }: { theme: Theme }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);

  const parts = useMemo(() => {
    const f = PERIMETER.fence;
    const bodies: BufferGeometry[] = [];
    const caps: BufferGeometry[] = [];
    const strips: BufferGeometry[] = [];
    for (let i = 0; i < PYLONS; i++) {
      const a = (i / PYLONS) * Math.PI * 2;
      bodies.push(standing(PYLON_W, PYLON_H, PYLON_W, f, a));
      caps.push(standing(PYLON_W * 1.5, 0.45, PYLON_W * 1.5, f, a, PYLON_H));
    }
    for (const m of PERIMETER.monoliths) {
      const a = m.a * DEG;
      caps.push(standing(PLINTH.w, PLINTH.h, PLINTH.d, m.r, a));
      bodies.push(standing(SLAB.w, m.h, SLAB.d, m.r, a, PLINTH.h));
      caps.push(standing(SLAB.w + 0.3, 0.6, SLAB.d + 0.3, m.r, a, PLINTH.h + m.h));
      // the lit strip, proud of the inner face (toward the city)
      strips.push(standing(STRIP.w, m.h - 2 * STRIP.inset, 0.2, m.r, a, PLINTH.h + STRIP.inset, -SLAB.d / 2 - 0.08));
    }
    const merge = (list: BufferGeometry[]) => {
      const g = mergeGeometries(list, false)!;
      for (const x of list) x.dispose();
      return g;
    };
    const mats = {
      body: new MeshLambertMaterial({ color: 0xffffff }),
      cap: new MeshLambertMaterial({ color: 0xffffff }),
      strip: new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      wall: wallMaterial(),
      line: new LineMaterial({ color: 0xffffff, linewidth: LINE_PX, transparent: true, opacity: 0.9, worldUnits: false }),
    };
    const body = new Mesh(merge(bodies), mats.body);
    body.castShadow = true;
    body.receiveShadow = true;
    const cap = new Mesh(merge(caps), mats.cap);
    cap.receiveShadow = true;
    const strip = new Mesh(merge(strips), mats.strip);
    // the fence's two lines, each a round of short segments through the pylons
    const pos: number[] = [];
    const SEG = 360;
    for (const y of STRANDS) {
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * Math.PI * 2;
        const a1 = ((i + 1) / SEG) * Math.PI * 2;
        pos.push(f * Math.cos(a0), y, f * Math.sin(a0), f * Math.cos(a1), y, f * Math.sin(a1));
      }
    }
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(pos);
    const lines = new LineSegments2(lineGeo, mats.line);
    lines.frustumCulled = false;
    const wall = new Mesh(new CylinderGeometry(f, f, WALL_H, 240, 1, true).translate(0, WALL_H / 2, 0), mats.wall);
    wall.renderOrder = 2;
    wall.frustumCulled = false;
    return { mats, meshes: [body, cap, strip, lines, wall] as const };
  }, []);
  useEffect(
    () => () => {
      for (const m of parts.meshes) m.geometry.dispose();
      for (const m of Object.values(parts.mats)) m.dispose();
    },
    [parts],
  );

  // the theme: black pylons and white caps by day, graphite and pale caps by night, the accent's line on both
  useEffect(() => {
    const t = theme;
    const dark = t === "dark";
    const { mats } = parts;
    mats.body.color.set(SIGNAL3.pylon[t]);
    mats.cap.color.set(SIGNAL3.cap[t]);
    mats.strip.color.set(SIGNAL3.line[t]).multiplyScalar(dark ? 1.25 : 1);
    mats.line.color.set(SIGNAL3.line[t]);
    mats.line.opacity = dark ? 0.95 : 0.8;
    mats.wall.uniforms.uColor.value.set(SIGNAL3.line[t]);
    mats.wall.uniforms.uA.value = WALL_A[t];
    // by night the wall adds its light to the dark; by day it lays a tint over the white
    mats.wall.blending = dark ? AdditiveBlending : NormalBlending;
    mats.wall.needsUpdate = true;
    invalidate();
  }, [theme, parts, invalidate]);

  useEffect(() => {
    parts.mats.line.resolution.set(size.width, size.height);
    invalidate();
  }, [size, parts, invalidate]);

  // it stands up as the paint's wave reaches the rim, and stays
  const grow = () => {
    const g = group.current;
    if (!g) return false;
    const p = OPENING.paint.value;
    const k = Math.min(1, Math.max(0, (p - WAVE_AT[0]) / (WAVE_AT[1] - WAVE_AT[0])));
    const e = k * k * (3 - 2 * k);
    const was = g.scale.y;
    g.visible = e > 0.001;
    g.scale.y = Math.max(0.001, e);
    parts.mats.wall.uniforms.uA.value = WALL_A[theme] * e;
    return was !== g.scale.y;
  };
  useLayoutEffect(() => {
    grow();
  });
  useFrame(() => {
    if (group.current && group.current.scale.y >= 1 && OPENING.paint.value >= 1) return;
    if (grow()) invalidate();
  });

  // the ring round the protocol fills the band the perimeter stood in: the city keeps the ledger's own rim
  if (!SENTINEL_ONLY || SENTINEL_RING) return null;
  return (
    <group ref={group}>
      {parts.meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  );
}
