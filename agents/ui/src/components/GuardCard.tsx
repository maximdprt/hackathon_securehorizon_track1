import type { Verdict } from '../types';

const VERDICT = {
  allow: { label: 'Paiement validé', tone: 'ok' },
  needs_approval: { label: 'Validation humaine requise', tone: 'warn' },
  block: { label: 'Paiement refusé', tone: 'bad' },
} as const;
const BACKEND: Record<string, string> = { mcp: 'par le serveur MCP', engine: 'moteur en direct', stub: 'garde de remplacement' };

/** Les indices du garde, dits en français. Un indice sans libellé garde son nom technique : sa preuve reste affichée. */
const LABELS: Record<string, string> = {
  amount_within_mandate: 'Montant au-dessus du plafond du mandat',
  amount_over_onchain_cap: "Montant au-dessus du plafond inscrit au registre d'autorité",
  daily_cap_exceeded: 'Plafond cumulé sur 24 h dépassé',
  amount_implausible: 'Montant absurde : un transfert illimité déguisé',
  amount_just_under_threshold: 'Montant juste sous le plafond',
  action_not_in_mandate: 'Action hors du mandat de cet agent',
  currency_mismatch: 'Devise différente de celle du mandat',
  recipient_whitelisted: 'Destinataire hors de la liste autorisée',
  order_origin: "L'ordre vient de ce que l'agent a lu, pas de l'utilisateur",
  issuer_in_registry: "Émetteur absent du registre d'autorité",
  issuer_role_mismatch: "Le rôle de l'émetteur ne lui permet pas de payer",
  issuer_flagged_onchain: 'Émetteur déjà signalé au registre des menaces',
  authority_source_unavailable: "Registre d'autorité injoignable",
  imperative_to_agent: "Instruction adressée à l'agent dans ce qu'il a lu",
  hidden_text_ratio: 'Texte caché aux lecteurs humains',
  override_lexicon: "Formules qui cherchent à réécrire les consignes de l'agent",
  mandate_override_attempt: 'Tentative de lever les limites du mandat',
  disable_logs_or_confirmation_attempt: 'Tentative de couper la confirmation humaine ou le journal',
  chat_template_delimiters: 'Balises de conversation injectées dans le contenu',
  invisible_unicode_count: 'Caractères invisibles dans le contenu',
  encoded_blob_instruction: 'Instruction dissimulée dans un bloc encodé',
  urgency_secrecy_markers: "Pression d'urgence ou de secret",
  bank_detail_change_notice: 'Annonce de changement de coordonnées de paiement',
  approval_claimed_in_data: 'Le contenu prétend que le paiement est déjà approuvé',
  agent_targeted_claims: 'Promesses adressées aux agents IA',
  second_payment_after_first: 'Second paiement réclamé après le premier',
  checkout_overcollects_pii: 'Le formulaire demande plus de données que nécessaire',
  recipient_flagged_onchain: 'Destinataire déjà signalé au registre des menaces',
  recipient_prior_incident_info: 'Destinataire déjà cité dans un incident',
  address_poisoning_similarity: "Adresse sosie d'une adresse autorisée",
  recipient_age_tx_count: 'Adresse du destinataire toute récente, sans historique',
  contract_verified: 'Contrat du destinataire non vérifié',
  domain_age_days: 'Domaine du marchand très récent',
  new_merchant_first_payment: 'Premier paiement à un marchand récent',
  brand_lookalike_score: "Nom de domaine qui imite une marque",
  free_hosting_subdomain: 'Site sur un hébergement gratuit',
  price_deviation: 'Prix très en dessous du marché',
  tld_risk: 'Extension de domaine à risque',
  legal_pages_missing: 'Pas de mentions légales',
  payment_methods_offered: 'Moyens de paiement inhabituels',
  approve_unlimited: 'Autorisation de dépense illimitée',
  amount_vs_history_zscore: "Montant inhabituel pour cet agent",
  velocity_1h: 'Rafale de paiements',
  nonce_replay: 'Paiement rejoué',
  tool_description_changed: "La description d'un outil a changé",
  tool_description_has_directives: "Un outil contient des ordres adressés à l'agent",
};
/** Les règles du mandat : elles ne retirent pas de points, elles imposent un humain. */
const RULES = new Set(['amount_within_mandate', 'amount_over_onchain_cap', 'daily_cap_exceeded']);
const points = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

