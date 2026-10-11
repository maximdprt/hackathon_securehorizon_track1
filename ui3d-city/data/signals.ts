import type { CheckKey } from "@/sim/types";

/* The team's MCP agent (the guard engine, guard/ on the Bruno branch) explains every decision with signals: an id, its
   layer, a weight and the evidence. It writes them on SentinelL1 too: the DecisionRecorded reason is
   "id: evidence; id: evidence; …" (agents/sentinel_chain.py short_reason, cut at 200 characters). We read them back
   from either place and sort them into the five checks the screens show. Read-only, pure. */

export type GuardLayer = "authority" | "mandate" | "counterparty" | "content" | "tools" | "transaction" | "claude" | "engine";
export type GuardSignal = { id: string; layer: GuardLayer; check: CheckKey | null; text: string; weight?: number; hard?: boolean };

/** the guard's layers onto the five checks (Autorité, Bénéficiaire, Mandat, Intention IA, Contrat) */
export const LAYER_CHECK: Record<GuardLayer, CheckKey | null> = {
  authority: "authority",
  counterparty: "beneficiary",
  mandate: "mandate",
  content: "intent_ai",
  claude: "intent_ai",
  tools: "contract",
  transaction: "contract",
  engine: null,
};

const ids = (layer: GuardLayer, list: string) => list.split(" ").map((id) => [id, layer] as const);
/** every signal id the guard emits (guard/features/*.py), with its layer */
const SIGNAL_LAYER = new Map<string, GuardLayer>([
  ...ids("authority", "amount_over_onchain_cap authority_source_unavailable inter_agent_message_signed issuer_flagged_onchain issuer_role_mismatch issuer_signature_invalid sender_identity_mismatch"),
  ...ids("mandate", "action_not_in_mandate amount_just_under_threshold amount_within_mandate currency_mismatch issuer_in_registry order_origin recipient_whitelisted"),
  ...ids(
    "counterparty",
    "address_poisoning_similarity brand_lookalike_score checkout_cross_domain contract_verified domain_age_days free_hosting_subdomain legal_pages_missing new_merchant_first_payment payment_methods_offered price_deviation recipient_age_tx_count recipient_flagged_onchain recipient_prior_incident_info redirect_chain_cross_domain review_profile safe_browsing_flag source_is_ad tld_risk tls_missing token_honeypot_or_unverified",
  ),
  ...ids(
    "content",
    "agent_targeted_claims approval_claimed_in_data bank_detail_change_notice canary_in_outbound chat_template_delimiters checkout_overcollects_pii disable_logs_or_confirmation_attempt encoded_blob_instruction hidden_text_ratio homoglyph_script_mix imperative_to_agent invisible_unicode_count invisible_unicode_trace mandate_override_attempt order_from_memory_not_current_turn override_lexicon payment_details_mention second_payment_after_first urgency_secrecy_markers",
  ),
  ...ids("tools", "plan_action_deviation tool_description_changed tool_description_has_directives tool_not_pinned unexpected_tool_call"),
  ...ids(
    "transaction",
    "amount_matches_402_quote amount_vs_balance_ratio amount_vs_history_zscore approve_unlimited bank_detail_change_recent calldata_undecodable confirmations_required_met facilitator_endorsed geo_mismatch nonce_replay permit_signature server_metadata_sybil_score signature_contains_arbitrary_call velocity_1h",
  ),
]);

