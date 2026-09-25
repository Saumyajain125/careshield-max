import { EligibilityDecision } from '@prisma/client';

/** The closed set of conditions an applicant may disclose. */
export const DIAGNOSED_CONDITIONS = [
  'DIABETES',
  'HYPERTENSION',
  'ASTHMA',
  'THYROID_DISORDER',
  'HEART_DISEASE',
  'CANCER',
  'CHRONIC_KIDNEY_DISEASE',
  'LIVER_CIRRHOSIS',
  'HIV',
] as const;

export type DiagnosedCondition = (typeof DIAGNOSED_CONDITIONS)[number];

/** Conditions that fall outside the CareShield Max appetite entirely. */
const UNINSURABLE: ReadonlySet<DiagnosedCondition> = new Set([
  'CANCER',
  'CHRONIC_KIDNEY_DISEASE',
  'LIVER_CIRRHOSIS',
  'HIV',
]);

/** Conditions that need a human underwriter rather than an instant bind. */
const REFERRAL_CONDITIONS: ReadonlySet<DiagnosedCondition> = new Set(['HEART_DISEASE']);

export interface Disclosures {
  smoker: boolean;
  alcoholUnitsPerWeek: number;
  heightCm: number;
  weightKg: number;
  hospitalisedInLast12Months: boolean;
  onRegularMedication: boolean;
  diagnosedConditions: DiagnosedCondition[];
}

export interface UnderwritingResult {
  decision: EligibilityDecision;
  /** Every rule that fired, in evaluation order. Surfaced to the customer. */
  reasons: string[];
  bmi: number;
}

/** Body mass index. Unrounded - the underwriting thresholds compare on this. */
export function calculateBmi(heightCm: number, weightKg: number): number {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/** One decimal place, for the reason strings the customer reads. */
export function formatBmi(bmi: number): string {
  return bmi.toFixed(1);
}

/**
 * Deterministic underwriting rules for instant issue.
 *
 * The decision ladder is DECLINED > REFERRED > ELIGIBLE: an uninsurable
 * condition always wins, otherwise any referral trigger downgrades an
 * otherwise clean case to manual review. Only ELIGIBLE may proceed to
 * an instant bind.
 */
export function evaluateEligibility(disclosures: Disclosures, age: number): UnderwritingResult {
  const bmi = calculateBmi(disclosures.heightCm, disclosures.weightKg);
  const declineReasons: string[] = [];
  const referralReasons: string[] = [];

  for (const condition of disclosures.diagnosedConditions) {
    if (UNINSURABLE.has(condition)) {
      declineReasons.push(`Disclosed condition outside underwriting appetite: ${condition}`);
    } else if (REFERRAL_CONDITIONS.has(condition)) {
      referralReasons.push(`Disclosed condition requires manual underwriting: ${condition}`);
    }
  }

  if (disclosures.hospitalisedInLast12Months) {
    referralReasons.push('Hospitalised within the last 12 months');
  }
  // Compared on the unrounded value on purpose: rounding 14.97 up to 15.0
  // instant-issues an applicant the rule is meant to refer.
  if (bmi >= 40 || bmi < 15) {
    referralReasons.push(`BMI of ${formatBmi(bmi)} is outside the instant-issue range of 15-40`);
  }
  if (disclosures.smoker && age >= 60) {
    referralReasons.push('Smoker aged 60 or above');
  }
  if (disclosures.alcoholUnitsPerWeek > 28) {
    referralReasons.push(`Alcohol consumption of ${disclosures.alcoholUnitsPerWeek} units/week exceeds 28`);
  }

  if (declineReasons.length > 0) {
    return { decision: EligibilityDecision.DECLINED, reasons: declineReasons, bmi };
  }
  if (referralReasons.length > 0) {
    return { decision: EligibilityDecision.REFERRED, reasons: referralReasons, bmi };
  }

  return { decision: EligibilityDecision.ELIGIBLE, reasons: ['Meets all instant-issue criteria'], bmi };
}
