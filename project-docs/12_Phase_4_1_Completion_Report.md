# 12 — Phase 4.1 Completion Report: Tauri Desktop Application

> **Date:** 2026-11-12 · **Branch:** `V1_KYC` (committed; not pushed) · **Scope:** P4.1 in section 7 of [00_Engineering_Decision_Document.md](00_Engineering_Decision_Document.md). Evidence labels follow the document rules: **Verified** (source + named test), **Partially verified**, **Unverified**.

## 1. What was built

A thin Tauri 2 shell (`desktop/`) around the existing React client. The shell has no backend and no analysis code: every request goes to the cloud API over HTTPS. It adds two native capabilities only, both exposed as explicitly granted commands:

| Command | Purpose | Storage |
| --- | --- | --- |
| `desktop_info` | Build-time API allowlist, default server, development flag, version | Compiled into the binary |
| `get_settings`, `set_api_url` | Persist the chosen cloud API URL across restarts (validated natively) | `settings.json` in the OS app-config directory (not a secret) |
| `token_get`, `token_set`, `token_clear` | Session token per API origin | OS credential store via the `keyring` crate: macOS Keychain, Windows Credential Manager, Linux Secret Service |

The client gained a desktop start-up gate (`client/src/desktop/DesktopGate.tsx`) that runs only inside Tauri (`window.__TAURI_INTERNALS__`):

1. **Server**: the saved address, or the build's default. The address is checked against the build allowlist and must answer `/api/v1/health` before it is saved. Unreachable servers produce a clear message that names the host.
2. **Session**: the token from the credential store is checked with `/api/v1/auth/me`. An expired or revoked token is deleted, and the user is asked to sign in.
3. **Sign in / create account**: email and password with `transport: "bearer"`. The token is written to the credential store before the app opens.
4. **Ready**: the app runs with a bearer client (`useApiClient`). Any later `AUTH_REQUIRED` response returns the user to sign-in and deletes the stored token.
5. **Sign out**: the session is revoked on the server, the stored token is deleted, and the query cache is cleared.

The token lives only in memory and in the OS credential store. It is never in `localStorage`, `sessionStorage`, cookies or a file. Desktop builds use hash routes (`App.tsx`). The web build is unchanged: the gate is a separate lazily loaded chunk, and the web client still uses cookies.

## 2. Architecture and security

- **Thin shell, cloud runtime.** Rust code is about 150 lines (`desktop/src-tauri/src/lib.rs`). There is no local runtime, file access, shell, HTTP or opener plugin.
- **Least privilege.** `build.rs` declares the six app commands in an app manifest, which makes each one a permission. `capabilities/main.json` grants exactly those six to the `main` window and nothing else. There is no `core:default` and `withGlobalTauri` is false.
- **Content-Security-Policy.** The base `tauri.conf.json` fails closed: `connect-src ipc: http://ipc.localhost` only. Each build generates `tauri.generated.conf.json` (git-ignored) with `connect-src` extended by exactly the API origins in `KYC_DESKTOP_API_ORIGINS`. `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` and `frame-ancestors 'none'` are set; there is no `unsafe-eval` and no wildcard. `'unsafe-inline'` is allowed for styles only, because CodeMirror injects `<style>` elements, as on the web. `freezePrototype` is on.
- **API URL policy, enforced in three places.**
  - Release builds refuse to build without `KYC_DESKTOP_API_ORIGINS` (https and non-local only), so a release never falls back to localhost.
  - The Rust side refuses to save or use a URL outside the compiled allowlist.
  - The client refuses it before any request, and the CSP blocks it regardless.
  - Debug builds (`tauri dev`) may use `http://localhost`.
- **Server side** (unchanged from P1.6): cross-origin requests are accepted only from `CORS_ALLOWED_ORIGINS`, with bearer tokens only, never cookies, and no anonymous identity is minted. Tauri origins are `tauri://localhost` (macOS, Linux) and `http://tauri.localhost` (Windows); `render.yaml` lists both.
- **No secrets in frontend build variables.** The shell's build-time values (API origins, default URL) are public by design. Signing credentials are read only by the Tauri CLI from the build environment (section 5) and are never committed.
- **Tokens are shape-checked natively.** Only `kyc_st_` plus 43 base64url characters may be stored.

## 3. Files

