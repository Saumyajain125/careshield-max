import { EligibilityDecision } from '@prisma/client';
import { calculateBmi, evaluateEligibility, formatBmi, type Disclosures } from './underwriting.engine';

const healthy: Disclosures = {
  smoker: false,
  alcoholUnitsPerWeek: 2,
  heightCm: 175,
  weightKg: 72,
  hospitalisedInLast12Months: false,
  onRegularMedication: false,
  diagnosedConditions: [],
};

const decide = (overrides: Partial<Disclosures>, age = 35) =>
  evaluateEligibility({ ...healthy, ...overrides }, age);

describe('calculateBmi', () => {
  it('computes BMI from height in cm and weight in kg', () => {
    expect(calculateBmi(175, 72)).toBeCloseTo(23.51, 2);
  });

  it('does not round - the referral thresholds compare on this value', () => {
    expect(calculateBmi(180, 48.5)).toBeLessThan(15);
    expect(calculateBmi(170, 115.5)).toBeLessThan(40);
  });

  it('rounds only for display', () => {
    expect(formatBmi(calculateBmi(180, 48.5))).toBe('15.0');
  });
});

describe('evaluateEligibility', () => {
  it('accepts a clean case for instant issue', () => {
    expect(decide({}).decision).toBe(EligibilityDecision.ELIGIBLE);
  });

  it('accepts manageable chronic conditions', () => {
    expect(decide({ diagnosedConditions: ['DIABETES', 'HYPERTENSION'] }).decision).toBe(
      EligibilityDecision.ELIGIBLE,
    );
  });

  it.each(['CANCER', 'CHRONIC_KIDNEY_DISEASE', 'LIVER_CIRRHOSIS', 'HIV'] as const)(
    'declines %s outright',
    (condition) => {
      const result = decide({ diagnosedConditions: [condition] });

      expect(result.decision).toBe(EligibilityDecision.DECLINED);
      expect(result.reasons[0]).toContain(condition);
    },
  );

  it('refers heart disease to a human underwriter', () => {
    expect(decide({ diagnosedConditions: ['HEART_DISEASE'] }).decision).toBe(
      EligibilityDecision.REFERRED,
    );
  });

  it('refers a recent hospitalisation', () => {
    expect(decide({ hospitalisedInLast12Months: true }).decision).toBe(EligibilityDecision.REFERRED);
  });

  it('refers BMI outside the instant-issue band', () => {
    expect(decide({ heightCm: 165, weightKg: 115 }).decision).toBe(EligibilityDecision.REFERRED);
    expect(decide({ heightCm: 180, weightKg: 45 }).decision).toBe(EligibilityDecision.REFERRED);
  });

  // Both of these sit within a rounding step of a threshold, which is where
  // the display-rounded BMI used to give the wrong answer.
  it('decides the BMI band on either side of the boundary', () => {
    // 14.969 - just under 15, so a referral even though it displays as 15.0.
    expect(decide({ heightCm: 180, weightKg: 48.5 }).decision).toBe(EligibilityDecision.REFERRED);
    // 39.965 - still inside the band, so an instant issue.
    expect(decide({ heightCm: 170, weightKg: 115.5 }).decision).toBe(EligibilityDecision.ELIGIBLE);
  });

  it('refers heavy drinking', () => {
    expect(decide({ alcoholUnitsPerWeek: 40 }).decision).toBe(EligibilityDecision.REFERRED);
    expect(decide({ alcoholUnitsPerWeek: 28 }).decision).toBe(EligibilityDecision.ELIGIBLE);
  });

  it('refers older smokers but not younger ones', () => {
    expect(decide({ smoker: true }, 40).decision).toBe(EligibilityDecision.ELIGIBLE);
    expect(decide({ smoker: true }, 60).decision).toBe(EligibilityDecision.REFERRED);
  });

  it('lets a decline outrank a referral', () => {
    const result = decide({
      diagnosedConditions: ['HEART_DISEASE', 'CANCER'],
      hospitalisedInLast12Months: true,
    });

    expect(result.decision).toBe(EligibilityDecision.DECLINED);
    expect(result.reasons).toHaveLength(1);
  });

  it('collects every referral reason that fired', () => {
    const result = decide({ hospitalisedInLast12Months: true, alcoholUnitsPerWeek: 40 });

    expect(result.decision).toBe(EligibilityDecision.REFERRED);
    expect(result.reasons).toHaveLength(2);
  });
});
