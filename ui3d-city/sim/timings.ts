/** Every duration of the simulation, in seconds. Tune here to fit the 5-minute pitch. */
export const TIMINGS = {
  /** out of the tower's door to the gantry */
  approach: 2.2,
  /** the analysis (the Pub's protocol): the car drives through the beam, then each of the five checks lights in turn
      while the whole car stands as a hologram and the score climbs; a clean transaction runs them at `healthy` */
  scan: 1.6,
  check: 0.45,
  verdict: 0.35,
  /** the decision's paint, all over the body in one go */
  paint: 0.4,
  healthy: 0.6,
  /** the registry short-circuits the analysis */
  immunity: 0.3,
  barrier: 0.4,
  /** outcomes */
  toCChain: 3.2,
  arrivalHold: 1.2,
  toScrapyard: 3.4,
  press: 0.55,
  shake: 0.45,
  dump: 1.3,
  toParking: 2.4,
  /** out of the human post by its exit gate, on to the C-Chain or across to the yard */
  parkToCChain: 3,
  parkToScrapyard: 3.4,
  /** the yard's own sequence runs this much faster than the reference's */
  yardSpeed: 1.3,
  humanTimeout: 120,
  /** back to the city's home view between two transactions */
  home: 1.2,
  between: 0.8,
} as const;

/** the analysis steps, in order; each lights one more line of the analysis card */
export const STEPS = ["scan", "authority", "beneficiary", "mandate", "intent_ai", "contract", "verdict"] as const;
export type Step = (typeof STEPS)[number];
