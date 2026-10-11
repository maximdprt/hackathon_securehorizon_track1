"use client";

// AVAGUARD: the Guard Yard standing in the city (not from builders-hub): the X-ray gantry in place of the toll, on our
// street where it leaves our block, and the baler, its grapple crane and the hackers' registry skip in place of the
// scrapyard, beside the HQ. Built once in the yard's own metres (components/guard-yard/three, the reference
// docs/reference/avaguard-fx.html), set in the world at the city's scale (geo.k), and played from `motion`: the
// gantry's beam while the car drives through it, then, for a refusal, the yard's own timeline (motion.yard, 10.4 to
// 22.2 s: the crane picks the car at PICK, lays it in the chamber, the lids, the side ram and the end ram crush it,
// the door opens, the bale is ejected, the crane lays it in the skip). The car the crane holds is the city's car
// (yardCar.ts), in the hero car's very materials, red, so the hand-over at PICK does not show. Doors: the gantry, the
// baler, the skip.
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Vector3, type Mesh, type Object3D } from "three";
import { buildBaler } from "@/components/guard-yard/three/baler";
import { BALE_GRIP, CAR_GRIP, CHX, CHZ, CZ, FLOOR, KX, KZ, LID_OPEN, PICK, RAM_OPEN, SIDE_OPEN, SKIP_LAND, SX } from "@/components/guard-yard/three/constants";
import { buildCrane } from "@/components/guard-yard/three/crane";
import { createKit } from "@/components/guard-yard/three/materials";
import { buildYardCar } from "@/components/guard-yard/three/yardCar";
import { buildPortal } from "@/components/guard-yard/three/portal";
import { buildSkip } from "@/components/guard-yard/three/skip";
import { baleOut, craneAt, doorAngle, lidAngle, pressState, ramX, sideZ, swingAt } from "@/components/guard-yard/three/timeline";
import { motion } from "@/sim/store";
import { Door, OPEN, RegistryTip, ScrapTip, TollTip } from "./Door";
import { AVAGUARD3, type Theme } from "./palette";
import { Word } from "./Parcel";
import type { GuardGeo } from "./guardGeo";
import type { CarMats } from "./GuardCar";
import { useCarGeometries } from "./carModel";

/** where the yard's car stands: from PICK on, the yard plays */
export const YARD_FROM = 10.4;

