import { ERROR_CODES, ERROR_MESSAGES, type ErrorBody, type ErrorCode } from '@kyc/contracts';

/** An error whose message is safe to show a user. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? ERROR_MESSAGES[code].message);
    this.name = 'AppError';
  }
  get httpStatus(): number {
    return ERROR_CODES[this.code].http;
  }
  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: ERROR_CODES[this.code].retryable,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
