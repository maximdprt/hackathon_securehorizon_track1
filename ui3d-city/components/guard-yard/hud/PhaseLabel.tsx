/** the cartouche at the top left: the transaction and the sequence's phase, read out politely */
export function PhaseLabel({ txId }: { txId: string }) {
  return (
    <div className="gy-frame gy-phase">
      <div className="gy-lbl">Sentinel · {txId}</div>
      <div className="t" data-gy="phase" aria-live="polite">
        Prêt
      </div>
    </div>
  );
}
