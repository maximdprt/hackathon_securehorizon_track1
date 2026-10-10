"use client";

// AVAGUARD: a door in the scene (not from builders-hub). Any part of our parcel wrapped in it takes the hand cursor, shows
// the City's own tooltip plate beside it on hover (staking/bits.tsx TipPlate, City3D.tsx's TipRow look), and opens its
// screen on a click (sim/nav.ts). The plate's contents read the stores only while it shows.
import { useEffect, useState, type ReactNode } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { TipPlate } from "@/components/explorer-v2/staking/bits";
import { useAudit } from "@/data/source";
import { openView } from "@/sim/nav";
import { sim, useSim } from "@/sim/store";
import { STATE, fmtAmount, shortAddr, type TxEvent } from "@/sim/types";

type At = [number, number, number];

export function Door({ at, tip, onOpen, children, name }: { at: At; tip: ReactNode; onOpen: () => void; children: ReactNode; name: string }) {
  const [on, setOn] = useState(false);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.domElement.style.cursor = on ? "pointer" : "";
  }, [on, gl]);
  useEffect(() => () => void (gl.domElement.style.cursor = ""), [gl]);
  return (
    <group
      name={name}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setOn(true);
      }}
      onPointerOut={() => setOn(false)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        setOn(false);
        onOpen();
      }}
    >
      {children}
      {on && (
        <Html position={at} zIndexRange={[45, 0]} style={{ pointerEvents: "none" }}>
          <div className="w-max -translate-y-1/2 translate-x-6">
            <TipPlate>{tip}</TipPlate>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the plates, in the City's tooltip grammar                           */
/* ------------------------------------------------------------------ */

/** a row as City3D.tsx's TipRow draws it */
export function TipRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <p className="flex items-center justify-between gap-6 font-mono text-[11px] tabular-nums text-zinc-900 dark:text-zinc-100">
      <span className="text-zinc-500">{label}</span>
      <span style={tone ? { color: tone } : undefined}>{value}</span>
    </p>
  );
}
function Head({ children, tone }: { children: ReactNode; tone: string }) {
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-zinc-900 dark:text-zinc-100">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: tone }} />
      {children}
    </p>
  );
}
const Hint = ({ children = "Cliquer pour ouvrir" }: { children?: ReactNode }) => <p className="mt-1 font-mono text-[10px] text-zinc-400">{children}</p>;

const STEP_WORD = ["scan", "lecture du contrat", "chaîne d'autorité", "consensus", "registre", "score", "verdict", "verdict"];
const PHASE_WORD: Record<string, string> = { approach: "approche", allow: "visa, vers la C-Chain", block: "refus, vers la déchetterie", human: "au parking", home: "terminée" };

export function TollTip() {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const busy = !!tx && phase !== "idle";
  return (
    <>
      <Head tone={STATE.verify.hex}>Contrôle AvaGuard+</Head>
      <TipRow label="En cours" value={busy ? tx.tx_id : "aucune transaction"} />
      {busy && <TipRow label="Étape" value={phase === "analysis" ? (STEP_WORD[step] ?? "verdict") : PHASE_WORD[phase] ?? phase} />}
      <TipRow label="Seuils" value="visa < 40 · refus ≥ 70" />
      <Hint>{busy ? "Cliquer pour voir son analyse" : "Cliquer pour voir la dernière analyse"}</Hint>
    </>
  );
}

export function RegistryTip() {
  const { banned } = useAudit();
  const last = banned[0];
  return (
    <>
      <Head tone={STATE.block.hex}>Registre des hackers</Head>
      <TipRow label="Adresses bannies" value={String(banned.length)} />
      <TipRow label="Tentatives bloquées" value={String(banned.reduce((a, b) => a + b.hits, 0))} />
      {last && <TipRow label="Dernière entrée" value={shortAddr(last.address)} tone={STATE.block.hex} />}
      <Hint />
    </>
  );
}

export function ParkingTip() {
  const human = useSim((s) => s.human);
  const { txs } = useAudit();
  const byHand = txs.filter((t) => t.via === "humain").length;
  return (
    <>
      <Head tone={STATE.human.hex}>Validation humaine</Head>
      <TipRow label="En attente" value={human ? `1 · ${human.tx_id}` : "0"} tone={human ? STATE.human.hex : undefined} />
      <TipRow label="Places" value={human ? "P3 occupée · 5 libres" : "6 libres"} />
      <TipRow label="Décisions humaines" value={String(byHand)} />
      <Hint />
    </>
  );
}

export function ScrapTip() {
  const { txs } = useAudit();
  const blocked = txs.filter((t) => t.status === "BLOCK");
  const usd = blocked.filter((t) => t.amount.token === "USDC").reduce((a, t) => a + t.amount.value, 0);
  return (
    <>
      <Head tone={STATE.block.hex}>Déchetterie</Head>
      <TipRow label="Transactions détruites" value={String(blocked.length)} />
      <TipRow label="Montant protégé" value={`${fmtAmount(usd)} USDC`} />
      <Hint>Cliquer pour voir les transactions bloquées</Hint>
    </>
  );
}

export function ProofTip() {
  const { txs } = useAudit();
  const proved = txs.filter((t) => t.onchain && (t.status === "ALLOW" || t.status === "BLOCK"));
  return (
    <>
      <Head tone={STATE.allow.hex}>Preuves on-chain · AvaGuard L1</Head>
      <TipRow label="Décisions ancrées" value={String(proved.length)} />
      {proved[0]?.onchain && <TipRow label="Dernier bloc" value={`#${proved[0].onchain.block.toLocaleString("fr-FR")}`} />}
      <Hint>Cliquer pour voir les preuves</Hint>
    </>
  );
}

export function CarTip({ tx }: { tx: TxEvent }) {
  return (
    <>
      <Head tone={STATE.verify.hex}>
        {tx.from.agent_id} → {shortAddr(tx.to.address)}
      </Head>
      <TipRow label="Montant" value={`${fmtAmount(tx.amount.value)} ${tx.amount.token}`} />
      <TipRow label="Méthode" value={tx.contract.method} />
      <TipRow label="Transaction" value={tx.tx_id} />
      <Hint>Cliquer pour ouvrir son audit</Hint>
    </>
  );
}

/** what each door opens */
export const OPEN = {
  // the transaction at the toll, else the last one played, else the list
  toll: () => openView("transactions", { tx: sim.get().tx?.tx_id ?? sim.get().ledger[0]?.tx_id ?? null }),
  registry: () => openView("registry"),
  parking: () => openView("parking"),
  scrapyard: () => openView("transactions", { filter: "BLOCK" }),
  proof: () => openView("transactions", { filter: "proof" }),
  car: (tx: string) => openView("transactions", { tx }),
};
