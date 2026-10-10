/** Every duration of the simulation, in seconds. Tune here to fit the 5-minute pitch. */
export const TIMINGS = {
  /** HQ to the toll */
  approach: 5.5,
  /** the analysis steps (section 5.1), at the fraud's pace; a clean transaction runs them at `healthy` */
  scan: 0.9,
  holo: 1.6,
  authority: 2.4,
  snowball: 2.2,
  registry: 1.0,
  score: 1.8,
  verdict: 0.8,
  healthy: 0.28,
  /** the registry short-circuits the analysis */
  immunity: 0.3,
  barrier: 0.6,
  /** outcomes */
  toCChain: 7,
  arrivalHold: 2.2,
  uTurn: 2.2,
  toScrapyard: 6.5,
  press: 0.55,
  shake: 0.45,
  dump: 1.3,
  toParking: 7.5,
  /** out of the bay, back through the gate and round the block to the toll */
  fromParking: 7,
  humanTimeout: 120,
  /** back to the city's home view between two transactions */
  home: 1.6,
  between: 1.2,
} as const;

/** the analysis steps, in order; each lights one more line of the analysis card */
export const STEPS = ["scan", "holo", "authority", "snowball", "registry", "score", "verdict"] as const;
export type Step = (typeof STEPS)[number];
