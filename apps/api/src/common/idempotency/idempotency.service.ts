import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, IdempotencyState } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Caller should carry on and do the real work. */
export interface ProceedOutcome {
  kind: 'PROCEED';
}

/** A previous request with this key already finished; return its response. */
export interface ReplayOutcome {
  kind: 'REPLAY';
  status: number;
  body: unknown;
}

export type IdempotencyOutcome = ProceedOutcome | ReplayOutcome;

/**
 * What happened to the key on a failed request. Sent back in the error body so
 * the client does not have to keep its own copy of these rules:
 *
 *   released  - the key is free, retry with it
 *   held      - another request owns it, wait rather than mint a new one
 *   completed - the answer is stored, a new key is needed for a new attempt
 *   invalid   - the key was used for a different payload
 */
export type KeyDisposition = 'released' | 'held' | 'completed' | 'invalid';

/** Prisma client or an open transaction - `complete()` accepts either. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Idempotency for mutating endpoints, keyed on the Idempotency-Key header.
 * The contract is Stripe's:
 *
 *   1. begin() inserts an IN_PROGRESS row before any side effect. The primary
 *      key is the lock - two double-clicks race on the INSERT, one wins.
 *   2. The loser reads the row: COMPLETED replays the stored response,
 *      IN_PROGRESS means the original is still running, so 409.
 *   3. complete() stores the final status and body, declines included, so a
 *      retry gets the same answer instead of re-hitting the issuer.
 *   4. release() deletes the row after a retryable infrastructure failure.
 *
 * Reusing a key with a different payload is a 422 - that is a client bug, and
 * returning the first response would hide it.
 *
 * TODO: nothing prunes these rows. Needs a TTL sweep before this goes near
 * production, or the table grows for ever.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Stable fingerprint of a request body, insensitive to key ordering. */
  static fingerprint(payload: unknown): string {
    return createHash('sha256').update(canonicalise(payload)).digest('hex');
  }

  async begin(key: string, endpoint: string, payload: unknown): Promise<IdempotencyOutcome> {
    const requestHash = IdempotencyService.fingerprint(payload);

    // Bounded, because the insert can lose the race to a request that then
    // releases the key before we read the row. Two goes is plenty in practice;
    // an unbounded recursion here would be a stack overflow under load.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: { key, endpoint, requestHash, state: IdempotencyState.IN_PROGRESS },
        });
        return { kind: 'PROCEED' };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }

      const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
      if (!existing) {
        // The winner released the key between our INSERT and this read, so
        // this is now a fresh attempt. Try to claim it again.
        continue;
      }

      if (existing.requestHash !== requestHash || existing.endpoint !== endpoint) {
        throw new UnprocessableEntityException({
          error: 'IDEMPOTENCY_KEY_REUSED',
          message:
            'This Idempotency-Key was already used with a different request payload. Generate a new key for a new request.',
          keyDisposition: 'invalid' satisfies KeyDisposition,
        });
      }

      if (existing.state === IdempotencyState.IN_PROGRESS) {
        this.logger.warn('Rejected a concurrent request on an in-flight idempotency key');
        throw new ConflictException({
          error: 'REQUEST_IN_PROGRESS',
          message: 'An identical request is already being processed. Please wait for it to finish.',
          keyDisposition: 'held' satisfies KeyDisposition,
        });
      }

      return {
        kind: 'REPLAY',
        status: existing.responseStatus ?? 200,
        body: existing.responseBody,
      };
    }

    // Three lost races in a row means something is hammering this key.
    throw new ConflictException({
      error: 'REQUEST_IN_PROGRESS',
      message: 'An identical request is already being processed. Please wait for it to finish.',
      keyDisposition: 'held' satisfies KeyDisposition,
    });
  }

  /**
   * Persist the terminal response so replays are byte-identical.
   *
   * `db` lets the caller pass an open transaction. On the success path that is
   * the point: if the bookkeeping is committed with the policy, there is no
   * window where the money moved, the policy exists, and the key still looks
   * free to retry.
   */
  async complete(
    key: string,
    status: number,
    body: unknown,
    options: { quoteId?: string; db?: Db } = {},
  ): Promise<void> {
    const db = options.db ?? this.prisma;

    await db.idempotencyRecord.update({
      where: { key },
      data: {
        state: IdempotencyState.COMPLETED,
        responseStatus: status,
        responseBody: body as Prisma.InputJsonValue,
        completedAt: new Date(),
        // Only ever a quote we actually read. Writing an unvalidated id here
        // violates the foreign key and wedges the record as IN_PROGRESS.
        quoteId: options.quoteId ?? null,
      },
    });
  }

  /**
   * Durable note that money has moved under this key, written before the
   * issuance transaction opens. If the process dies in that window this row is
   * the only thing linking the key to a charge that needs reconciling.
   */
  async recordCharge(key: string, chargeReference: string): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { key },
      data: { chargeReference },
    });
  }

  /** Free the key after a retryable failure so the client can try again. */
  async release(key: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({
      where: { key, state: IdempotencyState.IN_PROGRESS },
    });
  }
}

/** Deterministic JSON: object keys sorted recursively before hashing. */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);
  return `{${entries.join(',')}}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
