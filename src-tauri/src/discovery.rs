use crate::github;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub language: Option<String>,
    pub topics: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repositories {
    pub items: Vec<Repository>,
    pub has_more: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub head_sha: String,
    pub base_sha: String,
    pub draft: bool,
    pub created_at: String,
    pub head: String,
    pub base: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequests {
    pub items: Vec<PullRequest>,
    pub has_more: bool,
    pub warning: Option<String>,
}
fn field(v: &Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Resposta do GitHub sem {key}."))
}
pub fn valid_repo(repo: &str) -> bool {
    let parts: Vec<_> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
}
pub async fn repositories(page: u32) -> Result<Repositories, String> {
    if !(1..=1000).contains(&page) {
        return Err("Página inválida.".into());
    }
    let data = github::api(&format!("user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100&page={page}")).await?;
    let rows = data.as_array().ok_or("Lista de repositórios inválida.")?;
    let mut items = Vec::new();
    for row in rows {
        if row["archived"] == true || row["disabled"] == true {
            continue;
        }
        let name = field(row, "full_name")?;
        if !valid_repo(&name) {
            return Err("Nome de repositório inválido retornado pelo GitHub.".into());
        }
        items.push(Repository {
            name,
            owner: field(&row["owner"], "login")?,
            private: row["private"] == true,
            language: row["language"].as_str().map(str::to_owned),
            topics: row["topics"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    Ok(Repositories {
        items,
        has_more: rows.len() == 100,
    })
}
pub async fn pull_requests(
    repo: &str,
    page: u32,
    author: Option<&str>,
) -> Result<PullRequests, String> {
    if !valid_repo(repo) || !(1..=1000).contains(&page) {
        return Err("Repositório ou página inválida.".into());
    }
    let author = author.filter(|a| !a.is_empty());
    if author.is_some_and(|a| {
        a.len() > 100
            || !a
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-[]".contains(c))
    }) {
        return Err("Login do autor inválido.".into());
    }
    if author.is_some() && page > 100 {
        return Err("Busca do GitHub limitada a 1.000 resultados por repo/autor.".into());
    }
    let endpoint = if let Some(author) = author {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("q", &format!("repo:{repo} is:pr is:open author:{author}"))
            .finish();
        format!("search/issues?{query}&sort=created&order=desc&per_page=10&page={page}")
    } else {
        format!("repos/{repo}/pulls?state=open&sort=created&direction=desc&per_page=10&page={page}")
    };
    let data = github::api(&endpoint).await?;
    let rows = if author.is_some() {
        data["items"].as_array()
    } else {
        data.as_array()
    }
    .ok_or("Lista de PRs inválida.")?;
    let warning =
        if data["incomplete_results"] == true || data["total_count"].as_u64().unwrap_or(0) > 1000 {
            Some("Busca parcial: o GitHub limitou os resultados deste autor/repositório.".into())
        } else {
            None
        };
    let mut items = Vec::new();
    for row in rows {
        let number = row["number"].as_u64().ok_or("PR sem número.")?;
        items.push(PullRequest {
            number,
            title: field(row, "title")?,
            url: format!("https://github.com/{repo}/pull/{number}"),
            author: field(&row["user"], "login")?,
            head_sha: row["head"]["sha"].as_str().unwrap_or_default().into(),
            base_sha: row["base"]["sha"].as_str().unwrap_or_default().into(),
            draft: row["draft"] == true,
            created_at: field(row, "created_at")?,
            head: row["head"]["ref"].as_str().unwrap_or_default().into(),
            base: row["base"]["ref"].as_str().unwrap_or_default().into(),
        });
    }
    Ok(PullRequests {
        items,
        has_more: rows.len() == 10 && (author.is_none() || page < 100),
        warning,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_accepts_literal_repository_paths() {
        assert!(valid_repo("owner/repo.name"));
        for name in ["a", "a/b/c", "a/b?per_page=100", "a/..", "a/", "a/b#x"] {
            assert!(!valid_repo(name));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLabels {
    pub labels: Vec<String>,
    pub outside: bool,
}
fn classify(paths: &[String], codebases: &[crate::progress::Codebase]) -> ServiceLabels {
    let mut labels = std::collections::BTreeSet::new();
    let mut outside = false;
    for path in paths {
        let mut matched = false;
        for codebase in codebases {
            if path == &codebase.path || path.starts_with(&format!("{}/", codebase.path)) {
                labels.insert(codebase.label.clone());
                matched = true;
            }
        }
        if !matched {
            outside = true;
        }
    }
    ServiceLabels {
        labels: labels.into_iter().collect(),
        outside,
    }
}
pub async fn service_labels(
    repo: &str,
    number: u64,
    head_sha: &str,
    base_sha: &str,
    codebases: &[crate::progress::Codebase],
) -> Result<ServiceLabels, String> {
    if !valid_repo(repo) || number == 0 {
        return Err("PR inválida.".into());
    }
    let endpoint = format!("repos/{repo}/pulls/{number}");
    let before = github::api(&endpoint).await?;
    if (!head_sha.is_empty() && before["head"]["sha"] != head_sha)
        || (!base_sha.is_empty() && before["base"]["sha"] != base_sha)
    {
        return Err("PR atualizada. Atualize a lista para identificar os serviços.".into());
    }
    let count = before["changed_files"]
        .as_u64()
        .ok_or("Contagem de arquivos indisponível.")?;
    if count > 3000 {
        return Err("Mais de 3.000 arquivos: serviços não identificados integralmente.".into());
    }
    let mut paths = Vec::new();
    let mut listed = 0;
    for page in 1..=30 {
        let data = github::api(&format!("{endpoint}/files?per_page=100&page={page}")).await?;
        let files = data.as_array().ok_or("Lista de arquivos inválida.")?;
        listed += files.len() as u64;
        for file in files {
            paths.push(field(file, "filename")?);
            if let Some(old) = file["previous_filename"].as_str() {
                paths.push(old.into());
            }
        }
        if files.len() < 100 || listed == count {
            break;
        }
    }
    let after = github::api(&endpoint).await?;
    if listed != count
        || after["head"]["sha"] != before["head"]["sha"]
        || after["base"]["sha"] != before["base"]["sha"]
    {
        return Err("PR mudou ou lista incompleta. Atualize para identificar os serviços.".into());
    }
    Ok(classify(&paths, codebases))
}
#[cfg(test)]
mod codebase_tests {
    use super::*;
    #[test]
    fn matches_directory_boundaries_and_all_services() {
        let config = vec![
            crate::progress::Codebase {
                path: "apps/api".into(),
                label: "API".into(),
            },
            crate::progress::Codebase {
                path: "apps/web".into(),
                label: "Web".into(),
            },
        ];
        let result = classify(
            &[
                "apps/api/handler.ts".into(),
                "apps/web/app.ts".into(),
                "apps/api-other/test".into(),
            ],
            &config,
        );
        assert_eq!(result.labels, vec!["API", "Web"]);
        assert!(result.outside);
        assert!(!classify(&["apps/api/a.ts".into()], &config).outside);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires authenticated gh and network; read-only"]
    async fn live_discovery() {
        let repos = repositories(1).await.unwrap();
        assert!(repos.items.iter().all(|r| valid_repo(&r.name)));
        let prs = pull_requests("cli/cli", 1, None).await.unwrap();
        if let Some(pr) = prs.items.first() {
            let labels = service_labels(
                "cli/cli",
                pr.number,
                &pr.head_sha,
                &pr.base_sha,
                &[crate::progress::Codebase {
                    path: "pkg".into(),
                    label: "CLI packages".into(),
                }],
            )
            .await
            .unwrap();
            assert!(labels.labels.iter().all(|label| label == "CLI packages"));
        }
        eprintln!("Authenticated repository discovery succeeded; public PR listing and service classification succeeded.");
    }
}
