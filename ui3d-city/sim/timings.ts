/** Every duration of the simulation, in seconds. Tune here to fit the 5-minute pitch. */
export const TIMINGS = {
  /** HQ to the toll */
  approach: 5.5,
  /** the analysis (the Pub's protocol): the car drives through the beam, then each of the five checks lights in turn
      while the whole car stands as a hologram and the score climbs; a clean transaction runs them at `healthy` */
  scan: 2.6,
  check: 0.75,
  verdict: 0.6,
  /** the decision's paint, all over the body in one go */
  paint: 0.4,
  healthy: 0.6,
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
export const STEPS = ["scan", "authority", "beneficiary", "mandate", "intent_ai", "contract", "verdict"] as const;
export type Step = (typeof STEPS)[number];
