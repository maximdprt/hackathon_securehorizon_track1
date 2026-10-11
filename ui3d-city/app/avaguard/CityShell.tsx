"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCityData } from "@/components/explorer-v2/network/city-data";
import type { Lens } from "@/components/explorer-v2/network/city-key";
import { EASE, FRAME, FigureStrip, GLASS, PANE, PANEL_W } from "@/components/explorer-v2/network/city-frame";
import { overviewStatsUrl } from "@/components/explorer-v2/network/network-reads";
import type { CameraHandle, Inset, SizeBy } from "@/components/explorer-v2/network/icm-map";
import type { District } from "@/components/explorer-v2/network/districts";
import type { Height } from "@/components/explorer-v2/network/city-app";
import type { PchainNetwork } from "@/lib/pchain-explorer";
import { AVAGUARD_ID, SENTINEL_RING } from "@/components/explorer-v2/network/avaguard";
import { answerHuman, enqueue, followCar, playScene, resetAll, setPaused, stopFollow } from "@/sim/Director";
import { parseMessage, startLiveFeed } from "@/sim/liveFeed";
import { motion, sim, useSim, type View } from "@/sim/store";
import { closeView, listenUrl, openView } from "@/sim/nav";
import { STATE } from "@/sim/types";
import type { SceneKey } from "@/sim/scenario";
import { AnalysisCard } from "./ui/AnalysisCard";
import { Toasts } from "./ui/Panels";
import { Directory, Figures, LatestFeed, SentinelKey, useKpis } from "./ui/Frame";
import { ViewHost } from "./views/ViewHost";
import { TransactionsView } from "./views/TransactionsView";
import { RegistryView } from "./views/RegistryView";
import { ParkingView } from "./views/ParkingView";
import { AuditView } from "./views/AuditView";
import { ChainSheet } from "./ui/ChainSheet";
import { LIVE_CONFIGURED } from "@/data/source";
import { sentinelConfig } from "@/data/sentinel";

/* The page around the City, rebuilt after builders-hub's NetworkChains.tsx, city-app.tsx and city-frame.tsx (their
   large-screen layout: the same frame token, sky, cards, places and classes), with our contents and none of their
   brand, navigation, AI search or server reads: the list's door and the view at the top left, the search and its chips
   at the top, the key at the bottom left, the figures at the foot, the latest decisions at the bottom right. In words a
   newcomer to blockchains reads (ui/Frame.tsx). */

const City3D = memo(dynamic(() => import("@/components/explorer-v2/network/city3d/City3D"), { ssr: false }));
const NETWORK: PchainNetwork = "fuji";
const WINDOW_LABEL = "24 hours";
const NAV_H = "3.5rem";
/** the card at the right while a transaction plays (ui/AnalysisCard.tsx) */
const RIGHT_W = 372;

/** each chain's transactions over the day, from the same aggregate the network overview reads (NetworkChains.tsx) */
function useChainActivity(network: PchainNetwork) {
  const [byId, setById] = useState<Map<string, number | null> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(overviewStatsUrl("day", network), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: { chains?: { chainId: string; txCount: number | null }[] }) => setById(new Map((d.chains ?? []).map((c) => [String(c.chainId), c.txCount]))))
      .catch(() => {});
    return () => controller.abort();
  }, [network]);
  return byId;
}

/** the card glass of city-frame.tsx's SidebarHead, behind a control */
const CARD = "absolute inset-0 -z-10 rounded-2xl border border-zinc-200/90 bg-white/[0.94] shadow-[0_12px_32px_-18px_rgba(30,27,58,0.45)] backdrop-blur-xl dark:border-zinc-800/90 dark:bg-zinc-950/[0.9]";
const SEG_ON = "flex items-center rounded-xl bg-zinc-100 px-3 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50";
const SEG_OFF = "flex items-center rounded-xl px-3 text-zinc-400 dark:text-zinc-600";

