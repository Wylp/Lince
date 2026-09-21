//! App-owned bare Git cache. No working tree, hooks, submodules or project execution.
use crate::{
    batch::{LoadedFile, LoadedPr},
    github::{self, Snapshot},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

#[derive(Clone, Serialize)]
pub struct Entry {
    pub path: String,
    pub oid: String,
    pub mode: String,
    pub size: u64,
}
#[derive(Clone, Serialize)]
pub struct Document {
    pub path: String,
    pub side: String,
    pub text: Option<Arc<String>>,
    pub reason: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub head: Vec<Entry>,
    pub base: Vec<Entry>,
    pub analysis: Vec<Document>,
    pub warnings: Vec<String>,
}
pub struct Repository {
    pub path: PathBuf,
    pub index: Index,
}
fn git(path: &Path) -> Command {
    let mut c = Command::new(std::env::var_os("LINCE_GIT").unwrap_or_else(|| "git".into()));
    c.arg("--git-dir").arg(path).args([
        "-c",
        "core.bare=true",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "gc.auto=0",
    ]);
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        c.env_remove(name);
    }
    c.env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c
}
async fn run(mut command: Command, input: Vec<u8>, limit: usize) -> Result<Vec<u8>, String> {
    let mut child = command.spawn().map_err(|e| {
        format!("Não foi possível executar Git. Instale Git ou configure LINCE_GIT. {e}")
    })?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    tokio::time::timeout(Duration::from_secs(180), async {
        let write = async {
            stdin.write_all(&input).await?;
            drop(stdin);
            Ok::<(), std::io::Error>(())
        };
        let read = async {
            let mut out = Vec::new();
            stdout.take(limit as u64 + 1).read_to_end(&mut out).await?;
            Ok::<_, std::io::Error>(out)
        };
        let errors = async {
            let mut out = Vec::new();
            stderr.take(65537).read_to_end(&mut out).await?;
            Ok::<_, std::io::Error>(out)
        };
        let ((), out, err) = tokio::try_join!(write, read, errors).map_err(|e| e.to_string())?;
        if out.len() > limit || err.len() > 65536 {
            let _ = child.kill().await;
            return Err("Resposta Git acima do limite; operação interrompida.".into());
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!(
                "Git: {}",
                String::from_utf8_lossy(&err)
                    .chars()
                    .take(1000)
                    .collect::<String>()
            ));
        }
        Ok(out)
    })
    .await
    .map_err(|_| "Git não respondeu em 180 segundos. Tente atualizar a PR novamente.".to_string())?
}
fn parse_tree(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    for row in bytes.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let tab = row
            .iter()
            .position(|b| *b == b'\t')
            .ok_or("Árvore local inválida")?;
        let fields = std::str::from_utf8(&row[..tab])
            .map_err(|_| "Metadados Git inválidos")?
            .split_whitespace()
            .collect::<Vec<_>>();
        if fields.len() != 4 {
            return Err("Entrada Git incompleta".into());
        }
        let path = String::from_utf8(row[tab + 1..].to_vec())
            .map_err(|_| "Nome de arquivo não UTF-8; árvore não pode ser exibida integralmente")?;
        entries.push(Entry {
            path,
            mode: fields[0].into(),
            oid: fields[2].into(),
            size: fields[3].parse().unwrap_or(u64::MAX),
        });
    }
    if entries.len() > 100_000 {
        return Err("Repositório acima de 100.000 arquivos; índice não aberto.".into());
    }
    Ok(entries)
}
async fn tree(path: &Path, sha: &str) -> Result<Vec<Entry>, String> {
    let mut c = git(path);
    c.args(["ls-tree", "-r", "-l", "-z", sha]);
    parse_tree(&run(c, vec![], 32 * 1024 * 1024).await?)
}
fn supported(entry: &Entry) -> Result<(), String> {
    if !matches!(entry.mode.as_str(), "100644" | "100755") {
        return Err("Link simbólico, submódulo ou modo Git não suportado.".into());
    }
    if entry.size > github::MAX_FILE {
        return Err("Arquivo maior que 1 MiB; visualização indisponível.".into());
    }
    Ok(())
}
fn parse_blobs(
    bytes: &[u8],
    entries: &[&Entry],
) -> Result<HashMap<String, Result<Arc<String>, String>>, String> {
    let mut cursor = 0;
    let mut result = HashMap::new();
    for entry in entries {
        let end = bytes[cursor..]
            .iter()
            .position(|b| *b == b'\n')
            .ok_or("Lote Git truncado")?
            + cursor;
        let fields = std::str::from_utf8(&bytes[cursor..end])
            .map_err(|_| "Cabeçalho Git inválido")?
            .split_whitespace()
            .collect::<Vec<_>>();
        if fields.len() != 3
            || fields[0] != entry.oid
            || fields[1] != "blob"
            || fields[2].parse::<u64>().ok() != Some(entry.size)
        {
            return Err("Objeto Git ausente ou inconsistente.".into());
        }
        cursor = end + 1;
        let end = cursor
            .checked_add(entry.size as usize)
            .filter(|end| *end < bytes.len())
            .ok_or("Conteúdo Git incompleto")?;
        if bytes[end] != b'\n' {
            return Err("Delimitador Git inválido".into());
        }
        result.insert(
            entry.oid.clone(),
            github::decode_text(bytes[cursor..end].to_vec()).map(Arc::new),
        );
        cursor = end + 1;
    }
    if cursor != bytes.len() {
        return Err("Lote Git com conteúdo inesperado".into());
    }
    Ok(result)
}
async fn blobs(
    path: &Path,
    entries: Vec<&Entry>,
) -> Result<HashMap<String, Result<Arc<String>, String>>, String> {
    let mut unique = BTreeMap::new();
    for e in entries {
        if supported(e).is_ok() {
            unique.insert(e.oid.clone(), e);
        }
    }
    let entries = unique.into_values().collect::<Vec<_>>();
    if entries.iter().map(|e| e.size).sum::<u64>() > 64 * 1024 * 1024 {
        return Err("Lote de código acima de 64 MiB.".into());
    }
    if entries.is_empty() {
        return Ok(HashMap::new());
    }
    let input = entries
        .iter()
        .map(|e| format!("{}\n", e.oid))
        .collect::<String>()
        .into_bytes();
    let mut c = git(path);
    c.args(["cat-file", "--batch"]);
    parse_blobs(&run(c, input, 65 * 1024 * 1024).await?, &entries)
}
fn document(
    entry: &Entry,
    side: &str,
    content: &HashMap<String, Result<Arc<String>, String>>,
) -> Document {
    let result = supported(entry).and_then(|_| {
        content
            .get(&entry.oid)
            .cloned()
            .unwrap_or_else(|| Err("Conteúdo ausente do lote local.".into()))
    });
    match result {
        Ok(text) => Document {
            path: entry.path.clone(),
            side: side.into(),
            text: Some(text),
            reason: None,
        },
        Err(reason) => Document {
            path: entry.path.clone(),
            side: side.into(),
            text: None,
            reason: Some(reason),
        },
    }
}
pub async fn read(repo: &Repository, side: &str, path: &str) -> Result<Document, String> {
    let entries = match side {
        "head" => &repo.index.head,
        "base" => &repo.index.base,
        _ => return Err("Lado da revisão inválido".into()),
    };
    let entry = entries
        .iter()
        .find(|e| e.path == path)
        .ok_or("Arquivo não pertence ao snapshot")?;
    let contents = blobs(&repo.path, vec![entry]).await?;
    Ok(document(entry, side, &contents))
}
#[cfg(test)]
pub async fn prepare(snapshot: Snapshot, root: &Path) -> Result<(LoadedPr, Repository), String> {
    prepare_with_progress(snapshot, root, &|_, _| {}).await
}
pub async fn prepare_with_progress(
    snapshot: Snapshot,
    root: &Path,
    report: &(dyn Fn(&str, &str) + Send + Sync),
) -> Result<(LoadedPr, Repository), String> {
    let path = root.join(format!(
        "{:x}.git",
        Sha256::digest(snapshot.repo.as_bytes())
    ));
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    if !path.join("HEAD").exists() {
        let mut c = git(&path);
        c.args(["init", "--bare"]);
        run(c, vec![], 1024 * 1024).await?;
    }
    let helper = format!(
        "!'{}' auth git-credential",
        github::gh_executable()
            .to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''")
    );
    for (name, sha) in [("base", &snapshot.merge_base), ("head", &snapshot.head_sha)] {
        report(
            name,
            if name == "base" {
                "Conferindo a versão original no cache local."
            } else {
                "Conferindo a versão da PR no cache local."
            },
        );
        if sha.len() != 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("SHA da revisão inválido".into());
        }
        let mut check = git(&path);
        check.args(["cat-file", "-e", &format!("{sha}^{{commit}}")]);
        if run(check, vec![], 1024).await.is_err() {
            report(
                name,
                if name == "base" {
                    "Baixando a versão original. A primeira abertura pode levar mais tempo."
                } else {
                    "Baixando a versão da PR para navegar no código completo."
                },
            );
            let mut c = git(&path);
            c.args([
                "-c",
                "credential.helper=",
                "-c",
                &format!("credential.helper={helper}"),
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                "--depth=1",
                "--force",
                &format!("https://github.com/{}.git", snapshot.repo),
                &format!("{sha}:refs/lince/{name}"),
            ]);
            run(c, vec![], 1024 * 1024).await?;
        }
    }
    report(
        "tree",
        "Montando a árvore de arquivos das duas versões do repositório.",
    );
    let base = tree(&path, &snapshot.merge_base).await?;
    let head = tree(&path, &snapshot.head_sha).await?;
    let base_map = base
        .iter()
        .map(|e| (e.path.as_str(), e))
        .collect::<HashMap<_, _>>();
    let head_map = head
        .iter()
        .map(|e| (e.path.as_str(), e))
        .collect::<HashMap<_, _>>();
    let mut wanted = Vec::new();
    for f in &snapshot.files {
        if f.status != "added" {
            wanted.push(
                *base_map
                    .get(f.previous_path.as_deref().unwrap_or(&f.path))
                    .ok_or("Arquivo da base ausente na árvore Git")?,
            );
        }
        if f.status != "removed" {
            wanted.push(
                *head_map
                    .get(f.path.as_str())
                    .ok_or("Arquivo do head ausente na árvore Git")?,
            );
        }
    }
    if wanted
        .iter()
        .filter(|e| supported(e).is_ok())
        .map(|e| e.size)
        .sum::<u64>()
        > 64 * 1024 * 1024
    {
        return Err("Conteúdo antes/depois dos arquivos alterados excede 64 MiB.".into());
    }
    report(
        "diff",
        "Lendo o conteúdo completo dos arquivos alterados em lote.",
    );
    let content = blobs(&path, wanted).await?;
    let mut files = BTreeMap::new();
    let mut patch_bytes = 0;
    let started = std::time::Instant::now();
    for (index, f) in snapshot.files.iter().enumerate() {
        if index % 25 == 0 {
            report(
                "diff",
                &format!(
                    "Comparando arquivos: {} de {} preparados.",
                    index,
                    snapshot.files.len()
                ),
            );
        }
        if started.elapsed() > Duration::from_secs(30) {
            return Err("Cálculo de diff excedeu 30 segundos.".into());
        }
        let side = |entry: Option<&&Entry>| -> Result<Arc<String>, String> {
            match entry {
                None => Ok(Arc::new(String::new())),
                Some(e) => {
                    supported(e)?;
                    content.get(&e.oid).cloned().ok_or("Objeto local ausente")?
                }
            }
        };
        let old = if f.status == "added" {
            None
        } else {
            base_map.get(f.previous_path.as_deref().unwrap_or(&f.path))
        };
        let new = if f.status == "removed" {
            None
        } else {
            head_map.get(f.path.as_str())
        };
        let (before, after, diff) = match (side(old), side(new)) {
            (Ok(a), Ok(b)) => {
                let mut diff = github::render_diff(&a, &b);
                if old.map(|e| &e.mode) != new.map(|e| &e.mode) {
                    diff.reason = Some(format!(
                        "Modo Git: {} → {}",
                        old.map_or("ausente", |e| e.mode.as_str()),
                        new.map_or("ausente", |e| e.mode.as_str())
                    ));
                }
                (Some(a), Some(b), diff)
            }
            (Err(e), _) | (_, Err(e)) => (None, None, github::FileDiff::unsupported(e)),
        };
        patch_bytes += diff.patch.as_ref().map_or(0, |p| p.len());
        if patch_bytes > 32 * 1024 * 1024 {
            return Err("Diffs acima de 32 MiB.".into());
        }
        files.insert(
            f.path.clone(),
            LoadedFile {
                path: f.path.clone(),
                before,
                after,
                diff,
            },
        );
    }
    Ok((
        LoadedPr { snapshot, files },
        Repository {
            path,
            index: Index {
                head,
                base,
                analysis: vec![],
                warnings: vec![],
            },
        },
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_spaces_and_newlines_and_refuses_truncated_objects() {
        let entries = parse_tree(b"100644 blob abcd 3\ta name\n.ts\0").unwrap();
        assert_eq!(entries[0].path, "a name\n.ts");
        assert!(parse_blobs(b"abcd blob 3\nxx", &[&entries[0]]).is_err());
        assert_eq!(
            parse_blobs(b"abcd blob 3\nabc\n", &[&entries[0]]).unwrap()["abcd"]
                .as_ref()
                .unwrap()
                .as_str(),
            "abc"
        );
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    async fn command(path: &Path, args: &[&str], input: &str) -> String {
        let mut c = git(path);
        c.args(args)
            .env("GIT_AUTHOR_NAME", "Lince Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
            .env("GIT_COMMITTER_NAME", "Lince Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.invalid");
        String::from_utf8(
            run(c, input.as_bytes().to_vec(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap()
        .trim()
        .into()
    }
    #[tokio::test]
    async fn bare_cache_reads_unchanged_files_and_keeps_both_revisions_immutable() {
        let root = tempfile::tempdir().unwrap();
        let repo = "fixture/repo";
        let path = root
            .path()
            .join(format!("{:x}.git", Sha256::digest(repo.as_bytes())));
        std::fs::create_dir_all(&path).unwrap();
        command(&path, &["init", "--bare"], "").await;
        let before = command(
            &path,
            &["hash-object", "-w", "--stdin"],
            "export const count = 1;\n",
        )
        .await;
        let after = command(
            &path,
            &["hash-object", "-w", "--stdin"],
            "export const count = 2;\n",
        )
        .await;
        let helper = command(
            &path,
            &["hash-object", "-w", "--stdin"],
            "export function helper() { return 10; }\n",
        )
        .await;
        let python_base = command(
            &path,
            &["hash-object", "-w", "--stdin"],
            "def old_only(): return 1\n",
        )
        .await;
        let python_head = command(
            &path,
            &["hash-object", "-w", "--stdin"],
            "def new_only(): return 2\n",
        )
        .await;
        let base_tree = command(
            &path,
            &["mktree"],
            &format!("100644 blob {before}\ta.ts\n100644 blob {python_base}\tlibrary.py\n100644 blob {helper}\tunchanged.ts\n"),
        )
        .await;
        let head_tree = command(
            &path,
            &["mktree"],
            &format!("100644 blob {after}\ta.ts\n100644 blob {python_head}\tlibrary.py\n100644 blob {helper}\tunchanged.ts\n"),
        )
        .await;
        let base = command(&path, &["commit-tree", &base_tree, "-m", "base"], "").await;
        let head = command(&path, &["commit-tree", &head_tree, "-m", "head"], "").await;
        let snapshot = Snapshot {
            id: "fixture".into(),
            key: "fixture/repo#1".into(),
            url: "https://github.com/fixture/repo/pull/1".into(),
            repo: repo.into(),
            number: 1,
            title: "test".into(),
            author: "test".into(),
            base_branch: "main".into(),
            head_branch: "feature".into(),
            base_sha: base.clone(),
            merge_base: base,
            head_sha: head,
            files: vec![github::File {
                path: "a.ts".into(),
                previous_path: None,
                status: "modified".into(),
                additions: 1,
                deletions: 1,
                version: "v1".into(),
            }],
        };
        let stages = std::sync::Mutex::new(Vec::new());
        let (bundle, repository) =
            prepare_with_progress(snapshot.clone(), root.path(), &|step, _| {
                stages.lock().unwrap().push(step.to_owned());
            })
            .await
            .unwrap();
        assert_eq!(
            stages
                .lock()
                .unwrap()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["base", "head", "tree", "diff", "diff"]
        );
        assert!(bundle.files["a.ts"].diff.reviewable);
        assert!(read(&repository, "head", "unchanged.ts")
            .await
            .unwrap()
            .text
            .unwrap()
            .contains("helper"));
        assert!(read(&repository, "base", "a.ts")
            .await
            .unwrap()
            .text
            .unwrap()
            .contains("= 1"));
        assert!(read(&repository, "head", "a.ts")
            .await
            .unwrap()
            .text
            .unwrap()
            .contains("= 2"));
        assert!(read(&repository, "head", "../a.ts").await.is_err());
        assert!(read(&repository, "wrong", "a.ts").await.is_err());
        for (side, present, absent) in [
            ("base", "old_only", "new_only"),
            ("head", "new_only", "old_only"),
        ] {
            let (docs, warnings) = symbol_documents(&repository, side, "python").await.unwrap();
            assert_eq!(docs.len(), 1);
            assert!(warnings.is_empty());
            let index = crate::symbols::build("python", docs, warnings).unwrap();
            let query = |name: &str| Document {
                path: "caller.py".into(),
                side: side.into(),
                text: Some(Arc::new(format!("{name}()"))),
                reason: None,
            };
            assert_eq!(
                crate::symbols::find(&index, "python", &query(present), 1, 2)
                    .unwrap()
                    .targets
                    .len(),
                1
            );
            assert!(crate::symbols::find(&index, "python", &query(absent), 1, 2)
                .unwrap()
                .targets
                .is_empty());
        }
        assert!(symbol_documents(&repository, "wrong", "python")
            .await
            .is_err());
        assert!(repository.index.analysis.is_empty());
        assert!(repository.index.warnings.is_empty());
        let docs = read_many(&repository, "head", &["a.ts".into(), "unchanged.ts".into()])
            .await
            .unwrap();
        assert_eq!(docs.len(), 2);
        assert!(docs[0].text.as_ref().unwrap().contains("= 2"));
        assert!(read_many(&repository, "head", &["../outside".into()])
            .await
            .is_err());
        assert!(read_many(&repository, "wrong", &["a.ts".into()])
            .await
            .is_err());
        assert!(read_many(&repository, "head", &vec!["a.ts".into(); 65])
            .await
            .is_err());
        assert!(!path.join("a.ts").exists());
        let second = prepare(snapshot, root.path()).await.unwrap();
        assert_eq!(second.0.files["a.ts"].after, bundle.files["a.ts"].after);
    }
}

/// One local Git batch per language and side, on first definition lookup.
pub async fn symbol_documents(
    repo: &Repository,
    side: &str,
    lang: &str,
) -> Result<(Vec<Document>, Vec<String>), String> {
    let entries = match side {
        "head" => &repo.index.head,
        "base" => &repo.index.base,
        _ => return Err("Lado inválido".into()),
    };
    let mut selected = Vec::new();
    let mut bytes = 0;
    let mut skipped = 0;
    for entry in entries
        .iter()
        .filter(|e| crate::symbols::accepts(lang, &e.path))
    {
        if entry.path.split('/').any(|p| {
            matches!(
                p,
                "node_modules" | "vendor" | "dist" | "build" | ".venv" | "venv" | "target"
            )
        }) {
            continue;
        }
        if supported(entry).is_err()
            || selected.len() >= 2000
            || bytes + entry.size > 16 * 1024 * 1024
        {
            skipped += 1;
            continue;
        }
        selected.push(entry);
        bytes += entry.size;
    }
    let content = blobs(&repo.path, selected.clone()).await?;
    let docs: Vec<_> = selected
        .into_iter()
        .map(|entry| document(entry, side, &content))
        .collect();
    skipped += docs.iter().filter(|d| d.text.is_none()).count();
    let warnings = if skipped > 0 {
        vec![format!("Índice de declarações parcial: {skipped} arquivos omitidos por formato ou limite de 2.000 arquivos / 16 MiB por linguagem e lado.")]
    } else {
        vec![]
    };
    Ok((docs, warnings))
}

/// Local, bounded batch used by the on-demand JS/TS dependency graph.
pub async fn read_many(
    repo: &Repository,
    side: &str,
    paths: &[String],
) -> Result<Vec<Document>, String> {
    if paths.len() > 64 {
        return Err("Lote local acima de 64 arquivos".into());
    }
    let entries = match side {
        "head" => &repo.index.head,
        "base" => &repo.index.base,
        _ => return Err("Lado inválido".into()),
    };
    let map: HashMap<_, _> = entries.iter().map(|e| (e.path.as_str(), e)).collect();
    let wanted = paths
        .iter()
        .map(|path| {
            map.get(path.as_str())
                .copied()
                .ok_or("Arquivo não pertence ao snapshot".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if wanted
        .iter()
        .filter(|e| supported(e).is_ok())
        .map(|e| e.size)
        .sum::<u64>()
        > 8 * 1024 * 1024
    {
        return Err("Lote local acima de 8 MiB".into());
    }
    let content = blobs(&repo.path, wanted.clone()).await?;
    Ok(wanted
        .into_iter()
        .map(|e| document(e, side, &content))
        .collect())
}
