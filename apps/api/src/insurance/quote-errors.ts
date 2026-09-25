import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';

/**
 * The two quote errors that are raised from several places. They were
 * hand-built at every call site, which had already produced two different
 * wordings for the same condition.
 */

export function quoteNotFound(): NotFoundException {
  return new NotFoundException({ error: 'QUOTE_NOT_FOUND', message: 'No such quote.' });
}

export function quoteExpired(): GoneException {
  return new GoneException({
    error: 'QUOTE_EXPIRED',
    message: 'This quote has expired. Please recalculate your premium.',
  });
}

export function invalidQuoteState(status: string): ConflictException {
  return new ConflictException({
    error: 'INVALID_QUOTE_STATE',
    message: `This quote is ${status} and can no longer be paid for.`,
  });
}

/** True when the lock window has closed. One definition, used everywhere. */
export function hasExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
