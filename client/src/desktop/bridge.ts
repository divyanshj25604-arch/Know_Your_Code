/**
 * The desktop shell's native commands (P4.1, desktop/src-tauri/src/lib.rs), behind an interface so the gate can be
 * tested without Tauri. Only these six commands exist; the capability file grants nothing else.
 */
export interface DesktopInfo {
  /** Cloud API origins this build may connect to (also enforced by the CSP and the native side). */
  allowedOrigins: string[];
  defaultApiUrl: string | null;
  /** A development build (`tauri dev`): local http servers are allowed. */
  development: boolean;
  version: string;
}

export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  getApiUrl(): Promise<string | null>;
  /** Validates and persists the server address; rejects with a user-readable message. */
  setApiUrl(url: string): Promise<string>;
  /** The session token for this server from the OS credential store. */
  getToken(apiUrl: string): Promise<string | null>;
  setToken(apiUrl: string, token: string): Promise<void>;
  clearToken(apiUrl: string): Promise<void>;
}

/** True inside the Tauri shell. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Native errors arrive as strings; make them Errors with the same text. */
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

export async function tauriBridge(): Promise<DesktopBridge> {
  const { invoke } = await import('@tauri-apps/api/core');
  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      throw asError(e);
    }
  };
  return {
    info: () => call<DesktopInfo>('desktop_info'),
    getApiUrl: async () => (await call<{ apiUrl: string | null }>('get_settings')).apiUrl,
    setApiUrl: async (url) => (await call<{ apiUrl: string }>('set_api_url', { url })).apiUrl,
    getToken: (apiUrl) => call<string | null>('token_get', { apiUrl }),
    setToken: (apiUrl, token) => call<void>('token_set', { apiUrl, token }),
    clearToken: (apiUrl) => call<void>('token_clear', { apiUrl }),
  };
}