/** the site's navbar, as builders-hub's: the name at the left, the sections with their underline, the status and the theme */
function TopBar({ view }: { view: View }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const tabs: { label: string; view: View }[] = [
    { label: "Ville", view: null },
    { label: "Paiements", view: "transactions" },
    { label: "Registre des hackers", view: "registry" },
    { label: "Avis humain", view: "parking" },
    { label: "Audit", view: "audit" },
  ];
  return (
    <header className="relative z-40 flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5 dark:border-zinc-800 dark:bg-zinc-950" style={{ height: NAV_H }}>
      <div className="flex items-center gap-2.5">
        <svg width="24" height="24" viewBox="0 0 26 26" aria-hidden>
          <path d="M13 2 L23 6 V13 C23 18.5 18.8 22.6 13 24 C7.2 22.6 3 18.5 3 13 V6 Z" fill="none" stroke="#E6212F" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M8.5 13.2 L11.8 16.4 L17.6 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-900 dark:text-zinc-50" />
        </svg>
        <span className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">Sentinel</span>
        <span className="hidden text-[12.5px] text-zinc-400 lg:inline">le garde des paiements d&apos;agents IA</span>
      </div>
      <nav aria-label="Sections" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 xl:flex">
        {tabs.map((t) => {
          const on = view === t.view;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => (t.view ? openView(t.view) : closeView())}
              aria-current={on ? "page" : undefined}
              className={cn(
                "border-b-2 py-[15px] text-[14px] transition-colors",
                on ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "hidden rounded-md border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] sm:inline",
            LIVE_CONFIGURED ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-amber-500/50 text-amber-600 dark:text-amber-400",
          )}
        >
          {LIVE_CONFIGURED ? "Live · blockchain Sentinel" : "Démo · données fictives"}
        </span>
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
      </div>
    </header>
  );
}

/** the four situations the city plays (the demo, off the chain), as the chips under the search */
const SCENES: { k: SceneKey; key: string; label: string; tone: string }[] = [
  { k: "fraud", key: "1", label: "Facture piégée", tone: STATE.block.hex },
  { k: "legit", key: "2", label: "Paiement normal", tone: STATE.allow.hex },
  { k: "doubt", key: "3", label: "Boutique inconnue", tone: STATE.human.hex },
  { k: "immunity", key: "4", label: "Escroc récidiviste", tone: STATE.block.hex },
];

export default function CityShell() {
  const network = NETWORK;
  const activityById = useChainActivity(network);
  const [height] = useState<Height>("validators");
  const [lens] = useState<Lens>("districts");
  const view: SizeBy = height === "messages" ? "messages" : "validators";
  const data = useCityData({ days: 1, sizeBy: view, network });
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<District | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const camera = useRef<CameraHandle | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panel = useSim((s) => s.panel);
  const human = useSim((s) => s.human);
  const tx = useSim((s) => s.tx);
  const phase = useSim((s) => s.phase);
  const search = useSim((s) => s.search);
  const mode = useSim((s) => s.mode);
  const kpis = useKpis();

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
  // the camera keeps the city under the search and its chips, and clear of the list and the card (city-app.tsx's room)
  const inset = useMemo<Inset>(() => ({ left: listOpen ? PANEL_W + 28 : 20, right: rightOpen ? RIGHT_W + 28 : 20, top: 112, bottom: 92 }), [listOpen, rightOpen]);

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
          setListOpen(false);
          stopFollow();
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
    (window as unknown as { __ag: unknown }).__ag = { sim, motion, playScene, resetAll, answerHuman, setPaused, enqueue, parseMessage };
  }, []);

  // the search's box: centred on the window, kept clear of the corner cards at the left and the card at the right
  const searchLeft = listOpen ? `calc(${PANEL_W}px + 2 * var(--frame))` : "calc(27rem + 2 * var(--frame))";
  const searchRight = rightOpen ? `calc(${RIGHT_W}px + 2 * var(--frame))` : "calc(27rem + 2 * var(--frame))";

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

        {/* the list's door, the view and the status: city-frame.tsx SidebarHead's three cards in the top left corner */}
        <div className={cn("absolute left-(--frame) top-(--frame) z-30 flex items-center gap-2 transition-transform duration-300", EASE, listOpen && "translate-x-1 translate-y-2")}>
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            aria-expanded={listOpen}
            aria-controls="city-sidebar"
            title={listOpen ? "Fermer la liste" : "Voir la liste des paiements"}
            className="relative isolate flex h-11 items-center gap-2 rounded-2xl pl-3.5 pr-4 text-[13px] font-medium text-zinc-800 transition-colors hover:text-zinc-950 dark:text-zinc-100 dark:hover:text-white"
          >
            <span aria-hidden className={cn(CARD, "transition-opacity duration-200", listOpen && "opacity-0")} />
            {listOpen ? <PanelLeftClose className="h-4 w-4 text-zinc-500 dark:text-zinc-400" /> : <PanelLeftOpen className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />}
            Paiements
            <span className="font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{kpis.total}</span>
          </button>
          <div role="group" aria-label="Vue" className={cn("relative isolate flex h-11 items-stretch gap-0.5 rounded-2xl p-1 text-[13px] font-medium transition-opacity duration-200", listOpen && "pointer-events-none opacity-0")}>
            <span aria-hidden className={CARD} />
            {sentinelConfig.explorer ? (
              <a
                href={sentinelConfig.explorer}
                target="_blank"
                rel="noopener noreferrer"
                title="La blockchain Sentinel, bloc par bloc"
                className="flex items-center gap-1 rounded-xl px-3 text-zinc-500 transition-colors hover:bg-zinc-100/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                Explorer
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              <span className={SEG_OFF}>Explorer</span>
            )}
            <span aria-current="page" className={SEG_ON}>
              Ville
            </span>
          </div>
          <div
            title={LIVE_CONFIGURED ? "Les chiffres sont lus en direct sur la blockchain Sentinel, où l'agent MCP inscrit chaque décision" : "Données de démonstration"}
            className={cn("relative isolate flex h-11 items-center gap-2 rounded-2xl px-3.5 text-[13px] font-medium text-zinc-700 transition-opacity duration-200 dark:text-zinc-200", listOpen && "pointer-events-none opacity-0")}
          >
            <span aria-hidden className={CARD} />
            <span className={cn("h-2 w-2 rounded-full", LIVE_CONFIGURED ? (kpis.connected ? "animate-pulse bg-emerald-500" : "bg-zinc-300") : "bg-amber-500")} />
            {LIVE_CONFIGURED ? (kpis.connected ? "En direct" : "Connexion…") : "Démo"}
          </div>
        </div>

        {/* the list (city-app.tsx's sidebar): the decisions by outcome, shut until asked for */}
        <aside
          id="city-sidebar"
          aria-label="Paiements"
          inert={!listOpen || undefined}
          aria-hidden={!listOpen}
          className={cn(PANE, "left-(--frame)", listOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-6 opacity-0")}
          style={{ width: PANEL_W }}
        >
          <div aria-hidden className="h-[3.75rem] shrink-0 border-b border-zinc-100 dark:border-zinc-900" />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{listOpen && <Directory query={search} />}</div>
        </aside>

        {/* the search over the city's top, the situations to play under it (city-app.tsx's search and question chips) */}
        <div className="pointer-events-none absolute top-(--frame) z-30 flex justify-center transition-[left,right] duration-300 ease-out" style={{ left: searchLeft, right: searchRight }}>
          <div className="pointer-events-auto flex w-full max-w-[34rem] flex-col items-center gap-2">
            <label data-city-chrome className={cn("relative flex h-11 w-full items-center gap-2 rounded-2xl px-3.5", GLASS)}>
              <Search className="h-4 w-4 text-zinc-400" />
              <span className="sr-only">Rechercher</span>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => {
                  sim.set({ search: e.target.value });
                  if (e.target.value) setListOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openView("transactions");
                }}
                placeholder="Rechercher un paiement, une adresse, un agent…"
                className="h-full flex-1 bg-transparent text-[13.5px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              <span className="rounded border border-zinc-200 px-1.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-800">Ctrl K</span>
            </label>
            <div role="group" aria-label="Voir un cas" data-city-chrome className="flex flex-wrap justify-center gap-1.5">
              {SCENES.map((c) => (
                <button
                  key={c.k}
                  type="button"
                  onClick={() => playScene(c.k)}
                  title={`Rejoue ce cas dans la ville (démo, touche ${c.key})`}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white/[0.92] px-2.5 text-[11.5px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/[0.88] dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: c.tone }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* the key in the bottom left corner (city-key.tsx's place), hidden under the open list, and while a payment plays:
            the card at the right tells it then, and the stage keeps the whole protocol in view */}
        <div className={cn("absolute bottom-(--frame) left-(--frame) z-30 hidden transition-opacity duration-300 xl:block", (listOpen || busyRight) && "pointer-events-none opacity-0")}>
          <SentinelKey network={SENTINEL_RING ? Math.max(0, data.nodes.length - 2) : 0} />
        </div>

        <AnalysisCard />
        {sheetNode && <ChainSheet node={sheetNode} partner={sheetPartner} simulated={data.icmSimulated} onClose={() => setSelected(null)} />}
        <Toasts />
        <ViewHost screens={{ transactions: <TransactionsView />, registry: <RegistryView />, parking: <ParkingView />, audit: <AuditView /> }} />

        {/* the figures at the city's foot (city-frame.tsx FigureStrip), and the latest decisions in the bottom right corner */}
        <FigureStrip sidebar={listOpen} legend right={rightOpen ? RIGHT_W : 0} network={network}>
          <Figures />
        </FigureStrip>
        <LatestFeed away={rightOpen} />
      </div>
    </div>
  );
}
