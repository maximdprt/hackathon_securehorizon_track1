import { useState } from 'react';
import { initials } from '../agents';
import { amount, VERDICT_LABEL, type AgentMessage } from '../run';
import type { EndEvent, Onchain, Verdict } from '../types';

const ICON = {
  good: (
    <>
      <circle cx="8" cy="8" r="7.5" fill="currentColor" />
      <path d="M4.4 8.3l2.4 2.4 4.8-5.2" fill="none" stroke="var(--panel)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  crit: (
    <>
      <path d="M5 .5h6L15.5 5v6L11 15.5H5L.5 11V5z" fill="currentColor" />
      <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" stroke="var(--panel)" strokeWidth="1.9" strokeLinecap="round" />
    </>
  ),
  warn: (
    <>
      <path d="M8 .8l7.4 13.4H.6z" fill="currentColor" strokeLinejoin="round" />
      <path d="M8 5.6v4M8 12v.2" stroke="var(--panel)" strokeWidth="1.9" strokeLinecap="round" />
    </>
  ),
};
type Status = keyof typeof ICON;
const VERDICT_STATUS: Record<Verdict['verdict'], Status> = { allow: 'good', needs_approval: 'warn', block: 'crit' };
const VERDICT_EFFECT: Record<Verdict['verdict'], string> = {
  allow: 'Visa à usage unique délivré on-chain : ce paiement peut passer, et lui seul.',
  needs_approval: 'SentinelL1 ne tranche pas seul : la transaction est garée, un humain décide.',
  block: "Arrêtée à l'entrée de la chaîne, l'argent reste dans le wallet. Destinataire flagué : la prochaine fois, refus direct.",
};
const TX_LABEL = { visa: 'Visa', flag: 'Flag', decision: 'Décision' } as const;

function StatusIcon({ status, label }: { status: Status; label: string }) {
  return (
    <svg className={`ico ${status}`} viewBox="0 0 16 16" role="img" aria-label={label}>
      {ICON[status]}
    </svg>
  );
}