**Added:**
- `desktop/package.json`
- `desktop/scripts/tauri.mjs` (CLI wrapper) and `desktop/scripts/desktop-config.mjs` (origins, CSP)
- `desktop/tests/config.test.mjs`
- `desktop/assets/icon-source.png` (neutral placeholder; the brand pass will replace it)
- `desktop/src-tauri/`: `Cargo.toml`, `Cargo.lock`, `build.rs`, `src/main.rs`, `src/lib.rs`, `tauri.conf.json`, `capabilities/main.json`, `entitlements.plist`, `icons/*`, `.gitignore`
- `client/src/desktop/bridge.ts`, `client/src/desktop/DesktopGate.tsx` and `DesktopGate.test.tsx`
- `e2e/desktop.spec.ts`

**Modified:**
- `client/src/main.tsx` (desktop entry)
- `client/src/App.tsx` (hash routes inside Tauri)
- `client/src/api/client.ts` (`api` is a live binding replaceable by `useApiClient`)
- `client/src/styles/base.css` (gate styles, email/password inputs)
- `client/package.json` (`build:desktop`; `@tauri-apps/api`)
- `package.json` (the `desktop` workspace; desktop tests in `npm test`)
- `playwright.config.ts` (a second origin for the desktop E2E)
- `server/tests/e2e-server.ts` (allows that origin)
- `.gitignore`, `.prettierignore`, `eslint.config.js` (build outputs)

**Dependencies added:**
- npm: `@tauri-apps/cli` 2.12.4 (desktop dev) and `@tauri-apps/api` 2.12.4 (client).
- Rust: `tauri` 2.12.5, `tauri-build` 2, `keyring` 3.6.3 (native backends per OS), `url` 2, `serde`, `serde_json`.

## 4. Development and build

```bash
# Development: API on http://localhost:8080 (npm run dev). The dev window is served from http://localhost:5173,
# so the API must allow it: CORS_ALLOWED_ORIGINS=http://localhost:5173 in the server's .env.
npm run dev -w @kyc/desktop

# Release build (unsigned unless signing variables are set, section 5):
KYC_DESKTOP_API_ORIGINS=https://api.example.com \
KYC_DESKTOP_DEFAULT_API_URL=https://api.example.com \
npm run build -w @kyc/desktop                 # all targets for the host OS
npm run build -w @kyc/desktop -- --bundles app  # macOS .app only
```

- Several origins (for example staging and production) are comma-separated; the user then picks one on first launch.
- Output is in `desktop/src-tauri/target/release/bundle/`.
- The client is built into `client/dist-desktop` (git-ignored), separate from the web build.
- The bundle identifier `app.knowyourcode.desktop` is a placeholder. Replace it with a reverse-DNS name the organisation controls **before the first signed release**: it keys the keychain service, the config directory and OS signing records, so changing it later orphans users' stored sessions and settings.

## 5. Signing and release (prepared, not executed)

No certificates exist in this repository and none were created. The Tauri CLI reads the following from the build environment, which should be the CI secret store, never a file in the repository.

**macOS (Developer ID, outside the App Store)**

- **Requires:** an Apple Developer Program membership and a *Developer ID Application* certificate exported as `.p12`.
- **Signing:** `APPLE_CERTIFICATE` (the base64 of the `.p12`), `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: Org Name (TEAMID)`).
- **Notarization**, either option:
  - `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`; or
  - an App Store Connect API key: `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`.
- **Entitlements and runtime:** the hardened runtime is on, with `entitlements.plist` granting network client access only.
- **Verify the result:** `codesign --verify --deep --strict "Know Your Code.app"`, `spctl -a -vv "Know Your Code.app"`, and `xcrun stapler validate` on the `.dmg`.

**Windows**

- **Requires:** an OV or EV code-signing certificate. EV certificates normally live on an HSM or token, or use a cloud signing service such as Azure Trusted Signing.
- **Certificate in the Windows store:** set `bundle.windows.certificateThumbprint` in a CI-only config merge. `digestAlgorithm` is `sha256` and `timestampUrl` is pre-set.
- **HSM or cloud signing:** set `bundle.windows.signCommand` to the provider's signing tool instead.
- **Build and verify:** build on Windows (`npm run build -w @kyc/desktop` produces NSIS and MSI installers), then run `signtool verify /pa /v <installer>`.

**Release procedure**

