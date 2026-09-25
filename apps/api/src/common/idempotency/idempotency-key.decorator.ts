import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** RFC-ish bounds: long enough for a UUID, short enough to index cheaply. */
const KEY_PATTERN = /^[A-Za-z0-9_:.-]{8,255}$/;

/**
 * Extracts and validates the Idempotency-Key header, which is mandatory on the
 * money-moving endpoints: a client that has not thought about retries should
 * fail at integration time, not double-charge someone in production.
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;

  if (!key) {
    throw new BadRequestException({
      error: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'An Idempotency-Key header is required for this request.',
    });
  }

  if (!KEY_PATTERN.test(key)) {
    throw new BadRequestException({
      error: 'IDEMPOTENCY_KEY_INVALID',
      message: 'Idempotency-Key must be 8-255 characters of [A-Za-z0-9_:.-]. A UUID v4 is ideal.',
    });
  }

  return key;
});
