import type { GuardVerdict } from "../types";

const fr = new Intl.NumberFormat("fr-FR");
export const fmtBlock = (n: number) => fr.format(n).replace(/[\u202f\u00a0]/g, " ");
export const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/** the card at the top right: the X-ray, the score, the five checks lit one by one, then the details (frame.ts drives it) */
export function GuardCard({ v }: { v: GuardVerdict }) {
  return (
    <div className="gy-frame gy-card" data-gy="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="gy-lbl">Radiographie</span>
        <span className="gy-badge" data-gy="badge">
          SCAN…
        </span>
      </div>
      <canvas className="gy-xray" data-gy="xray" width={600} height={200} />
      <div className="gy-score">
        <b data-gy="score">--</b>
        <span className="gy-lbl">risque / 100</span>
      </div>
      {v.criteria.map((c) => (
        <div className="gy-row" data-gy="row" data-v={c.value} key={c.label}>
          <span className="n">{c.label}</span>
          <span className="b">
            <i />
          </span>
          <span className="v">{c.value}</span>
        </div>
      ))}
      <div className="gy-details" data-gy="details">
        <div className="gy-lbl" style={{ marginTop: 8 }}>
          Pourquoi
        </div>
        <ul>
          {v.reasons.slice(0, 3).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="gy-mono gy-kv">
          <span>Décision</span>
          <b style={{ color: "var(--gy-red)" }}>refus en {fmtSecs(v.latencyMs)}</b>
        </div>
        <div className="gy-mono gy-kv">
          <span>Seuils</span>
          <b>
            &lt; {v.thresholds.allow} visa · {v.thresholds.allow}-{v.thresholds.block - 1} humain · ≥ {v.thresholds.block} refus
          </b>
        </div>
        {v.proofBlock !== undefined && (
          <div className="gy-mono gy-kv">
            <span>Preuve on-chain</span>
            <b style={{ color: "var(--gy-green)" }}>bloc #{fmtBlock(v.proofBlock)}</b>
          </div>
        )}
        {v.incidentId && (
          <div className="gy-mono gy-kv">
            <span>Incident DORA</span>
            <b>{v.incidentId}</b>
          </div>
        )}
      </div>
    </div>
  );
}
