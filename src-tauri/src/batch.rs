//! Immutable, reusable content snapshot. Network access happens only in load().
use crate::github::{self, FileDiff, Snapshot};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

const BATCH_BYTES: u64 = 4 * 1024 * 1024;
const SNAPSHOT_BYTES: u64 = 32 * 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub path: String,
    pub before: Option<Arc<String>>,
    pub after: Option<Arc<String>>,
    pub diff: FileDiff,
}
#[derive(Serialize)]
pub struct LoadedPr {
    pub snapshot: Snapshot,
    pub files: BTreeMap<String, LoadedFile>,
}
#[derive(Clone)]
struct Blob {
    oid: String,
    size: u64,
    mode: String,
}
type Entry = Result<Blob, String>;
fn tree(data: Value) -> Result<HashMap<String, Entry>, String> {
    if data["truncated"] == true {
        return Err(
            "Árvore Git truncada: não é possível garantir o lote completo desta PR.".into(),
        );
    }
    let mut entries = HashMap::new();
    for entry in data["tree"].as_array().ok_or("Árvore Git inválida")? {
        if entry["type"] == "tree" {
            continue;
        }
        let path = entry["path"].as_str().ok_or("Caminho Git ausente")?;
        let mode = entry["mode"].as_str().unwrap_or_default();
        let value = if entry["type"] != "blob" || !matches!(mode, "100644" | "100755") {
            Err("Link simbólico, submódulo ou modo Git não suportado.".into())
        } else if entry["size"].as_u64().unwrap_or(u64::MAX) > github::MAX_FILE {
            Err("Arquivo maior que 1 MiB; revisão textual indisponível.".into())
        } else {
            Ok(Blob {
                oid: entry["sha"].as_str().ok_or("SHA ausente")?.into(),
                size: entry["size"].as_u64().unwrap(),
                mode: mode.into(),
            })
        };
        entries.insert(path.into(), value);
    }
    Ok(entries)
}
fn batches(blobs: BTreeMap<String, u64>) -> Result<Vec<Vec<String>>, String> {
    if blobs.values().sum::<u64>() > SNAPSHOT_BYTES {
        return Err("Os arquivos alterados excedem 32 MiB de conteúdo. O lote não foi carregado; nenhuma revisão parcial foi aberta.".into());
    }
    let mut batches = Vec::new();
    let mut batch = Vec::new();
    let mut size = 0;
    for (oid, bytes) in blobs {
        if !batch.is_empty() && (batch.len() >= 40 || size + bytes > BATCH_BYTES) {
            batches.push(std::mem::take(&mut batch));
            size = 0;
        }
        batch.push(oid);
        size += bytes;
    }
    if !batch.is_empty() {
        batches.push(batch);
    }
    Ok(batches)
}
fn resolve(entries: &HashMap<String, Entry>, path: &str) -> Entry {
    entries
        .get(path)
        .cloned()
        .unwrap_or_else(|| Err("Arquivo não encontrado na árvore completa do snapshot.".into()))
}
pub async fn load(snapshot: Snapshot) -> Result<LoadedPr, String> {
    let base = tree(
        github::api(&format!(
            "repos/{}/git/trees/{}?recursive=1",
            snapshot.repo, snapshot.merge_base
        ))
        .await?,
    )?;
    let head = tree(
        github::api(&format!(
            "repos/{}/git/trees/{}?recursive=1",
            snapshot.repo, snapshot.head_sha
        ))
        .await?,
    )?;
    let mut sides = HashMap::new();
    let mut blobs = BTreeMap::new();
    let mut expanded_bytes = 0;
    for f in &snapshot.files {
        let old = if f.status == "added" {
            None
        } else {
            Some(resolve(
                &base,
                f.previous_path.as_deref().unwrap_or(&f.path),
            ))
        };
        let new = if f.status == "removed" {
            None
        } else {
            Some(resolve(&head, &f.path))
        };
        for b in [&old, &new]
            .into_iter()
            .filter_map(|s| s.as_ref())
            .filter_map(|s| s.as_ref().ok())
        {
            expanded_bytes += b.size;
            if expanded_bytes > 64 * 1024 * 1024 {
                return Err("Conteúdos antes/depois excedem 64 MiB; lote não aberto.".into());
            }
            blobs.insert(b.oid.clone(), b.size);
        }
        sides.insert(f.path.clone(), (old, new));
    }
    let sizes = blobs.clone();
    let mut texts = HashMap::new();
    let (owner, repo) = snapshot
        .repo
        .split_once('/')
        .ok_or("Repositório inválido")?;
    for batch in batches(blobs)? {
        let fields = batch
            .iter()
            .enumerate()
            .map(|(i, oid)| {
                format!(
                    "b{i}:object(oid:{}){{... on Blob {{oid byteSize isBinary isTruncated text}}}}",
                    serde_json::to_string(oid).unwrap()
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        let query = format!(
            "query {{repository(owner:{},name:{}){{{fields}}}}}",
            serde_json::to_string(owner).unwrap(),
            serde_json::to_string(repo).unwrap()
        );
        let response = github::graphql(query).await?;
        for (i, oid) in batch.iter().enumerate() {
            let value = &response["data"]["repository"][format!("b{i}")];
            if value["oid"].as_str() != Some(oid) || value["byteSize"].as_u64() != Some(sizes[oid])
            {
                return Err(
                    "Lote de conteúdo incompleto ou inconsistente. Abra a PR novamente.".into(),
                );
            }
            let text = if value["isTruncated"] == true {
                Err("Conteúdo truncado pelo GitHub; revisão não habilitada.".into())
            } else if value["isBinary"] == true {
                Err("Arquivo binário; revisão textual indisponível.".into())
            } else {
                match value["text"].as_str() {
                Some(text) if text.len() as u64==sizes[oid]=>github::decode_text(text.as_bytes().to_vec()).map(Arc::new),
                _=>Err("Conteúdo não UTF-8, ausente ou truncado pelo GitHub; revisão textual indisponível.".into())
            }
            };
            texts.insert(oid.clone(), text);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = BTreeMap::new();
        let mut patch_bytes = 0;
        let started = std::time::Instant::now();
        for f in &snapshot.files {
            if started.elapsed() > std::time::Duration::from_secs(30) {
                return Err("O cálculo dos diffs excedeu 30 segundos; lote não aberto.".into());
            }
            let (old, new) = &sides[&f.path];
            let side = |entry: &Option<Entry>| -> Result<(Arc<String>, String), String> {
                match entry {
                    None => Ok((Arc::new(String::new()), "ausente".into())),
                    Some(Err(e)) => Err(e.clone()),
                    Some(Ok(b)) => Ok((
                        texts.get(&b.oid).ok_or("Objeto ausente no lote")?.clone()?,
                        b.mode.clone(),
                    )),
                }
            };
            let (before, after, diff) = match (side(old), side(new)) {
                (Ok((before, old_mode)), Ok((after, new_mode))) => {
                    let mut diff = if matches!(
                        f.status.as_str(),
                        "added" | "removed" | "modified" | "renamed" | "changed"
                    ) {
                        github::render_diff(&before, &after)
                    } else {
                        FileDiff::unsupported(format!("Status Git não suportado: {}", f.status))
                    };
                    if diff.reviewable
                        && ((!before.is_empty() && !before.ends_with('\n'))
                            || (!after.is_empty() && !after.ends_with('\n')))
                    {
                        diff.reason = Some(format!(
                            "{} Arquivo sem newline final na base ou no head.",
                            diff.reason.unwrap_or_default()
                        ));
                    }
                    if old_mode != new_mode && diff.reviewable {
                        diff.reason = Some(format!(
                            "Modo Git: {old_mode} → {new_mode}. {}",
                            diff.reason.unwrap_or_default()
                        ));
                    }
                    (Some(before), Some(after), diff)
                }
                (Err(e), _) | (_, Err(e)) => (None, None, FileDiff::unsupported(e)),
            };
            patch_bytes += diff.patch.as_ref().map_or(0, |p| p.len());
            if patch_bytes > 32 * 1024 * 1024 {
                return Err(
                    "Diffs do lote excedem 32 MiB; revisão não aberta para preservar memória."
                        .into(),
                );
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
        Ok(LoadedPr { snapshot, files })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batches_by_bytes_and_count_and_rejects_oversize_snapshots() {
        let small = (0..81).map(|i| (i.to_string(), 1)).collect();
        assert_eq!(
            batches(small)
                .unwrap()
                .iter()
                .map(Vec::len)
                .collect::<Vec<_>>(),
            vec![40, 40, 1]
        );
        assert_eq!(
            batches((0..9).map(|i| (i.to_string(), 1024 * 1024)).collect())
                .unwrap()
                .len(),
            3
        );
        assert!(batches(BTreeMap::from([("x".into(), SNAPSHOT_BYTES + 1)])).is_err());
    }
    #[test]
    fn trees_reject_truncation_and_do_not_follow_links() {
        assert!(tree(serde_json::json!({"truncated":true})).is_err());
        let map=tree(serde_json::json!({"tree":[{"path":"link","type":"blob","mode":"120000","size":1,"sha":"a"},{"path":"huge","type":"blob","mode":"100644","size":2097152,"sha":"b"}]})).unwrap();
        assert!(resolve(&map, "link").is_err());
        assert!(resolve(&map, "huge").is_err());
        assert!(resolve(&map, "missing").is_err());
    }
}
