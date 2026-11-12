import { ERROR_MESSAGES, type ErrorCode } from '@kyc/contracts';

/**
 * A failure whose code and message are safe to show a user. Core and runtime code throw it; each runtime decides how
 * to deliver it (the cloud server maps `code` to an HTTP status in `server/src/http/errors.ts`). Anything that is not
 * a KycError is an unexpected fault and must be reported generically.
 */
export class KycError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? ERROR_MESSAGES[code].message);
    this.name = 'KycError';
  }
}

export function isKycError(e: unknown): e is KycError {
  return e instanceof KycError;
}
