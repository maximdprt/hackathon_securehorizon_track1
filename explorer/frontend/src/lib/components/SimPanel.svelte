<script lang="ts">
	// Floating test panel: fire a verdict to the Sentinel authority API. It writes on-chain (visa/flag + DecisionRecorded)
	// and streams to the 3D city. Lets anyone simulate agent payments from the explorer.
	const API = 'https://rpc.petroi.fr';
	const ISSUER = '0xaF11630142CF1f829B87c586C0a6C980B61A855d';

	let open = $state(false);
	let busy = $state(false);
	let status = $state('');
	let recipient = $state('0x00000000000000000000000000000000DeaDBeef');
	let amount = $state(4800);
	let verdict = $state('block');
	let reason = $state('injection dans la facture, bénéficiaire signalé');

	async function send(payload: any) {
		busy = true;
		status = 'envoi sur la chaîne…';
		try {
			const r = await fetch(API + '/authorize', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const d = await r.json();
			if (d.status === 'ok') {
				const tx = (d.visa_tx || d.flag_tx || d.decision_tx || '').slice(0, 14);
				status = `✓ ${d.verdict} écrit · tx ${tx}…`;
			} else {
				status = 'erreur : ' + JSON.stringify(d).slice(0, 90);
			}
		} catch (e) {
			status = 'erreur réseau';
		}
		busy = false;
	}

	function preset(kind: 'allow' | 'human' | 'block') {
		const n = Date.now() % 100000;
		if (kind === 'allow')
			return send({
				payment: { issuer: ISSUER, recipient: '0x0000000000000000000000000000000000Fa38c12', amount: 12, nonce: n },
				verdict: 'allow', reason: 'facture SaaS connue, dans le mandat',
				context: { issuer_label: 'agent-meteo-02', recipient_label: 'SaaS Vendor' },
				full: { instruction_id: '0xa1' + n, issuer: ISSUER, action: 'pay', amount: 12, currency: 'USDC', recipient: '0x0000000000000000000000000000000000Fa38c12', verdict: 'allow', risk_score: 0.08, reasons: ['service connu, enregistré ERC-8004', 'montant dans le mandat'], owasp: [], authority_check: { authorized: true, within_limit: true }, poison_check: { is_poisoned: false } }
			});
		if (kind === 'human')
			return send({
				payment: { issuer: ISSUER, recipient: '0x00000000000000000000000000000000b0u71c9e', amount: 640, nonce: n },
				verdict: 'needs_human', reason: 'domaine créé il y a 3 jours, risque 55',
				context: { issuer_label: 'agent-achat-03', recipient_label: 'boutique-neuve.example' },
				full: { instruction_id: '0xb0' + n, issuer: ISSUER, action: 'pay', amount: 640, currency: 'USDC', recipient: '0x00000000000000000000000000000000b0u71c9e', verdict: 'needs_approval', risk_score: 0.55, reasons: ['domaine récent', 'hors habitude'], owasp: ['ASI07'], authority_check: { authorized: true, within_limit: true }, poison_check: { is_poisoned: false, confidence: 0.4 } }
			});
		return send({
			payment: { issuer: ISSUER, recipient: '0x00000000000000000000000000000000DeaDBeef', amount: 4800, nonce: n },
			verdict: 'block', reason: 'injection dans la facture, bénéficiaire signalé',
			context: { issuer_label: 'agent-compta-07', recipient_label: 'Faux marchand' },
			full: { instruction_id: '0xde' + n, issuer: ISSUER, action: 'pay', amount: 4800, currency: 'USDC', recipient: '0x00000000000000000000000000000000DeaDBeef', verdict: 'block', risk_score: 0.92, reasons: ['directive injectée dans la source', 'adresse inconnue'], owasp: ['ASI03', 'ASI07'], authority_check: { authorized: false, within_limit: false }, poison_check: { is_poisoned: true, confidence: 0.97 }, onchain_flagged: true }
		});
	}

	function sendCustom() {
		const n = Date.now() % 100000;
		const schemaV = verdict === 'needs_human' ? 'needs_approval' : verdict;
		send({
			payment: { issuer: ISSUER, recipient, amount: Number(amount) || 1, nonce: n },
			verdict, reason,
			context: { issuer_label: 'agent-test', recipient_label: recipient },
			full: { instruction_id: '0xcu' + n, issuer: ISSUER, action: 'pay', amount: Number(amount) || 1, currency: 'USDC', recipient, verdict: schemaV, risk_score: verdict === 'allow' ? 0.1 : verdict === 'needs_human' ? 0.55 : 0.9, reasons: [reason], owasp: verdict === 'block' ? ['ASI03', 'ASI07'] : [], onchain_flagged: verdict === 'block' }
		});
	}
</script>

<div class="sim">
	{#if open}
		<div class="panel">
			<div class="phead">
				<span>Simuler une transaction d'agent</span>
				<button class="x" onclick={() => (open = false)} aria-label="Fermer">✕</button>
			</div>
			<div class="quick">
				<button class="b allow" disabled={busy} onclick={() => preset('allow')}>ALLOW · 12 USDC · agent légitime</button>
				<button class="b human" disabled={busy} onclick={() => preset('human')}>DOUTE · 640 USDC · validation humaine</button>
				<button class="b block" disabled={busy} onclick={() => preset('block')}>FRAUDE · 4 800 USDC · doc piégé</button>
			</div>
			<div class="form">
				<label>Destinataire<input bind:value={recipient} spellcheck="false" /></label>
				<div class="row">
					<label>Montant (USDC)<input type="number" bind:value={amount} /></label>
					<label>Verdict<select bind:value={verdict}><option value="allow">allow</option><option value="needs_human">needs_human</option><option value="block">block</option></select></label>
				</div>
				<label>Raison<input bind:value={reason} /></label>
				<button class="b send" disabled={busy} onclick={sendCustom}>Envoyer sur Sentinel L1</button>
			</div>
			<div class="status">{status}</div>
			<div class="hint">écrit on-chain (visa/flag) · visible ici · voiture sur city.petroi.fr/?live=1</div>
		</div>
	{/if}
	<button class="fab" onclick={() => (open = !open)}>{open ? 'Fermer le test' : '⚡ Tester une transaction'}</button>
</div>

<style lang="postcss">
	@reference "$lib/../app.css";
	.sim {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
	}
	.fab {
		@apply rounded-full px-4 py-2 text-sm font-semibold;
		background: #171717;
		color: #fff;
		box-shadow: 0 2px 8px #00000026;
	}
	.panel {
		@apply w-80 rounded-xl p-3 text-sm;
		background: #fff;
		color: #171717;
		border: 1px solid #ebebeb;
		box-shadow: 0 1px 1px #00000005, 0 10px 28px -8px #0000002b;
	}
	.phead {
		@apply mb-2 flex items-center justify-between font-semibold;
	}
	.x {
		color: #888;
	}
	.quick {
		@apply mb-2 flex flex-col gap-1.5;
	}
	.b {
		@apply rounded-lg px-3 py-2 text-left text-xs font-semibold transition;
	}
	.b.allow {
		background: #e6f1ff;
		color: #0761d1;
	}
	.b.human {
		background: #fff1d6;
		color: #ab570a;
	}
	.b.block {
		background: #ffe0e0;
		color: #c50000;
	}
	.b.send {
		@apply w-full text-center;
		background: #171717;
		color: #fff;
	}
	.b:disabled {
		opacity: 0.5;
	}
	.form {
		@apply flex flex-col gap-1.5 pt-2;
		border-top: 1px solid #ebebeb;
	}
	.form label {
		@apply flex flex-col gap-0.5 text-[11px];
		color: #888;
	}
	.form input,
	.form select {
		@apply rounded-md px-2 py-1 text-xs;
		background: #fafafa;
		color: #171717;
		border: 1px solid #ebebeb;
		font-family: 'Geist Mono', ui-monospace, monospace;
	}
	.row {
		@apply grid grid-cols-2 gap-2;
	}
	.status {
		@apply mt-2 text-[11px];
		color: #4d4d4d;
		min-height: 1rem;
		font-family: 'Geist Mono', ui-monospace, monospace;
	}
	.hint {
		@apply mt-1 text-[10px];
		color: #a1a1a1;
	}
</style>
