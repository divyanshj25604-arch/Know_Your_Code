import { ERROR_CODES, type ErrorBody } from '@kyc/contracts';
import type { KycError } from '@kyc/core';

/**
 * HTTP delivery of a KycError (the user-safe error type from @kyc/core). The status comes from the shared error
 * catalogue in @kyc/contracts, so the code-to-status mapping lives in exactly one place.
 */
export function httpStatusOf(err: KycError): number {
  return ERROR_CODES[err.code].http;
}

export function errorBody(err: KycError): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      retryable: ERROR_CODES[err.code].retryable,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}
