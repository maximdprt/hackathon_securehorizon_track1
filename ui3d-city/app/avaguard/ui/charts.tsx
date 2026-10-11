"use client";

import { useEffect, useRef } from "react";
import { STATE, type CheckKey, CHECK_LABEL, CHECK_ORDER, type TxEvent } from "@/sim/types";
import { motion } from "@/sim/store";

/* The analysis card's charts, drawn in SVG by hand. Values that move every frame (the gauge's count) are written to the
   DOM from requestAnimationFrame, never through React state. */

export const zoneHex = (s: number, t: TxEvent["thresholds"]) => (s < t.allow_below ? STATE.allow.hex : s < t.block_from ? STATE.human.hex : STATE.block.hex);
export const zoneWord = (s: number, t: TxEvent["thresholds"]) => (s < t.allow_below ? "sûr" : s < t.block_from ? "doute" : "danger");

/* The guard computes a risk; the city shows its trust, 100 − risk: 0 is a scam, 100 is safe. Colours and icons still
   read the risk against the MCP's thresholds, so a trust and its risk always wear the same colour. */
export const trustOf = (risk: number) => 100 - risk;
/** how the chain grows: every decision of the protocol is a paid transaction */
export const SEC_LINE = "Every visa and every decision is a transaction on SentinelL1, paid in SEC.";
/** the thresholds on the trust scale: refused at or under `block_at`, a visa above `visa_above`, a human between */
export const trustCuts = (t: TxEvent["thresholds"]) => ({ block_at: 100 - t.block_from, visa_above: 100 - t.allow_below });
export const trustZones = (t: TxEvent["thresholds"]) => {
  const c = trustCuts(t);
  return `visa > ${c.visa_above} · humain ${c.block_at + 1} à ${c.visa_above} · refus ≤ ${c.block_at}`;
};

const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};

/** semicircular 0..100 trust gauge with the three threshold zones (refusal at the left, visa at the right); starts full
    and drains to the trust while motion.gauge runs, each signal taking its share */
export function Gauge({ tx, live }: { tx: TxEvent; live: boolean }) {
  const num = useRef<SVGTextElement>(null);
  const bar = useRef<SVGPathElement>(null);
  const t = tx.thresholds;
  const c = trustCuts(t);
  const trust = trustOf(tx.score);
  const angle = (v: number) => Math.PI - (Math.PI * v) / 100;
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const v = live ? Math.round(100 - (100 - trust) * motion.gauge) : trust;
      if (num.current) {
        num.current.textContent = live && motion.gauge === 0 ? "--" : String(v);
        num.current.setAttribute("fill", live && motion.gauge === 0 ? "#71717a" : zoneHex(trustOf(v), t));
      }
      if (bar.current) {
        bar.current.setAttribute("d", v > 0 ? arc(80, 78, 54, Math.PI, angle(v)) : "");
        bar.current.setAttribute("stroke", zoneHex(trustOf(v), t));
      }
      if (live) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
  return (
    <svg width="160" height="92" viewBox="0 0 160 92" role="img" aria-label={`Confiance ${trust} sur 100`}>
      <path d={arc(80, 78, 66, Math.PI, angle(c.block_at))} stroke={STATE.block.hex} strokeWidth="5" fill="none" opacity="0.8" />
      <path d={arc(80, 78, 66, angle(c.block_at), angle(c.visa_above))} stroke={STATE.human.hex} strokeWidth="5" fill="none" opacity="0.8" />
      <path d={arc(80, 78, 66, angle(c.visa_above), 0)} stroke={STATE.allow.hex} strokeWidth="5" fill="none" opacity="0.8" />
      <path d={arc(80, 78, 54, Math.PI, 0)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth="10" fill="none" />
      <path ref={bar} strokeWidth="10" fill="none" strokeLinecap="round" />
      <text ref={num} x="80" y="74" textAnchor="middle" className="font-mono" fontSize="28" fontWeight="700">
        --
      </text>
      <text x="80" y="90" textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="9">
        CONFIANCE / 100
      </text>
    </svg>
  );
}

/** radar of the five checks' trust (a full pentagon is a clean payment); a check draws once its line is lit */
export function Radar({ tx, lit }: { tx: TxEvent; lit: (k: CheckKey) => boolean }) {
  const R = 40;
  const c = 80;
  const at = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [c + Math.cos(a) * R * v, c + Math.sin(a) * R * v];
  };
  const poly = (vals: number[]) => vals.map((v, i) => at(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
  const vals = CHECK_ORDER.map((k) => (lit(k) ? trustOf(tx.checks[k].score) / 100 : 0));
  return (
    <svg width="160" height="124" viewBox="0 18 160 124" role="img" aria-label="Radar des 5 contrôles">
      {[0.33, 0.66, 1].map((r) => (
        <polygon key={r} points={poly([r, r, r, r, r])} fill="none" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
      ))}
      <polygon points={poly(vals)} fill={zoneHex(tx.score, tx.thresholds)} fillOpacity={0.28} stroke={zoneHex(tx.score, tx.thresholds)} strokeWidth="1.5" />
      {CHECK_ORDER.map((k, i) => {
        const [x, y] = at(i, 1.3);
        return (
          <text key={k} x={x} y={y + 3} textAnchor="middle" fontSize="7.5" className="fill-zinc-500 font-mono uppercase">
            {CHECK_LABEL[k].split(" ")[0]}
          </text>
        );
      })}
    </svg>
  );
}

/** CONFIANCE, five notches filled by the snowball's waves */
export function Confidence({ live, done, tone }: { live: boolean; done: boolean; tone: string }) {
  const cells = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const waves = done ? 5 : Math.floor(motion.snow * 5 + 0.0001);
      cells.current.forEach((el, i) => el && (el.style.background = i < waves ? tone : ""));
      if (live) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">Confiance</span>
      <span className="flex flex-1 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} ref={(el) => void (cells.current[i] = el)} className="h-1.5 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </span>
    </div>
  );
}

/** state icon: a shape as well as a colour (never colour alone) */
export function StateIcon({ kind, size = 16 }: { kind: "ok" | "warn" | "bad" | "wait"; size?: number }) {
  const c = kind === "ok" ? STATE.allow.hex : kind === "warn" ? STATE.human.hex : kind === "bad" ? STATE.block.hex : "#71717a";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke={c} strokeWidth="1.8" />
      {kind === "ok" && <path d="M6 10.4 L8.8 13 L14 7.4" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === "warn" && <path d="M10 5.5 V11 M10 14 V14.2" stroke={c} strokeWidth="2.2" strokeLinecap="round" />}
      {kind === "bad" && <path d="M7 7 L13 13 M13 7 L7 13" stroke={c} strokeWidth="2" strokeLinecap="round" />}
      {kind === "wait" && <circle cx="10" cy="10" r="2" fill={c} />}
    </svg>
  );
}
export const iconOf = (s: number, t: TxEvent["thresholds"]): "ok" | "warn" | "bad" => (s < t.allow_below ? "ok" : s < t.block_from ? "warn" : "bad");
