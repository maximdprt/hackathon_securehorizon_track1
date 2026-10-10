import { CylinderGeometry, Euler, Group, Mesh, type Object3D, Quaternion, type Scene, Vector3 } from "three";
import { CRANE, JAW, L1, L2, PIV } from "./constants";
import type { Kit } from "./materials";
import { clamp, depth } from "./timeline";

/* The grapple crane: a yellow column, a turret, a boom (L1) and a stick (L2) solved by two-segment IK toward the
   grapple's root; the grapple hangs free from the stick's tip by a link and closes its two jaws across world z, wide
   (pivots at +-PIV) so a car fits between the pivots and the jaws close on its flanks, never through them. */

export function buildCrane(scene: Scene, kit: Kit, parent: Object3D) {
  const { B, C, mats } = kit;
  C(0.45, 0.55, 2.4, mats.yellow, CRANE.x, 1.2, CRANE.z, parent);
  B(1.6, 0.2, 1.6, mats.steelDark, CRANE.x, 0.1, CRANE.z, parent);
  const turret = new Group();
  turret.position.copy(CRANE);
  scene.add(turret);
  B(1.0, 0.5, 1.0, mats.yellow, 0, 0.25, 0, turret);
  const boom = new Group();
  boom.position.set(0, 0.5, 0);
  turret.add(boom);
  B(L1, 0.36, 0.36, mats.yellow, L1 / 2, 0, 0, boom);
  const stick = new Group();
  stick.position.set(L1, 0, 0);
  boom.add(stick);
  B(L2, 0.28, 0.28, mats.yellow, L2 / 2, 0, 0, stick);
  const bCyl = C(0.1, 0.1, 2.4, mats.chrome, 1.1, -0.36, 0, boom);
  bCyl.rotation.z = Math.PI / 2 - 0.22;

  const grapple = new Group();
  scene.add(grapple);
  C(0.2, 0.2, 0.45, mats.steelDark, 0, -0.22, 0, grapple);
  B(2.3, 0.16, 0.5, mats.steelDark, 0, -0.45, 0, grapple);
  const jaws = [-1, 1].map((s) => {
    const p = new Group();
    p.position.set(s * PIV, -0.45, 0);
    grapple.add(p);
    B(0.1, JAW, 1.2, mats.steelDark, 0, -JAW / 2, 0, p);
    B(0.2, 0.1, 1.2, mats.steelDark, -s * 0.08, -JAW + 0.05, 0, p);
    for (let k = 0; k < 3; k++) B(0.05, JAW * 0.8, 0.07, mats.steel, s * 0.06, -JAW * 0.45, -0.45 + k * 0.45, p, false);
    return p;
  });
  const link = new Mesh(new CylinderGeometry(0.06, 0.06, 1, 8), mats.chrome);
  scene.add(link);

  const base = new Vector3(CRANE.x, CRANE.y + 0.5, CRANE.z);
  const tip = new Vector3();
  const Y = new Vector3(0, 1, 0);
  const dir = new Vector3();
  function solveIK(T: Vector3) {
    const dx = T.x - base.x;
    const dz = T.z - base.z;
    const dy = T.y - base.y;
    turret.rotation.y = -Math.atan2(dz, dx);
    const h = Math.hypot(dx, dz);
    const d = Math.min(L1 + L2 - 0.05, Math.max(0.6, Math.hypot(h, dy)));
    const a = Math.atan2(dy, h);
    const c1 = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const c2 = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    boom.rotation.z = a + c1;
    stick.rotation.z = -(Math.PI - c2);
    turret.updateMatrixWorld(true);
  }

  /** the grapple's root (under its rotator), its jaws' angle, its sway (x, z) */
  function setCrane(root: Vector3, jaw: number, swing: [number, number] = [0, 0]) {
    solveIK(new Vector3(root.x, root.y + 0.35, root.z));
    tip.set(L2, 0, 0);
    stick.localToWorld(tip);
    link.position.copy(tip).add(root).multiplyScalar(0.5);
    link.scale.y = Math.max(0.05, tip.distanceTo(root));
    // the link along (tip - root), so it follows the sway
    dir.copy(tip).sub(root);
    if (dir.lengthSq() > 1e-8) link.quaternion.setFromUnitVectors(Y, dir.normalize());
    grapple.position.copy(root);
    grapple.quaternion.setFromEuler(new Euler(swing[0], Math.PI / 2, swing[1], "YXZ")); // yaw pi/2: the jaws close along world z
    jaws.forEach((p, i) => {
      p.rotation.z = (i ? 1 : -1) * jaw;
    });
    grapple.updateMatrixWorld(true);
  }

  /** a held object: its base under the root by the pivot, the tips' depth and the grip height; it sways with the jaws */
  const turn = new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0));
  function hang(obj: Object3D, jaw: number, gripY: number) {
    const off = new Vector3(0, -(0.45 + depth(jaw) + gripY), 0);
    obj.position.copy(grapple.localToWorld(off));
    obj.quaternion.copy(grapple.quaternion.clone().multiply(turn));
  }

  return { setCrane, hang };
}
