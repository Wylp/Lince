use crate::{github, progress, Backend};
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize, Clone)]
pub struct Watch {
    pub account: String,
    pub repo: String,
    pub last_seen: u64,
}
#[derive(Serialize, Clone, Default)]
pub struct PollStatus {
    pub checked: usize,
    pub notified: usize,
    pub errors: Vec<String>,
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lince.sqlite3"))
}
async fn account() -> Result<String, String> {
    github::api("user").await?["login"]
        .as_str()
        .map(str::to_owned)
        .ok_or("Conta GitHub indisponível.".into())
}
pub async fn list(app: &tauri::AppHandle) -> Result<Vec<Watch>, String> {
    let path = path(app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let read = || -> progress::DbResult<Vec<Watch>> {
            let conn = progress::connect(&path)?;
            let mut stmt =
                conn.prepare("SELECT account,repo,last_seen FROM watched_repos ORDER BY repo")?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(Watch {
                        account: r.get(0)?,
                        repo: r.get(1)?,
                        last_seen: r.get::<_, i64>(2)? as u64,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        };
        read().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
async fn save(
    app: &tauri::AppHandle,
    account: String,
    repo: String,
    number: Option<u64>,
    insert: bool,
) -> Result<(), String> {
    let path = path(app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let write=||->progress::DbResult<()> {
            let conn=progress::connect(&path)?;
            match number {
                None=>{conn.execute("DELETE FROM watched_repos WHERE account=?1 AND repo=?2",params![account,repo])?;},
                Some(n) if insert=>{conn.execute("INSERT INTO watched_repos VALUES(?1,?2,?3) ON CONFLICT(account,repo) DO NOTHING",params![account,repo,i64::try_from(n)?])?;},
                Some(n)=>{conn.execute("UPDATE watched_repos SET last_seen=MAX(last_seen,?3) WHERE account=?1 AND repo=?2",params![account,repo,i64::try_from(n)?])?;}
            } Ok(())
        };write().map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}
pub async fn set(app: &tauri::AppHandle, repo: String, enabled: bool) -> Result<(), String> {
    github::parse_url(&format!("https://github.com/{repo}/pull/1"))?;
    let state = app.state::<Backend>();
    let _guard = state.monitor.lock().await;
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    let account = account().await?;
    if !enabled {
        return save(app, account, repo, None, false).await;
    }
    let watches = list(app).await?;
    if watches
        .iter()
        .any(|w| w.account == account && w.repo == repo)
    {
        return Ok(());
    }
    if watches.iter().filter(|w| w.account == account).count() >= 20 {
        return Err("Limite de 20 repositórios acompanhados por conta.".into());
    }
    let data = github::api(&format!(
        "repos/{repo}/pulls?state=all&sort=created&direction=desc&per_page=1"
    ))
    .await?;
    let rows = data
        .as_array()
        .ok_or("Resposta inválida ao ativar alertas.")?;
    let latest = rows
        .first()
        .map(|r| r["number"].as_u64().ok_or("PR sem número"))
        .transpose()?
        .unwrap_or(0);
    save(app, account, repo, Some(latest), true).await
}
fn scan(rows: &[Value], since: u64) -> Result<(u64, Vec<String>, bool), String> {
    let mut max = since;
    let mut titles = Vec::new();
    let mut reached = false;
    for row in rows {
        let n = row["number"].as_u64().ok_or("PR sem número")?;
        if n <= since {
            reached = true;
            continue;
        }
        max = max.max(n);
        if row["state"] == "open" {
            titles.push(format!(
                "#{n} {}",
                row["title"].as_str().ok_or("PR sem título")?
            ));
        }
    }
    Ok((max, titles, reached))
}
async fn changes(w: &Watch) -> Result<(u64, Vec<String>), String> {
    let mut latest = w.last_seen;
    let mut titles = Vec::new();
    for page in 1..=30 {
        let data = github::api(&format!(
            "repos/{}/pulls?state=all&sort=created&direction=desc&per_page=100&page={page}",
            w.repo
        ))
        .await?;
        let rows = data.as_array().ok_or("Lista de PRs inválida")?;
        let (max, batch, reached) = scan(rows, w.last_seen)?;
        latest = latest.max(max);
        titles.extend(batch);
        if reached || rows.len() < 100 {
            return Ok((latest, titles));
        }
    }
    Err("Mais de 3.000 PRs desde a última consulta. Desative e reative os alertas para definir um novo ponto de partida.".into())
}
pub async fn poll(app: &tauri::AppHandle) -> Result<PollStatus, String> {
    let state = app.state::<Backend>();
    let _guard = state.monitor.lock().await;
    let watches = list(app).await?;
    if watches.is_empty() {
        return Ok(PollStatus::default());
    }
    let _permit = state.network.acquire().await.map_err(|e| e.to_string())?;
    let account = account().await?;
    let mut status = PollStatus::default();
    for w in watches.into_iter().filter(|w| w.account == account) {
        let result = async {
            let (latest, titles) = changes(&w).await?;
            if !titles.is_empty() {
                app.notification()
                    .builder()
                    .title(format!("{} · {} nova(s) PR(s)", w.repo, titles.len()))
                    .body(
                        titles
                            .iter()
                            .take(3)
                            .cloned()
                            .collect::<Vec<_>>()
                            .join("\n"),
                    )
                    .show()
                    .map_err(|e| e.to_string())?;
                status.notified += titles.len();
            }
            save(app, account.clone(), w.repo.clone(), Some(latest), false).await?;
            status.checked += 1;
            Ok::<_, String>(())
        }
        .await;
        if let Err(e) = result {
            status.errors.push(format!("{}: {e}", w.repo));
        }
    }
    Ok(status)
}
pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            let status = match poll(&app).await {
                Ok(s) => s,
                Err(e) => PollStatus {
                    errors: vec![e],
                    ..Default::default()
                },
            };
            let _ = app.emit("watch-status", status);
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_new_open_prs_notify_but_closed_prs_advance_cursor() {
        let rows = serde_json::json!([{"number":15,"state":"closed"},{"number":14,"state":"open","title":"new"},{"number":10,"state":"open","title":"old"}]);
        let (max, titles, done) = scan(rows.as_array().unwrap(), 10).unwrap();
        assert_eq!(max, 15);
        assert_eq!(titles, vec!["#14 new"]);
        assert!(done);
        assert!(scan(rows.as_array().unwrap(), 15).unwrap().1.is_empty());
    }
}
