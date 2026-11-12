fn main() {
    // Build-time configuration (see desktop/scripts/tauri.mjs). Rebuild when it changes.
    println!("cargo:rerun-if-env-changed=KYC_DESKTOP_API_ORIGINS");
    println!("cargo:rerun-if-env-changed=KYC_DESKTOP_DEFAULT_API_URL");
    // Declaring the app's commands makes each one a permission that must be granted in capabilities/ (least
    // privilege): nothing else is callable from the web view.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_info",
            "get_settings",
            "set_api_url",
            "token_get",
            "token_set",
            "token_clear",
        ]),
    ))
    .expect("failed to run tauri-build");
}
