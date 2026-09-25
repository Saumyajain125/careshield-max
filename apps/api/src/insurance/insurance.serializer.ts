import type { MedicalDeclaration, Policy, Quote } from '@prisma/client';
import { formatMoney } from '../common/money';

// Wire shapes for the buy journey. Money crosses as a fixed-scale string:
// JSON numbers are IEEE-754 doubles, which would undo the point of the
// NUMERIC(10, 2) columns.

export interface PremiumView {
  base: string;
  ageLoading: string;
  conditionLoading: string;
  total: string;
  currency: string;
}

export interface QuoteView {
  id: string;
  status: Quote['status'];
  planCode: string;
  applicant: { age: number; hasPreExistingConditions: boolean };
  premium: PremiumView;
  createdAt: string;
  expiresAt: string;
  /** Remaining lock, computed here so a skewed client clock cannot extend it. */
  expiresInSeconds: number;
  isExpired: boolean;
  medicalDeclaration: MedicalDeclarationView | null;
  policy: PolicyView | null;
}

export interface MedicalDeclarationView {
  decision: MedicalDeclaration['decision'];
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

type QuoteWithRelations = Quote & {
  medicalDeclaration?: MedicalDeclaration | null;
  policy?: Policy | null;
};

export function toQuoteView(quote: QuoteWithRelations, now: Date = new Date()): QuoteView {
  const remainingMs = quote.expiresAt.getTime() - now.getTime();

  return {
    id: quote.id,
    status: quote.status,
    planCode: 'CARESHIELD_MAX',
    applicant: { age: quote.age, hasPreExistingConditions: quote.hasPreExistingConditions },
    premium: {
      base: formatMoney(quote.basePremium),
      ageLoading: formatMoney(quote.ageLoading),
      conditionLoading: formatMoney(quote.conditionLoading),
      total: formatMoney(quote.totalPremium),
      currency: quote.currency,
    },
    createdAt: quote.createdAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
    expiresInSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
    isExpired: remainingMs <= 0,
    medicalDeclaration: quote.medicalDeclaration
      ? toMedicalDeclarationView(quote.medicalDeclaration)
      : null,
    policy: quote.policy ? toPolicyView(quote.policy) : null,
  };
}

export function toMedicalDeclarationView(declaration: MedicalDeclaration): MedicalDeclarationView {
  return {
    decision: declaration.decision,
    reasons: declaration.reasons,
    declaredAt: declaration.declaredAt.toISOString(),
    canProceedToPayment: declaration.decision === 'ELIGIBLE',
  };
}

export function toPolicyView(policy: Policy): PolicyView {
  return {
    id: policy.id,
    policyNumber: policy.policyNumber,
    planCode: policy.planCode,
    premiumPaid: formatMoney(policy.premiumPaid),
    currency: policy.currency,
    paymentReference: policy.paymentReference,
    issuedAt: policy.issuedAt.toISOString(),
    coverStart: policy.coverStart.toISOString(),
    coverEnd: policy.coverEnd.toISOString(),
  };
}
