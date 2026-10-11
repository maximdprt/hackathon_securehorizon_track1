'use client';

// Drop <ConnectWallet /> anywhere in the landing (header/CTA). Self-styled (Sentinel look),
// no external CSS needed. Shows "Se connecter" -> opens Privy -> shows the short address + logout.
import { usePrivy } from '@privy-io/react-auth';

const INK = '#171717';
const pill: React.CSSProperties = {
	borderRadius: 100,
	padding: '8px 16px',
	fontSize: 14,
	fontWeight: 600,
	fontFamily: 'Geist, Inter, system-ui, sans-serif',
	cursor: 'pointer',
	border: '1px solid #ebebeb',
	transition: 'opacity .15s',
};
const primary: React.CSSProperties = { ...pill, background: INK, color: '#fff', border: 'none' };
const ghost: React.CSSProperties = { ...pill, background: '#fff', color: INK };

export default function ConnectWallet() {
	const { ready, authenticated, user, login, logout } = usePrivy();

	if (!ready) return <button disabled style={{ ...primary, opacity: 0.5 }}>…</button>;

	if (!authenticated)
		return (
			<button style={primary} onClick={login}>
				Connecter mon wallet
			</button>
		);

	const addr = user?.wallet?.address;
	const label = addr
		? `${addr.slice(0, 6)}…${addr.slice(-4)}`
		: user?.email?.address ?? user?.google?.email ?? 'connecté';

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			<span style={{ fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 13, color: INK }}>{label}</span>
			<button style={ghost} onClick={logout}>
				Déconnexion
			</button>
		</div>
	);
}