/** what a signal means, for a jury that does not read rule ids */
const SIGNAL_FR: Record<string, string> = {
  imperative_to_agent: "Ordre caché adressé à l'agent",
  override_lexicon: "Tentative de contourner les règles",
  mandate_override_attempt: "Tentative de dépasser le mandat",
  disable_logs_or_confirmation_attempt: "Demande de sauter la confirmation",
  approval_claimed_in_data: "Fausse approbation dans le document",
  agent_targeted_claims: "Texte écrit pour piéger un agent",
  urgency_secrecy_markers: "Urgence ou secret exigés",
  bank_detail_change_notice: "Changement de RIB annoncé",
  hidden_text_ratio: "Texte caché dans la page",
  invisible_unicode_count: "Caractères invisibles",
  encoded_blob_instruction: "Instruction encodée",
  chat_template_delimiters: "Balises de prompt injectées",
  homoglyph_script_mix: "Lettres sosies (homoglyphes)",
  canary_in_outbound: "Donnée secrète sur le point de fuiter",
  checkout_overcollects_pii: "Paiement qui aspire des données perso",
  second_payment_after_first: "Second paiement réclamé",
  order_from_memory_not_current_turn: "Ordre venu de la mémoire, pas de l'humain",
  amount_within_mandate: "Montant au-delà du mandat",
  action_not_in_mandate: "Action hors mandat",
  amount_just_under_threshold: "Montant juste sous le seuil",
  currency_mismatch: "Devise inattendue",
  issuer_in_registry: "Émetteur déjà signalé",
  recipient_whitelisted: "Bénéficiaire de confiance",
  issuer_flagged_onchain: "Émetteur signalé on-chain",
  issuer_role_mismatch: "Émetteur sans droit de payer",
  issuer_signature_invalid: "Signature de l'émetteur invalide",
  inter_agent_message_signed: "Message inter-agents non signé",
  authority_source_unavailable: "Registre d'autorité injoignable",
  amount_over_onchain_cap: "Au-delà du plafond on-chain",
  sender_identity_mismatch: "Identité de l'expéditeur incohérente",
  recipient_flagged_onchain: "Bénéficiaire déjà banni on-chain",
  recipient_prior_incident_info: "Bénéficiaire déjà vu dans un incident",
  domain_age_days: "Site tout juste créé",
  new_merchant_first_payment: "Premier paiement à ce marchand",
  brand_lookalike_score: "Site sosie d'une marque",
  address_poisoning_similarity: "Adresse sosie (address poisoning)",
  checkout_cross_domain: "Paiement sur un autre domaine",
  redirect_chain_cross_domain: "Redirections suspectes",
  free_hosting_subdomain: "Hébergement gratuit",
  price_deviation: "Prix anormal",
  safe_browsing_flag: "Site listé comme dangereux",
  token_honeypot_or_unverified: "Jeton piège ou non vérifié",
  tld_risk: "Extension de domaine risquée",
  tls_missing: "Pas de HTTPS",
  legal_pages_missing: "Pas de mentions légales",
  review_profile: "Avis clients suspects",
  recipient_age_tx_count: "Adresse neuve",
  source_is_ad: "Lien publicitaire",
  amount_vs_history_zscore: "Montant inhabituel",
  amount_vs_balance_ratio: "Montant énorme face au solde",
  velocity_1h: "Rafale de paiements",
  approve_unlimited: "Autorisation de dépense illimitée",
  permit_signature: "Signature permit (droit de dépense)",
  signature_contains_arbitrary_call: "Appel arbitraire dans la signature",
  calldata_undecodable: "Transaction illisible",
  nonce_replay: "Rejeu d'une transaction",
  facilitator_endorsed: "Facilitateur x402 non reconnu",
  amount_matches_402_quote: "Montant différent du devis x402",
  bank_detail_change_recent: "RIB changé récemment",
  geo_mismatch: "Localisation incohérente",
  server_metadata_sybil_score: "Serveur suspect (sybil)",
  plan_action_deviation: "L'agent dévie de son plan",
  tool_description_changed: "Outil modifié (tool poisoning)",
  tool_description_has_directives: "Outil qui donne des ordres",
  tool_not_pinned: "Outil non épinglé",
  unexpected_tool_call: "Appel d'outil inattendu",
  confirmations_required_met: "Confirmations insuffisantes",
  payment_methods_offered: "Moyens de paiement douteux",
  contract_verified: "Contrat non vérifié",
};

export const signalLabel = (id: string) => SIGNAL_FR[id] ?? id.replace(/_/g, " ");
export const layerOf = (id: string, hint?: string): GuardLayer => (hint && hint in LAYER_CHECK ? (hint as GuardLayer) : (SIGNAL_LAYER.get(id) ?? "engine"));

/** the signals that say "the text the agent read gave it orders": the prompt injections the MCP agent caught */
export const isInjection = (s: GuardSignal) => s.layer === "content" || s.layer === "tools";
/** a refusal with no new analysis needed: the counterparty is already in the on-chain registry */
export const isRepeat = (s: GuardSignal) => s.id === "recipient_flagged_onchain" || s.id === "issuer_flagged_onchain" || s.id === "issuer_in_registry";

/** a DecisionRecorded reason, read back into the guard's signals; anything else (a note, a cut end) stays as text */
export function parseReason(reason: string): { signals: GuardSignal[]; notes: string[] } {
  const signals: GuardSignal[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const part of reason.split(/;\s+/)) {
    // "[mandate] amount_within_mandate: …" (a repeat offender quotes its first refusal) or "id: evidence"
    const m = /^(?:\[([a-z]+)\]\s*)?([a-z][a-z0-9_]{3,}):\s*(.*)$/s.exec(part.trim());
    if (m && (SIGNAL_LAYER.has(m[2]) || m[1])) {
      const [, hint, id, text] = m;
      // a repeat's reason nests the first one after its own: "recipient_flagged_onchain: …: [mandate] amount_within_mandate: …"
      const nested = /^(.*?):\s*\[([a-z]+)\]\s*([a-z][a-z0-9_]{3,}):\s*(.*)$/s.exec(text);
      push(id, nested ? nested[1] : text, hint);
      if (nested) push(nested[3], nested[4], nested[2]);
    } else if (part.trim()) notes.push(part.trim());
  }
  return { signals, notes };

  function push(id: string, text: string, hint?: string) {
    if (seen.has(id)) return;
    seen.add(id);
    const layer = layerOf(id, hint);
    signals.push({ id, layer, check: LAYER_CHECK[layer], text: text.trim() });
  }
}

/** the guard's full verdict carries its signals whole (guard/models.py Signal): id, layer, weight, evidence, hard */
export function signalsOfVerdict(v: { signals?: { id: string; layer?: string; weight?: number; evidence?: string; hard?: boolean }[] }): GuardSignal[] {
  return (v.signals ?? []).map((s) => {
    const layer = layerOf(s.id, s.layer);
    return { id: s.id, layer, check: LAYER_CHECK[layer], text: s.evidence ?? "", weight: s.weight, hard: s.hard };
  });
}
