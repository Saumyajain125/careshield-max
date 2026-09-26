import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { validationOptions } from '../src/common/validation';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MockPaymentClient } from '../src/payments/mock-payment.client';

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  payments: MockPaymentClient;
  close: () => Promise<void>;
}

/** Boots the real app against the real database, with main.ts's global pipes. */
export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  // The same options object main.ts installs, not a copy of it - a copy meant
  // the test asserting the API refuses a client-supplied premium could not
  // catch a regression in the real config.
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    payments: app.get(MockPaymentClient),
    close: async () => {
      await app.close();
    },
  };
}

/** Wipe every table and the payment ledger between test cases. */
export async function resetDatabase(harness: Harness): Promise<void> {
  await harness.prisma
    .$executeRaw`TRUNCATE TABLE idempotency_records, policies, medical_declarations, quotes RESTART IDENTITY CASCADE`;
  harness.payments.resetLedger();
}

/** Disclosures that underwrite cleanly, for tests about something else. */
export const HEALTHY_DISCLOSURES = {
  smoker: false,
  alcoholUnitsPerWeek: 2,
  heightCm: 175,
  weightKg: 72,
  hospitalisedInLast12Months: false,
  onRegularMedication: false,
  diagnosedConditions: [] as string[],
};
