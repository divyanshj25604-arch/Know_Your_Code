/**
 * The complete host contract of @kyc/core: the two globals every JavaScript runtime provides (Node, browsers,
 * workers, Deno, Bun). Nothing else from a host is visible to core source; see tsconfig.json.
 */
declare function setTimeout(callback: () => void, ms?: number): unknown;
declare const performance: { now(): number };
