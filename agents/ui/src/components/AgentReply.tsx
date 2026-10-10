import { useState } from 'react';
import { initials } from '../agents';
import { amount, planOf, type AgentMessage, type Step } from '../run';
import type { EndEvent } from '../types';
import { Card, Check, Doc, Globe } from './Icons';

const STATE: Record<Step['kind'], { label: string; muted?: boolean } | null> = {
  search: { label: 'Terminé' },
  shop: { label: 'Terminé' },
  missing: { label: 'Introuvable', muted: true },
  invalid: { label: "Renvoyé à l'agent", muted: true },
  order: { label: 'Prêt, non envoyé', muted: true },
  thought: null,
};

function Plan({ msg }: { msg: AgentMessage }) {
  return (
    <section className="plan">
      <h3 className="plan__title">Plan</h3>
      <ul className="plan__list">
        {planOf(msg).map((step) => (
          <li key={step.label} className={`plan__step plan__step--${step.state}`}>
            <span className="plan__icon">{step.state === 'done' && <Check />}</span>
            {step.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ToolLine({ step }: { step: Step }) {
  const state = STATE[step.kind];
  return (
    <li className="tool">
      <span className="tool__icon">{step.kind === 'search' ? <Globe /> : step.kind === 'order' ? <Card /> : <Doc />}</span>
      <span className="tool__name">{step.name}</span>
      <span className={`tool__meta${step.kind === 'order' || step.kind === 'shop' ? ' mono' : ''}`}>{step.meta}</span>
      {state && <span className={`tool__state${state.muted ? ' tool__state--muted' : ''}`}>{state.label}</span>}
      {step.why && <p className="tool__note">{step.why}</p>}
      {step.found && <p className="tool__note tool__note--found">Relevé : {step.found}</p>}
    </li>
  );
}

function Tools({ msg }: { msg: AgentMessage }) {
  return (
    <ul className="tools" aria-label="Actions de l'agent">
      {msg.steps.map((step) => (
        <ToolLine key={step.id} step={step} />
      ))}
      {msg.status === 'running' && (
        <li className="tool tool--running">
          <span className="tool__icon">
            <Doc />
          </span>
          <span className="tool__name">Réflexion</span>
          <span className="tool__meta">en cours</span>
          <span className="tool__dots" aria-hidden="true">
            <span className="tool__dot" />
            <span className="tool__dot" />
            <span className="tool__dot" />
          </span>
        </li>
      )}
    </ul>
  );
}

/** La décision de l'agent en texte, puis ce que le bac à sable sait et que l'agent ignore. */
function Decision({ end }: { end: EndEvent }) {
  if (end.outcome !== 'ready' || !end.order) {
    return (
      <>
        <p className="chat__text chat__text--strong">{end.outcome === 'no_payment' ? "Je n'ai rien acheté." : `Je n'ai pas réussi à décider en ${end.turns} étapes.`}</p>
        {end.final_text && <p className="chat__text">{end.final_text}</p>}
      </>
    );
  }
  const { order, site } = end;
  const name = (site?.name ?? (end.chosen || 'une boutique inconnue')).replace(/\.$/, '');
  const legit = site?.kind === 'legit';
  return (
    <>
      <p className="chat__text chat__text--strong">Je choisis {name}.</p>
      <p className="chat__text">
        {end.item || 'Article'} à {amount(order.amount)} {order.currency}
        {site ? `, sur ${site.domain}` : ''}.
      </p>
      {end.why && <p className="chat__text">{end.why}</p>}
      <section className="plan">
        <h3 className="plan__title">Bac à sable</h3>
        <div className="plan__row">
          <span className={`pill pill--${legit ? 'ok' : 'warn'}`}>{site ? `Boutique ${legit ? 'légitime' : 'frauduleuse'}` : 'Adresse inconnue'}</span>
          <p className="plan__text">{site ? site.why : "L'adresse payée n'apparaît sur aucune page lue : l'agent l'a inventée ou mal recopiée."}</p>
        </div>
        <p className="plan__text">Arrêté juste avant le paiement. Le garde n'est pas branché : l'ordre est prêt, il n'est pas envoyé.</p>
      </section>
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
    <button type="button" className="button" onClick={copy}>
      {copied ? 'Copié' : 'Copier la requête'}
    </button>
  );
}

export function AgentReply({ msg, onRetry }: { msg: AgentMessage; onRetry: (prompt: string) => void }) {
  const request = msg.end?.request ? JSON.stringify(msg.end.request, null, 2) : '';
  return (
    <div className="chat__msg--agent">
      <span className="chat__msg-avatar" aria-hidden="true">
        {initials(msg.agentName).slice(0, 1)}
      </span>
      <div className="chat__msg-body">
        {msg.status === 'running' && (
          <>
            <p className="chat__text">{msg.live}</p>
            <Plan msg={msg} />
            <Tools msg={msg} />
          </>
        )}
        {msg.status === 'done' && msg.end && <Decision end={msg.end} />}
        {msg.status === 'stopped' && <p className="chat__text chat__text--strong">Run interrompu.</p>}
        {msg.status === 'error' && (
          <>
            <p className="chat__text chat__text--strong">Le run a échoué.</p>
            <p className="chat__text">{msg.error}</p>
            <p className="chat__text chat__text--muted">
              Si c'est une erreur d'identifiants, rafraîchis les clés AWS du fichier .env puis relance agents/app.py.
            </p>
          </>
        )}
        {(msg.status === 'error' || msg.status === 'stopped') && (
          <div>
            <button type="button" className="button" onClick={() => onRetry(msg.prompt)}>
              Relancer cette demande
            </button>
          </div>
        )}

        {msg.status !== 'running' && msg.steps.length > 0 && (
          <details className="disclosure">
            <summary className="disclosure__summary">Détail du run ({msg.steps.length} actions)</summary>
            <div className="disclosure__body">
              <Plan msg={msg} />
              <Tools msg={msg} />
            </div>
          </details>
        )}
        {request && (
          <details className="disclosure">
            <summary className="disclosure__summary">Requête prête pour le garde (verify_payment)</summary>
            <div className="disclosure__body">
              <div>
                <CopyButton text={request} />
              </div>
              <pre className="code">{request}</pre>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
