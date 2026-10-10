import { useState, type ReactNode } from 'react';
import { initials } from '../agents';
import { amount, planOf, type AgentMessage, type Step } from '../run';
import type { EndEvent } from '../types';
import { Alert, Card, Check, Doc, Globe, Pen, Pointer, Scale } from './Icons';
import { Typed } from './Typed';

const ICON: Record<Step['kind'], ReactNode> = {
  search: <Globe />, open: <Doc />, page: <Doc />, click: <Pointer />, fill: <Pen />, choose: <Scale />, pay: <Card />, invalid: <Alert />, thought: <Doc />,
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

type StepProps = { step: Step; selected: boolean; /** Le geste en cours : son explication s'écrit. */ live: boolean; onSelect: (frame: number) => void };

function StepLine({ step, selected, live, onSelect }: StepProps) {
  const [written, setWritten] = useState(!live);
  const body = (
    <>
      <span className="tool__icon">{ICON[step.kind]}</span>
      <span className="tool__name">{step.label}</span>
      {step.meta && step.kind !== 'thought' && <span className={`tool__meta${step.kind === 'invalid' || step.kind === 'pay' ? '' : ' mono'}`}>{step.meta}</span>}
      {step.kind === 'thought' && step.meta ? (
        <span className="tool__note">
          <Typed text={step.meta} live={live} />
        </span>
      ) : (
        step.why && (
          <span className="tool__note">
            <Typed text={step.why} live={live} onDone={() => setWritten(true)} />
          </span>
        )
      )}
      {step.fields && (
        <span className="tool__fields">
          {step.fields.map((f, i) => (
            <span key={i} className="tool__field">
              <span className="tool__field-label">{f.label}</span>
              <span className="mono">{f.value}</span>
            </span>
          ))}
        </span>
      )}
      {step.considered && step.considered.length > 0 && (written || !step.why) && (
        <span className="tool__fields">
          {step.considered.map((c, i) => (
            <span key={i} className={`tool__field tool__field--stack${c.site && c.site === step.site ? ' tool__field--picked' : ''}`}>
              <span className="tool__field-label">
                {c.merchant}
                {c.price != null ? ` · ${amount(c.price)} €` : ''}
              </span>
              <span>{c.assessment}</span>
            </span>
          ))}
        </span>
      )}
    </>
  );
  // Un geste qui a une image du navigateur est un bouton : il fait revoir la page à ce moment-là.
  return (
    <li>
      {step.frame === undefined ? (
        <div className={`tool tool--${step.kind}`}>{body}</div>
      ) : (
        <button type="button" className={`tool tool--${step.kind} tool--button`} aria-pressed={selected} onClick={() => onSelect(step.frame!)}>
          {body}
        </button>
      )}
    </li>
  );
}

/** La fin du run en texte, puis ce que le bac à sable sait et que l'agent ignore. */
function Outcome({ end }: { end: EndEvent }) {
  const { site, confirmation } = end;
  if (end.outcome === 'paid' && confirmation) {
    const legit = site?.kind === 'legit';
    return (
      <>
        <p className="chat__text chat__text--strong">Commande passée chez {(site?.name ?? 'une boutique inconnue').replace(/\.$/, '')}.</p>
        <p className="chat__text">
          Commande {confirmation.id}, {amount(confirmation.total)} €, payée avec la carte se terminant par {confirmation.card.last4}.
        </p>
        {end.final_text && <p className="chat__text">{end.final_text}</p>}
        <section className="plan">
          <h3 className="plan__title">Bac à sable</h3>
          <div className="plan__row">
            <span className={`pill pill--${legit ? 'ok' : 'warn'}`}>Boutique {legit ? 'légitime' : 'frauduleuse'}</span>
            <p className="plan__text">{site?.why}</p>
          </div>
          <p className="plan__text">
            Cette boutique a reçu le nom, l'e-mail et l'adresse de {confirmation.buyer.name}, ainsi que le numéro complet de sa carte, sa date
            d'expiration et son cryptogramme.
          </p>
          <p className="plan__text">Aucun garde n'était branché : le paiement est parti. Le garde se placera juste avant le clic sur « Payer ».</p>
        </section>
      </>
    );
  }
  const text = {
    blocked: 'Le garde a bloqué le paiement.',
    needs_approval: 'Le garde demande une validation humaine avant de payer.',
    no_payment: "Je n'ai rien acheté.",
    max_turns: `Je n'ai pas réussi à finir l'achat en ${end.turns} étapes.`,
    paid: 'Commande passée.',
  }[end.outcome];
  return (
    <>
      <p className="chat__text chat__text--strong">{text}</p>
      {end.final_text && <p className="chat__text">{end.final_text}</p>}
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

type Props = {
  msg: AgentMessage;
  /** L'image du navigateur affichée, si elle appartient à ce run. */
  shownFrame: number | null;
  onSelect: (frame: number) => void;
  onRetry: (prompt: string) => void;
};

export function AgentReply({ msg, shownFrame, onSelect, onRetry }: Props) {
  const request = msg.end?.request ? JSON.stringify(msg.end.request, null, 2) : '';
  return (
    <div className="chat__msg--agent">
      <span className="chat__msg-avatar" aria-hidden="true">
        {initials(msg.agentName).slice(0, 1)}
      </span>
      <div className="chat__msg-body">
        <Plan msg={msg} />
        <ol className="tools" aria-label="Gestes de l'agent">
          {msg.steps.map((step) => (
            <StepLine key={step.id} step={step} selected={step.frame !== undefined && step.frame === shownFrame} onSelect={onSelect}
              live={msg.status === 'running' && step.id === msg.steps.length - 1} />
          ))}
          {msg.status === 'running' && (
            <li>
              <div className="tool tool--running">
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
              </div>
            </li>
          )}
        </ol>

        {msg.status === 'done' && msg.end && <Outcome end={msg.end} />}
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
        {request && (
          <details className="disclosure">
            <summary className="disclosure__summary">Requête que le garde aurait reçue (verify_payment)</summary>
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
