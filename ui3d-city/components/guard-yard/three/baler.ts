import { CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, type Scene } from "three";
import { BX, CZ, FLOOR, H, LID_OPEN, RAM_OPEN, SIDE_OPEN, WALL } from "./constants";
import { raw, type Kit } from "./materials";

/* The baler, after the scrapyards' car loggers: a steel chamber on a wheeled chassis, two hydraulic lids hinged on the
   fixed wall (a closed lid's underside lies exactly at H), a side plate pushed by three rams, an end ram that also
   ejects, an end door hinged at its top, the power pack and the cab. As the reference. */

export function buildBaler(scene: Scene, kit: Kit) {
  const { B, C, mats } = kit;
  const baler = new Group();
  scene.add(baler);
  B(7.5, 0.5, 2.9, mats.steelDark, BX - 0.35, 0.55, CZ, baler);
  [-3.4, -2.4, 1.6, 2.5].forEach((dx) =>
    [-1, 1].forEach((s) => {
      const w = new Mesh(new CylinderGeometry(0.45, 0.45, 0.35, 20), mats.rubber);
      w.rotation.x = Math.PI / 2;
      w.position.set(BX + dx, 0.45, CZ + s * 1.35);
      w.castShadow = true;
      baler.add(w);
    }),
  );
  B(6.6, 0.12, 2.5, mats.steel, BX, FLOOR - 0.06, CZ, baler);
  B(6.6, WALL, 0.25, mats.yellow, BX, FLOOR + WALL / 2, CZ - 1.25, baler);
  for (let i = 0; i < 7; i++) B(0.16, WALL, 0.12, mats.yellow, BX - 3 + i, FLOOR + WALL / 2, CZ - 1.42, baler);

  // the side plate (on +z), pushed by three rams
  const sidePlate = new Group();
  baler.add(sidePlate);
  B(6.4, WALL - 0.04, 0.2, mats.yellow, 0, 0, 0, sidePlate);
  B(6.4, 0.14, 0.02, mats.hazard, 0, WALL / 2 - 0.12, 0.11, sidePlate, false);
  sidePlate.position.set(BX, FLOOR + WALL / 2, SIDE_OPEN);
  const sideRods = [-2, 0, 2].map((dx) => {
    const body = C(0.16, 0.16, 1.0, mats.steelDark, BX + dx, FLOOR + 0.4, CZ + 2.15, baler);
    body.rotation.x = Math.PI / 2;
    const rod = C(0.07, 0.07, 1.0, mats.chrome, BX + dx, FLOOR + 0.4, CZ + 1.65, baler);
    rod.rotation.x = Math.PI / 2;
    return rod;
  });

  // the lids, hinged on the fixed wall
  const lids = [-1, 1].map((s) => {
    const piv = new Group();
    piv.position.set(BX + s * 1.62, H, CZ - 1.25);
    baler.add(piv);
    B(3.2, 0.18, 2.45, mats.yellow, 0, 0.09, 1.22, piv);
    for (let i = 0; i < 4; i++) B(0.12, 0.22, 2.45, mats.yellow, -1.3 + i * 0.87, 0.26, 1.22, piv);
    piv.rotation.x = LID_OPEN;
    return piv;
  });

  // the end ram (on -x) and its rod
  const endRam = new Group();
  baler.add(endRam);
  B(0.2, WALL - 0.04, 2.1, mats.yellow, 0, 0, 0, endRam);
  endRam.position.set(RAM_OPEN, FLOOR + WALL / 2, CZ - 0.04);
  const endRod = C(0.09, 0.09, 1, mats.chrome, BX - 3.7, FLOOR + 0.4, CZ - 0.04, baler);
  endRod.rotation.z = Math.PI / 2;
  B(0.9, 0.8, 0.5, mats.steelDark, BX - 4.15, FLOOR + 0.4, CZ - 0.04, baler);
  const setRam = (x: number) => {
    endRam.position.x = x;
    const L = Math.max(0.3, x - 0.1 - (BX - 3.75));
    endRod.scale.y = L;
    endRod.position.x = BX - 3.75 + L / 2;
  };

  // the end door (on +x), hinged at its top
  const door = new Group();
  baler.add(door);
  door.position.set(BX + 3.35, H + 0.05, CZ);
  B(0.18, WALL + 0.05, 2.4, mats.yellow, 0, -(WALL + 0.05) / 2, 0, door);

  // the power pack and the cab
  B(1.9, 1.6, 2.6, mats.yellow, BX - 5.3, 1.6, CZ, baler);
  for (let i = 0; i < 8; i++) B(0.04, 0.9, 0.02, mats.steelDark, BX - 5.8 + i * 0.14, 1.6, CZ + 1.31, baler, false);
  C(0.07, 0.07, 1.0, mats.steelDark, BX - 4.8, 2.9, CZ + 0.9, baler);
  B(1.2, 1.4, 1.2, mats.panelW, BX - 5.3, 3.1, CZ - 0.4, baler);
  B(0.9, 0.6, 0.02, kit.track(new MeshPhysicalMaterial({ color: raw("#0d1520"), metalness: 0.2, roughness: 0.05, clearcoat: 1 })), BX - 5.3, 3.3, CZ + 0.21, baler, false);

  return { baler, lids, sidePlate, sideRods, setRam, door };
}
