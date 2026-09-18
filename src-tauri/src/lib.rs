mod batch;
mod discovery;
mod github;
mod progress;
mod watches;
use github::{FileDiff, Snapshot};
use std::collections::HashMap;
use tauri::{Manager, State};
use tokio::sync::Mutex;

struct Backend {
    bundles: Mutex<HashMap<String, std::sync::Arc<batch::LoadedPr>>>,
    loading: Mutex<()>,
    disk: Mutex<()>,
    monitor: Mutex<()>,
    network: tokio::sync::Semaphore,
}
impl Default for Backend {
    fn default() -> Self {
        Self {
            bundles: Mutex::new(HashMap::new()),
            loading: Mutex::new(()),
            disk: Mutex::new(()),
            monitor: Mutex::new(()),
            network: tokio::sync::Semaphore::new(3),
        }
    }
}
#[tauri::command]
async fn open_pr(url: String, state: State<'_, Backend>) -> Result<Snapshot, String> {
    let _loading = state.loading.lock().await;
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    let snapshot = github::open(&url).await?;
    if state.bundles.lock().await.contains_key(&snapshot.id) {
        return Ok(snapshot);
    }
    let bundle = batch::load(snapshot.clone()).await?;
    let mut cache = state.bundles.lock().await;
    cache.clear();
    cache.insert(snapshot.id.clone(), std::sync::Arc::new(bundle));
    Ok(snapshot)
}
#[tauri::command]
async fn get_diff(
    snapshot_id: String,
    path: String,
    state: State<'_, Backend>,
) -> Result<FileDiff, String> {
    let cache = state.bundles.lock().await;
    let bundle = cache
        .get(&snapshot_id)
        .ok_or("Revisão expirada. Abra a PR novamente.")?;
    bundle
        .files
        .get(&path)
        .map(|f| f.diff.clone())
        .ok_or("Arquivo não pertence à revisão.".into())
}
#[tauri::command]
async fn get_pr_files(
    snapshot_id: String,
    state: State<'_, Backend>,
) -> Result<std::sync::Arc<batch::LoadedPr>, String> {
    let cache = state.bundles.lock().await;
    let bundle = cache
        .get(&snapshot_id)
        .ok_or("Revisão expirada. Abra a PR novamente.")?;
    Ok(bundle.clone())
}
#[tauri::command]
async fn load_progress(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<progress::Store, String> {
    let _guard = state.disk.lock().await;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3");
    tauri::async_runtime::spawn_blocking(move || progress::load(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_progress(
    url: String,
    key: String,
    review: progress::ReviewProgress,
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<(), String> {
    let (repo, number) = github::parse_url(&url)?;
    if key != format!("{repo}#{number}") || review.files.len() > 3000 {
        return Err("Progresso inválido.".into());
    }
    if review
        .files
        .values()
        .any(|p| !p.top.is_finite() || !p.left.is_finite() || p.top < 0.0 || p.left < 0.0)
    {
        return Err("Posição de leitura inválida.".into());
    }
    let _guard = state.disk.lock().await;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3");
    tauri::async_runtime::spawn_blocking(move || progress::save_review(&path, &url, &key, &review))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_auth_status() -> github::AuthStatus {
    github::auth_status().await
}

#[tauri::command]
async fn list_repositories(
    page: u32,
    state: State<'_, Backend>,
) -> Result<discovery::Repositories, String> {
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    discovery::repositories(page).await
}
#[tauri::command]
async fn list_pull_requests(
    repo: String,
    page: u32,
    author: Option<String>,
    state: State<'_, Backend>,
) -> Result<discovery::PullRequests, String> {
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    discovery::pull_requests(&repo, page, author.as_deref()).await
}
#[tauri::command]
async fn get_repo_activity(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<Vec<progress::RepoActivity>, String> {
    let _guard = state.disk.lock().await;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3");
    tauri::async_runtime::spawn_blocking(move || progress::repo_activity(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_review_history(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<Vec<progress::ReviewHistory>, String> {
    let _guard = state.disk.lock().await;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3");
    tauri::async_runtime::spawn_blocking(move || progress::review_history(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_repo_configs(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<Vec<progress::RepoConfig>, String> {
    let _guard = state.disk.lock().await;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3");
    tauri::async_runtime::spawn_blocking(move || progress::configs(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_repo_config(
    config: progress::RepoConfig,
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<(), String> {
    let _guard = state.disk.lock().await;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3");
    tauri::async_runtime::spawn_blocking(move || progress::save_config(&path, &config))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_service_labels(
    repo: String,
    number: u64,
    head_sha: String,
    base_sha: String,
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<discovery::ServiceLabels, String> {
    let configs = {
        let _guard = state.disk.lock().await;
        let path = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("lince.sqlite3");
        tauri::async_runtime::spawn_blocking(move || progress::configs(&path))
            .await
            .map_err(|e| e.to_string())??
    };
    let config = configs
        .iter()
        .find(|c| c.repo == repo && c.monorepo)
        .ok_or("Monorepo não configurado.")?;
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    discovery::service_labels(&repo, number, &head_sha, &base_sha, &config.codebases).await
}

#[tauri::command]
fn updates_enabled(app: tauri::AppHandle) -> bool {
    !cfg!(debug_assertions)
        && app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|config| config.get("endpoints"))
            .and_then(serde_json::Value::as_array)
            .is_some_and(|endpoints| !endpoints.is_empty())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Backend::default())
        .setup(|_app| {
            watches::start(_app.handle().clone());
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = _app.get_webview_window("main") {
                window.set_decorations(false)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            updates_enabled,
            list_watches,
            set_watch,
            poll_watches,
            get_repo_configs,
            save_repo_config,
            get_service_labels,
            list_repositories,
            list_pull_requests,
            get_repo_activity,
            get_review_history,
            get_auth_status,
            open_pr,
            get_diff,
            get_pr_files,
            load_progress,
            save_progress
        ])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar Lince");
}

#[tauri::command]
async fn list_watches(app: tauri::AppHandle) -> Result<Vec<watches::Watch>, String> {
    watches::list(&app).await
}
#[tauri::command]
async fn set_watch(app: tauri::AppHandle, repo: String, enabled: bool) -> Result<(), String> {
    watches::set(&app, repo, enabled).await
}
#[tauri::command]
async fn poll_watches(app: tauri::AppHandle) -> Result<watches::PollStatus, String> {
    watches::poll(&app).await
}
