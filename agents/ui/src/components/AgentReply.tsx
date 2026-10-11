import { useEffect, useState, type ReactNode } from 'react';
import { initials } from '../agents';
import { amount, planOf, short, type AgentMessage, type Step } from '../run';
import type { EndEvent } from '../types';
import { Alert, Card, Check, Doc, Globe, Pen, Pointer, Scale } from './Icons';
import { GuardCard } from './GuardCard';
import { Typed } from './Typed';
import { ms } from '../timing';

const ICON: Record<Step['kind'], ReactNode> = {
  search: <Globe />, research: <Doc />, guard: <Check />, open: <Doc />, page: <Doc />, click: <Pointer />, fill: <Pen />, choose: <Scale />, pay: <Card />, submit: <Globe />, invalid: <Alert />, thought: <Doc />,
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
      {step.results && step.results.length > 0 && (written || !step.why) && (
        <span className="tool__fields">
          {step.results.map((r, i) => (
            <span key={i} className="tool__field tool__field--stack">
              <span className="tool__field-label">{r.name}</span>
              <span>{r.snippet}</span>
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

type OutcomeProps = { end: EndEvent; human?: AgentMessage['human']; onDecide: (decision: 'allow' | 'decline' | 'block') => void };

/** Ce que le bac à sable sait du destinataire et que ni l'agent ni le garde ne savent : pour juger si le verdict est juste. */
function Truth({ end }: { end: EndEvent }) {
  const subject = end.site ? { kind: end.site.kind, why: end.site.why, noun: 'Boutique', fem: true } : end.asset ? { kind: end.asset.kind, why: end.asset.why, noun: 'Placement', fem: false } : null;
  if (!subject) return null;
  const legit = subject.kind === 'legit';
  return (
    <section className="plan">
      <h3 className="plan__title">Bac à sable</h3>
      <div className="plan__row">
        <span className={`pill pill--${legit ? 'ok' : 'warn'}`}>
          {subject.noun} {legit ? 'légitime' : subject.fem ? 'frauduleuse' : 'frauduleux'}
        </span>
        <p className="plan__text">{subject.why}</p>
      </div>
    </section>
  );
}

/** La fin du run en texte, puis ce que le bac à sable sait et que l'agent ignore. */
function Outcome({ end, human, onDecide }: OutcomeProps) {
  const { site, confirmation } = end;
  const guard = <Sentinel end={end} human={human} onDecide={onDecide} />;
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
          {!end.verdict && <p className="plan__text">Aucun garde n'était branché : le paiement est parti sans vérification.</p>}
        </section>
        {guard}
      </>
    );
  }
  if (end.outcome === 'ready' && end.order) {
    const { order, asset } = end;
    return (
      <>
        <p className="chat__text chat__text--strong">Ordre prêt{asset ? ` pour ${asset.name}` : ''}.</p>
        <p className="chat__text">
          « {order.action} » de {amount(order.amount)} {order.currency} vers <span className="mono">{short(order.recipient)}</span>.
        </p>
        <section className="plan">
          <h3 className="plan__title">Bac à sable</h3>
          {asset && (
            <div className="plan__row">
              <span className={`pill pill--${asset.kind === 'legit' ? 'ok' : 'warn'}`}>Placement {asset.kind === 'legit' ? 'légitime' : 'frauduleux'}</span>
              <p className="plan__text">{asset.why}</p>
            </div>
          )}
          <p className="plan__text">Aucun garde n'était branché : l'ordre est préparé mais n'a pas été envoyé.</p>
        </section>
      </>
    );
  }
  // l'agent ne connaît pas le garde : pour un blocage / une attente, il constate seulement que le paiement n'est pas passé
  const text = {
    ready: 'Ordre prêt.',
    done: 'Investissement effectué.',
    blocked: "J'ai lancé le paiement, mais il n'est pas passé.",
    needs_approval: "J'ai lancé le paiement ; il est en attente d'une validation.",
    no_payment: "Je n'ai rien acheté.",
    max_turns: `Je n'ai pas réussi à finir l'achat en ${end.turns} étapes.`,
    paid: 'Commande passée.',
  }[end.outcome];
  return (
    <>
      <p className="chat__text chat__text--strong">{text}</p>
      {end.final_text && <p className="chat__text">{end.final_text}</p>}
      {end.verdict && <Truth end={end} />}
      {guard}
    </>
  );
}

/** Le verdict de SentinelL1 : un acteur à part, que l'agent ne connaît pas. Révélé APRÈS la voiture, comme une notification. */
function Sentinel({ end, human, onDecide }: OutcomeProps) {
  const reveal = ms(900); // le temps que la voiture arrive au péage ; 0 quand les animations sont coupées (tests)
  const [shown, setShown] = useState(reveal === 0);
  useEffect(() => {
    if (reveal === 0) return;
    const t = setTimeout(() => setShown(true), reveal);
    return () => clearTimeout(t);
  }, [reveal]);
  if (!end.verdict) return null;
  if (!shown) return <p className="chat__text chat__text--muted">SentinelL1 vérifie la transaction…</p>;
  return <GuardCard verdict={end.verdict} onchain={end.onchain} human={human} onDecide={onDecide} />;
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
  /** Un humain tranche le paiement que le garde a mis en attente. */
  onDecide: (decision: 'allow' | 'decline' | 'block') => void;
};

export function AgentReply({ msg, shownFrame, onSelect, onRetry, onDecide }: Props) {
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

        {msg.status === 'done' && msg.end && <Outcome end={msg.end} human={msg.human} onDecide={onDecide} />}
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
            <summary className="disclosure__summary">{msg.end?.verdict ? 'Requête envoyée au garde (verify_payment)' : 'Requête que le garde aurait reçue (verify_payment)'}</summary>
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
