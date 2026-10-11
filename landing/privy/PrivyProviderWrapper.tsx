'use client';

// Wrap the landing page with this so wallet login works everywhere below it.
// Next.js App Router: put <PrivyProviderWrapper> in app/layout.tsx around {children}.
// Needs env NEXT_PUBLIC_PRIVY_APP_ID (the public Privy App ID).
import { PrivyProvider } from '@privy-io/react-auth';
import type { ReactNode } from 'react';

export default function PrivyProviderWrapper({ children }: { children: ReactNode }) {
	const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
	if (!appId) {
		if (typeof window !== 'undefined') console.warn('[privy] NEXT_PUBLIC_PRIVY_APP_ID manquant - login désactivé');
		return <>{children}</>;
	}
	return (
		<PrivyProvider
			appId={appId}
			config={{
				// Sentinel brand (voir DESIGN.md): encre #171717, logo S
				appearance: {
					theme: 'light',
					accentColor: '#171717',
					logo: 'https://petroi.fr/sentinel-logo.png',
					walletChainType: 'ethereum-only',
				},
				// login par wallet externe (MetaMask, Rabby, WalletConnect...) OU email -> wallet embarqué créé auto
				loginMethods: ['wallet', 'email'],
				embeddedWallets: { createOnLogin: 'users-without-wallets' },
			}}
		>
			{children}
		</PrivyProvider>
	);
}
