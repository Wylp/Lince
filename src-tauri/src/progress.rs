use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, time::Duration};

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProgress {
    pub version: String,
    pub reviewed: bool,
    #[serde(default)]
    pub approved_unread: bool,
    pub top: f64,
    pub left: f64,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
pub struct ReviewProgress {
    pub selected: String,
    pub files: BTreeMap<String, FileProgress>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub schema: u32,
    pub last_url: String,
    pub reviews: BTreeMap<String, ReviewProgress>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            schema: 1,
            last_url: String::new(),
            reviews: BTreeMap::new(),
        }
    }
}

pub(crate) type DbResult<T> = Result<T, Box<dyn std::error::Error>>;
const SCHEMA: u32 = 5;

fn legacy(path: &Path) -> DbResult<Store> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let store: Store = serde_json::from_slice(&bytes).map_err(|e| {
                format!(
                    "JSON de progresso inválido em {}. Arquivo preservado: {e}",
                    path.display()
                )
            })?;
            if store.schema != 1 {
                return Err("Versão de progresso JSON não suportada; arquivo preservado.".into());
            }
            Ok(store)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn connect(path: &Path) -> DbResult<Connection> {
    let directory = path.parent().ok_or("Diretório de dados ausente")?;
    std::fs::create_dir_all(directory)?;
    let mut conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    let version: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > SCHEMA {
        return Err("Banco criado por uma versão mais recente do Lince; dados preservados.".into());
    }
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    if version < SCHEMA {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Recheck under the writer lock: another process may have initialized it.
        let locked_version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if locked_version == 0 {
            let old = legacy(&directory.join("progress.json"))?;
            tx.execute_batch(
                "CREATE TABLE app_state (
                key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL
            );
            CREATE TABLE reviews (
                review_key TEXT PRIMARY KEY NOT NULL, selected_path TEXT NOT NULL
            );
            CREATE TABLE file_progress (
                review_key TEXT NOT NULL REFERENCES reviews(review_key) ON DELETE CASCADE,
                path TEXT NOT NULL, version TEXT NOT NULL,
                reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1)),
                approved_unread INTEGER NOT NULL DEFAULT 0 CHECK(approved_unread IN (0,1)),
                scroll_top REAL NOT NULL CHECK(scroll_top >= 0),
                scroll_left REAL NOT NULL CHECK(scroll_left >= 0),
                PRIMARY KEY(review_key, path)
            );",
            )?;
            for (key, review) in &old.reviews {
                write_review(&tx, key, review)?;
            }
            write_last_url(&tx, &old.last_url)?;
            tx.pragma_update(None, "user_version", 1)?;
        } else if locked_version > SCHEMA {
            return Err("Schema do banco não suportado; dados preservados.".into());
        }
        if locked_version < 2 {
            tx.execute_batch("CREATE TABLE review_activity (
                review_key TEXT NOT NULL, repo TEXT NOT NULL, day INTEGER NOT NULL,
                last_reviewed_at INTEGER NOT NULL, PRIMARY KEY(review_key, day)
            ); CREATE INDEX review_activity_repo ON review_activity(repo);
            CREATE TABLE repository_config(repo TEXT PRIMARY KEY NOT NULL, monorepo INTEGER NOT NULL CHECK(monorepo IN (0,1)));
            CREATE TABLE codebases(repo TEXT NOT NULL REFERENCES repository_config(repo) ON DELETE CASCADE,
                path TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(repo,path));
            INSERT INTO review_activity(review_key,repo,day,last_reviewed_at)
            SELECT review_key,substr(review_key,1,instr(review_key,'#')-1),0,0
            FROM file_progress WHERE reviewed=1 AND instr(review_key,'#')>1 GROUP BY review_key;")?;
            tx.pragma_update(None, "user_version", SCHEMA)?;
        }
        if locked_version < 3 {
            tx.execute_batch("CREATE TABLE watched_repos(account TEXT NOT NULL,repo TEXT NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(account,repo));")?;
        }
        if locked_version < 4 {
            tx.execute_batch("CREATE TABLE IF NOT EXISTS review_drafts(review_key TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL);")?;
        }
        if locked_version > 0 && locked_version < 5 {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('file_progress') WHERE name='approved_unread')", [], |r| r.get(0))?;
            if !exists {
                tx.execute_batch("ALTER TABLE file_progress ADD COLUMN approved_unread INTEGER NOT NULL DEFAULT 0 CHECK(approved_unread IN (0,1));")?;
            }
        }
        tx.pragma_update(None, "user_version", SCHEMA)?;
        tx.commit()?;
    }
    Ok(conn)
}

