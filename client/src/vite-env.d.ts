/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the API is served. Empty (default): same origin as the page. Public: compiled into the bundle. */
  readonly VITE_API_BASE_URL?: string;
  /** "hash" forces hash routes (desktop shells); otherwise they are used only off http(s). */
  readonly VITE_ROUTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
