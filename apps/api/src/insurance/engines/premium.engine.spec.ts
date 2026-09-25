import { calculatePremium } from './premium.engine';

/** Premiums are asserted as fixed-scale strings so no float creeps in. */
const total = (age: number, hasPreExistingConditions: boolean): string =>
  calculatePremium({ age, hasPreExistingConditions }).totalPremium.toFixed(2);

describe('calculatePremium', () => {
  it('charges the Rs 10,000 base premium for a young, healthy applicant', () => {
    const quote = calculatePremium({ age: 30, hasPreExistingConditions: false });

    expect(quote.basePremium.toFixed(2)).toBe('10000.00');
    expect(quote.ageLoading.toFixed(2)).toBe('0.00');
    expect(quote.conditionLoading.toFixed(2)).toBe('0.00');
    expect(quote.totalPremium.toFixed(2)).toBe('10000.00');
    expect(quote.currency).toBe('INR');
  });

  it('adds a 50% loading above age 45', () => {
    expect(total(46, false)).toBe('15000.00');
  });

  it('treats the age threshold as strictly greater than 45', () => {
    expect(total(45, false)).toBe('10000.00');
    expect(total(46, false)).toBe('15000.00');
  });

  it('adds a flat Rs 5,000 for pre-existing conditions', () => {
    expect(total(30, true)).toBe('15000.00');
  });

  it('stacks both loadings additively', () => {
    const quote = calculatePremium({ age: 60, hasPreExistingConditions: true });

    expect(quote.ageLoading.toFixed(2)).toBe('5000.00');
    expect(quote.conditionLoading.toFixed(2)).toBe('5000.00');
    expect(quote.totalPremium.toFixed(2)).toBe('20000.00');
  });

  it('is deterministic - the same inputs always rate identically', () => {
    const runs = Array.from({ length: 25 }, () => total(46, true));

    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe('20000.00');
  });

  it('keeps exact decimal arithmetic rather than binary floats', () => {
    const { totalPremium } = calculatePremium({ age: 50, hasPreExistingConditions: true });

    // Decimal comparison, not `toBeCloseTo` - the value must be exact.
    expect(totalPremium.equals('20000')).toBe(true);
  });
});
