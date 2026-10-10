// AVAGUARD: our addition to the vendored City (not from builders-hub). Everything the City needs to stand our L1:
// its id, name, logo and validators, its route to the C-Chain, and the flows we simulate when the network has none.
import type { MapChain } from "@/components/explorer-v2/network/city-data";

/** SentinelL1, live on Fuji (CLAUDE.md 11.1): its blockchain and its subnet, as the P-Chain and the L1 registry know them.
    The registry's own row for it (a Frontier guest) gives way to our HQ in the Security ward (city-data.ts). */
export const AVAGUARD_ID = process.env.NEXT_PUBLIC_AVAGUARD_CHAIN_ID || "2PqooUD2u82cQVbEHUfSnK5GTnRfUg17d8RUuccc97y27NkZhd";
export const SENTINEL_SUBNET = "jUCDvuYEuP16TFpxjanBQt6JiedTDUBanrYTBjThmdmfw8PxH";
export const SENTINEL_EVM_CHAIN_ID = 99999;
export const AVAGUARD_NAME = "Sentinel L1";
/** SENTINEL (the deployed sentinel-city-3d): the demo city is only our L1 and the C-Chain hub it reports to, one main
    road between them and one hero car, no ambient fleet. NEXT_PUBLIC_CITY_FULL=1 stands every Fuji chain again. */
export const SENTINEL_ONLY = process.env.NEXT_PUBLIC_CITY_FULL !== "1";
/** its validator set today: one node (NodeID-5dd7CBhH8UDU3QCUbSWBFSckXZrC4mHi9) */
export const AVAGUARD_VALIDATORS = 1;
/** our HQ is a skyline landmark whatever its validator count, so it reads from the home view */
export const AVAGUARD_MIN_H = 104;
/** the room our ward claims on the circle, in lots' worth: the toll, the parking and the scrapyard stand on it */
export const SECURITY_ROOM = 16;
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
