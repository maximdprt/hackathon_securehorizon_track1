<script lang="ts">
	import {
		PUBLIC_CHAIN_NAME,
		PUBLIC_CHAIN_ID,
		PUBLIC_CHAIN_BLOCK_TIME,
		PUBLIC_CHAIN_GAS_LIMIT,
		PUBLIC_CHAIN_BASE_FEE,
		PUBLIC_NATIVE_SYMBOL,
		PUBLIC_LINK_DOCS,
		PUBLIC_LINK_SUBNET,
		PUBLIC_LINK_SITE,
		PUBLIC_LINK_RPC,
		PUBLIC_LINK_FUJI,
		PUBLIC_LINK_GITHUB,
		PUBLIC_LINK_CONTRACTS,
		PUBLIC_LINK_REPO
	} from '$env/static/public';
	import { _ } from 'svelte-i18n';

	const formatNumber = (value?: string) => {
		if (!value) return null;
		return Number(value).toLocaleString();
	};

	const atAGlance = [
		{ label: $_('chain.chainName'), value: PUBLIC_CHAIN_NAME },
		{ label: $_('chain.chainId'), value: PUBLIC_CHAIN_ID },
		{ label: $_('chain.blockTime'), value: PUBLIC_CHAIN_BLOCK_TIME ? `${PUBLIC_CHAIN_BLOCK_TIME} seconds` : null },
		{ label: $_('chain.gasLimit'), value: PUBLIC_CHAIN_GAS_LIMIT ? formatNumber(PUBLIC_CHAIN_GAS_LIMIT) : null },
		{ label: $_('chain.baseFee'), value: PUBLIC_CHAIN_BASE_FEE ? `${PUBLIC_CHAIN_BASE_FEE} gwei` : null },
		{ label: $_('chain.nativeToken'), value: PUBLIC_NATIVE_SYMBOL }
	];

	const resourceLinks = [
		{ label: $_('chain.site'), href: PUBLIC_LINK_SITE },
		{ label: $_('chain.docs'), href: PUBLIC_LINK_DOCS },
		{ label: $_('chain.rpc'), href: PUBLIC_LINK_RPC },
		{ label: $_('chain.subnet'), href: PUBLIC_LINK_SUBNET },
		{ label: $_('chain.fuji'), href: PUBLIC_LINK_FUJI },
		{ label: $_('chain.contracts'), href: PUBLIC_LINK_CONTRACTS },
		{ label: $_('chain.github'), href: PUBLIC_LINK_GITHUB },
		{ label: $_('chain.repo'), href: PUBLIC_LINK_REPO }
	].filter((link) => Boolean(link.href));
</script>

<section class="chain-card">
	<h2>{$_('home.highlights')}</h2>
	<ul class="spec-list">
		{#each atAGlance as item}
			{#if item.value}
				<li>
					<span>{item.label}</span>
					<strong>{item.value}</strong>
				</li>
			{/if}
		{/each}
	</ul>
	{#if resourceLinks.length}
		<div class="resource-list">
			{#each resourceLinks as link}
				<a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
			{/each}
		</div>
	{/if}
</section>

<style lang="postcss">
	@reference "$lib/../app.css";
	.chain-card {
		@apply flex h-full w-full flex-col gap-2 rounded-2xl bg-base-200 p-4;
	}

	h2 {
		@apply text-lg font-semibold;
	}

	.spec-list {
		@apply flex flex-col gap-2;
	}

	li {
		@apply flex items-center justify-between gap-4 rounded-xl bg-base-100 px-4 py-2 text-sm;
	}

	.resource-list {
		@apply flex flex-wrap gap-2;
	}

	.resource-list a {
		@apply badge badge-outline gap-1 px-3 py-2 text-xs font-medium uppercase;
	}
</style>
