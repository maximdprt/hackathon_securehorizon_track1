import type { GuardVerdict } from "../types";
import { fmtBlock } from "./GuardCard";

const fr = new Intl.NumberFormat("fr-FR");

/** the label at the bottom left once the bale lies in the skip */
export function HackerTag({ v }: { v: GuardVerdict }) {
  return (
    <div className="gy-frame gy-tag" data-gy="tag">
      <div className="gy-lbl" style={{ color: "var(--gy-red)" }}>
        Registre des hackers
      </div>
      <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4 }}>
        <span className="gy-mono" style={{ color: "var(--gy-red)" }}>
          {v.beneficiary}
        </span>{" "}
        compactée et enregistrée
      </div>
      <div className="gy-mono" style={{ color: "var(--gy-mute)", fontSize: 12, marginTop: 4 }}>
        {fr.format(v.amount.value).replace(/[\u202f\u00a0]/g, " ")} {v.amount.asset} protégés{v.proofBlock !== undefined ? ` · bloc #${fmtBlock(v.proofBlock)}` : ""}
      </div>
    </div>
  );
}
