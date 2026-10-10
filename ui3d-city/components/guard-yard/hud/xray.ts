import { PROFILE } from "../three/constants";

/* The card's 2D X-ray, as the reference: drawn once off screen from the car's own profile (x 125 px/m, y 110 px/m,
   origin (300, 185)), glazing, two wheels, seats, and the flagged call framed in red on the boot; then revealed from
   right to left with a thin blue sweep line. No noise. */

export function xrayBase(flaggedCall: string) {
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 200;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0f17";
  g.fillRect(0, 0, 600, 200);
  const X = (x: number) => 300 + x * 125;
  const Y = (y: number) => 185 - y * 110;
  g.fillStyle = "rgba(170,195,230,.28)";
  g.beginPath();
  PROFILE.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(210,225,255,.7)";
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "rgba(230,240,255,.55)";
  g.fillRect(X(1.2), Y(0.85), 90, 40);
  [-1.32, 1.32].forEach((x) => {
    g.beginPath();
    g.arc(X(x), Y(0.36), 40, 0, 6.3);
    g.strokeStyle = "rgba(230,240,255,.7)";
    g.lineWidth = 6;
    g.stroke();
  });
  g.fillStyle = "rgba(200,215,240,.35)";
  g.fillRect(X(-0.5), Y(0.95), 60, 30);
  g.fillRect(X(0.2), Y(0.95), 50, 30);
  g.strokeStyle = "#FF5D57";
  g.lineWidth = 3;
  g.strokeRect(X(-2.05), Y(0.92), 120, 52);
  g.fillStyle = "#FF5D57";
  g.font = "700 16px ui-monospace, monospace";
  g.fillText(flaggedCall, X(-2.05), Y(0.92) - 8);
  return c;
}

export function drawXray(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, u: number) {
  ctx.fillStyle = "#0b0f17";
  ctx.fillRect(0, 0, 600, 200);
  const w = 600 * u;
  if (w > 0) ctx.drawImage(base, 600 - w, 0, w, 200, 600 - w, 0, w, 200);
  if (u > 0 && u < 1) {
    ctx.fillStyle = "rgba(143,184,255,.9)";
    ctx.fillRect(600 - w - 2, 0, 3, 200);
  }
}
