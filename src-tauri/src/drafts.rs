use crate::{batch::LoadedPr, github::Snapshot, progress};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub path: String,
    pub side: String,
    pub start_line: u32,
    pub line: u32,
    pub body: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub snapshot_id: String,
    pub revision: u64,
    pub comments: Vec<Comment>,
    pub state: String,
    pub batch_id: String,
    pub last_url: Option<String>,
}
impl Default for Draft {
    fn default() -> Self {
        Self {
            snapshot_id: String::new(),
            revision: 0,
            comments: vec![],
            state: "ready".into(),
            batch_id: String::new(),
            last_url: None,
        }
    }
}
pub fn load(path: &Path, key: &str) -> Result<Draft, String> {
    let conn = progress::connect(path).map_err(|e| e.to_string())?;
    read(&conn, key)
}
fn read(conn: &rusqlite::Connection, key: &str) -> Result<Draft, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT payload FROM review_drafts WHERE review_key=?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    value
        .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
        .unwrap_or_else(|| Ok(Draft::default()))
}
fn write(conn: &rusqlite::Connection, key: &str, draft: &Draft) -> Result<(), String> {
    conn.execute("INSERT INTO review_drafts(review_key,payload) VALUES(?1,?2) ON CONFLICT(review_key) DO UPDATE SET payload=excluded.payload", params![key, serde_json::to_string(draft).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn validate(bundle: &LoadedPr, comments: &[Comment]) -> Result<(), String> {
    if comments.len() > 50 || comments.iter().map(|c| c.body.len()).sum::<usize>() > 256 * 1024 {
        return Err("Uma revisão aceita até 50 comentários e 256 KiB de texto.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for c in comments {
        if c.id.is_empty()
            || c.id.len() > 80
            || !ids.insert(&c.id)
            || c.body.trim().is_empty()
            || c.body.len() > 65536
            || !matches!(c.side.as_str(), "LEFT" | "RIGHT")
            || c.start_line == 0
            || c.line < c.start_line
            || c.line - c.start_line > 12000
        {
            return Err("Comentário ou intervalo inválido.".into());
        }
        let file = bundle
            .files
            .get(&c.path)
            .ok_or("Comentários precisam de um arquivo alterado")?;
        if !file.diff.reviewable
            || !crate::comment_range(
                file.diff.patch.as_deref().unwrap_or(""),
                &c.side,
                c.start_line,
                c.line,
            )
        {
            return Err(format!("{}: selecione linhas do mesmo lado dentro do diff. O intervalo inclui linhas fora dos hunks.", c.path));
        }
    }
    Ok(())
}
pub fn save(
    path: &Path,
    snapshot: &Snapshot,
    revision: u64,
    comments: Vec<Comment>,
) -> Result<Draft, String> {
    let mut conn = progress::connect(path).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let old = read(&tx, &snapshot.key)?;
    if old.revision != revision {
        return Err("Rascunhos mudaram em outra janela. Recarregue a lista.".into());
    }
    if old.state != "ready" {
        return Err(
            "Verifique o resultado do envio anterior antes de alterar os rascunhos.".into(),
        );
    }
    if !old.comments.is_empty() && old.snapshot_id != snapshot.id && !comments.is_empty() {
        return Err("Os rascunhos pertencem a outro snapshot. Confira e descarte os antigos antes de comentar nesta versão.".into());
    }
    let next = Draft {
        snapshot_id: snapshot.id.clone(),
        revision: revision + 1,
        comments,
        last_url: old.last_url,
        ..Draft::default()
    };
    write(&tx, &snapshot.key, &next)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(next)
}
pub fn begin(path: &Path, key: &str, revision: u64) -> Result<Draft, String> {
    let mut conn = progress::connect(path).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut draft = read(&tx, key)?;
    if draft.revision != revision || draft.comments.is_empty() || draft.state != "ready" {
        return Err("A lista mudou ou há um envio para verificar. Recarregue os rascunhos.".into());
    }
    draft.batch_id = format!(
        "{:x}",
        Sha256::digest(format!(
            "{key}:{revision}:{:?}",
            std::time::SystemTime::now()
        ))
    );
    draft.state = "sending".into();
    draft.revision += 1;
    write(&tx, key, &draft)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(draft)
}
pub fn finish(
    path: &Path,
    key: &str,
    batch: &str,
    url: Option<String>,
    retry: bool,
) -> Result<Draft, String> {
    let mut conn = progress::connect(path).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut draft = read(&tx, key)?;
    if draft.batch_id != batch || draft.state == "ready" {
        return Err("O estado do envio mudou. Recarregue a lista.".into());
    }
    if let Some(url) = url {
        draft.comments.clear();
        draft.last_url = Some(url);
        draft.state = "ready".into();
    } else {
        draft.state = if retry { "ready" } else { "uncertain" }.into();
    }
    draft.revision += 1;
    write(&tx, key, &draft)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(draft)
}
pub fn payload(snapshot: &Snapshot, draft: &Draft) -> serde_json::Value {
    let comments: Vec<_> = draft
        .comments
        .iter()
        .map(|c| {
            let mut value =
                serde_json::json!({"path":c.path,"side":c.side,"line":c.line,"body":c.body});
            if c.start_line != c.line {
                value["start_line"] = c.start_line.into();
                value["start_side"] = c.side.clone().into();
            }
            value
        })
        .collect();
    serde_json::json!({"commit_id":snapshot.head_sha, "event":"COMMENT", "body":format!("Comentários enviados pelo Lince.\n\n<!-- lince-review:{} -->", draft.batch_id), "comments":comments})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Snapshot {
        serde_json::from_value(serde_json::json!({"id":"one", "key":"acme/repo#1", "url":"https://github.com/acme/repo/pull/1", "repo":"acme/repo", "number":1,"title":"test","author":"a","baseBranch":"main","headBranch":"feature","baseSha":"base","headSha":"head","mergeBase":"base","files":[]})).unwrap()
    }
    fn comment() -> Comment {
        Comment {
            id: "a".into(),
            path: "src/file.rs".into(),
            side: "RIGHT".into(),
            start_line: 4,
            line: 6,
            body: "Rever este trecho".into(),
        }
    }
    #[test]
    fn persists_edits_rejects_stale_writers_and_preserves_drafts_after_push() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let mut snapshot = snapshot();
        // Upgrade a real schema 3 database without losing progress.
        let conn = progress::connect(&path).unwrap();
        conn.execute_batch("DROP TABLE review_drafts; PRAGMA user_version=3;")
            .unwrap();
        drop(conn);
        let saved = save(&path, &snapshot, 0, vec![comment()]).unwrap();
        assert_eq!(load(&path, &snapshot.key).unwrap().comments[0].line, 6);
        assert!(save(&path, &snapshot, 0, vec![]).is_err());
        snapshot.id = "new-head".into();
        assert!(save(&path, &snapshot, saved.revision, vec![comment()]).is_err());
        assert_eq!(load(&path, &snapshot.key).unwrap().snapshot_id, "one");
        assert!(save(&path, &snapshot, saved.revision, vec![])
            .unwrap()
            .comments
            .is_empty());
    }
    #[test]
    fn freezes_batches_and_reconciles_uncertain_publications_without_resending() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let snapshot = snapshot();
        let saved = save(&path, &snapshot, 0, vec![comment()]).unwrap();
        let sending = begin(&path, &snapshot.key, saved.revision).unwrap();
        assert!(begin(&path, &snapshot.key, sending.revision).is_err());
        assert!(save(&path, &snapshot, sending.revision, vec![]).is_err());
        let uncertain = finish(&path, &snapshot.key, &sending.batch_id, None, false).unwrap();
        assert_eq!(uncertain.state, "uncertain");
        assert_eq!(uncertain.comments.len(), 1);
        let published = finish(
            &path,
            &snapshot.key,
            &sending.batch_id,
            Some("https://github.com/review".into()),
            false,
        )
        .unwrap();
        assert!(published.comments.is_empty());
        assert_eq!(published.state, "ready");
        assert!(begin(&path, &snapshot.key, published.revision).is_err());
    }
    #[test]
    fn payload_pins_commit_and_preserves_sides_and_multiline_endpoints() {
        let mut single = comment();
        single.id = "b".into();
        single.side = "LEFT".into();
        single.start_line = 3;
        single.line = 3;
        let draft = Draft {
            comments: vec![comment(), single],
            batch_id: "token".into(),
            ..Draft::default()
        };
        let p = payload(&snapshot(), &draft);
        assert_eq!(p["event"], "COMMENT");
        assert_eq!(p["commit_id"], "head");
        assert_eq!(p["comments"][0]["start_line"], 4);
        assert_eq!(p["comments"][0]["line"], 6);
        assert_eq!(p["comments"][0]["start_side"], "RIGHT");
        assert!(p["comments"][1].get("start_line").is_none());
        assert_eq!(p["comments"][1]["side"], "LEFT");
        assert!(crate::comment_range("@@ -4,3 +4,3 @@\n", "RIGHT", 4, 6));
        assert!(!crate::comment_range(
            "@@ -4,3 +4,3 @@\n@@ -10,2 +10,2 @@\n",
            "RIGHT",
            5,
            10
        ));
        assert!(!crate::comment_range("@@ -0,0 +1,3 @@\n", "LEFT", 1, 1));
    }
}
