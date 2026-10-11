import { describe, expect, it } from 'vitest';

import { planCity, ringCity, withRing, type CityChain } from '@/components/explorer-v2/network/city';
import { AVAGUARD_ID, RING_FACING, RING_LOT_MAX, RING_ROAD, RING_SPAN } from '@/components/explorer-v2/network/avaguard';
import type { District } from '@/components/explorer-v2/network/districts';

// AVAGUARD: the Sentinel city's ring (city.ts ringCity, withRing). The protocol keeps its own plan, our L1 alone round the
// plaza, and every other L1 stands round it as the skyline, on the ring's arc, past the campus, the tallest farthest from
// the camera's home; the two plans make one city at the protocol's scale.

const GEOMETRY = { cx: 600, cy: 352, tilt: 0.5, reach: 444, hub: { w: 27, h: 150 } };
const TAU = 2 * Math.PI;
const RING = { road: RING_ROAD, span: RING_SPAN, facing: RING_FACING, lotMax: RING_LOT_MAX };
const inSpan = (a: number) => {
  const d = (((a - RING_SPAN[0]) % TAU) + TAU) % TAU;
  return d <= RING_SPAN[1] - RING_SPAN[0] + 1e-9;
};

/** Fuji's districts as the city reads them: a chain each in Finance and Gaming, the rest on the Frontier, validators 1 to 20 */
function fuji(n = 228): CityChain[] {
  const at = (i: number): District => (i === 0 ? 'finance' : i === 1 ? 'gaming' : 'frontier');
  return Array.from({ length: n }, (_, i) => ({ id: `l1-${i}`, district: at(i), talks: 0, validators: 1 + ((i * 7) % 20), newAt: null }));
}
const ours: CityChain = { id: AVAGUARD_ID, district: 'security', talks: 0, validators: 1, newAt: null };

describe('the ring round the protocol', () => {
  const ring = ringCity(fuji(), GEOMETRY, RING)!;

  it('stands every chain on a lot of the ring, past the campus and on its arc', () => {
    expect(ring).not.toBeNull();
    expect(ring.lots.size).toBe(228);
    for (const l of ring.lots.values()) {
      expect(l.r).toBeGreaterThan(RING_ROAD);
      expect(l.r).toBeLessThan(GEOMETRY.reach);
      expect(inSpan(l.a)).toBe(true);
      expect(l.pitch).toBe(ring.lot);
    }
    expect(ring.lot).toBeLessThanOrEqual(RING_LOT_MAX);
  });

  it('tiles its arc with the wards, in the city order', () => {
    const wards = [...ring.wards].sort((a, b) => a.a0 - b.a0);
    expect(wards[0].a0).toBeCloseTo(RING_SPAN[0], 9);
    expect(wards[wards.length - 1].a1).toBeCloseTo(RING_SPAN[1], 9);
    for (let i = 1; i < wards.length; i++) expect(wards[i].a0).toBeCloseTo(wards[i - 1].a1, 9);
  });

  it('takes its group photo from the camera: the tallest farthest, the lowest nearest', () => {
    const toward = (id: string) => {
      const l = ring.lots.get(id)!;
      return l.r * Math.cos(l.a - RING_FACING);
    };
    const frontier = fuji().filter((c) => c.district === 'frontier');
    const tallest = frontier.reduce((a, b) => (b.validators > a.validators ? b : a));
    const lowest = frontier.reduce((a, b) => (b.validators < a.validators ? b : a));
    expect(toward(tallest.id)).toBeLessThan(toward(lowest.id));
  });

  it('makes one city with the protocol, at the protocol scale', () => {
    const inner = planCity([ours], GEOMETRY);
    const open: [number, number] = [RING_SPAN[1] - TAU, RING_SPAN[0]];
    const city = withRing(inner, ring, open);
    // the campus keeps its lot, its plaza, its ring road and our tower's place
    expect(city.lot).toBe(inner.lot);
    expect(city.core).toBe(inner.core);
    expect(city.rings[0]).toBeCloseTo(inner.rings[0], 9);
    expect(city.lots.get(AVAGUARD_ID)!.r).toBeCloseTo(inner.lots.get(AVAGUARD_ID)!.r, 9);
    expect(city.lots.size).toBe(229);
    // our ward keeps the ring's open arc, the ring's wards the rest
    const security = city.wards.find((w) => w.district === 'security')!;
    expect(security.a0).toBeCloseTo(open[0], 9);
    expect(security.a1).toBeCloseTo(open[1], 9);
    // the ring road past the campus is shared, once, and goes all the way round
    const shared = city.roads!.filter((q) => Math.abs(q.r - RING_ROAD) < 1);
    expect(shared).toHaveLength(1);
    expect(shared[0].span).toBeNull();
    // no tower of the ring stands on the campus's block
    const block = inner.blocks[0];
    for (const l of ring.lots.values()) expect(l.r > block.r1 || l.a < block.a0 || l.a > block.a1).toBe(true);
  });

  it('stands nothing when there is no other chain', () => {
    expect(ringCity([], GEOMETRY, RING)).toBeNull();
    const inner = planCity([ours], GEOMETRY);
    expect(withRing(inner, null, [0, 1])).toBe(inner);
  });
});
