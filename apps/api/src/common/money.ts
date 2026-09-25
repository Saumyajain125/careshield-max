import { Decimal } from 'decimal.js';

// Every rupee amount is a Decimal backed by a NUMERIC(10, 2) column. `number`
// is never used for money: 0.1 + 0.2 !== 0.3 is not a property a premium
// engine can live with.

/** Rupee amounts are stored and compared with exactly two decimal places. */
export const MONEY_SCALE = 2;

/** Build a Decimal from anything Prisma or a DTO might hand us. */
export function money(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** Round to the stored scale, half-up, as Indian insurers round premiums. */
export function toMoney(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Canonical wire format: a fixed-scale string, never a float. */
export function formatMoney(value: Decimal.Value): string {
  return toMoney(value).toFixed(MONEY_SCALE);
}
