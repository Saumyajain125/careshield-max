/** Wire types mirroring the NestJS serializer. Money is always a string. */

export type QuoteStatus =
  | 'QUOTE_GENERATED'
  | 'MEDICAL_DECLARED'
  | 'PREMIUM_PAID'
  | 'POLICY_ISSUED';

export type EligibilityDecision = 'ELIGIBLE' | 'REFERRED' | 'DECLINED';

export interface Premium {
  base: string;
  ageLoading: string;
  conditionLoading: string;
  total: string;
  currency: string;
}

export interface MedicalDeclarationView {
  decision: EligibilityDecision;
  reasons: string[];
  declaredAt: string;
  canProceedToPayment: boolean;
}

export interface PolicyView {
  id: string;
  policyNumber: string;
  planCode: string;
  premiumPaid: string;
  currency: string;
  paymentReference: string;
  issuedAt: string;
  coverStart: string;
  coverEnd: string;
}

export interface Quote {
  id: string;
  status: QuoteStatus;
  planCode: string;
  applicant: { age: number; hasPreExistingConditions: boolean };
  premium: Premium;
  createdAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  isExpired: boolean;
  medicalDeclaration: MedicalDeclarationView | null;
  policy: PolicyView | null;
}

/** The closed set of conditions the API accepts. */
export const DIAGNOSED_CONDITIONS = [
  { code: 'DIABETES', label: 'Diabetes' },
  { code: 'HYPERTENSION', label: 'High blood pressure' },
  { code: 'ASTHMA', label: 'Asthma' },
  { code: 'THYROID_DISORDER', label: 'Thyroid disorder' },
  { code: 'HEART_DISEASE', label: 'Heart disease' },
  { code: 'CANCER', label: 'Cancer' },
  { code: 'CHRONIC_KIDNEY_DISEASE', label: 'Chronic kidney disease' },
  { code: 'LIVER_CIRRHOSIS', label: 'Liver cirrhosis' },
  { code: 'HIV', label: 'HIV' },
] as const;

/** What the API did with the Idempotency-Key it was sent. */
export type KeyDisposition = 'released' | 'held' | 'completed' | 'invalid';

/** Discriminated result returned by every Server Action to the client. */
export type ActionState<T> =
  | { status: 'idle' }
  | { status: 'success'; data: T }
  | {
      status: 'error';
      code: string;
      message: string;
      fieldErrors?: string[];
      keyDisposition?: KeyDisposition;
    };

export const IDLE: ActionState<never> = { status: 'idle' };
