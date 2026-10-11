"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { History, Moon, Search, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCompact } from "@/components/explorer-v2/evm/metric-charts";
import { useCityData } from "@/components/explorer-v2/network/city-data";
import { CityKey, KEY_W, type Lens } from "@/components/explorer-v2/network/city-key";
import { FRAME, FigureStrip, GLASS } from "@/components/explorer-v2/network/city-frame";
import { overviewStatsUrl } from "@/components/explorer-v2/network/network-reads";
import type { CameraHandle, Inset, SizeBy } from "@/components/explorer-v2/network/icm-map";
import type { District } from "@/components/explorer-v2/network/districts";
import type { Height } from "@/components/explorer-v2/network/city-app";
import type { PchainNetwork } from "@/lib/pchain-explorer";
import { AVAGUARD_ID } from "@/components/explorer-v2/network/avaguard";
import { answerHuman, enqueue, followCar, playScene, resetAll, setPaused } from "@/sim/Director";
import { startLiveFeed } from "@/sim/liveFeed";
import { motion, sim, useSim, type View } from "@/sim/store";
import { closeView, listenUrl, openView } from "@/sim/nav";
import { STATE, fmtAmount } from "@/sim/types";
import type { SceneKey } from "@/sim/scenario";
import { AnalysisCard } from "./ui/AnalysisCard";
import { HumanAlert, Toasts } from "./ui/Panels";
import { HowItWorks, Impact, TryIt } from "./ui/Story";
import { ViewHost } from "./views/ViewHost";
import { TransactionsView } from "./views/TransactionsView";
import { RegistryView } from "./views/RegistryView";
import { ParkingView } from "./views/ParkingView";
import { AuditView } from "./views/AuditView";
import { ChainSheet } from "./ui/ChainSheet";
import { LIVE_CONFIGURED, protectedOf, useAudit } from "@/data/source";
import { StateIcon } from "./ui/charts";

/* The page around the City, rebuilt after builders-hub's NetworkChains.tsx, city-app.tsx and city-frame.tsx (their
   large-screen layout: the same frame token, sky, cards, places and classes), with our contents and none of their
   brand, navigation, AI search or server reads. */

const City3D = memo(dynamic(() => import("@/components/explorer-v2/network/city3d/City3D"), { ssr: false }));
const NETWORK: PchainNetwork = "fuji";
const WINDOW_LABEL = "24 hours";
const NAV_H = "3.5rem";