export type Human = { state: 'sending' | 'done' | 'error'; decision: 'allow' | 'block'; error?: string };

/** embedded : dans la notification SentinelL1, qui porte déjà le verdict ; la carte n'en montre que le score et son détail. */
type Props = { verdict: Verdict; human?: Human; onDecide?: (decision: 'allow' | 'block') => void; embedded?: boolean };

/** Le verdict du garde : le score de confiance sur 100, où il se place par rapport aux seuils, et chaque retrait avec sa preuve. */
export function GuardCard({ verdict, human, onDecide, embedded = false }: Props) {
  const v = VERDICT[verdict.verdict];
  const trust = verdict.trust_score;
  const th = verdict.thresholds;
  const waiting = verdict.verdict === 'needs_approval' && human?.state !== 'done';
  return (
    <section className={`guard guard--${v.tone}${embedded ? ' guard--embedded' : ''}`} aria-label="Verdict du garde">
      <header className="guard__head">
        {!embedded && <span className="guard__tag">Garde</span>}
        {!embedded && <span className={`pill pill--${v.tone}`}>{v.label}</span>}
        <span className="guard__via">
          {BACKEND[verdict.backend ?? ''] ?? verdict.backend}
          {verdict.latency_ms != null ? ` · ${Math.round(verdict.latency_ms)} ms` : ''}
        </span>
      </header>

      {trust != null && (
        <>
          <p className="guard__score">
            <span className="guard__value">{trust}</span>
            <span className="guard__unit">/ 100 de confiance</span>
          </p>
          <div className="guard__bar" role="img" aria-label={`Confiance ${trust} sur 100`}>
            <span className="guard__fill" style={{ width: `${trust}%` }} />
            {th && <span className="guard__tick" style={{ left: `${th.block_below}%` }} />}
            {th && <span className="guard__tick" style={{ left: `${th.allow_at_or_above}%` }} />}
          </div>
          {th && (
            <p className="guard__scale">
              Refusé à {th.block_below} ou moins · validé au-dessus de {th.allow_at_or_above} · entre les deux, un humain décide
            </p>
          )}
        </>
      )}

      {verdict.deductions.length > 0 ? (
        <ol className="guard__lines" aria-label="Détail du score">
          <li className="guard__line">
            <span className="guard__label">Départ</span>
            <span className="guard__cost">100</span>
          </li>
          {verdict.deductions.map((d) => (
            <li key={d.id} className={`guard__line${d.hard ? ' guard__line--hard' : ''}`}>
              <span className="guard__label">
                {LABELS[d.id] ?? d.id.replace(/_/g, ' ')}
                {d.evidence && <span className="guard__evidence">{d.evidence}</span>}
              </span>
              <span className="guard__cost">{d.hard ? 'refus direct' : RULES.has(d.id) ? 'règle' : `−${points(d.cost)}`}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="plan__text">Aucun indice relevé sur cette transaction.</p>
      )}
      {verdict.owasp.length > 0 && <p className="guard__scale">OWASP {verdict.owasp.join(' · ')}</p>}

      {waiting && onDecide && (
        <div className="guard__actions">
          <button type="button" className="button button--primary" disabled={human?.state === 'sending'} onClick={() => onDecide('allow')}>
            Approuver
          </button>
          <button type="button" className="button" disabled={human?.state === 'sending'} onClick={() => onDecide('block')}>
            Refuser
          </button>
        </div>
      )}
      {human?.state === 'error' && <p className="guard__human guard__human--error">La décision n'a pas pu être enregistrée : {human.error}</p>}
      {human?.state === 'done' && (
        <p className="guard__human">
          {human.decision === 'allow'
            ? "Approuvé par un humain. La décision est inscrite au journal d'audit et sur SentinelL1 (visa) ; la sandbox ne rejoue pas le paiement."
            : 'Refusé par un humain. Le destinataire est signalé sur SentinelL1 et au registre des menaces : la prochaine fois, refus direct.'}
        </p>
      )}
    </section>
  );
}
