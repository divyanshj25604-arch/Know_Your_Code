//! Know Your Code desktop shell (P4.1).
//!
//! A thin native window around the web client. It adds exactly two things the browser cannot do safely:
//!  - remember which cloud API to talk to (a small settings file in the app's config directory: not a secret), and
//!  - keep the session token in the operating system's credential store (Keychain, Credential Manager, Secret
//!    Service), never in a file or in web storage.
//! There is no local backend and no local analysis: every request goes to the cloud API over HTTPS.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;

/// Credential-store service name. Entries are keyed by API origin, so each server has its own session.
const KEYRING_SERVICE: &str = "know-your-code";

/// Servers a release build may connect to, fixed at build time (comma-separated origins). The same list is written
/// into the Content-Security-Policy's connect-src, so the web view cannot reach anything else either.
const ALLOWED_ORIGINS: Option<&str> = option_env!("KYC_DESKTOP_API_ORIGINS");
/// The server offered on first launch.
const DEFAULT_API_URL: Option<&str> = option_env!("KYC_DESKTOP_DEFAULT_API_URL");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    allowed_origins: Vec<String>,
    default_api_url: Option<String>,
    /// Debug builds (`tauri dev`) may use a local http server; release builds may not.
    development: bool,
    version: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    api_url: Option<String>,
}

fn allowed_origins() -> Vec<String> {
    ALLOWED_ORIGINS
        .unwrap_or("")
        .split(',')
        .map(|o| o.trim().trim_end_matches('/').to_ascii_lowercase())
        .filter(|o| !o.is_empty())
        .collect()
}

fn is_local(u: &url::Url) -> bool {
    matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"))
}

/// Validate an API URL and return its normalised form (origin plus optional path, no trailing slash).
fn validate_api_url(raw: &str) -> Result<(String, String), String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "Enter a full address, such as https://api.example.com".to_string())?;
    let dev = cfg!(debug_assertions);
    match u.scheme() {
        "https" => {}
        "http" if dev && is_local(&u) => {}
        "http" => return Err("The server address must use https.".into()),
        _ => return Err("The server address must start with https://".into()),
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("The server address must not contain a user name or password.".into());
    }
    if u.query().is_some() || u.fragment().is_some() {
        return Err("The server address must not contain ? or #.".into());
    }
    let origin = u.origin().ascii_serialization().to_ascii_lowercase();
    if !dev && !allowed_origins().iter().any(|o| o == &origin) {
        return Err(format!("This app is not configured to connect to {origin}."));
    }
    let normalised = format!("{}{}", origin, u.path().trim_end_matches('/'));
    Ok((normalised, origin))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        // A stored URL that this build may no longer use (allowlist changed) is ignored, not trusted.
        .map(|s| Settings { api_url: s.api_url.filter(|u| validate_api_url(u).is_ok()) })
        .unwrap_or_default()
}

fn entry(api_url: &str) -> Result<keyring::Entry, String> {
    let (_, origin) = validate_api_url(api_url)?;
    keyring::Entry::new(KEYRING_SERVICE, &origin).map_err(|e| format!("credential store unavailable: {e}"))
}

/// Session tokens issued by the API: `kyc_st_` + 43 base64url characters. Anything else is refused.
fn well_formed_token(t: &str) -> bool {
    t.len() == 50 && t.starts_with("kyc_st_") && t[7..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[tauri::command]
fn desktop_info(app: tauri::AppHandle) -> DesktopInfo {
    DesktopInfo {
        allowed_origins: allowed_origins(),
        default_api_url: DEFAULT_API_URL.map(str::to_string).filter(|u| validate_api_url(u).is_ok()),
        development: cfg!(debug_assertions),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    read_settings(&app)
}

#[tauri::command]
fn set_api_url(app: tauri::AppHandle, url: String) -> Result<Settings, String> {
    let (normalised, _) = validate_api_url(&url)?;
    let s = Settings { api_url: Some(normalised) };
    let bytes = serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?;
    fs::write(settings_path(&app)?, bytes).map_err(|e| format!("could not save the setting: {e}"))?;
    Ok(s)
}

#[tauri::command]
fn token_get(api_url: String) -> Result<Option<String>, String> {
    match entry(&api_url)?.get_password() {
        Ok(t) if well_formed_token(&t) => Ok(Some(t)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("could not read the saved session: {e}")),
    }
}

#[tauri::command]
fn token_set(api_url: String, token: String) -> Result<(), String> {
    if !well_formed_token(&token) {
        return Err("refusing to store a value that is not a session token".into());
    }
    entry(&api_url)?.set_password(&token).map_err(|e| format!("could not save the session: {e}"))
}

#[tauri::command]
fn token_clear(api_url: String) -> Result<(), String> {
    match entry(&api_url)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not remove the saved session: {e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            get_settings,
            set_api_url,
            token_get,
            token_set,
            token_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running Know Your Code");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_must_have_the_api_shape() {
        assert!(well_formed_token(&format!("kyc_st_{}", "a".repeat(43))));
        assert!(!well_formed_token("kyc_st_short"));
        assert!(!well_formed_token(&format!("ghp_{}", "a".repeat(46))));
        assert!(!well_formed_token(&format!("kyc_st_{}!", "a".repeat(42))));
    }

    #[test]
    fn api_urls_are_validated() {
        assert!(validate_api_url("ftp://example.com").is_err());
        assert!(validate_api_url("https://user:pw@example.com").is_err());
        assert!(validate_api_url("https://example.com/?x=1").is_err());
        assert!(validate_api_url("not a url").is_err());
        // Debug builds (cargo test) accept local http for development; release builds reject http entirely.
        assert_eq!(validate_api_url("http://localhost:8080/").unwrap().1, "http://localhost:8080");
        assert!(validate_api_url("http://example.com").is_err());
        assert_eq!(validate_api_url("https://API.example.com/kyc/").unwrap().0, "https://api.example.com/kyc");
    }
}
