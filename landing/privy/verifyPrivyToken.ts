// SERVER ONLY. Verify a Privy auth token and read the user's wallet. Never import this in client code
// (it uses PRIVY_APP_SECRET). Use it in an API route / server action to gate access or tie a login to an address.
import { PrivyClient } from '@privy-io/server-auth';

const APP_ID = process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
	console.warn('[privy] PRIVY_APP_ID / PRIVY_APP_SECRET manquant côté serveur');
}

export const privy = APP_ID && APP_SECRET ? new PrivyClient(APP_ID, APP_SECRET) : null;

/** Verify the Privy access token (sent by the client as `Authorization: Bearer <token>` or a cookie).
 *  Returns the verified claims (userId, appId, ...) or null if invalid/expired. */
export async function verifyPrivyToken(token: string) {
	if (!privy || !token) return null;
	try {
		return await privy.verifyAuthToken(token); // validates signature against the app's JWKS
	} catch {
		return null;
	}
}

/** The user's linked wallet address, server-side (e.g. to use as the agent owner / issuer on SentinelL1). */
export async function getUserWallet(userId: string): Promise<string | null> {
	if (!privy) return null;
	try {
		const user = await privy.getUser(userId);
		const wallet = user.linkedAccounts.find((a) => a.type === 'wallet');
		return (wallet && 'address' in wallet ? (wallet.address as string) : null) ?? null;
	} catch {
		return null;
	}
}
