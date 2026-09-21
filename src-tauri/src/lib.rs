mod batch;
mod discovery;
mod drafts;
mod github;
mod progress;
mod repository;
mod symbols;
mod watches;
use github::{FileDiff, Snapshot};
use std::collections::HashMap;
use tauri::{Manager, State};
#[derive(Clone, serde::Serialize)]
struct LoadingProgress {
    step: String,
    detail: String,
}
use tokio::sync::Mutex;

struct Backend {
    bundles: Mutex<HashMap<String, std::sync::Arc<batch::LoadedPr>>>,
    repository: Mutex<Option<std::sync::Arc<repository::Repository>>>,
    loading: Mutex<()>,
    symbols: Mutex<HashMap<String, std::sync::Arc<symbols::Index>>>,
    disk: Mutex<()>,
    monitor: Mutex<()>,
    draft_sending: Mutex<()>,
    network: tokio::sync::Semaphore,
}
impl Default for Backend {
    fn default() -> Self {
        Self {
            bundles: Mutex::new(HashMap::new()),
            repository: Mutex::new(None),
            loading: Mutex::new(()),
            symbols: Mutex::new(HashMap::new()),
            disk: Mutex::new(()),
            monitor: Mutex::new(()),
            draft_sending: Mutex::new(()),
            network: tokio::sync::Semaphore::new(3),
        }
    }
}
#[tauri::command]
async fn open_pr(
    app: tauri::AppHandle,
    url: String,
    on_progress: tauri::ipc::Channel<LoadingProgress>,
    state: State<'_, Backend>,
) -> Result<Snapshot, String> {
    let report = |step: &str, detail: &str| {
        let _ = on_progress.send(LoadingProgress {
            step: step.into(),
            detail: detail.into(),
        });
    };
    report("github", "Aguardando acesso ao GitHub para consultar a PR.");
    let _loading = state.loading.lock().await;
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    report(
        "github",
        "Buscando informações, commits e lista de arquivos alterados no GitHub.",
    );
    let snapshot = github::open(&url).await?;
    if state.bundles.lock().await.contains_key(&snapshot.id) {
        report(
            "diff",
            "Esta versão já está preparada no cache. Restaurando sua revisão.",
        );
        return Ok(snapshot);
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("repositories");
    let (bundle, repository) =
        repository::prepare_with_progress(snapshot.clone(), &root, &report).await?;
    *state.repository.lock().await = Some(std::sync::Arc::new(repository));
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
            get_repository_index,
            get_code_definitions,
            read_repository_file,
            read_repository_files,
            load_review_drafts,
            save_review_drafts,
            submit_review_drafts,
            check_review_submission,
            load_progress,
            set_focus_mode,
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

#[tauri::command]
async fn get_repository_index(
    snapshot_id: String,
    state: State<'_, Backend>,
) -> Result<serde_json::Value, String> {
    let _loading = state.loading.lock().await;
    if !state.bundles.lock().await.contains_key(&snapshot_id) {
        return Err("Revisão expirada".into());
    }
    let repo = state
        .repository
        .lock()
        .await
        .clone()
        .ok_or("Repositório ainda não carregado")?;
    serde_json::to_value(&repo.index).map_err(|e| e.to_string())
}
#[tauri::command]
async fn read_repository_file(
    snapshot_id: String,
    side: String,
    path: String,
    state: State<'_, Backend>,
) -> Result<repository::Document, String> {
    let repo = {
        let _loading = state.loading.lock().await;
        if !state.bundles.lock().await.contains_key(&snapshot_id) {
            return Err("Revisão expirada".into());
        }
        state
            .repository
            .lock()
            .await
            .clone()
            .ok_or("Repositório ainda não carregado")?
    };
    repository::read(&repo, &side, &path).await
}

fn comment_range(patch: &str, side: &str, start: u32, end: u32) -> bool {
    if start == 0 || end < start || !matches!(side, "LEFT" | "RIGHT") {
        return false;
    }
    patch
        .lines()
        .filter(|line| line.starts_with("@@ "))
        .any(|line| {
            let field = line
                .split_whitespace()
                .nth(if side == "LEFT" { 1 } else { 2 })
                .unwrap_or("");
            let mut parts = field.trim_start_matches(['-', '+']).split(',');
            let first = parts
                .next()
                .and_then(|n| n.parse::<u32>().ok())
                .unwrap_or(0);
            let count = parts
                .next()
                .map_or(Some(1), |n| n.parse::<u32>().ok())
                .unwrap_or(0);
            count > 0 && start >= first && end < first.saturating_add(count)
        })
}
#[cfg(test)]
mod comment_tests {
    use super::*;
    #[test]
    fn validates_line_and_side_inside_hunks() {
        let patch = "@@ -4,2 +4,2 @@\n-old\n+new\n context\n";
        assert!(comment_range(patch, "LEFT", 4, 4));
        assert!(comment_range(patch, "RIGHT", 5, 5));
        assert!(!comment_range(patch, "RIGHT", 3, 3));
        assert!(!comment_range(patch, "LEFT", 6, 6));
    }
}

#[tauri::command]
async fn get_code_definitions(
    snapshot_id: String,
    side: String,
    path: String,
    line: u32,
    column: u32,
    state: State<'_, Backend>,
) -> Result<symbols::Definitions, String> {
    let repo = {
        let _loading = state.loading.lock().await;
        if !state.bundles.lock().await.contains_key(&snapshot_id) {
            return Err("Revisão expirada".into());
        }
        state
            .repository
            .lock()
            .await
            .clone()
            .ok_or("Repositório não carregado")?
    };
    let lang = symbols::language(&path).ok_or("Linguagem sem parser de definições")?;
    // Validate exact snapshot membership before populating a cache.
    let doc = repository::read(&repo, &side, &path).await?;
    let key = format!("{snapshot_id}:{side}:{lang}");
    let index = {
        let mut cache = state.symbols.lock().await;
        if let Some(index) = cache.get(&key) {
            index.clone()
        } else {
            let (docs, warnings) = repository::symbol_documents(&repo, &side, lang).await?;
            let index = std::sync::Arc::new(
                tauri::async_runtime::spawn_blocking(move || symbols::build(lang, docs, warnings))
                    .await
                    .map_err(|e| e.to_string())??,
            );
            // Bound total retained indexes, not just the individual language batch.
            if cache.len() >= 6 {
                cache.clear();
            }
            cache.insert(key, index.clone());
            index
        }
    };
    tauri::async_runtime::spawn_blocking(move || symbols::find(&index, lang, &doc, line, column))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_repository_files(
    snapshot_id: String,
    side: String,
    paths: Vec<String>,
    state: State<'_, Backend>,
) -> Result<Vec<repository::Document>, String> {
    let repo = {
        let _loading = state.loading.lock().await;
        if !state.bundles.lock().await.contains_key(&snapshot_id) {
            return Err("Revisão expirada".into());
        }
        state
            .repository
            .lock()
            .await
            .clone()
            .ok_or("Repositório não carregado")?
    };
    repository::read_many(&repo, &side, &paths).await
}

fn drafts_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3"))
}
async fn draft_bundle(
    state: &Backend,
    snapshot_id: &str,
) -> Result<std::sync::Arc<batch::LoadedPr>, String> {
    state
        .bundles
        .lock()
        .await
        .get(snapshot_id)
        .cloned()
        .ok_or("Revisão expirada".into())
}
#[tauri::command]
async fn load_review_drafts(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    snapshot_id: String,
) -> Result<drafts::Draft, String> {
    let bundle = draft_bundle(&state, &snapshot_id).await?;
    let path = drafts_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || drafts::load(&path, &bundle.snapshot.key))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_review_drafts(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    snapshot_id: String,
    revision: u64,
    comments: Vec<drafts::Comment>,
) -> Result<drafts::Draft, String> {
    let bundle = draft_bundle(&state, &snapshot_id).await?;
    let path = drafts_path(&app)?;
    drafts::validate(&bundle, &comments)?;
    tauri::async_runtime::spawn_blocking(move || {
        drafts::save(&path, &bundle.snapshot, revision, comments)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn submit_review_drafts(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    snapshot_id: String,
    revision: u64,
) -> Result<drafts::Draft, String> {
    let _sending = state.draft_sending.lock().await;
    let bundle = draft_bundle(&state, &snapshot_id).await?;
    let path = drafts_path(&app)?;
    let (db, key) = (path.clone(), bundle.snapshot.key.clone());
    let draft = tauri::async_runtime::spawn_blocking(move || drafts::load(&db, &key))
        .await
        .map_err(|e| e.to_string())??;
    if draft.snapshot_id != snapshot_id || draft.revision != revision {
        return Err(
            "Rascunhos de outra versão ou lista alterada. Recarregue e confira a revisão.".into(),
        );
    }
    drafts::validate(&bundle, &draft.comments)?;
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    github::ensure_current(&bundle.snapshot).await?;
    let (db, key) = (path.clone(), bundle.snapshot.key.clone());
    let sending = tauri::async_runtime::spawn_blocking(move || drafts::begin(&db, &key, revision))
        .await
        .map_err(|e| e.to_string())??;
    let result = github::request(
        &format!(
            "repos/{}/pulls/{}/reviews",
            bundle.snapshot.repo, bundle.snapshot.number
        ),
        Some(drafts::payload(&bundle.snapshot, &sending)),
    )
    .await;
    let key = bundle.snapshot.key.clone();
    match result {
        Ok(value) if value["html_url"].is_string() && value["state"] == "COMMENTED" => {
            let url = value["html_url"].as_str().unwrap().to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                drafts::finish(&path, &key, &sending.batch_id, Some(url), false)
            })
            .await
            .map_err(|e| e.to_string())?
        }
        result => {
            let error = result
                .err()
                .unwrap_or_else(|| "Resposta de envio inesperada".into());
            // A definite rejection is safe to retry. Timeouts/disconnects are not.
            let rejected = [
                "HTTP 422",
                "HTTP 403",
                "HTTP 400",
                "Autenticação indisponível",
                "PR ou conteúdo não encontrado",
                "GitHub CLI não encontrado",
            ]
            .iter()
            .any(|s| error.contains(s));
            tauri::async_runtime::spawn_blocking(move || {
                drafts::finish(&path, &key, &sending.batch_id, None, rejected)
            })
            .await
            .map_err(|e| e.to_string())??;
            Err(if rejected {
                error
            } else {
                format!("O envio ficou sem confirmação. Use Verificar envio antes de tentar novamente. {error}")
            })
        }
    }
}
#[tauri::command]
async fn check_review_submission(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    snapshot_id: String,
    allow_retry: bool,
) -> Result<drafts::Draft, String> {
    let _sending = state.draft_sending.lock().await;
    let bundle = draft_bundle(&state, &snapshot_id).await?;
    let path = drafts_path(&app)?;
    let (db, key) = (path.clone(), bundle.snapshot.key.clone());
    let draft = tauri::async_runtime::spawn_blocking(move || drafts::load(&db, &key))
        .await
        .map_err(|e| e.to_string())??;
    if draft.state == "ready" {
        return Ok(draft);
    }
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    let url = github::find_review(&bundle.snapshot, &draft.batch_id).await?;
    if url.is_none() && !allow_retry {
        return Err("Envio ainda não encontrado no GitHub. Aguarde e verifique novamente. Se confirmar na PR que nada foi publicado, libere uma nova tentativa.".into());
    }
    let key = bundle.snapshot.key.clone();
    tauri::async_runtime::spawn_blocking(move || {
        drafts::finish(&path, &key, &draft.batch_id, url, allow_retry)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_focus_mode(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    enabled: bool,
) -> Result<(), String> {
    let _guard = state.disk.lock().await;
    let path = drafts_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || progress::set_focus_mode(&path, enabled))
        .await
        .map_err(|e| e.to_string())?
}