export function CityYard({ geo, theme, carMats }: { geo: GuardGeo; theme: Theme; carMats: MutableRefObject<CarMats | null> }) {
  const carGeos = useCarGeometries();
  const gantry = useMemo(() => new Group(), []);
  const yardRoot = useMemo(() => {
    const g = new Group();
    g.matrixAutoUpdate = false;
    return g;
  }, []);
  // the skip in the same frame, its own door
  const skipRoot = useMemo(() => {
    const g = new Group();
    g.matrixAutoUpdate = false;
    return g;
  }, []);
  const built = useRef<ReturnType<typeof build> | null>(null);

  function build() {
    const kit = createKit();
    // the gantry: its beam (the yard's x = SX) on the toll's point, along our street
    const inner = new Group();
    inner.position.x = -SX;
    gantry.add(inner);
    const portal = buildPortal(inner, kit);
    // the yard: baler, crane, skip, the car it handles
    const baler = buildBaler(yardRoot, kit);
    yardRoot.add(portal.balerBeacon);
    const crane = buildCrane(yardRoot, kit, baler.baler);
    const skip = buildSkip(skipRoot, kit);
    if (!carMats.current) throw new Error("CityYard: the hero car's materials are not shared yet");
    const car = buildYardCar(yardRoot, carMats.current, carGeos);
    car.group.visible = false;
    const dispose = () => {
      const skipCar = new Set<Object3D>();
      car.group.traverse((o) => skipCar.add(o));
      for (const root of [gantry, yardRoot, skipRoot]) {
        root.traverse((o) => {
          if (skipCar.has(o)) return;
          (o as Mesh).geometry?.dispose();
        });
        root.clear();
      }
      car.dispose();
      kit.materials.forEach((m) => m.dispose());
      kit.textures.forEach((t) => t.dispose());
    };
    return { portal, baler, crane, skip, car, dispose };
  }

  useEffect(() => {
    built.current = build();
    return () => {
      built.current?.dispose();
      built.current = null;
    };
    // rebuilt with the theme (the car's materials follow it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    gantry.position.copy(geo.toll.p);
    gantry.rotation.set(0, -geo.toll.yaw, 0);
    gantry.scale.setScalar(geo.k);
    for (const r of [yardRoot, skipRoot]) {
      r.matrix.copy(geo.scrapyard.matrix);
      r.matrixWorldNeedsUpdate = true;
    }
  }, [geo, gantry, yardRoot, skipRoot]);

  useFrame(({ clock }) => {
    const b = built.current;
    if (!b) return;
    const { portal, baler, crane, skip, car } = b;
    const blink = Math.floor(clock.elapsedTime * 3) % 2;

    // ---- the gantry: the beam while the car drives through it, the lights, the barrier
    const scanning = motion.visible && motion.leg === "scanPass" && motion.u > 0 && motion.u < 1;
    portal.setBeam(scanning);
    portal.setTraffic(portal.lightsIn, motion.visible && motion.leg === "approach" && motion.u > 0.6 ? "green" : "red");
    portal.setTraffic(portal.lightsOut, motion.barrier > 0.5 ? "green" : "red");
    portal.barPivot.rotation.x = -1.35 * motion.barrier;
    portal.beacons.slice(0, 2).forEach((m) => (m.emissiveIntensity = scanning ? (blink ? 3 : 0.3) : 0.3));

    // ---- the yard: at rest, or its timeline from PICK on
    const t = motion.yard;
    const playing = motion.visible && t >= YARD_FROM;
    yardRoot.updateMatrixWorld(true);
    car.group.visible = playing;
    if (!playing) {
      crane.setCrane(craneAt(0).root, 0.2);
      baler.lids.forEach((p) => (p.rotation.x = LID_OPEN));
      baler.sidePlate.position.z = SIDE_OPEN;
      baler.setRam(RAM_OPEN);
      baler.door.rotation.z = 0;
      baler.sideRods.forEach((r) => (r.position.z = CZ + 1.65));
      portal.beacons[2].emissiveIntensity = 0.3;
      skip.rimMat.opacity = 0;
      return;
    }
    const cs = craneAt(t);
    crane.setCrane(cs.root, cs.jaw, swingAt(t));
    if (t >= 13.8) {
      baler.lids.forEach((p) => (p.rotation.x = lidAngle(t)));
      baler.sidePlate.position.z = sideZ(t);
      baler.setRam(ramX(t));
      baler.door.rotation.z = doorAngle(t);
      baler.sideRods.forEach((r) => (r.position.z = CZ + 1.65 - (SIDE_OPEN - sideZ(t))));
      portal.beacons[2].emissiveIntensity = t < 17.1 ? (blink ? 3 : 0.3) : 0.3;
    } else {
      baler.lids.forEach((p) => (p.rotation.x = LID_OPEN));
      baler.sidePlate.position.z = SIDE_OPEN;
      baler.setRam(RAM_OPEN);
      baler.door.rotation.z = 0;
      portal.beacons[2].emissiveIntensity = 0.3;
    }
    const g = car.group;
    g.quaternion.identity();
    g.rotation.set(0, 0, 0);
    if (t < 13.8) {
      car.crush(0, 0, 0);
      if (cs.hold === "car") crane.hang(g, cs.jaw, CAR_GRIP);
      else if (t >= 13.3) g.position.set(CHX, FLOOR, CHZ);
      else g.position.set(PICK.x, 0, 0);
    } else if (t < 17.15) {
      const st = pressState(t);
      car.crush(st.kT, st.kS, st.kE);
      g.position.set(st.cx, FLOOR, st.cz);
    } else {
      car.crush(1, 1, 1);
      if (t < 19.45) {
        const bo = baleOut(t);
        g.position.set(bo.x, bo.y, CZ - 0.04);
        g.rotation.set(0, 0, bo.rz);
      } else if (cs.hold === "bale") crane.hang(g, cs.jaw, BALE_GRIP);
      else {
        const u = t - 21.15;
        const drop = Math.max(0, 0.04 - 0.5 * 9.81 * Math.max(0, u) * Math.max(0, u));
        g.position.set(SKIP_LAND.x, SKIP_LAND.y + drop, SKIP_LAND.z);
        g.rotation.set(0.04, 0.12, -0.05 * Math.min(1, Math.max(0, u) * 6));
      }
    }
    skip.rimMat.opacity = t > 21.2 ? Math.max(0.35, 1 - (t - 21.2) / 1.2) : 0;
  });

  const k = geo.k;
  // the gantry's word over its source tower (the yard's z = -3.95), off the lane, so the verdict plate over the car never
  // meets it; the gantry's local z runs along (-sin yaw, 0, cos yaw) in the world
  const gantryWord = geo.toll.p.clone().add(new Vector3(-Math.sin(geo.toll.yaw), 0, Math.cos(geo.toll.yaw)).multiplyScalar(-3.95 * k)).setY(geo.toll.p.y + 7.1 * k);
  return (
    <group>
      <Door name="guard:toll" at={[geo.toll.p.x, geo.toll.p.y + 5.8 * k, geo.toll.p.z]} tip={<TollTip />} onOpen={OPEN.toll}>
        <primitive object={gantry} />
      </Door>
      <Word at={gantryWord} tone={AVAGUARD3.band[theme]} small>
        Contrôle Sentinel · radiographie
      </Word>
      <Door name="guard:scrapyard" at={geo.scrapyard.crusher.toArray() as [number, number, number]} tip={<ScrapTip />} onOpen={OPEN.scrapyard}>
        <primitive object={yardRoot} />
      </Door>
      {/* behind the fixed wall, over the open lids (they stand up to about 4 m) */}
      <Word at={geo.scrapyard.W(CHX, 6.0, CZ - 1.9).toArray() as [number, number, number]} tone={AVAGUARD3.gate[theme]} small>
        Presse à épaves
      </Word>
      <Door name="guard:registry" at={geo.scrapyard.skip.toArray() as [number, number, number]} tip={<RegistryTip />} onOpen={OPEN.registry}>
        <primitive object={skipRoot} />
      </Door>
      <Word at={geo.scrapyard.W(KX, 3.1, KZ).toArray() as [number, number, number]} tone={AVAGUARD3.registry[theme]} small>
        Registre des hackers
      </Word>
    </group>
  );
}
