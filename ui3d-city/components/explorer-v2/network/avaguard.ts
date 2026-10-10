// AVAGUARD: our addition to the vendored City (not from builders-hub). Everything the City needs to stand our L1:
// its id, name, logo and validators, its route to the C-Chain, and the flows we simulate when the network has none.
import type { MapChain } from "@/components/explorer-v2/network/city-data";

/** demo id until Walid's L1 has its chain ID; set NEXT_PUBLIC_AVAGUARD_CHAIN_ID to the real one */
export const AVAGUARD_ID = process.env.NEXT_PUBLIC_AVAGUARD_CHAIN_ID || "avaguard-l1";
export const AVAGUARD_NAME = "AvaGuard L1";
/** a hackathon L1's validator set */
export const AVAGUARD_VALIDATORS = 5;
/** our HQ is a skyline landmark whatever its validator count, so it reads from the home view */
export const AVAGUARD_MIN_H = 104;
/** the room our ward claims on the circle, in lots' worth: the toll, the parking and the scrapyard stand on it */
export const SECURITY_ROOM = 9;
/** the ICM messages our street carries each way (simulated: ours is a demo L1) */
export const AVAGUARD_FLOW = { out: 180, in: 120 };

/** a generic shield, our own drawing (no existing logo); a site file, so the badge atlas loads it directly */
export const AVAGUARD_LOGO = "/avaguard/shield.svg";

export const AVAGUARD_CHAIN: MapChain = { chainId: AVAGUARD_ID, chainName: AVAGUARD_NAME, chainLogoURI: AVAGUARD_LOGO, validatorCount: AVAGUARD_VALIDATORS };

/** the route key of our street, as city-data.ts keys routes: `${from}>${to}` */
export const guardKey = (hubId: string) => `${AVAGUARD_ID}>${hubId}`;
export const guardBackKey = (hubId: string) => `${hubId}>${AVAGUARD_ID}`;

const hashOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** plausible ICM flows between the C-Chain and the most validated chains, for a network whose feed has none (Fuji
    today): marked simulated in the key. Deterministic, so the plan never moves between two loads */
export function simulatedFlows(chains: MapChain[], hubId: string) {
  const top = chains
    .filter((c) => String(c.chainId) !== hubId && String(c.chainId) !== AVAGUARD_ID && Number(c.validatorCount) > 0)
    .sort((a, b) => Number(b.validatorCount) - Number(a.validatorCount))
    .slice(0, 15);
  return top.flatMap((c) => {
    const id = String(c.chainId);
    const n = 40 + (Math.abs(hashOf(id)) % 520);
    return [
      { sourceChainId: hubId, targetChainId: id, messageCount: n },
      { sourceChainId: id, targetChainId: hubId, messageCount: Math.round(n * 0.7) },
    ];
  });
}
