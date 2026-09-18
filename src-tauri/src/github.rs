use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

pub(crate) const MAX_FILE: u64 = 1_048_576;
const MAX_LINES: usize = 12_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub version: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub key: String,
    pub url: String,
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub base_sha: String,
    pub head_sha: String,
    pub merge_base: String,
    pub files: Vec<File>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub patch: Option<String>,
    pub reason: Option<String>,
    pub reviewable: bool,
}
impl FileDiff {
    pub(crate) fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            patch: None,
            reason: Some(reason.into()),
            reviewable: false,
        }
    }
}

pub fn parse_url(input: &str) -> Result<(String, u64), String> {
    let u = url::Url::parse(input.trim()).map_err(|_| "Informe uma URL válida de PR do GitHub.")?;
    let parts: Vec<_> = u.path().trim_end_matches('/').split('/').collect();
    if u.scheme() != "https"
        || u.host_str() != Some("github.com")
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || parts.len() != 5
        || parts[3] != "pull"
        || !parts[1..3].iter().all(|s| {
            !s.is_empty()
                && *s != "."
                && *s != ".."
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    {
        return Err("Use https://github.com/owner/repo/pull/123 (GitHub.com).".into());
    }
    let number = parts[4]
        .parse::<u64>()
        .ok()
        .filter(|n| *n > 0)
        .ok_or("Número de PR inválido.")?;
    Ok((format!("{}/{}", parts[1], parts[2]), number))
}

pub(crate) fn gh_executable() -> PathBuf {
    if let Some(path) = std::env::var_os("LINCE_GH") {
        return path.into();
    }
    let name = if cfg!(windows) { "gh.exe" } else { "gh" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join(name);
            if p.is_file() {
                return p;
            }
        }
    }
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/gh"),
        PathBuf::from("/usr/local/bin/gh"),
        PathBuf::from("/usr/bin/gh"),
    ];
    if let Some(p) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(p).join("GitHub CLI/gh.exe"));
    }
    if let Some(p) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(p).join("Programs/GitHub CLI/gh.exe"));
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .unwrap_or_else(|| name.into())
}

