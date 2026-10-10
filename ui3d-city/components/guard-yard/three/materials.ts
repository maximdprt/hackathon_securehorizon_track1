import {
  BoxGeometry,
  CanvasTexture,
  Color,
  LinearSRGBColorSpace,
  CylinderGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

/* Procedural textures (canvas, no image) and the yard's materials, as the reference: one seeded generator (Lehmer
   16807, seed 7) drawn in the same order, so every load renders the same. Everything made here is tracked for dispose. */

export type Kit = ReturnType<typeof createKit>;

/** a colour as three r128 (the reference) read a hex: its sRGB components taken as linear values. r155+ converts hex to
    linear properly, which darkens every material and light of the reference; ColorManagement stays on for the City */
export const raw = (c: string) => new Color().setStyle(c, LinearSRGBColorSpace);

export function createKit() {
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const textures: Texture[] = [];
  const materials: Material[] = [];

  function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat: [number, number] | null) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!, w, h);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    textures.push(t);
    return t;
  }
  function noise(g: CanvasRenderingContext2D, w: number, h: number, base: string, amp: number, n = 9000, size = 2) {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const v = (rnd() - 0.5) * amp;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      g.fillRect(rnd() * w, rnd() * h, size * rnd() + 0.5, size * rnd() + 0.5);
    }
  }

  // the textures, in the reference's order (the generator's draws depend on it)
  const asphaltTex = canvasTex(512, 512, (g, w, h) => {
    noise(g, w, h, "#1a1d23", 0.22, 26000, 2);
    for (let i = 0; i < 7; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 20 + rnd() * 60;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(0,0,0,.35)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }, [10, 6]);
  const concreteTex = canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, "#5d6066", 0.16, 9000, 1.5);
    g.strokeStyle = "rgba(0,0,0,.25)";
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = rnd() * w;
      let y = rnd() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 30;
        y += rnd() * 20;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, [1, 1]);
  const yellowTex = canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, "#c8961f", 0.14, 6000, 2);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(40,25,10,${0.08 + rnd() * 0.2})`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 6 + rnd() * 40);
    }
    g.fillStyle = "rgba(30,20,10,.35)";
    g.fillRect(0, h - 26, w, 26);
  }, [1, 1]);
  const greenTex = canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, "#2d4a3a", 0.14, 6000, 2);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(120,70,30,${0.1 + rnd() * 0.25})`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 4, 4 + rnd() * 30);
    }
  }, [2, 1]);
  const panelTex = canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, "#d9dde3", 0.06, 2000, 2);
    g.strokeStyle = "rgba(0,0,0,.25)";
    g.lineWidth = 2;
    for (let y = 40; y < h; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }, [1, 1]);
  const hazardTex = canvasTex(256, 32, (g) => {
    for (let i = -2; i < 20; i++) {
      g.fillStyle = i % 2 ? "#15171c" : "#E0A82E";
      g.beginPath();
      g.moveTo(i * 16, 32);
      g.lineTo(i * 16 + 16, 32);
      g.lineTo(i * 16 + 32, 0);
      g.lineTo(i * 16 + 16, 0);
      g.fill();
    }
  }, null);

  const track = <M extends Material>(m: M) => {
    materials.push(m);
    return m;
  };
  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) => track(new MeshStandardMaterial(p));
  const mats = {
    steelDark: std({ color: raw("#2b3038"), metalness: 0.75, roughness: 0.45 }),
    steel: std({ color: raw("#8a919c"), metalness: 0.9, roughness: 0.3 }),
    chrome: std({ color: raw("#e6e9ee"), metalness: 1, roughness: 0.12 }),
    concrete: std({ map: concreteTex, roughness: 0.95 }),
    yellow: std({ map: yellowTex, metalness: 0.35, roughness: 0.55 }),
    panelW: std({ map: panelTex, metalness: 0.2, roughness: 0.5 }),
    hazard: std({ map: hazardTex, roughness: 0.6 }),
    rubber: std({ color: raw("#0d0f12"), roughness: 0.9 }),
    skip: std({ map: greenTex, metalness: 0.4, roughness: 0.6 }),
    asphalt: std({ map: asphaltTex, roughness: 0.92, metalness: 0 }),
  };
  const glow = (c: string, i = 3) => std({ color: raw("#111"), emissive: raw(c), emissiveIntensity: i });
  const paint = (c: string) => std({ color: raw(c), roughness: 0.8 });

  /** a box resting centred at (x, y, z) in its parent; small details cast no shadow */
  function B(w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, parent: Object3D, cast = true) {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function C(r1: number, r2: number, h: number, mat: Material, x: number, y: number, z: number, parent: Object3D, seg = 16) {
    const m = new Mesh(new CylinderGeometry(r1, r2, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function signTex(lines: string[], bg = "#E0A82E", fg = "#15171c") {
    return canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = fg;
      g.lineWidth = 10;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.font = "700 46px Inter, Arial";
      lines.forEach((l, i) => g.fillText(l, w / 2, 100 + i * 64));
    }, null);
  }

  return { rnd, canvasTex, mats, glow, paint, track, B, C, signTex, textures, materials };
}
