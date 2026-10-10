// AVAGUARD: the Security district's form, after infrastructure.ts (builders-hub, BSD-3-Clause, Copyright (c) 2021,
// Ava Labs, Inc.): a guard house is a data hall, long and low, louvered storey by storey. Our own HQ does not use it
// (forms/index.ts keeps it a stepped landmark); another set the catalog files under security would.
import type { Node } from "@/components/explorer-v2/network/icm-map";
import type { Plan } from "./frame";
import { hallPlan } from "./infrastructure";

export function securityPlan(n: Node): Plan {
  return hallPlan(n);
}
