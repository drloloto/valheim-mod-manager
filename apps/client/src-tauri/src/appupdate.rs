//! App updates when the GitHub repository is private. The updater's `latest.json` and the installers are
//! release assets, and a private repository hands those out only through the API with a token, never
//! through the `releases/download/…` links the manifest carries. With a token the check asks the API for
//! the latest release, points the updater at the manifest's API asset URL and, once the updater has picked
//! the installer, swaps its download URL for the matching asset's API URL. Without a token the updater runs
//! on the configured endpoint as before (a public repository).
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const REPO: &str = "drloloto/valheim-mod-manager";
const MANIFEST: &str = "latest.json";

#[derive(Deserialize, Debug)]
struct Release {
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Asset {
    pub id: u64,
    pub name: String,
}

/// What the UI shows for a pending update.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

pub fn info(u: &Update) -> UpdateInfo {
    UpdateInfo { version: u.version.clone(), body: u.body.clone() }
}

fn asset_url(id: u64) -> Url {
    format!("https://api.github.com/repos/{REPO}/releases/assets/{id}").parse().expect("a well-formed asset URL")
}

/// The API URL of the release asset the updater's download URL names (its last path segment).
pub fn asset_api_url(download_url: &Url, assets: &[Asset]) -> Option<Url> {
    let name = download_url.path_segments()?.rfind(|s| !s.is_empty())?;
    assets.iter().find(|a| a.name == name).map(|a| asset_url(a.id))
}

fn updater_err(e: tauri_plugin_updater::Error) -> AppError {
    AppError::Network(e.to_string())
}

/// Checks for an update: with a token through the GitHub API (private repository), without one on the
/// configured endpoint. The returned update downloads from a URL the token can reach.
pub async fn check(app: &AppHandle, client: &reqwest::Client, token: Option<&str>) -> Result<Option<Update>> {
    let token = token.map(str::trim).filter(|t| !t.is_empty());
    let Some(token) = token else {
        let updater = app.updater_builder().build().map_err(updater_err)?;
        return updater.check().await.map_err(updater_err);
    };
    let res = client
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;
    let status = res.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "GitHub rejected the token",
            404 => "the token has no access to the repository's releases, or there is no release yet",
            _ => "GitHub answered unexpectedly",
        };
        return Err(AppError::Network(format!("{hint} (HTTP {status})")));
    }
    let release: Release = res.json().await?;
    let manifest = release
        .assets
        .iter()
        .find(|a| a.name == MANIFEST)
        .ok_or_else(|| AppError::NotFound(format!("the latest release carries no {MANIFEST}; it was not built by the release workflow")))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![asset_url(manifest.id)])
        .map_err(updater_err)?
        .header("Authorization", format!("Bearer {token}"))
        .map_err(updater_err)?
        // The API returns the asset's bytes (the manifest JSON) only for this media type; the updater
        // sends the same headers for the installer download.
        .header("Accept", "application/octet-stream")
        .map_err(updater_err)?
        .build()
        .map_err(updater_err)?;
    let Some(mut update) = updater.check().await.map_err(updater_err)? else {
        return Ok(None);
    };
    update.download_url = asset_api_url(&update.download_url, &release.assets)
        .ok_or_else(|| AppError::NotFound(format!("the release has no asset named like {}", update.download_url)))?;
    Ok(Some(update))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_download_url_maps_to_the_api_asset_by_file_name() {
        let assets = vec![
            Asset { id: 11, name: "latest.json".into() },
            Asset { id: 12, name: "valheim-mod-manager_0.4.0_x64-setup.exe".into() },
            Asset { id: 13, name: "valheim-mod-manager_0.4.0_x64-setup.exe.sig".into() },
        ];
        let url: Url = "https://github.com/drloloto/valheim-mod-manager/releases/download/v0.4.0/valheim-mod-manager_0.4.0_x64-setup.exe".parse().unwrap();
        assert_eq!(asset_api_url(&url, &assets).unwrap().as_str(), "https://api.github.com/repos/drloloto/valheim-mod-manager/releases/assets/12");
        let other: Url = "https://github.com/x/y/releases/download/v1/other.msi".parse().unwrap();
        assert!(asset_api_url(&other, &assets).is_none());
    }
}