/** each chain's transactions over the day, from the same aggregate the network overview reads (NetworkChains.tsx) */
function useChainActivity(network: PchainNetwork) {
  const [byId, setById] = useState<Map<string, number | null> | null>(null);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(overviewStatsUrl("day", network), { signal: controller.signal })
      .then((res) => {
        setTakenAt(res.headers.get("x-snapshot"));
        return res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`));
      })
      .then((d: { chains?: { chainId: string; txCount: number | null }[] }) => setById(new Map((d.chains ?? []).map((c) => [String(c.chainId), c.txCount]))))
      .catch(() => {});
    return () => controller.abort();
  }, [network]);
  return { byId, takenAt };
}

/** one cell of the figure strip, with city-app.tsx's classes */
function Figure({ label, value, sub, title, tone }: { label: string; value: ReactNode; sub: ReactNode; title?: string; tone?: string }) {
  return (
    <div title={title} className="flex min-w-0 flex-col items-start gap-0.5 px-4 py-2.5">
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="font-mono text-[17px] font-semibold tabular-nums leading-tight text-zinc-900 dark:text-zinc-50" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="truncate font-mono text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">{sub}</span>
    </div>
  );
}

/** the card glass of city-frame.tsx's SidebarHead, behind a control */
const CARD = "absolute inset-0 -z-10 rounded-2xl border border-zinc-200/90 bg-white/[0.94] shadow-[0_12px_32px_-18px_rgba(30,27,58,0.45)] backdrop-blur-xl dark:border-zinc-800/90 dark:bg-zinc-950/[0.9]";
const SEG_ON = "flex items-center rounded-xl bg-zinc-100 px-3 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50";
const SEG_OFF = "flex items-center rounded-xl px-3 text-zinc-400 dark:text-zinc-600";

/** the top bar: the name and what it does in one line, the screens, the theme */
function TopBar({ view }: { view: View }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const tabs: { label: string; view: View }[] = [
    { label: "Ville", view: null },
    { label: "Transactions", view: "transactions" },
    { label: "Registre des hackers", view: "registry" },
    { label: "Validation humaine", view: "parking" },
    { label: "Audit", view: "audit" },
  ];
  return (
    <header className="relative z-40 flex shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/95 px-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950" style={{ height: NAV_H }}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <svg width="18" height="18" viewBox="0 0 26 26" aria-hidden>
            <path d="M13 2 L23 6 V13 C23 18.5 18.8 22.6 13 24 C7.2 22.6 3 18.5 3 13 V6 Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
            <path d="M8.5 13.2 L11.8 16.4 L17.6 10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-slate-900 dark:text-zinc-50">Sentinel</div>
          <div className="hidden text-[11.5px] text-slate-500 md:block dark:text-zinc-400">Contrôle les paiements des agents IA avant qu&apos;ils partent</div>
        </div>
      </div>
      <nav aria-label="Sections" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-xl bg-slate-100/80 p-1 xl:flex dark:bg-zinc-900">
        {tabs.map((t) => {
          const on = view === t.view;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => (t.view ? openView(t.view) : closeView())}
              aria-current={on ? "page" : undefined}
              className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", on ? "bg-white text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-100")}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        {LIVE_CONFIGURED ? (
          <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-700 ring-1 ring-emerald-200 sm:inline dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">Live · Sentinel L1 + agent MCP</span>
        ) : (
          <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-700 ring-1 ring-amber-200 sm:inline dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">Démo · données fictives</span>
        )}
        <button
          type="button"
          aria-label={dark ? "Thème clair" : "Thème sombre"}
          onClick={() => {
            const next = !dark;
            document.documentElement.classList.toggle("dark", next);
            setDark(next);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}

const SCENES: { k: SceneKey; key: string; label: string }[] = [
  { k: "fraud", key: "1", label: "Fraude" },
  { k: "legit", key: "2", label: "Légitime" },
  { k: "doubt", key: "3", label: "Doute" },
  { k: "immunity", key: "4", label: "Immunité" },
];

export default function CityShell() {
  const network = NETWORK;
  const { byId: activityById, takenAt } = useChainActivity(network);
  const [height, setHeight] = useState<Height>("validators");
  const [lens, setLens] = useState<Lens>("districts");
  const view: SizeBy = height === "messages" ? "messages" : "validators";
  const data = useCityData({ days: 1, sizeBy: view, network });
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<District | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [chip, setChip] = useState<null | "risk">(null);
  const camera = useRef<CameraHandle | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panel = useSim((s) => s.panel);
  const paused = useSim((s) => s.paused);
  const kpi = useSim((s) => s.kpi);
  const registry = useSim((s) => s.registry);
  const journal = useSim((s) => s.journal);
  const human = useSim((s) => s.human);
  const tx = useSim((s) => s.tx);
  const phase = useSim((s) => s.phase);
  const search = useSim((s) => s.search);
  const mode = useSim((s) => s.mode);
  const liveStatus = useSim((s) => s.liveStatus);

  // the C-Chain's tower opens the transactions it settles, Sentinel's tower the audit; any other tower stays the City's
  const hubId = data.hubId;
  const onSelect = useCallback(
    (id: string | null) => {
      if (id && id === hubId) return openView("transactions");
      if (id === AVAGUARD_ID) return openView("audit");
      setSelected(id);
    },
    [hubId],
  );
  const screen = useSim((s) => s.view);
  useEffect(() => listenUrl(), []);
  const onFocus = useCallback((d: District | null) => {
    setRoute(null);
    setFocus(d);
    setSelected(null);
  }, []);
  const onRoute = useCallback((pair: string | null) => {
    setRoute(pair);
    if (pair) setSelected(null);
  }, []);
  const onHover = useCallback(() => {}, []);
  const activity = useMemo(() => {
    if (!activityById) return null;
    const m = new Map<string, number>();
    for (const [id, n] of activityById) if (n) m.set(id, n);
    return m;
  }, [activityById]);
  // the camera keeps the city clear of the open card at the right
  const busyRight = !!panel || (!!tx && phase !== "idle") || !!human;
  // another tower picked: its sheet at the right, while no transaction holds that place
  const sheetNode = !busyRight && selected ? (data.nodes.find((n) => n.id === selected) ?? null) : null;
  const sheetPartner = useMemo(() => {
    if (!sheetNode) return null;
    const by = new Map<string, number>();
    for (const r of data.routes) if (r.from === sheetNode.id || r.to === sheetNode.id) by.set(r.from === sheetNode.id ? r.to : r.from, (by.get(r.from === sheetNode.id ? r.to : r.from) ?? 0) + r.messages);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? (data.nodes.find((n) => n.id === top[0])?.name ?? null) : null;
  }, [sheetNode, data]);
  const rightOpen = busyRight || !!sheetNode;
  const inset = useMemo<Inset>(() => ({ left: 420, right: rightOpen ? 372 + 28 : 24, top: 40, bottom: 140 }), [rightOpen]);

  // the network's own figures, real and dated (the snapshot), apart from ours
  const figures = useMemo(() => {
    const sets = data.nodes.filter((n) => n.id !== AVAGUARD_ID);
    const realIcm = data.icmSimulated ? 0 : data.summary.total;
    return { chains: sets.length, validators: sets.reduce((a, n) => a + (n.validators ?? 0), 0), icm: realIcm };
  }, [data]);
  const day = takenAt ? new Date(takenAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "…";
  // the strip's Sentinel figures and the risk chip, from the same source as the screens (history plus this session)
  const audit = useAudit();
  const avgRisk = useMemo(() => (audit.txs.length ? Math.round(audit.txs.reduce((a, t) => a + t.score, 0) / audit.txs.length) : null), [audit.txs]);
  const pending = human ? 1 : 0;
  const stats = useMemo(() => {
    const t = audit.txs;
    const final = t.filter((x) => x.status === "ALLOW" || x.status === "BLOCK");
    return {
      total: t.length,
      visas: t.filter((x) => x.status === "ALLOW").length,
      blocked: t.filter((x) => x.status === "BLOCK").length,
      prot: protectedOf(t),
      avg: final.length ? final.reduce((a, x) => a + x.timings_ms.decide, 0) / final.length : 0,
    };
  }, [audit.txs]);

  // the presenter's keys
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.repeat || el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      // a screen over the city keeps the keyboard for itself
      if (sim.get().view) return;
      const digit = /^(Digit|Numpad)\d$/.test(e.code) ? e.code.slice(-1) : null;
      if (digit && ["1", "2", "3", "4"].includes(digit)) return playScene(SCENES[Number(digit) - 1].k);
      if (digit === "0") return resetAll();
      if (e.code === "Space") {
        e.preventDefault();
        return setPaused(!sim.get().paused);
      }
      switch (e.key.toLowerCase()) {
        case "f":
          followCar();
          break;
        case "o":
          camera.current?.home();
          break;
        case "d":
          openView("transactions", { tx: sim.get().tx?.tx_id ?? sim.get().ledger[0]?.tx_id ?? null });
          break;
        case "a":
          answerHuman(true);
          break;
        case "r":
          answerHuman(false);
          break;
        case "escape":
          sim.set({ panel: null });
          break;
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // live mode: verdicts from the team's API, proofs from the chain
  useEffect(() => {
    if (mode !== "live") return;
    return startLiveFeed(
      (t) => enqueue(t),
      (p) => sim.set((s) => (s.tx && s.tx.raw && (s.tx.raw as { instruction_id?: string }).instruction_id === p.instruction_id ? { tx: { ...s.tx, onchain: { chain: "Fuji", block: p.block, tx_hash: p.tx_hash } } } : {})),
      (status) => sim.set({ liveStatus: status }),
    );
  }, [mode]);

  // a test and debug handle for tools/capture.mjs and the Playwright suite
  useEffect(() => {
    (window as unknown as { __ag: unknown }).__ag = { sim, motion, playScene, resetAll, answerHuman, setPaused };
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar view={screen} />
      <div
        data-city-app
        className={`${FRAME} relative min-h-0 w-full flex-1 overflow-clip bg-[radial-gradient(ellipse_420px_300px_at_13%_11%,rgba(255,255,255,0.55),rgba(255,255,255,0.28)_45%,rgba(255,255,255,0)_100%),linear-gradient(to_bottom,#D6DDE5_0%,#D4DBE4_26%,#D3DAE3_39%,#D2D9E2_51%,#D1D7E0_57%,#CED3DB_63%,#CCD1D8_75%,#CACFD6_88%,#C9CED5_100%)] dark:bg-[radial-gradient(ellipse_420px_300px_at_13%_11%,rgba(160,175,200,0.2),rgba(160,175,200,0.13)_45%,rgba(160,175,200,0)_100%),linear-gradient(to_bottom,#161A21_0%,#151920_26%,#11141B_39%,#0E1219_51%,#12161B_57%,#191B20_63%,#1B1E22_69%,#1C1E23_75%,#1D1F24_88%,#1D1F24_100%)]`}
      >
        <City3D
          data={data}
          network={network}
          versions={null}
          target=""
          sizeBy={view}
          paint={lens === "versions"}
          activity={activity}
          windowLabel={WINDOW_LABEL}
          selected={selected}
          onSelect={onSelect}
          focus={focus}
          onFocus={onFocus}
          route={route}
          onRoute={onRoute}
          lit={null}
          hovered={null}
          onHover={onHover}
          inset={inset}
          cameraRef={camera}
        />

        {/* the story, for someone who has never heard of the project: what the MCP agent does, and four situations to try */}
        <div className="absolute left-(--frame) top-(--frame) z-30 hidden max-h-[calc(100%-2*var(--frame)-8.5rem)] flex-col gap-3 overflow-y-auto lg:flex">
          <HowItWorks />
          <TryIt />
        </div>
        {mode === "live" && (
          <div className="absolute right-(--frame) top-(--frame) z-20 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11.5px] text-slate-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/85 dark:text-zinc-300">
            Direct : {liveStatus || "connexion…"}
          </div>
        )}

        <AnalysisCard />
        {sheetNode && <ChainSheet node={sheetNode} partner={sheetPartner} simulated={data.icmSimulated} onClose={() => setSelected(null)} />}
        <HumanAlert />
        <Toasts />
        <ViewHost screens={{ transactions: <TransactionsView />, registry: <RegistryView />, parking: <ParkingView />, audit: <AuditView /> }} />

        {/* what it is worth, in five figures */}
        <div className={cn("absolute bottom-[1.6rem] left-(--frame) z-20 transition-[right] duration-300", rightOpen ? "right-[calc(var(--frame)+384px)]" : "right-(--frame)")}>
          <Impact />
        </div>

        {/* the licence's mention, as the prompt asks */}
        <p className="pointer-events-none absolute inset-x-0 bottom-1 z-10 text-center text-[10px] text-slate-400 dark:text-zinc-500">City 3D d&apos;après le code open source Avalanche Builder Hub (BSD-3) · Concept Sentinel · données de démonstration</p>
      </div>
    </div>
  );
}