pub async fn api(endpoint: &str) -> Result<Value, String> {
    request(endpoint, None).await
}
async fn request(endpoint: &str, body: Option<Value>) -> Result<Value, String> {
    let mut command = Command::new(gh_executable());
    command
        .args([
            "api",
            "--hostname",
            "github.com",
            "--method",
            if body.is_some() { "POST" } else { "GET" },
            endpoint,
        ])
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if body.is_some() {
        command.args(["--input", "-"]);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "GitHub CLI não encontrado. Instale gh ou configure LINCE_GH.".to_owned()
        } else {
            format!("Não foi possível executar gh: {e}.")
        }
    })?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let result = tokio::time::timeout(Duration::from_secs(60), async {
        let read = |stream: Box<dyn tokio::io::AsyncRead + Unpin + Send>, limit| async move {
            let mut bytes = Vec::new();
            stream
                .take(limit)
                .read_to_end(&mut bytes)
                .await
                .map(|_| bytes)
        };
        let write = async {
            if let Some(body) = body {
                stdin.write_all(&serde_json::to_vec(&body)?).await?;
            }
            drop(stdin);
            Ok::<(), std::io::Error>(())
        };
        let ((), out, err) = tokio::try_join!(
            write,
            read(Box::new(stdout), 32 * 1024 * 1024),
            read(Box::new(stderr), 65536)
        )?;
        // Do not wait forever on a child blocked on a full pipe after hitting our cap.
        if out.len() >= 32 * 1024 * 1024 || err.len() >= 65536 {
            child.kill().await?;
            return Err(std::io::Error::other(
                "Resposta excede o limite de segurança.",
            ));
        }
        let status = child.wait().await?;
        Ok((status, out, err))
    })
    .await
    .map_err(|_| "GitHub não respondeu em 60 segundos. Tente novamente.")?
    .map_err(|e: std::io::Error| format!("Falha ao consultar gh: {e}"))?;
    if !result.0.success() {
        let error = String::from_utf8_lossy(&result.2);
        if error.contains("401") || error.contains("auth login") || error.contains("GH_TOKEN") {
            return Err("Autenticação indisponível. Execute gh auth login --hostname github.com no terminal e tente novamente.".into());
        }
        if error.contains("404") {
            return Err("PR ou conteúdo não encontrado. Confira a URL e o acesso da conta autenticada no gh (incluindo SSO do repositório).".into());
        }
        return Err(format!(
            "GitHub CLI falhou: {}",
            error.chars().take(1200).collect::<String>()
        ));
    }
    serde_json::from_slice(&result.1).map_err(|e| format!("Resposta inválida do GitHub: {e}"))
}
fn string(v: &Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Resposta do GitHub sem {key}."))
}
pub async fn open(input: &str) -> Result<Snapshot, String> {
    let (repo, number) = parse_url(input)?;
    let endpoint = format!("repos/{repo}/pulls/{number}");
    let meta = api(&endpoint).await?;
    let base_sha = string(&meta["base"], "sha")?;
    let head_sha = string(&meta["head"], "sha")?;
    let total = meta["changed_files"]
        .as_u64()
        .ok_or("Contagem de arquivos ausente.")?;
    if total > 3000 {
        return Err("Esta PR excede 3.000 arquivos, limite da API do GitHub. A revisão não foi aberta para evitar uma lista incompleta.".into());
    }
    let comparison = api(&format!(
        "repos/{repo}/compare/{base_sha}...{head_sha}?per_page=1"
    ))
    .await?;
    let merge_base = string(&comparison["merge_base_commit"], "sha")?;
    let mut files = Vec::new();
    for page in 1..=30 {
        let response = api(&format!("{endpoint}/files?per_page=100&page={page}")).await?;
        let batch = response.as_array().ok_or("Lista de arquivos inválida.")?;
        for f in batch {
            let path = string(f, "filename")?;
            let status = string(f, "status")?;
            let previous_path = f["previous_filename"].as_str().map(str::to_owned);
            // Conservative invalidation on any new head/base, including mode-only changes.
            let version = format!(
                "{:x}",
                Sha256::digest(format!(
                    "{merge_base}\0{head_sha}\0{}\0{status}\0{path}\0{}",
                    string(f, "sha")?,
                    previous_path.as_deref().unwrap_or("")
                ))
            );
            files.push(File {
                path,
                previous_path,
                status,
                version,
                additions: f["additions"].as_u64().unwrap_or(0),
                deletions: f["deletions"].as_u64().unwrap_or(0),
            });
        }
        if batch.len() < 100 || files.len() as u64 == total {
            break;
        }
    }
    let after = api(&endpoint).await?;
    if after["base"]["sha"] != meta["base"]["sha"]
        || after["head"]["sha"] != meta["head"]["sha"]
        || files.len() as u64 != total
    {
        return Err("A PR mudou durante a consulta ou a lista está incompleta. Abra novamente para obter uma revisão consistente.".into());
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let key = format!("{repo}#{number}");
    Ok(Snapshot {
        id: format!("{key}:{base_sha}:{head_sha}"),
        key,
        url: format!("https://github.com/{repo}/pull/{number}"),
        repo,
        number,
        title: string(&meta, "title")?,
        author: string(&meta["user"], "login")?,
        base_branch: string(&meta["base"], "ref")?,
        head_branch: string(&meta["head"], "ref")?,
        base_sha,
        head_sha,
        merge_base,
        files,
    })
}

pub(crate) fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() as u64 > MAX_FILE {
        return Err("Arquivo maior que 1 MiB.".into());
    }
    if bytes.contains(&0) {
        return Err("Arquivo binário; revisão textual indisponível.".into());
    }
    let text =
        String::from_utf8(bytes).map_err(|_| "Arquivo não UTF-8; revisão textual indisponível.")?;
    if text.lines().any(|line| line.len() > 4000) {
        return Err(
            "Linha maior que 4.000 bytes; diff não exibido para preservar a navegação.".into(),
        );
    }
    if text.lines().count() > MAX_LINES {
        return Err(
            "Arquivo com mais de 12.000 linhas; revisão textual indisponível nesta versão.".into(),
        );
    }
    if text.starts_with("version https://git-lfs.github.com/spec/v1") {
        return Err("Objeto Git LFS: o conteúdo não está disponível nesta revisão textual.".into());
    }
    Ok(text)
}
pub(crate) fn render_diff(old: &str, new: &str) -> FileDiff {
    if old == new {
        return FileDiff { patch: None, reason: Some("Sem alterações textuais: renomeação, arquivo vazio ou mudança de permissão. Confira o status e o caminho acima.".into()), reviewable: true };
    }
    let diff = similar::TextDiff::configure()
        .timeout(Duration::from_secs(3))
        .diff_lines(old, new);
    // Stable synthetic headers avoid ambiguous quoting for Git paths containing tabs or spaces.
    let body = diff
        .unified_diff()
        .context_radius(3)
        .header("a/file", "b/file")
        .to_string();
    if body.lines().count() > 16_000 {
        return FileDiff::unsupported(
            "Diff com mais de 16.000 linhas. Revisão não habilitada nesta versão.",
        );
    }
    FileDiff {
        patch: Some(format!("diff --git a/file b/file\n{body}")),
        reason: None,
        reviewable: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires network and an authenticated GitHub CLI"]
    async fn live_public_pr() {
        let url = std::env::var("LINCE_TEST_PR")
            .unwrap_or_else(|_| "https://github.com/cli/cli/pull/14462".into());
        let snapshot = open(&url).await.unwrap();
        assert!(!snapshot.files.is_empty());
        let cache = tempfile::tempdir().unwrap();
        let (loaded, _) = crate::repository::prepare(snapshot.clone(), cache.path())
            .await
            .unwrap();
        let mut displayed = 0;
        for file in snapshot.files.iter().take(5) {
            let result = &loaded.files[&file.path].diff;
            assert!(result.patch.is_some() || result.reason.is_some());
            if result.reviewable {
                displayed += 1;
            }
        }
        assert!(displayed > 0);
        eprintln!(
            "Validated {} files in {} at {}",
            snapshot.files.len(),
            snapshot.url,
            snapshot.head_sha
        );
    }
    #[test]
    fn validates_urls() {
        assert_eq!(
            parse_url("https://github.com/a/b/pull/42/files"),
            Err("Use https://github.com/owner/repo/pull/123 (GitHub.com).".into())
        );
        assert_eq!(
            parse_url("https://github.com/a/b/pull/42?x=y#diff"),
            Ok(("a/b".into(), 42))
        );
        for url in [
            "http://github.com/a/b/pull/1",
            "https://evil.com/a/b/pull/1",
            "https://github.com/a/b/pull/0",
            "https://user@github.com/a/b/pull/1",
        ] {
            assert!(parse_url(url).is_err());
        }
    }
    #[test]
    fn rejects_unsupported_content() {
        assert!(decode_text(vec![0, 1]).is_err());
        assert!(decode_text(vec![255]).is_err());
        assert!(decode_text(vec![b'a'; MAX_FILE as usize + 1]).is_err());
        assert!(decode_text(b"version https://git-lfs.github.com/spec/v1\n".to_vec()).is_err());
    }
    #[test]
    fn complete_diff_handles_add_delete_and_no_newline() {
        for (old, new) in [("", "hello\n"), ("hello\n", ""), ("old", "new")] {
            let result = render_diff(old, new);
            assert!(result.reviewable);
            assert!(result.patch.unwrap().contains("@@"));
        }
        assert!(render_diff("old", "new")
            .patch
            .unwrap()
            .contains("\\ No newline at end of file"));
        assert!(render_diff("", "").reviewable);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub state: String,
    pub login: Option<String>,
    pub message: String,
}
fn auth_result(result: Result<Value, String>) -> AuthStatus {
    match result {
        Ok(user) => match user["login"].as_str().filter(|s| !s.is_empty()) {
            Some(login) => AuthStatus {
                state: "authenticated".into(),
                login: Some(login.into()),
                message: "Sua conta está pronta para abrir pull requests.".into(),
            },
            None => AuthStatus {
                state: "unavailable".into(),
                login: None,
                message: "GitHub retornou uma conta inválida. Verifique novamente.".into(),
            },
        },
        Err(error) => {
            let (state, message) = if error.starts_with("Autenticação indisponível.") {
                (
                    "signedOut",
                    "Entre na sua conta pelo terminal e clique em verificar novamente.",
                )
            } else if error.starts_with("GitHub CLI não encontrado.") {
                (
                    "missing",
                    "O Lince não encontrou o executável gh neste dispositivo.",
                )
            } else {
                (
                    "unavailable",
                    "Não foi possível confirmar sua sessão. Confira a conexão e tente novamente.",
                )
            };
            AuthStatus {
                state: state.into(),
                login: None,
                message: message.into(),
            }
        }
    }
}
pub async fn auth_status() -> AuthStatus {
    auth_result(api("user").await)
}
#[cfg(test)]
mod auth_tests {
    use super::*;
    #[test]
    fn distinguishes_session_from_network_failure() {
        let account = auth_result(Ok(serde_json::json!({"login":"reviewer"})));
        assert_eq!(account.state, "authenticated");
        assert_eq!(account.login.as_deref(), Some("reviewer"));
        assert_eq!(
            auth_result(Err("Autenticação indisponível. login".into())).state,
            "signedOut"
        );
        assert_eq!(
            auth_result(Err("GitHub CLI não encontrado.".into())).state,
            "missing"
        );
        assert_eq!(
            auth_result(Err("GitHub não respondeu".into())).state,
            "unavailable"
        );
        assert_eq!(auth_result(Ok(serde_json::json!({}))).state, "unavailable");
    }
}

pub async fn publish_comment(
    snapshot: &Snapshot,
    path: &str,
    side: &str,
    line: u32,
    body: &str,
) -> Result<String, String> {
    let current = api(&format!(
        "repos/{}/pulls/{}",
        snapshot.repo, snapshot.number
    ))
    .await?;
    if current["head"]["sha"] != snapshot.head_sha || current["base"]["sha"] != snapshot.base_sha {
        return Err("A PR mudou. Atualize a revisão antes de publicar o comentário.".into());
    }
    let result=request(&format!("repos/{}/pulls/{}/comments",snapshot.repo,snapshot.number),Some(serde_json::json!({"commit_id":snapshot.head_sha,"path":path,"side":side,"line":line,"body":body}))).await?;
    string(&result, "html_url")
}
