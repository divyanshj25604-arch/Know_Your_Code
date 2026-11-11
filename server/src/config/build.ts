/**
 * Replaced with `true` by tsup when the server is bundled for deployment (`define` in tsup.config.ts). Source runs
 * (tsx dev server, Vitest, the E2E harness) leave the identifier undeclared, so the `typeof` guard yields false.
 */
declare const __KYC_BUNDLED__: boolean | undefined;

export const IS_BUNDLED: boolean = typeof __KYC_BUNDLED__ !== 'undefined' && __KYC_BUNDLED__ === true;
