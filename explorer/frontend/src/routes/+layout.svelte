<script lang="ts">
	import '../app.css';
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';
	import FirstVisitBanner from '$lib/components/layout/FirstVisitBanner.svelte';
	import PagePreloader from '$lib/components/PagePreloader.svelte';
	import SimPanel from '$lib/components/SimPanel.svelte';
	import { _ } from 'svelte-i18n';

	let { children } = $props();
</script>

<svelte:head>
	<meta name="theme-color" content="#ff154e" />
	<meta
		name="description"
		content={$_('meta.description')}
	/>
	<meta property="og:site_name" content="SentinelScan" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={$_('meta.title')} />
	<meta
		property="og:description"
		content={$_('meta.ogDescription')}
	/>
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={$_('meta.title')} />
	<meta
		name="twitter:description"
		content={$_('meta.ogDescription')}
	/>
	<meta
		name="keywords"
		content={$_('meta.keywords')}
	/>
</svelte:head>

<div class="flex min-h-screen w-screen flex-col">
	<Header />
	<FirstVisitBanner />
	<div class="main-content-wrapper flex flex-1 flex-col gap-4 px-1 py-2 sm:py-4">
		{@render children?.()}
	</div>
	<Footer />
</div>

<PagePreloader />
<SimPanel />

<style lang="postcss">
	@reference "$lib/../app.css";
	.main-content-wrapper {
		min-height: calc(100vh - calc(var(--spacing) * 8));
	}
</style>
