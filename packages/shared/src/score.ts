import { TIER_MULTIPLIER, type Tier } from "./geo.js";

export interface FinalScoreInput {
  aiScore: number; // 0–100 iz modela
  tier: Tier;
  remoteOk: boolean | null;
  budgetEur: number | null; // procenjena vrednost posla
  leadType?: string | null; // tender | project | intent | hiring_signal
}

/** Konačna ocena = AI ocena × tier + bonusi. Uvek 0–100. */
export function finalScore({ aiScore, tier, remoteOk, budgetEur, leadType }: FinalScoreInput): number {
  let s = aiScore * TIER_MULTIPLIER[tier];
  if (leadType === "tender") s += 5; // postoji budžet, rok i obavezna procedura izbora dobavljača
  if (remoteOk === true) s += 5;
  if (remoteOk === false) s -= 25;
  if (budgetEur !== null) {
    if (budgetEur >= 20000) s += 10;
    else if (budgetEur >= 5000) s += 5;
    else if (budgetEur < 500) s -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}
