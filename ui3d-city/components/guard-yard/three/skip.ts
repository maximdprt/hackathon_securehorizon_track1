import { BoxGeometry, CylinderGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, PlaneGeometry, type Scene } from "three";
import { KX, KZ } from "./constants";
import { raw, type Kit } from "./materials";

/* The skip, after the hook-lift containers of recycling centres: an open ribbed box, a lifting hook at the front (-x),
   two rollers at the back (+x), the stencil "REGISTRE DES HACKERS" on its +z flank, a red rim that lights when the bale
   lands, and four old bales (the fourth stacked far from SKIP_LAND on purpose: the new bale never goes through it). */

export function buildSkip(scene: Scene, kit: Kit) {
  const { B, mats } = kit;
  const skip = new Group();
  skip.position.set(KX, 0, KZ);
  scene.add(skip);
  const m = mats.skip;
  B(5.6, 0.14, 2.3, m, 0, 0.28, 0, skip);
  [-1, 1].forEach((s) => {
    B(5.6, 1.7, 0.08, m, 0, 1.18, s * 1.15, skip);
    for (let i = 0; i < 10; i++) B(0.1, 1.7, 0.14, m, -2.7 + i * 0.6, 1.18, s * 1.19, skip);
    B(5.7, 0.12, 0.2, m, 0, 2.06, s * 1.17, skip);
  });
  B(0.08, 1.7, 2.3, m, -2.8, 1.18, 0, skip);
  B(0.08, 1.7, 2.3, m, 2.8, 1.18, 0, skip);
  B(0.3, 0.3, 2.3, mats.steelDark, -2.95, 0.4, 0, skip);
  B(0.25, 1.4, 0.25, mats.steelDark, -3.05, 1.0, 0, skip);
  B(0.5, 0.2, 0.2, mats.steelDark, -3.2, 1.65, 0, skip);
  [-1, 1].forEach((s) => {
    const r = new Mesh(new CylinderGeometry(0.18, 0.18, 0.2, 16), mats.steelDark);
    r.rotation.x = Math.PI / 2;
    r.position.set(2.6, 0.18, s * 0.9);
    skip.add(r);
  });
  const rimMat = kit.track(new LineBasicMaterial({ color: raw("#FF5D57"), transparent: true, opacity: 0 }));
  const rim = new LineSegments(new EdgesGeometry(new BoxGeometry(5.62, 0.01, 2.36)), rimMat);
  rim.position.y = 2.13;
  skip.add(rim);
  const stencil = kit.canvasTex(1024, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = "700 74px Arial, sans-serif";
    g.fillStyle = "rgba(235,235,225,.92)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("REGISTRE DES HACKERS", w / 2, h / 2);
  }, null);
  const label = new Mesh(new PlaneGeometry(4.6, 0.72), kit.track(new MeshStandardMaterial({ map: stencil, transparent: true, roughness: 0.7 })));
  label.position.set(0, 1.25, 1.27);
  skip.add(label);
  const glassMat = kit.track(new MeshStandardMaterial({ color: raw("#0d1520"), roughness: 0.1 }));
  (
    [
      ["#7b8798", -1.6, 0.75, 0.3, 0.25],
      ["#9c4b46", 0.2, 0.75, -0.35, -0.2],
      ["#c9c2b0", 1.6, 0.75, 0.25, 0.1],
      ["#5a6f8c", -1.7, 1.45, 0, 0.12],
    ] as [string, number, number, number, number][]
  ).forEach(([c, x, y, z, r]) => {
    const g = new Group();
    B(1.9, 0.72, 1.05, kit.track(new MeshStandardMaterial({ color: raw(c), metalness: 0.5, roughness: 0.45 })), 0, 0, 0, g);
    B(0.9, 0.24, 1.07, glassMat, -0.2, 0.2, 0, g, false);
    B(0.4, 0.3, 1.09, mats.rubber, 0.65, -0.2, 0, g, false);
    g.position.set(x, y, z);
    g.rotation.set(0.06, r, -0.05);
    skip.add(g);
  });
  return { rimMat };
}