/** Ce que l'analyse de SentinelL1 a décidé de la transaction, et pourquoi. */
function GuardVerdict({ verdict }: { verdict: Verdict }) {
  const label = VERDICT_LABEL[verdict.verdict];
  return (
    <div className="truth">
      <StatusIcon status={VERDICT_STATUS[verdict.verdict]} label={`SentinelL1 : ${label}`} />
      <span>
        <b className={`verdict ${VERDICT_STATUS[verdict.verdict]}`}>{label[0].toUpperCase() + label.slice(1)}.</b>{' '}
        {verdict.trust_score != null && <>Confiance {verdict.trust_score}/100. </>}
        {VERDICT_EFFECT[verdict.verdict]}
        {verdict.reasons.length > 0 && (
          <ul className="reasons">
            {verdict.reasons.slice(0, 4).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {verdict.owasp.length > 0 && <span className="k">OWASP {verdict.owasp.join(' · ')}</span>}
      </span>
    </div>
  );
}

/** La preuve on-chain : les transactions écrites sur SentinelL1, ouvrables dans l'explorateur. */
function ChainProof({ onchain }: { onchain: Onchain | null | undefined }) {
  if (!onchain) return <>Chaîne non branchée : décision locale seulement.</>;
  if (!onchain.ok)
    return (
      <>
        <b>Non inscrit.</b> {onchain.error}. Sans visa, le paiement ne passe pas le GuardedVault.
      </>
    );
  return (
    <>
      <span className="txs">
        {onchain.txs.map((tx) => (
          <a key={tx.hash} href={tx.url} target="_blank" rel="noreferrer" className="mono">
            {TX_LABEL[tx.kind]} {tx.hash.slice(0, 10)}…
          </a>
        ))}
      </span>
      <a href={onchain.city} target="_blank" rel="noreferrer">
        Voir la voiture dans la ville 3D
      </a>
    </>
  );
}

/** La vérification de SentinelL1 : un acteur à part, que l'agent ne connaît pas. Elle a lieu quand la
 *  transaction arrive à l'entrée de la chaîne. */
function SentinelCheck({ end }: { end: EndEvent }) {
  if (!end.verdict) return null;
  return (
    <section className="sentinel" aria-label="Vérification SentinelL1">
      <p className="k">SentinelL1 · vérification de la transaction</p>
      <p className="sub">Analysée à l'entrée de la chaîne par l'outil MCP verify_payment.</p>
      <dl className="facts">
        <dt>Décision</dt>
        <dd>
          <GuardVerdict verdict={end.verdict} />
        </dd>
        <dt>On-chain</dt>
        <dd>
          <ChainProof onchain={end.onchain} />
        </dd>
      </dl>
    </section>
  );
}

/** La décision de l'agent, puis ce que le bac à sable sait et que l'agent ignore. */
function Decision({ end }: { end: EndEvent }) {
  if ((end.outcome !== 'ready' && end.outcome !== 'submitted') || !end.order) {
    return (
      <>
        <p className="lead">{end.outcome === 'no_payment' ? "Je n'ai rien acheté." : `Je n'ai pas réussi à décider en ${end.turns} étapes.`}</p>
        {end.final_text && <p className="pre">{end.final_text}</p>}
      </>
    );
  }
  const { order, site } = end;
  const name = (site?.name ?? (end.chosen || 'une boutique inconnue')).replace(/\.$/, '');
  const legit = site?.kind === 'legit';
  return (
    <>
      <p className="lead">Je choisis {name}.</p>
      <p>
        {end.item || 'Article'} à {amount(order.amount)} {order.currency}
        {site ? `, sur ${site.domain}` : ''}.
      </p>
      {end.why && <p>{end.why}</p>}
      <dl className="facts">
        <dt>Transaction</dt>
        <dd>
          {end.outcome === 'submitted' ? (
            <>
              Envoyée à SentinelL1 : {amount(order.amount)} {order.currency} vers <span className="mono">{order.recipient}</span>.
            </>
          ) : (
            <>Arrêté juste avant le paiement. SentinelL1 n'est pas branché : la transaction est prête, elle n'est pas envoyée.</>
          )}
        </dd>
        <dt>Bac à sable</dt>
        <dd className="truth">
          <StatusIcon status={legit ? 'good' : 'crit'} label={legit ? 'Boutique légitime' : 'Boutique frauduleuse'} />
          <span>
            {site ? (
              <>
                <b>Boutique {legit ? 'légitime' : 'frauduleuse'}.</b> {site.why}
              </>
            ) : (
              <>
                <b>Adresse inconnue.</b> L'adresse payée n'apparaît sur aucune page lue : l'agent l'a inventée ou mal recopiée.
              </>
            )}
          </span>
        </dd>
      </dl>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // presse-papiers refusé : le texte reste sélectionnable dans le bloc
    }
  }
  return (
    <button type="button" className="link" onClick={copy}>
      {copied ? 'Copié' : 'Copier'}
    </button>
  );
}

export function AgentBubble({ msg, onRetry }: { msg: AgentMessage; onRetry: (prompt: string) => void }) {
  const studied = [...new Set(msg.steps.filter((s) => s.kind === 'shop').map((s) => s.title.replace(/^Étudie /, '')))];
  const request = msg.end?.request ? JSON.stringify(msg.end.request, null, 2) : '';
  return (
    <div className="msg">
      <span className="avatar" aria-hidden="true">
        {initials(msg.agentName)}
      </span>
      <div className="bubble">
        <div className="from">
          <b>{msg.agentName}</b>
          <span className="k">{msg.model}</span>
        </div>

        {msg.status === 'running' && (
          <>
            <p className="working">{msg.live}</p>
            {studied.length > 0 && (
              <ul className="pills" aria-label="Boutiques étudiées">
                {studied.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {msg.status === 'done' && msg.end && (
          <>
            <Decision end={msg.end} />
            <SentinelCheck end={msg.end} />
          </>
        )}
        {msg.status === 'stopped' && <p className="lead">Run interrompu.</p>}
        {msg.status === 'error' && (
          <>
            <p className="lead">Le run a échoué.</p>
            <p className="pre">{msg.error}</p>
            <p className="sub">Si c'est une erreur d'identifiants, rafraîchis les clés AWS du fichier .env puis relance agents/app.py.</p>
          </>
        )}
        {(msg.status === 'error' || msg.status === 'stopped') && (
          <button type="button" className="btn ghost small" onClick={() => onRetry(msg.prompt)}>
            Relancer cette demande
          </button>
        )}

        {msg.status !== 'running' && msg.steps.length > 0 && (
          <details>
            <summary>Étapes de l'agent ({msg.steps.length})</summary>
            <ol>
              {msg.steps.map((step) => (
                <li key={step.id}>
                  <b>{step.title}.</b> {step.detail && <span className="mono">{step.detail}</span>}
                  {step.why && <span className="why">{step.why}</span>}
                  {step.found && <span className="found">Relevé : {step.found}</span>}
                </li>
              ))}
            </ol>
          </details>
        )}
        {request && (
          <details>
            <summary>{msg.end?.verdict ? 'Transaction analysée par SentinelL1 (verify_payment)' : 'Transaction prête pour SentinelL1 (verify_payment)'}</summary>
            <CopyButton text={request} />
            <pre>{request}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
