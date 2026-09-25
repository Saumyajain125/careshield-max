import { Decimal } from 'decimal.js';
import { toMoney } from '../../common/money';

/** Rating table, kept as data so pricing changes are reviewable on their own. */
export const RATE_CARD = {
  planCode: 'CARESHIELD_MAX',
  currency: 'INR',
  /** Base annual premium, before any loadings. */
  basePremium: new Decimal(10_000),
  /** Applicants strictly older than this attract the age loading. */
  ageLoadingThreshold: 45,
  /** Age loading is a percentage of the base premium. */
  ageLoadingRate: new Decimal(0.5),
  /** Pre-existing conditions attract a flat rupee loading. */
  preExistingConditionLoading: new Decimal(5_000),
} as const;

export interface PremiumInput {
  age: number;
  hasPreExistingConditions: boolean;
}

export interface PremiumBreakdown {
  basePremium: Decimal;
  ageLoading: Decimal;
  conditionLoading: Decimal;
  totalPremium: Decimal;
  currency: string;
}

/**
 * Pure and deterministic - same inputs, same premium - which is what a
 * 15-minute quote lock rests on.
 *
 *   base                     = Rs 10,000
 *   age > 45                 = +50% of base (Rs 5,000)
 *   hasPreExistingConditions = +Rs 5,000 flat
 */
export function calculatePremium(input: PremiumInput): PremiumBreakdown {
  const basePremium = toMoney(RATE_CARD.basePremium);

  const ageLoading =
    input.age > RATE_CARD.ageLoadingThreshold
      ? toMoney(basePremium.times(RATE_CARD.ageLoadingRate))
      : toMoney(0);

  const conditionLoading = input.hasPreExistingConditions
    ? toMoney(RATE_CARD.preExistingConditionLoading)
    : toMoney(0);

  const totalPremium = toMoney(basePremium.plus(ageLoading).plus(conditionLoading));

  return { basePremium, ageLoading, conditionLoading, totalPremium, currency: RATE_CARD.currency };
}
