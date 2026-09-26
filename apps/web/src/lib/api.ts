import 'server-only';

// Server-side client for the NestJS API. Every call goes through a Server
// Action, so the browser never talks to the API directly and the origin stays
// out of the client bundle.

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** What the API did with the Idempotency-Key it was sent. */
export type KeyDisposition = 'released' | 'held' | 'completed' | 'invalid';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: string[],
    public readonly keyDisposition?: KeyDisposition,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Long enough for the mock gateway, short enough that nobody stares at a spinner. */
const REQUEST_TIMEOUT_MS = 15_000;

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // A quote and a policy are never stale-cacheable.
      cache: 'no-store',
      // Without this a hung API leaves the Server Action pending for ever.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(
      503,
      'API_UNREACHABLE',
      'We could not reach our servers. Please check your connection and try again.',
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      extractCode(payload, response.status),
      extractMessage(payload),
      extractFieldErrors(payload),
      extractKeyDisposition(payload),
    );
  }

  // A truncated 2xx body would otherwise return null as T and blow up in a
  // render - right after the customer's money moved, on the checkout call.
  if (payload === null) {
    throw new ApiError(502, 'MALFORMED_RESPONSE', 'We got an incomplete answer from our servers.');
  }

  return payload as T;
}

/** Nest puts our own `error` code in the body; fall back to the status. */
function extractCode(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error;
  }
  return `HTTP_${status}`;
}

function extractMessage(payload: unknown): string {
  if (isRecord(payload)) {
    if (typeof payload.message === 'string') return payload.message;
    // The ValidationPipe returns `message` as an array of field errors.
    if (Array.isArray(payload.message) && payload.message.length > 0) {
      return 'Please check the highlighted fields and try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

function extractFieldErrors(payload: unknown): string[] | undefined {
  if (isRecord(payload) && Array.isArray(payload.message)) {
    return payload.message.filter((m): m is string => typeof m === 'string');
  }
  return undefined;
}

const DISPOSITIONS = ['released', 'held', 'completed', 'invalid'];

function extractKeyDisposition(payload: unknown): KeyDisposition | undefined {
  if (isRecord(payload) && typeof payload.keyDisposition === 'string') {
    return DISPOSITIONS.includes(payload.keyDisposition)
      ? (payload.keyDisposition as KeyDisposition)
      : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