1. Staging smoke passes (`BASE_URL=<staging> npm run smoke`).
2. Set the version in `desktop/src-tauri/tauri.conf.json` and `Cargo.toml`.
3. CI builds macOS (on a macOS runner) and Windows (on a Windows runner), with `KYC_DESKTOP_API_ORIGINS` set to the production origin, and the signing variables above.
4. Verify signatures (commands above), then install on a clean machine and run the manual checklist in section 7.
5. Publish the installers. Publishing is a separate approval; nothing was published.

The exact variable names are those of the Tauri 2 signing guides (`v2.tauri.app/distribute/sign/macos`, `/windows`). They were not re-fetched for this report. Check them against those pages when CI is set up.

## 6. Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Rust unit tests (token shape, URL validation) | 2/2 pass | `cargo test` in `desktop/src-tauri` |
| Build configuration (release needs https origins, CSP contents, base config fails closed, six permissions only, no signing identity committed) | 6/6 pass | `desktop/tests/config.test.mjs` (`npm run test -w @kyc/desktop`) |
| Gate logic (first launch, restore, expired token, mid-session expiry, sign-out revokes and deletes, unreachable server, allowlist) | 6/6 pass | `client/src/desktop/DesktopGate.test.tsx` |
| Browser end-to-end, cross-origin, bearer only: connect, register, import, all four modes, reload restores the session, no token in web storage, sign-out revokes on the server, expired token, unreachable server | 2/2 pass | `e2e/desktop.spec.ts`. The built client is served from a second origin, the real server is used, and Tauri IPC is replaced by a test stand-in |
| macOS release build | Built `Know Your Code.app` (4.0 MiB, unsigned) | `KYC_DESKTOP_API_ORIGINS=https://api.example.com npm run build -w @kyc/desktop -- --bundles app` |
| Native launch | The release binary started and stayed running (checked after 6 s) | Window content was not inspected: this environment denies screen and accessibility access |
| Windows build | Not run | Needs a Windows host |
| Web app unchanged | Full deterministic E2E suite passes | [17_Phase_4_Final_Completion_Report.md](17_Phase_4_Final_Completion_Report.md) |

## 7. Acceptance criteria

| Criterion | Status | Notes |
| --- | --- | --- |
| Desktop app launches | **PASS** | The macOS release build launches and keeps running. Visual check of the window still belongs in the manual checklist |
| Login works against the cloud backend | **BLOCKED** | No cloud deployment exists (P4.2 staging needs Render credentials). The same flow passes in the browser against the real server cross-origin (`e2e/desktop.spec.ts`); the native web view against a deployed API is unverified |
| Session persists securely after restart | **BLOCKED** | Restore logic is verified (gate tests, E2E reload); the native credential store is implemented and compiled but not exercised by an automated test. It needs one interactive run on each OS |
| Repository import/open works through the cloud workflow | **BLOCKED** | Verified against the local API in the browser E2E; awaits a deployed API |
| Project, Learn, Explore and Validate work | **BLOCKED** | Same as above: verified in `e2e/desktop.spec.ts`, not yet in the native window against the cloud |
| Logout removes the session | **BLOCKED** | Server revocation and the `token_clear` call are verified (gate tests, E2E); native keychain deletion is not yet observed |
| Web application continues working | **PASS** | Full web E2E suite, client and server tests |
| Desktop builds and signing instructions are documented | **PASS** | Sections 4–5; the macOS unsigned build was produced |
| Signed macOS and Windows builds | **BLOCKED** | No certificates or Apple/Windows signing accounts; the Windows build needs a Windows host |

**Manual checklist** (one run per OS, once staging exists):

1. Install, launch, connect to staging, and create an account.
2. Import `https://github.com/tj/commander.js` and visit the four modes.
3. Quit and relaunch: you should still be signed in.
4. Check the credential store: Keychain Access shows an item for service `know-your-code` with the staging origin as its account, or on Windows, Credential Manager shows `know-your-code`.
5. Sign out: the item is gone.
6. Relaunch: the sign-in screen appears.

## 8. Limitations

- **Web registration:** the web client still has no sign-in UI (it works anonymously with cookies), so desktop accounts are created in the desktop app. Anonymous web work can be claimed only from a browser (P1.2 behaviour).
- **Default server per build:** the default server is fixed per build. Changing the allowed origins needs a new build, by design.
- **Linux:** a Secret Service provider such as GNOME Keyring or KWallet is required; Linux packages are not part of the acceptance scope.
- **Icon:** the icon is a neutral placeholder until the brand pass ([08_Brand_Identity_Requirements.md](08_Brand_Identity_Requirements.md)).
