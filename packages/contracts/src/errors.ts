export const ERROR_CODES = {
  INVALID_URL: { http: 400, retryable: false },
  INVALID_SELECTION: { http: 400, retryable: false },
  INVALID_REQUEST: { http: 400, retryable: false },
  REPO_NOT_FOUND_OR_PRIVATE: { http: 404, retryable: false },
  FILE_NOT_FOUND: { http: 404, retryable: false },
  NOT_FOUND: { http: 404, retryable: false },
  NOT_OWNER: { http: 403, retryable: false },
  SNAPSHOT_EXPIRED: { http: 410, retryable: false },
  REPO_TOO_LARGE: { http: 413, retryable: false },
  UNSUPPORTED_LANGUAGE: { http: 422, retryable: false },
  RATE_LIMITED: { http: 429, retryable: true },
  GITHUB_RATE_LIMITED: { http: 429, retryable: true },
  BUDGET_EXCEEDED: { http: 402, retryable: true },
  INDEX_FAILED: { http: 500, retryable: true },
  AI_TIMEOUT: { http: 504, retryable: true },
  AI_ERROR: { http: 502, retryable: true },
  AI_BUSY: { http: 503, retryable: true },
  AI_NOT_CONFIGURED: { http: 503, retryable: false },
  SNAPSHOT_NOT_READY: { http: 409, retryable: true },
  SERVICE_UNAVAILABLE: { http: 503, retryable: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> };
}

/** User-facing copy, from docs/05 §17. */
export const ERROR_MESSAGES: Record<ErrorCode, { message: string; action?: string }> = {
  INVALID_URL: {
    message: "That isn't a GitHub repository link.",
    action: 'Paste a link like https://github.com/user/project',
  },
  INVALID_SELECTION: { message: 'Select some code to explain.' },
  INVALID_REQUEST: { message: 'That request was not valid.' },
  REPO_NOT_FOUND_OR_PRIVATE: {
    message: 'We can only open public repositories right now.',
    action: 'Try a sample repository, or make a public copy of your project.',
  },
  FILE_NOT_FOUND: {
    message: "That file isn't in this version of the repo.",
    action: 'Back to the file tree',
  },
  NOT_FOUND: { message: "We couldn't find that." },
  NOT_OWNER: { message: 'Only the browser that imported this repo can delete it.' },
  SNAPSHOT_EXPIRED: { message: "This repo's data was deleted after 7 days.", action: 'Import it again' },
  REPO_TOO_LARGE: { message: 'This repository is over the size limit.', action: 'Try another repository' },
  UNSUPPORTED_LANGUAGE: {
    message: 'No JavaScript/TypeScript files found.',
    action: 'Try another repository',
  },
  RATE_LIMITED: { message: "You're going fast! Try again in a minute.", action: 'Retry' },
  GITHUB_RATE_LIMITED: {
    message: 'GitHub is limiting requests. Try again in a few minutes.',
    action: 'Retry',
  },
  BUDGET_EXCEEDED: {
    message: "We've hit today's free limit. Navigation still works.",
    action: 'Come back tomorrow',
  },
  INDEX_FAILED: { message: 'Analysis failed.', action: 'Retry' },
  AI_TIMEOUT: { message: "The explanation didn't finish.", action: 'Retry' },
  AI_ERROR: { message: "The explanation didn't finish.", action: 'Retry' },
  AI_BUSY: { message: 'Our AI is busy. Please retry.', action: 'Retry' },
  AI_NOT_CONFIGURED: {
    message: 'AI explanations are not configured on this server.',
    action: 'Navigation and verified relations still work.',
  },
  SNAPSHOT_NOT_READY: { message: 'This repository is still being analysed.' },
  SERVICE_UNAVAILABLE: { message: 'Know Your Code is temporarily unavailable.', action: 'Retry' },
};
