<script lang="ts">
	import {
		PUBLIC_LINK_SITE,
		PUBLIC_LINK_DOCS,
		PUBLIC_LINK_SUBNET,
		PUBLIC_LINK_RPC,
		PUBLIC_LINK_FUJI,
		PUBLIC_LINK_GITHUB,
		PUBLIC_LINK_CONTRACTS,
		PUBLIC_LINK_REPO
	} from '$env/static/public';
	import ExternalLink from 'virtual:icons/hugeicons/link-square-02';
	import { _ } from 'svelte-i18n';

	const spotlightLinks = [
		{ label: $_('chain.site'), href: PUBLIC_LINK_SITE },
		{ label: $_('chain.docs'), href: PUBLIC_LINK_DOCS },
		{ label: $_('chain.rpc'), href: PUBLIC_LINK_RPC },
		{ label: $_('chain.subnet'), href: PUBLIC_LINK_SUBNET }
	].filter((link) => Boolean(link.href));

	const communityLinks = [
		{ label: $_('chain.contracts'), href: PUBLIC_LINK_CONTRACTS },
		{ label: $_('chain.fuji'), href: PUBLIC_LINK_FUJI },
		{ label: $_('chain.github'), href: PUBLIC_LINK_GITHUB },
		{ label: $_('chain.repo'), href: PUBLIC_LINK_REPO }
	].filter((link) => Boolean(link.href));
</script>

<footer class="footer">
	<div class="footer__top">
		<div class="footer__brand">
			<div class="footer__logo">
				<img src="/sentinel-logo.png" alt="Sentinel" class="h-9 w-9 object-contain" />
				<div>
					<h3>SentinelScan</h3>
					<p class="caption">SentinelL1 explorer</p>
				</div>
			</div>
			<p class="tagline">{$_('footer.tagline')}</p>
		</div>
		<div class="footer__links">
			<div>
				<h4>Spotlight</h4>
				<ul>
					{#each spotlightLinks as link}
						<li>
							<a href={link.href} target="_blank" rel="noreferrer">
								<span>{link.label}</span>
								<ExternalLink />
							</a>
						</li>
					{/each}
				</ul>
			</div>
			<div>
				<h4>Resources</h4>
				<ul>
					{#each communityLinks as link}
						<li>
							<a href={link.href} target="_blank" rel="noreferrer">
								<span>{link.label}</span>
								<ExternalLink />
							</a>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
	<div class="footer__bottom">
		<div class="footer__credits">
			<span>Built for ESSECKATHON 2026</span>
			<span class="sep">•</span>
			<span>BW Capital</span>
			<span class="sep">•</span>
			<span>{new Date().getFullYear()}</span>
		</div>
		<a class="footer__cta" href={PUBLIC_LINK_REPO} target="_blank" rel="noreferrer">
			<span>SentinelL1 · Agentic Payment Security</span>
			<ExternalLink />
		</a>
	</div>
</footer>

<style lang="postcss">
	@reference "$lib/../app.css";
	.footer {
		@apply mt-auto w-full bg-base-300/90 backdrop-blur px-4 py-6 text-sm;
	}

	.footer__top {
		@apply container mx-auto flex flex-col gap-6 rounded-3xl bg-base-200/60 p-6 sm:flex-row sm:items-start sm:justify-between;
	}

	.footer__brand {
		@apply flex-1;
	}

	.footer__logo {
		@apply flex items-center gap-3;
	}

	.footer__brand h3 {
		@apply text-xl font-semibold;
	}

	.caption {
		@apply text-xs uppercase tracking-wide text-base-content/70;
	}

	.tagline {
		@apply mt-3 text-sm text-base-content/80;
	}

	.footer__links {
		@apply grid w-full gap-6 sm:w-auto sm:grid-cols-2;
	}

	.footer__links h4 {
		@apply text-sm font-semibold uppercase tracking-wide text-base-content/70;
	}

	.footer__links ul {
		@apply mt-3 flex flex-col gap-2;
	}

	.footer__links a {
		@apply inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-base-300;
	}

	.footer__links a :global(svg) {
		@apply text-xs;
	}

	.footer__bottom {
		@apply container mx-auto mt-4 flex flex-col items-center justify-between gap-3 rounded-3xl bg-base-200/60 px-6 py-4 text-xs sm:flex-row;
	}

	.footer__credits {
		@apply flex items-center gap-2;
	}

	.sep {
		@apply hidden sm:inline;
	}

	.footer__cta {
		@apply inline-flex items-center gap-2 rounded-lg bg-base-100 px-3 py-1.5 font-medium transition hover:bg-base-300;
	}

	@media (max-width: theme('screens.sm')) {
		.footer {
			@apply px-3 py-5;
		}
	}
</style>
