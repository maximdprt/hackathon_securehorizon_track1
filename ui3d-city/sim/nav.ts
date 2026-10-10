import { sim, type View, type ViewFilter } from "./store";

/* The doors: every building of the parcel (and the C-Chain, the HQ) opens a screen over the city. The URL follows
   (?view=transactions&tx=tx_0042&filter=BLOCK), so the browser's Back closes it and a link opens it again. */

const VIEWS: View[] = ["transactions", "registry", "parking", "audit"];
const FILTERS: ViewFilter[] = ["all", "ALLOW", "BLOCK", "HUMAN", "PENDING", "proof"];

function urlOf(view: View, tx: string | null, filter: ViewFilter) {
  const q = new URLSearchParams(window.location.search);
  for (const k of ["view", "tx", "filter"]) q.delete(k);
  if (view) q.set("view", view);
  if (view && tx) q.set("tx", tx);
  if (view && filter !== "all") q.set("filter", filter);
  const s = q.toString();
  return `${window.location.pathname}${s ? `?${s}` : ""}`;
}

export function openView(view: Exclude<View, null>, opts: { tx?: string | null; filter?: ViewFilter } = {}) {
  const s = sim.get();
  const tx = opts.tx ?? null;
  const filter = opts.filter ?? "all";
  const fresh = s.view === null;
  sim.set({ view, viewTx: tx, viewFilter: filter, panel: null });
  // the first screen pushes an entry, so Back returns to the city; moving between screens replaces it
  if (fresh) window.history.pushState({ agView: true }, "", urlOf(view, tx, filter));
  else window.history.replaceState({ agView: true }, "", urlOf(view, tx, filter));
}

/** a row picked inside a screen: the URL keeps it */
export function setViewTx(tx: string | null) {
  const s = sim.get();
  sim.set({ viewTx: tx });
  window.history.replaceState(window.history.state, "", urlOf(s.view, tx, s.viewFilter));
}
export function setViewFilter(filter: ViewFilter) {
  const s = sim.get();
  sim.set({ viewFilter: filter });
  window.history.replaceState(window.history.state, "", urlOf(s.view, s.viewTx, filter));
}

export function closeView() {
  if (!sim.get().view) return;
  if (window.history.state?.agView) window.history.back();
  else {
    sim.set({ view: null, viewTx: null, viewFilter: "all" });
    window.history.replaceState(null, "", urlOf(null, null, "all"));
  }
}

/** read the URL into the state: on load (a shared link) and on Back / Forward */
export function syncFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("view") as View;
  const f = q.get("filter") as ViewFilter;
  sim.set({ view: VIEWS.includes(v) ? v : null, viewTx: q.get("tx"), viewFilter: FILTERS.includes(f) ? f : "all" });
}
export function listenUrl() {
  syncFromUrl();
  window.addEventListener("popstate", syncFromUrl);
  return () => window.removeEventListener("popstate", syncFromUrl);
}
