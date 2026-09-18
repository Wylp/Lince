use crate::github::{FileDiff, Snapshot};
use serde::Serialize;
use std::{collections::BTreeMap, sync::Arc};
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
