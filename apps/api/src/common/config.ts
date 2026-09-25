/**
 * Runtime configuration, read once at boot so the values are stable for the
 * lifetime of the process (and easy to override in tests).
 */

/**
 * `??` only catches undefined, so QUOTE_LOCK_MINUTES= (empty) would give
 * Number('') === 0 and every quote would be born expired. Blank and
 * unparseable values fall back to the default instead.
 */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  port: intFromEnv('PORT', 4000),

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * How long a generated quote stays honoured. The brief fixes this at 15
   * minutes; it stays configurable so the expiry gate can be exercised in
   * tests without waiting a quarter of an hour.
   */
  quoteLockMinutes: intFromEnv('QUOTE_LOCK_MINUTES', 15),

  /** Cover term for an issued policy. */
  policyTermMonths: intFromEnv('POLICY_TERM_MONTHS', 12),

  /**
   * Fault-injection tokens (see MockPaymentClient) need an explicit opt-in.
   * Keying this off `NODE_ENV !== 'production'` armed them on staging and
   * whenever NODE_ENV was simply unset.
   */
  allowFaultInjection:
    process.env.ALLOW_PAYMENT_FAULT_INJECTION === 'true' ||
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development',
};
