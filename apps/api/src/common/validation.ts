import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * One definition of the global validation behaviour, shared by main.ts and the
 * e2e harness. Duplicating it meant the tests could pass while production ran
 * with different options.
 *
 * `enableImplicitConversion` is deliberately off: it runs Boolean(value) ahead
 * of our own @Transform callbacks, so "false" arrives as true.
 */
export const validationOptions: ValidationPipeOptions = {
  // Reject unknown properties instead of dropping them, so a client cannot
  // smuggle in a field like totalPremium.
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
