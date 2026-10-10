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
import { ViewHost } from "./views/ViewHost";
import { TransactionsView } from "./views/TransactionsView";
import { RegistryView } from "./views/RegistryView";
import { ParkingView } from "./views/ParkingView";
import { AuditView } from "./views/AuditView";
import { ChainSheet } from "./ui/ChainSheet";
import { useAudit } from "@/data/source";
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

/** the site's navbar replaced by ours: the shield and AvaGuard+, our tabs, the search, the theme, the badge */
function TopBar({ view, onSearch }: { view: View; onSearch: () => void }) {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const tabs: { label: string; view: View }[] = [
    { label: "City", view: null },
    { label: "Transactions", view: "transactions" },
    { label: "Registre", view: "registry" },
    { label: "Validation", view: "parking" },
    { label: "Audit", view: "audit" },
  ];
  return (
    <header className="relative z-40 flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5 dark:border-zinc-800 dark:bg-zinc-950" style={{ height: NAV_H }}>
      <div className="flex items-center gap-2.5">
        <svg width="24" height="24" viewBox="0 0 26 26" aria-hidden>
          <path d="M13 2 L23 6 V13 C23 18.5 18.8 22.6 13 24 C7.2 22.6 3 18.5 3 13 V6 Z" fill="none" stroke="#3FD08F" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M8.5 13.2 L11.8 16.4 L17.6 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">AvaGuard+</span>
      </div>
      <nav aria-label="Sections" className="absolute left-1/2 flex -translate-x-1/2 items-center gap-6">
        {tabs.map((t) => {
          const on = view === t.view;
          return (
            <button key={t.label} type="button" onClick={() => (t.view ? openView(t.view) : closeView())} aria-current={on ? "page" : undefined} className={cn("border-b-2 py-[15px] text-[14px] transition-colors", on ? "border-[#3FD08F] text-zinc-900 dark:text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")}>
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSearch} className="flex h-8 w-56 items-center gap-2 rounded-md border border-zinc-200 px-2.5 font-mono text-[11px] tracking-[0.14em] text-zinc-400 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
          <Search className="h-3.5 w-3.5" />
          SEARCH
          <span className="ml-auto rounded border border-zinc-200 px-1 text-[9.5px] dark:border-zinc-800">CTRL K</span>
        </button>
        <button
          type="button"
          aria-label={dark ? "Thème clair" : "Thème sombre"}
          onClick={() => {
            const next = !dark;
            document.documentElement.classList.toggle("dark", next);
            setDark(next);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <span className="rounded-md border border-[#F2B33D]/50 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#F2B33D]">Concept AvaGuard+ · simulation</span>
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

  // the C-Chain's tower opens the transactions it settles, AvaGuard's tower the audit; any other tower stays the City's
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
  const inset = useMemo<Inset>(() => ({ left: 20, right: rightOpen ? 372 + 28 : 20, top: 150, bottom: 112 }), [rightOpen]);

  // the network's own figures, real and dated (the snapshot), apart from ours
  const figures = useMemo(() => {
    const sets = data.nodes.filter((n) => n.id !== AVAGUARD_ID);
    const realIcm = data.icmSimulated ? 0 : data.summary.total;
    return { chains: sets.length, validators: sets.reduce((a, n) => a + (n.validators ?? 0), 0), icm: realIcm };
  }, [data]);
  const day = takenAt ? new Date(takenAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "…";
  // the strip's AvaGuard figures and the risk chip, from the same source as the screens (history plus this session)
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
      usd: t.filter((x) => x.status === "BLOCK" && x.amount.token === "USDC").reduce((a, x) => a + x.amount.value, 0),
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
      <TopBar view={screen} onSearch={() => searchRef.current?.focus()} />
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

        {/* the commands row (city-frame.tsx SidebarHead's cards): chains, the view, the network */}
        <div className="absolute left-(--frame) top-(--frame) z-30 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <div className="relative isolate flex h-11 items-center gap-2 rounded-2xl pl-3.5 pr-4 text-zinc-800 dark:text-zinc-100">
              <span aria-hidden className={CARD} />
              Chaînes
              <span className="font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{figures.chains + 1}</span>
            </div>
            <div role="group" aria-label="Vue" className="relative isolate flex h-11 items-stretch gap-0.5 rounded-2xl p-1">
              <span aria-hidden className={CARD} />
              <span className={SEG_OFF} title="La vue 2D de l'explorer n'est pas reprise ici">
                Explorer
              </span>
              <span aria-current="page" className={SEG_ON}>
                City
              </span>
            </div>
            <div role="group" aria-label="Réseau" className="relative isolate flex h-11 items-stretch gap-0.5 rounded-2xl p-1">
              <span aria-hidden className={CARD} />
              <span className={SEG_OFF} title="Instantané Fuji uniquement">
                Mainnet
              </span>
              <span aria-current="page" className={SEG_ON}>
                Fuji
              </span>
            </div>
          </div>
          {/* the demo bar, discreet */}
          <div role="group" aria-label="Démo" className="relative isolate flex h-9 items-center gap-0.5 self-start rounded-xl px-1 font-mono text-[10.5px]">
            <span aria-hidden className={CARD} />
            {SCENES.map((s) => (
              <button key={s.k} type="button" onClick={() => playScene(s.k)} className="rounded-lg px-2 py-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
                <span className="text-zinc-400">{s.key}</span> {s.label}
              </button>
            ))}
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <button type="button" onClick={resetAll} className="rounded-lg px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
              <span className="text-zinc-400">0</span> Reset
            </button>
            <button type="button" onClick={() => setPaused(!paused)} className="rounded-lg px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
              <span className="text-zinc-400">Espace</span> {paused ? "reprendre" : "pause"}
            </button>
            <span className="px-2 text-zinc-400">F suivre</span>
          </div>
        </div>

        {/* the search over the city's top, its chips under it (city-app.tsx) */}
        <div className="pointer-events-none absolute left-1/2 top-(--frame) z-30 w-[min(42rem,calc(100%-56rem))] -translate-x-1/2">
          <div className="pointer-events-auto flex flex-col items-center gap-2">
            <label className={cn("relative flex h-11 w-full items-center gap-2 rounded-2xl px-3.5", GLASS)}>
              <Search className="h-4 w-4 text-zinc-400" />
              <span className="sr-only">Rechercher</span>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => sim.set({ search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openView("transactions");
                }}
                placeholder="Rechercher une transaction, une adresse, un agent…"
                className="h-full flex-1 bg-transparent text-[13.5px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              <span className="rounded border border-zinc-200 px-1.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-800">/</span>
            </label>
            <div className="flex flex-wrap justify-center gap-1.5">
              {[
                { label: "Transactions par état", on: () => openView("transactions") },
                { label: "Risque moyen", on: () => setChip(chip === "risk" ? null : "risk") },
                { label: "Registre des hackers", on: () => openView("registry") },
                { label: "Montant protégé", on: () => openView("audit") },
              ].map((c) => (
                <button key={c.label} type="button" onClick={c.on} className={cn("h-8 rounded-xl px-3 font-mono text-[11px] text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50", GLASS)}>
                  {c.label}
                </button>
              ))}
            </div>
            {chip === "risk" && (
              <div className={cn("rounded-xl px-3 py-2 text-[12.5px] text-zinc-700 dark:text-zinc-200", GLASS)}>
                Risque moyen des décisions : <span className="font-mono">{avgRisk === null ? "aucune décision" : `${avgRisk}/100`}</span> <span className="text-zinc-400">(simulé)</span>
              </div>
            )}
          </div>
        </div>

        {/* the key in the bottom left corner (city-key.tsx), and ours above it */}
        <div data-city-hud className="absolute bottom-[calc(var(--frame)+1.4rem)] left-(--frame) z-30 hidden flex-col gap-2 xl:flex" style={{ width: KEY_W }}>
          <div className={cn("rounded-2xl px-4 py-3", GLASS)}>
            <div className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">AvaGuard</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {(["verify", "allow", "block", "human"] as const).map((t) => (
                <span key={t} className="flex items-center gap-1.5 text-[11.5px] text-zinc-700 dark:text-zinc-300">
                  <span className="h-2 w-2 rounded-full" style={{ background: STATE[t].hex }} />
                  <StateIcon kind={t === "allow" ? "ok" : t === "block" ? "bad" : t === "human" ? "warn" : "wait"} size={12} />
                  {STATE[t].label}
                </span>
              ))}
            </div>
            {mode === "live" && <div className="mt-1.5 font-mono text-[10px] text-zinc-500">live : {liveStatus || "…"}</div>}
          </div>
          <CityKey
            height={height}
            onHeight={setHeight}
            lens={lens}
            onLens={setLens}
            versionsIn={false}
            painted={lens === "versions"}
            target=""
            targets={[]}
            onTarget={() => {}}
            windowShort={data.icmSimulated ? "24H · simulé" : "24H"}
            inPanel={false}
            onSize={() => {}}
          />
        </div>

        <AnalysisCard />
        {sheetNode && <ChainSheet node={sheetNode} partner={sheetPartner} simulated={data.icmSimulated} onClose={() => setSelected(null)} />}
        <HumanAlert />
        <Toasts />
        <ViewHost screens={{ transactions: <TransactionsView />, registry: <RegistryView />, parking: <ParkingView />, audit: <AuditView /> }} />

        {/* the figures at the city's foot (city-frame.tsx FigureStrip): the network's, real and dated, then ours */}
        <div className="absolute inset-x-0 bottom-[1.3rem] z-10">
          <FigureStrip sidebar={false} legend right={0} network={network}>
            <Figure label="Chains" value={figures.chains.toLocaleString("fr-FR")} sub={`Fuji · instantané ${day}`} />
            <Figure label="Validators" value={fmtCompact(figures.validators)} sub="réels" />
            <Figure label="ICM · 24H" value={fmtCompact(figures.icm)} sub={data.icmSimulated ? "rues : trafic simulé" : "réels"} />
            <Figure label="Transactions" value={stats.total} sub={kpi.transactions ? `dont ${kpi.transactions} ici · simulé` : "simulé"} />
            <Figure label="Visas" value={stats.visas} sub="émis" tone={STATE.allow.hex} />
            <Figure label="Bloquées" value={stats.blocked} sub="refusées" tone={STATE.block.hex} />
            <Figure label="En attente" value={pending} sub="humain" tone={STATE.human.hex} />
            <Figure label="Registre" value={audit.banned.length} sub="adresses" />
            <Figure label="Protégé" value={fmtAmount(stats.usd)} sub="USDC" />
            <Figure label="Décision" value={stats.avg ? `${(stats.avg / 1000).toFixed(1).replace(".", ",")} s` : "0 s"} sub="moyenne" />
          </FigureStrip>
        </div>

        {/* the round button at the bottom right: the decisions' log (under the card while one is open) */}
        {!rightOpen && <button
          type="button"
          aria-label="Journal des décisions"
          onClick={() => openView("transactions")}
          className={cn("absolute bottom-[calc(var(--frame)+1.3rem)] right-(--frame) z-30 flex h-12 w-12 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50", GLASS)}
        >
          <History className="h-5 w-5" />
          {journal.length > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[#3FD08F] px-1.5 font-mono text-[9.5px] font-bold text-zinc-950">{journal.length}</span>}
        </button>}

        {/* the licence's mention, as the prompt asks */}
        <p className="pointer-events-none absolute inset-x-0 bottom-1 z-10 text-center font-mono text-[9.5px] text-zinc-500 dark:text-zinc-500">City 3D d&apos;après le code open source Avalanche Builder Hub (BSD-3) · Concept AvaGuard+ · simulation</p>
      </div>
    </div>
  );
}