fn write_last_url(tx: &Transaction<'_>, url: &str) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO app_state(key,value) VALUES('last_url',?1)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value != excluded.value",
        [url],
    )?;
    Ok(())
}
fn write_review(tx: &Transaction<'_>, key: &str, review: &ReviewProgress) -> DbResult<()> {
    tx.execute(
        "INSERT INTO reviews(review_key,selected_path) VALUES(?1,?2)
        ON CONFLICT(review_key) DO UPDATE SET selected_path=excluded.selected_path
        WHERE selected_path != excluded.selected_path",
        params![key, review.selected],
    )?;
    {
        let mut upsert = tx.prepare_cached("INSERT INTO file_progress(review_key,path,version,reviewed,scroll_top,scroll_left,approved_unread)
            VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(review_key,path) DO UPDATE SET
            version=excluded.version,reviewed=excluded.reviewed,scroll_top=excluded.scroll_top,scroll_left=excluded.scroll_left,approved_unread=excluded.approved_unread
            WHERE version != excluded.version OR reviewed != excluded.reviewed OR approved_unread != excluded.approved_unread
                OR scroll_top != excluded.scroll_top OR scroll_left != excluded.scroll_left")?;
        for (path, file) in &review.files {
            if !file.top.is_finite() || !file.left.is_finite() || file.top < 0.0 || file.left < 0.0
            {
                return Err("Posição de leitura inválida.".into());
            }
            if file.reviewed && file.approved_unread {
                return Err(
                    "Um arquivo não pode estar visto e aprovado sem leitura ao mesmo tempo.".into(),
                );
            }
            upsert.execute(params![
                key,
                path,
                file.version,
                file.reviewed,
                file.top,
                file.left,
                file.approved_unread
            ])?;
        }
    }
    let existing = tx
        .prepare("SELECT path FROM file_progress WHERE review_key=?1")?
        .query_map([key], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for path in existing {
        if !review.files.contains_key(&path) {
            tx.execute(
                "DELETE FROM file_progress WHERE review_key=?1 AND path=?2",
                params![key, path],
            )?;
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Store, String> {
    let read = || -> DbResult<Store> {
        let mut conn = connect(path)?;
        // One consistent snapshot for settings, reviews and file progress.
        let tx = conn.transaction()?;
        let last_url = tx
            .query_row(
                "SELECT value FROM app_state WHERE key='last_url'",
                [],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or_default();
        let mut store = Store {
            last_url,
            ..Store::default()
        };
        {
            let mut statement = tx.prepare("SELECT review_key, selected_path FROM reviews")?;
            for row in
                statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            {
                let (key, selected) = row?;
                store.reviews.insert(
                    key,
                    ReviewProgress {
                        selected,
                        files: BTreeMap::new(),
                    },
                );
            }
            let mut statement = tx.prepare(
                "SELECT review_key,path,version,reviewed,scroll_top,scroll_left,approved_unread FROM file_progress",
            )?;
            for row in statement.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    FileProgress {
                        version: r.get(2)?,
                        reviewed: r.get(3)?,
                        top: r.get(4)?,
                        left: r.get(5)?,
                        approved_unread: r.get(6)?,
                    },
                ))
            })? {
                let (key, path, progress) = row?;
                store
                    .reviews
                    .get_mut(&key)
                    .ok_or("Arquivo sem revisão no banco")?
                    .files
                    .insert(path, progress);
            }
        }
        tx.commit()?;
        Ok(store)
    };
    read().map_err(|e| format!("Não foi possível ler o progresso SQLite: {e}"))
}

pub fn save_review(
    path: &Path,
    url: &str,
    key: &str,
    review: &ReviewProgress,
) -> Result<(), String> {
    let write = || -> DbResult<()> {
        let mut conn = connect(path)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        record_review_activity(&tx, key, review)?;
        write_review(&tx, key, review)?;
        write_last_url(&tx, url)?;
        tx.commit()?;
        Ok(())
    };
    write().map_err(|e| format!("Não foi possível salvar o progresso SQLite: {e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoActivity {
    pub repo: String,
    pub sessions: i64,
    pub last_reviewed_at: i64,
    pub score: f64,
}
fn record_review_activity(
    tx: &Transaction<'_>,
    key: &str,
    review: &ReviewProgress,
) -> DbResult<()> {
    let mut statement =
        tx.prepare("SELECT reviewed,version FROM file_progress WHERE review_key=?1 AND path=?2")?;
    let mut newly_reviewed = false;
    for (path, file) in &review.files {
        if !file.reviewed {
            continue;
        }
        let old: Option<(bool, String)> = statement
            .query_row(params![key, path], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if old
            .as_ref()
            .is_none_or(|(reviewed, version)| !reviewed || version != &file.version)
        {
            newly_reviewed = true;
            break;
        }
    }
    if newly_reviewed {
        let repo = key
            .rsplit_once('#')
            .ok_or("Identificador da revisão inválido")?
            .0;
        tx.execute(
            "INSERT INTO review_activity(review_key,repo,day,last_reviewed_at)
            VALUES(?1,?2,unixepoch()/86400,unixepoch()) ON CONFLICT(review_key,day)
            DO UPDATE SET last_reviewed_at=excluded.last_reviewed_at",
            params![key, repo],
        )?;
    }
    Ok(())
}
pub fn repo_activity(path: &Path) -> Result<Vec<RepoActivity>, String> {
    let read = || -> DbResult<Vec<RepoActivity>> {
        let conn = connect(path)?;
        let mut statement = conn.prepare(
            "SELECT repo,COUNT(*),MAX(last_reviewed_at),
            SUM(CASE WHEN last_reviewed_at=0 THEN 0.000001 ELSE 1.0/(1.0+MAX(0,unixepoch()-last_reviewed_at)/604800.0) END)
            FROM review_activity GROUP BY repo",
        )?;
        let rows = statement
            .query_map([], |r| {
                Ok(RepoActivity {
                    repo: r.get(0)?,
                    sessions: r.get(1)?,
                    last_reviewed_at: r.get(2)?,
                    score: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    };
    read().map_err(|e| format!("Não foi possível ler o histórico de revisão: {e}"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Codebase {
    pub path: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RepoConfig {
    pub repo: String,
    pub monorepo: bool,
    pub codebases: Vec<Codebase>,
}
pub fn configs(path: &Path) -> Result<Vec<RepoConfig>, String> {
    let read = || -> DbResult<Vec<RepoConfig>> {
        let mut conn = connect(path)?;
        let tx = conn.transaction()?;
        let rows = tx
            .prepare("SELECT repo,monorepo FROM repository_config")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut configs = Vec::new();
        for (repo, monorepo) in rows {
            let codebases = tx
                .prepare("SELECT path,label FROM codebases WHERE repo=?1 ORDER BY path")?
                .query_map([&repo], |r| {
                    Ok(Codebase {
                        path: r.get(0)?,
                        label: r.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            configs.push(RepoConfig {
                repo,
                monorepo,
                codebases,
            });
        }
        tx.commit()?;
        Ok(configs)
    };
    read().map_err(|e| format!("Falha ao ler codebases: {e}"))
}
pub fn save_config(path: &Path, config: &RepoConfig) -> Result<(), String> {
    if !crate::discovery::valid_repo(&config.repo) || config.codebases.len() > 100 {
        return Err("Configuração de repositório inválida.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for codebase in &config.codebases {
        if codebase.label.trim().is_empty()
            || codebase.label.len() > 80
            || codebase.path.is_empty()
            || codebase.path.len() > 512
            || codebase.path.contains('\\')
            || codebase
                .path
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
            || !seen.insert(&codebase.path)
        {
            return Err(
                "Use caminhos relativos únicos (ex.: apps/api) e nomes de até 80 caracteres."
                    .into(),
            );
        }
    }
    let write = || -> DbResult<()> {
        let mut conn = connect(path)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO repository_config(repo,monorepo) VALUES(?1,?2) ON CONFLICT(repo) DO UPDATE SET monorepo=excluded.monorepo",params![config.repo,config.monorepo])?;
        tx.execute("DELETE FROM codebases WHERE repo=?1", [&config.repo])?;
        for codebase in &config.codebases {
            tx.execute(
                "INSERT INTO codebases(repo,path,label) VALUES(?1,?2,?3)",
                params![config.repo, codebase.path, codebase.label],
            )?;
        }
        tx.commit()?;
        Ok(())
    };
    write().map_err(|e| format!("Falha ao salvar codebases: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn review() -> ReviewProgress {
        ReviewProgress {
            selected: "src/ação's.ts".into(),
            files: BTreeMap::from([(
                "src/ação's.ts".into(),
                FileProgress {
                    version: "v1".into(),
                    reviewed: true,
                    approved_unread: false,
                    top: 321.5,
                    left: 12.0,
                },
            )]),
        }
    }
    #[test]
    fn roundtrip_preserves_other_prs_and_removes_obsolete_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        assert!(load(&path).unwrap().reviews.is_empty());
        save_review(&path, "https://github.com/a/b/pull/1", "a/b#1", &review()).unwrap();
        save_review(&path, "https://github.com/a/b/pull/2", "a/b#2", &review()).unwrap();
        let store = load(&path).unwrap();
        assert_eq!(store.reviews["a/b#1"].files["src/ação's.ts"].top, 321.5);
        assert!(store.reviews["a/b#2"].files["src/ação's.ts"].reviewed);
        save_review(&path, "first", "a/b#1", &ReviewProgress::default()).unwrap();
        let store = load(&path).unwrap();
        assert!(store.reviews["a/b#1"].files.is_empty());
        assert_eq!(store.reviews["a/b#2"].selected, "src/ação's.ts");
        assert_eq!(store.last_url, "first");
    }
    #[test]
    fn imports_json_once_without_deleting_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        let json = dir.path().join("progress.json");
        let legacy = Store {
            last_url: "legacy-url".into(),
            reviews: BTreeMap::from([("a/b#1".into(), review())]),
            ..Store::default()
        };
        let bytes = serde_json::to_vec(&legacy).unwrap();
        std::fs::write(&json, &bytes).unwrap();
        let imported = load(&path).unwrap();
        assert_eq!(imported.last_url, "legacy-url");
        assert!(imported.reviews["a/b#1"].files["src/ação's.ts"].reviewed);
        assert_eq!(std::fs::read(&json).unwrap(), bytes);
        save_review(&path, "new-url", "a/b#1", &ReviewProgress::default()).unwrap();
        assert_eq!(load(&path).unwrap().last_url, "new-url");
        assert!(load(&path).unwrap().reviews["a/b#1"].files.is_empty());
    }
    #[test]
    fn corrupt_legacy_does_not_mark_migration_complete() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        let json = dir.path().join("progress.json");
        std::fs::write(&json, "broken").unwrap();
        assert!(load(&path).is_err());
        assert_eq!(std::fs::read_to_string(&json).unwrap(), "broken");
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            0
        );
        drop(conn);
        std::fs::write(&json, serde_json::to_vec(&Store::default()).unwrap()).unwrap();
        assert!(load(&path).is_ok());
    }
    #[test]
    fn failed_save_rolls_back_selection_files_and_last_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        save_review(&path, "old-url", "a/b#1", &review()).unwrap();
        let mut broken = review();
        broken.selected = "changed".into();
        broken.files.values_mut().next().unwrap().top = f64::NAN;
        assert!(save_review(&path, "new-url", "a/b#1", &broken).is_err());
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.last_url, "old-url");
        assert_eq!(loaded.reviews["a/b#1"].selected, "src/ação's.ts");
        assert_eq!(loaded.reviews["a/b#1"].files["src/ação's.ts"].top, 321.5);
    }
    #[test]
    fn refuses_future_schema_and_corrupt_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);
        assert!(load(&path).unwrap_err().contains("mais recente"));
        let broken = dir.path().join("broken.sqlite3");
        std::fs::write(&broken, b"not sqlite").unwrap();
        assert!(load(&broken).is_err());
        assert_eq!(std::fs::read(&broken).unwrap(), b"not sqlite");
    }
}

#[cfg(test)]
mod discovery_storage_tests {
    use super::*;
    #[test]
    fn activity_ignores_scroll_and_counts_each_pr_once_per_day() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        let mut review = ReviewProgress {
            selected: "a".into(),
            files: BTreeMap::from([(
                "a".into(),
                FileProgress {
                    version: "v1".into(),
                    reviewed: false,
                    approved_unread: false,
                    top: 0.0,
                    left: 0.0,
                },
            )]),
        };
        save_review(
            &path,
            "https://github.com/org/repo/pull/1",
            "org/repo#1",
            &review,
        )
        .unwrap();
        assert!(repo_activity(&path).unwrap().is_empty());
        review.files.get_mut("a").unwrap().reviewed = true;
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        review.files.get_mut("a").unwrap().top = 900.0;
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        review.files.get_mut("a").unwrap().version = "v2".into();
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        let history = repo_activity(&path).unwrap();
        assert_eq!(history[0].sessions, 1);
        assert_eq!(history[0].repo, "org/repo");
        save_review(&path, "url", "org/repo#2", &review).unwrap();
        assert_eq!(repo_activity(&path).unwrap()[0].sessions, 2);
    }
    #[test]
    fn migrates_v1_and_preserves_codebases_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lince.sqlite3");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT);INSERT INTO app_state VALUES('last_url','legacy');CREATE TABLE reviews(review_key TEXT PRIMARY KEY,selected_path TEXT);CREATE TABLE file_progress(review_key TEXT,path TEXT,version TEXT,reviewed INTEGER,scroll_top REAL,scroll_left REAL,PRIMARY KEY(review_key,path));PRAGMA user_version=1;").unwrap();
        drop(conn);
        assert_eq!(load(&path).unwrap().last_url, "legacy");
        let config = RepoConfig {
            repo: "org/mono".into(),
            monorepo: true,
            codebases: vec![Codebase {
                path: "apps/api".into(),
                label: "API".into(),
            }],
        };
        save_config(&path, &config).unwrap();
        let loaded = configs(&path).unwrap();
        assert!(loaded[0].monorepo);
        assert_eq!(loaded[0].codebases[0].path, "apps/api");
        let bad = RepoConfig {
            codebases: vec![Codebase {
                path: "../etc".into(),
                label: "bad".into(),
            }],
            ..config
        };
        assert!(save_config(&path, &bad).is_err());
        assert_eq!(configs(&path).unwrap()[0].codebases[0].label, "API");
        assert_eq!(
            Connection::open(path)
                .unwrap()
                .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            SCHEMA
        );
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewHistory {
    pub key: String,
    pub reviewed: i64,
    pub approved_unread: i64,
    pub total: i64,
    pub last_reviewed_at: Option<i64>,
}

pub fn review_history(path: &Path) -> Result<Vec<ReviewHistory>, String> {
    let read = || -> DbResult<Vec<ReviewHistory>> {
        let conn = connect(path)?;
        let mut query = conn.prepare(
            "SELECT r.review_key,
            COALESCE(f.reviewed,0),COALESCE(f.total,0),NULLIF(a.last_reviewed_at,0),COALESCE(f.approved_unread,0)
            FROM reviews r
            LEFT JOIN (SELECT review_key,SUM(reviewed) reviewed,COUNT(*) total,SUM(approved_unread) approved_unread
                FROM file_progress GROUP BY review_key) f USING(review_key)
            LEFT JOIN (SELECT review_key,MAX(last_reviewed_at) last_reviewed_at
                FROM review_activity GROUP BY review_key) a USING(review_key)
            ORDER BY a.last_reviewed_at DESC,r.review_key",
        )?;
        let rows = query
            .query_map([], |r| {
                Ok(ReviewHistory {
                    key: r.get(0)?,
                    reviewed: r.get(1)?,
                    total: r.get(2)?,
                    last_reviewed_at: r.get(3)?,
                    approved_unread: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    };
    read().map_err(|e| format!("Não foi possível carregar o histórico: {e}"))
}

#[cfg(test)]
mod history_tests {
    use super::*;
    #[test]
    fn v2_upgrade_preserves_reviews_and_separates_watches_by_account() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite3");
        save_review(&path, "url", "org/repo#1", &ReviewProgress::default()).unwrap();
        let conn = connect(&path).unwrap();
        conn.execute_batch("DROP TABLE watched_repos;PRAGMA user_version=2;")
            .unwrap();
        drop(conn);
        let conn = connect(&path).unwrap();
        conn.execute_batch(
            "INSERT INTO watched_repos VALUES('alice','org/repo',10),('bob','org/repo',20);",
        )
        .unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT last_seen FROM watched_repos WHERE account='alice'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            10
        );
        assert_eq!(review_history(&path).unwrap()[0].key, "org/repo#1");
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            SCHEMA
        );
    }
    #[test]
    fn history_includes_unmarked_prs_and_does_not_multiply_files_by_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite3");
        let mut review = ReviewProgress::default();
        review.files.insert(
            "a".into(),
            FileProgress {
                version: "v1".into(),
                ..Default::default()
            },
        );
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        let rows = review_history(&path).unwrap();
        assert_eq!(rows[0].total, 1);
        assert_eq!(rows[0].reviewed, 0);
        assert_eq!(rows[0].last_reviewed_at, None);
        review.files.get_mut("a").unwrap().reviewed = true;
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        connect(&path)
            .unwrap()
            .execute(
                "INSERT INTO review_activity VALUES('org/repo#1','org/repo',-1,1)",
                [],
            )
            .unwrap();
        save_review(&path, "url", "org/repo#2", &ReviewProgress::default()).unwrap();
        let rows = review_history(&path).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].key, "org/repo#1");
        assert_eq!((rows[0].reviewed, rows[0].total), (1, 1));
        assert!(rows[0].last_reviewed_at.unwrap() > 1);
        assert_eq!(rows[1].total, 0);
    }
}

#[cfg(test)]
mod decision_tests {
    use super::*;
    #[test]
    fn v4_migration_preserves_seen_files_and_stores_unread_approval_separately() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.sqlite3");
        let mut review = ReviewProgress {
            selected: "test/e2e.ts".into(),
            files: BTreeMap::from([
                (
                    "src/main.ts".into(),
                    FileProgress {
                        version: "v1".into(),
                        reviewed: true,
                        ..Default::default()
                    },
                ),
                (
                    "test/e2e.ts".into(),
                    FileProgress {
                        version: "v1".into(),
                        top: 120.0,
                        ..Default::default()
                    },
                ),
            ]),
        };
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        let conn = connect(&path).unwrap();
        conn.execute_batch(
            "ALTER TABLE file_progress DROP COLUMN approved_unread; PRAGMA user_version=4;",
        )
        .unwrap();
        drop(conn);
        let migrated = load(&path).unwrap();
        assert!(migrated.reviews["org/repo#1"].files["src/main.ts"].reviewed);
        assert!(!migrated.reviews["org/repo#1"].files["test/e2e.ts"].approved_unread);
        review.files.get_mut("test/e2e.ts").unwrap().approved_unread = true;
        save_review(&path, "url", "org/repo#1", &review).unwrap();
        let loaded = load(&path).unwrap();
        let state = &loaded.reviews["org/repo#1"].files["test/e2e.ts"];
        assert!(state.approved_unread);
        assert!(!state.reviewed);
        assert_eq!(state.top, 120.0);
        let history = review_history(&path).unwrap();
        assert_eq!(
            (
                history[0].reviewed,
                history[0].approved_unread,
                history[0].total
            ),
            (1, 1, 2)
        );
        review.files.get_mut("test/e2e.ts").unwrap().reviewed = true;
        assert!(save_review(&path, "changed-url", "org/repo#1", &review).is_err());
        let saved = load(&path).unwrap();
        assert_eq!(saved.last_url, "url");
        assert!(!saved.reviews["org/repo#1"].files["test/e2e.ts"].reviewed);
    }
}
