import type { GuardVerdict } from "../types";
import { drawXray, xrayBase } from "./xray";

/* The HUD driven from frame(t) by direct DOM writes (textContent, classList, style), never React state per frame. Each
   setter remembers its last value and touches the DOM only on a change. */

export type Hud = ReturnType<typeof createHud>;

export function createHud(root: HTMLElement, v: GuardVerdict) {
  const q = <T extends Element>(k: string) => root.querySelector<T>(`[data-gy="${k}"]`)!;
  const phase = q<HTMLElement>("phase");
  const card = q<HTMLElement>("card");
  const badge = q<HTMLElement>("badge");
  const score = q<HTMLElement>("score");
  const details = q<HTMLElement>("details");
  const tag = q<HTMLElement>("tag");
  const rows = [...root.querySelectorAll<HTMLElement>('[data-gy="row"]')];
  const xctx = q<HTMLCanvasElement>("xray").getContext("2d")!;
  const base = xrayBase(v.flaggedCall ?? "");
  const tone = (n: number) => (n < v.thresholds.allow ? "var(--gy-green)" : n < v.thresholds.block ? "var(--gy-amber)" : "var(--gy-red)");
  const last: Record<string, unknown> = {};
  const changed = (k: string, val: unknown) => {
    if (last[k] === val) return false;
    last[k] = val;
    return true;
  };
  return {
    phase(text: string) {
      if (changed("phase", text)) phase.textContent = text;
    },
    card(on: boolean) {
      if (changed("card", on)) card.classList.toggle("on", on);
    },
    rows(n: number) {
      if (!changed("rows", n)) return;
      rows.forEach((r, i) => {
        const on = i < n;
        const val = Number(r.dataset.v);
        const bar = r.querySelector<HTMLElement>("i")!;
        r.classList.toggle("on", on);
        bar.style.width = on ? `${val}%` : "0";
        bar.style.background = tone(val);
        r.querySelector<HTMLElement>(".v")!.style.color = on ? tone(val) : "var(--gy-mute)";
      });
    },
    score(n: number | null) {
      if (!changed("score", n)) return;
      score.textContent = n === null ? "--" : String(n);
      score.style.color = n === null ? "var(--gy-ink)" : tone(n);
    },
    verdict(on: boolean) {
      if (!changed("verdict", on)) return;
      badge.textContent = on ? "BLOCK" : "SCAN…";
      badge.style.background = on ? "var(--gy-red)" : "rgba(111,168,255,.15)";
      badge.style.color = on ? "#fff" : "var(--gy-blue)";
      card.style.setProperty("--c", on ? "var(--gy-red)" : "var(--gy-blue)");
      details.classList.toggle("on", on);
    },
    tag(on: boolean) {
      if (changed("tag", on)) tag.classList.toggle("on", on);
    },
    xray(u: number) {
      const k = Math.round(u * 600);
      if (changed("xray", k)) drawXray(xctx, base, u);
    },
  };
}
