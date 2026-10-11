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
/** SENTINEL: the rest of the network stands round the protocol, every other Fuji L1 a tower of the skyline, as an
    amphitheatre open on the camera's side, so nothing stands between the reader and the road (city.ts ringCity). The
    protocol's campus keeps its own plan and scale; the ring has its own lots, past the campus. NEXT_PUBLIC_CITY_RING=0
    (or ?ring=0) keeps the bare protocol city */
export const SENTINEL_RING =
  SENTINEL_ONLY && process.env.NEXT_PUBLIC_CITY_RING !== "0" && (typeof window === "undefined" || new URLSearchParams(window.location.search).get("ring") !== "0");
const DEG = Math.PI / 180;
/** the camera's home turn in the Sentinel city (Rig.tsx Shot az): a little from the right, so our straight road runs
    diagonally away from the control tower and nothing stands in front of it; and the plan angle it looks from */
export const HOME_AZ = 1.1;
export const RING_FACING = Math.PI / 2 - HOME_AZ;
/** the ring's span, as plan angles (from +x toward +z, the camera's home looking from about 27 degrees): it opens on the
    campus (66 to 130 degrees, the yard included) and on the foreground between it and the camera, and wraps the rest */
export const RING_SPAN: [number, number] = [138 * DEG, 372 * DEG];
/** the ring's first ring road: the one past the campus's block (city.ts rings[1]), so the two plans share it */
export const RING_ROAD = 252.2;
/** the ring's lots: as large as fit, and never larger than this (a tower half the campus's lot) */
export const RING_LOT_MAX = 26;
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
