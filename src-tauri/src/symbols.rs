//! Syntax-based declaration candidates. Never claims type/import resolution.
use crate::repository::Document;
use serde::Serialize;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tree_sitter::{Language, Node, Parser};

pub fn language(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()? {
        "py" | "pyi" => Some("python"),
        "java" => Some("java"),
        "cs" => Some("csharp"),
        "go" => Some("go"),
        "rs" => Some("rust"),
        "c" => Some("c"),
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" | "h" => Some("cpp"),
        "php" | "phtml" => Some("php"),
        _ => None,
    }
}
pub fn accepts(lang: &str, path: &str) -> bool {
    // C and C++ share declarations through headers.
    language(path) == Some(lang) || (lang == "c" && path.ends_with(".h"))
}
fn grammar(lang: &str) -> Result<Language, String> {
    Ok(match lang {
        "python" => tree_sitter_python::LANGUAGE.into(),
        "java" => tree_sitter_java::LANGUAGE.into(),
        "csharp" => tree_sitter_c_sharp::LANGUAGE.into(),
        "go" => tree_sitter_go::LANGUAGE.into(),
        "rust" => tree_sitter_rust::LANGUAGE.into(),
        "c" => tree_sitter_c::LANGUAGE.into(),
        "cpp" => tree_sitter_cpp::LANGUAGE.into(),
        "php" => tree_sitter_php::LANGUAGE_PHP.into(),
        _ => return Err("Linguagem sem parser de definições".into()),
    })
}
fn parse(lang: &str, text: &str) -> Result<tree_sitter::Tree, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&grammar(lang)?)
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    let mut progress = |_: &tree_sitter::ParseState| {
        if started.elapsed() > Duration::from_millis(500) {
            std::ops::ControlFlow::Break(())
        } else {
            std::ops::ControlFlow::Continue(())
        }
    };
    parser
        .parse_with_options(
            &mut |offset, _| text.as_bytes().get(offset..).unwrap_or_default(),
            None,
            Some(tree_sitter::ParseOptions::new().progress_callback(&mut progress)),
        )
        .ok_or_else(|| "Análise sintática excedeu 500 ms por arquivo".into())
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
}
#[derive(Default)]
pub struct Index {
    names: HashMap<String, Vec<Symbol>>,
    pub warnings: Vec<String>,
    pub files: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Definitions {
    pub targets: Vec<Symbol>,
    pub warnings: Vec<String>,
    pub indexed_files: usize,
}
fn point(text: &str, byte: usize, row: usize) -> (u32, u32) {
    let prefix = &text[..byte];
    let line = row as u32 + 1;
    let column = prefix
        .rsplit('\n')
        .next()
        .unwrap_or("")
        .encode_utf16()
        .count() as u32
        + 1;
    (line, column)
}
fn declarator_name(node: Node<'_>) -> Option<Node<'_>> {
    if matches!(
        node.kind(),
        "identifier" | "field_identifier" | "type_identifier" | "name"
    ) {
        return Some(node);
    }
    for field in ["name", "declarator"] {
        if let Some(n) = node.child_by_field_name(field).and_then(declarator_name) {
            return Some(n);
        }
    }
    None
}
fn declaration<'a>(node: Node<'a>, lang: &str) -> Option<Node<'a>> {
    let kind = node.kind();
    let allowed = match lang {
        "python" => matches!(kind, "function_definition" | "class_definition"),
        "java" => matches!(
            kind,
            "method_declaration"
                | "constructor_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "enum_declaration"
                | "record_declaration"
                | "annotation_type_declaration"
        ),
        "csharp" => matches!(
            kind,
            "method_declaration"
                | "local_function_statement"
                | "constructor_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "struct_declaration"
                | "enum_declaration"
                | "record_declaration"
                | "delegate_declaration"
                | "property_declaration"
        ),
        "go" => matches!(
            kind,
            "function_declaration" | "method_declaration" | "type_spec"
        ),
        "rust" => matches!(
            kind,
            "function_item"
                | "function_signature_item"
                | "struct_item"
                | "enum_item"
                | "trait_item"
                | "type_item"
                | "const_item"
                | "static_item"
                | "macro_definition"
        ),
        "c" | "cpp" => matches!(
            kind,
            "function_definition"
                | "struct_specifier"
                | "class_specifier"
                | "enum_specifier"
                | "union_specifier"
                | "type_definition"
                | "alias_declaration"
        ),
        "php" => matches!(
            kind,
            "function_definition"
                | "method_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "trait_declaration"
                | "enum_declaration"
        ),
        _ => false,
    };
    if allowed {
        declarator_name(node)
    } else {
        None
    }
}
fn extract(lang: &str, path: &str, text: &str) -> Result<(Vec<Symbol>, bool), String> {
    let tree = parse(lang, text)?;
    let mut symbols = Vec::new();
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        if let Some(name) = declaration(node, lang) {
            if !node.has_error() {
                let (line, column) = point(text, name.start_byte(), name.start_position().row);
                let (end_line, end_column) = point(text, name.end_byte(), name.end_position().row);
                symbols.push(Symbol {
                    path: path.into(),
                    name: text[name.byte_range()].into(),
                    kind: node.kind().into(),
                    line,
                    column,
                    end_line,
                    end_column,
                });
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return Ok((symbols, tree.root_node().has_error()));
            }
        }
    }
}
pub fn build(lang: &str, docs: Vec<Document>, warnings: Vec<String>) -> Result<Index, String> {
    let mut index = Index {
        warnings,
        ..Index::default()
    };
    let started = Instant::now();
    let mut count = 0;
    for doc in docs {
        if count >= 20_000 || started.elapsed() > Duration::from_secs(15) {
            index.warnings.push(
                "Índice de declarações parcial: limite de 20.000 símbolos ou 15 segundos.".into(),
            );
            break;
        }
        let Some(text) = doc.text else { continue };
        match extract(lang, &doc.path, &text) {
            Ok((symbols, incomplete)) => {
                index.files += 1;
                if incomplete
                    && !index
                        .warnings
                        .iter()
                        .any(|w| w.contains("erros de sintaxe"))
                {
                    index.warnings.push(
                        "Há arquivos com erros de sintaxe; declarações incompletas foram omitidas."
                            .into(),
                    );
                }
                for symbol in symbols.into_iter().take(20_000 - count) {
                    index
                        .names
                        .entry(symbol.name.clone())
                        .or_default()
                        .push(symbol);
                    count += 1;
                }
            }
            Err(e) => {
                if index.warnings.len() < 8 {
                    index.warnings.push(format!("{}: {e}", doc.path));
                }
            }
        }
    }
    Ok(index)
}
// Monaco and LSP positions use UTF-16, Tree-sitter uses UTF-8 byte columns.
fn offset(text: &str, line: u32, column: u32) -> Option<usize> {
    if line == 0 || column == 0 {
        return None;
    }
    let mut start = 0;
    for (i, row) in text.split_inclusive('\n').enumerate() {
        if i + 1 == line as usize {
            let mut utf16 = 1;
            for (byte, c) in row.char_indices() {
                if utf16 == column {
                    return Some(start + byte);
                }
                utf16 += c.len_utf16() as u32;
            }
            return (utf16 == column).then_some(start + row.len());
        }
        start += row.len();
    }
    None
}
fn identifier(lang: &str, text: &str, line: u32, column: u32) -> Result<Option<String>, String> {
    let Some(mut byte) = offset(text, line, column) else {
        return Ok(None);
    };
    if byte > 0
        && text[..byte]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
        && !text[byte..]
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
    {
        byte -= text[..byte].chars().next_back().unwrap().len_utf8();
    }
    let tree = parse(lang, text)?;
    let Some(node) = tree.root_node().descendant_for_byte_range(byte, byte) else {
        return Ok(None);
    };
    if !matches!(
        node.kind(),
        "identifier" | "field_identifier" | "type_identifier" | "name"
    ) {
        return Ok(None);
    }
    let mut parent = node.parent();
    while let Some(n) = parent {
        if matches!(
            n.kind(),
            "comment"
                | "line_comment"
                | "block_comment"
                | "string"
                | "string_literal"
                | "string_content"
                | "encapsed_string"
        ) {
            return Ok(None);
        }
        parent = n.parent();
    }
    Ok(Some(text[node.byte_range()].into()))
}
pub fn find(
    index: &Index,
    lang: &str,
    doc: &Document,
    line: u32,
    column: u32,
) -> Result<Definitions, String> {
    let text = doc
        .text
        .as_deref()
        .ok_or("Arquivo indisponível para análise")?;
    let name = identifier(lang, text, line, column)?;
    let mut targets = name
        .and_then(|name| index.names.get(&name))
        .cloned()
        .unwrap_or_default();
    // Prefer nearby declarations, without discarding ambiguous candidates.
    targets.sort_by_key(|s| (s.path != doc.path, s.path.clone(), s.line));
    let mut warnings = index.warnings.clone();
    if targets.len() > 20 {
        targets.truncate(20);
        warnings.push(
            "Mostrando as primeiras 20 declarações candidatas. Refine a busca pelo explorador."
                .into(),
        );
    }
    Ok(Definitions {
        targets,
        warnings,
        indexed_files: index.files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn doc(path: &str, text: &str) -> Document {
        Document {
            path: path.into(),
            side: "head".into(),
            text: Some(Arc::new(text.into())),
            reason: None,
        }
    }
    #[test]
    fn definitions_across_files_in_all_eight_languages() {
        let cases = [
            (
                "python",
                "py",
                "def calculate(x):\n    return x * 2\nclass Service: pass\n",
                "calculate(2)\n",
            ),
            (
                "java",
                "java",
                "class Service { static int calculate(int x) { return x * 2; } }",
                "class Caller { int run() { return Service.calculate(2); } }",
            ),
            (
                "csharp",
                "cs",
                "class Service { public static int calculate(int x) { return x * 2; } }",
                "class Caller { int Run() { return Service.calculate(2); } }",
            ),
            (
                "go",
                "go",
                "package main\nfunc calculate(x int) int { return x * 2 }\ntype Service struct {}",
                "package main\nfunc main() { calculate(2) }",
            ),
            (
                "rust",
                "rs",
                "pub fn calculate(x: i32) -> i32 { x * 2 }\nstruct Service;",
                "fn main() { calculate(2); }",
            ),
            (
                "c",
                "c",
                "int calculate(int x) { return x * 2; }\nstruct Service { int x; };",
                "int main() { return calculate(2); }",
            ),
            (
                "cpp",
                "cpp",
                "int calculate(int x) { return x * 2; }\nclass Service {};",
                "int main() { return calculate(2); }",
            ),
            (
                "php",
                "php",
                "<?php function calculate($x) { return $x * 2; } class Service {}",
                "<?php calculate(2);",
            ),
        ];
        for (lang, ext, target, source) in cases {
            let index = build(
                lang,
                vec![doc(&format!("lib/service.{ext}"), target)],
                vec![],
            )
            .unwrap();
            assert!(
                index.names.contains_key("Service"),
                "class/type in {lang}: {:?}",
                index.names
            );
            let at = source.find("calculate").unwrap() + 3;
            let (line, column) = point(
                source,
                at,
                source[..at].bytes().filter(|c| *c == b'\n').count(),
            );
            let result = find(
                &index,
                lang,
                &doc(&format!("caller.{ext}"), source),
                line,
                column,
            )
            .unwrap();
            assert_eq!(result.targets.len(), 1, "{lang}: {:?}", index.names);
            assert_eq!(result.targets[0].name, "calculate");
            assert_eq!(result.targets[0].path, format!("lib/service.{ext}"));
        }
    }
    #[test]
    fn preserves_ambiguity_and_ignores_strings_comments_and_invalid_positions() {
        let text = "def calculate(x):\n    return x\n";
        let index = build("python", vec![doc("a.py", text), doc("b.py", text)], vec![]).unwrap();
        assert_eq!(
            find(&index, "python", &doc("caller.py", "calculate(2)"), 1, 3)
                .unwrap()
                .targets
                .len(),
            2
        );
        for (source, line, col) in [
            ("# calculate(2)", 1, 5),
            ("'calculate'", 1, 5),
            ("calculate(2)", 0, 3),
            ("calculate(2)", 1, 200),
        ] {
            assert!(find(&index, "python", &doc("caller.py", source), line, col)
                .unwrap()
                .targets
                .is_empty());
        }
        let empty = build("python", vec![], vec!["parcial".into()]).unwrap();
        assert_eq!(
            find(&empty, "python", &doc("caller.py", "calculate(2)"), 1, 3)
                .unwrap()
                .warnings,
            vec!["parcial"]
        );
    }
    #[test]
    fn unicode_positions_use_utf16_and_qualified_cpp_declarators_work() {
        let text = "é = '🦊'; calculate(2)";
        let index = build(
            "python",
            vec![doc("target.py", "def calculate(x): return x")],
            vec![],
        )
        .unwrap();
        let at = text.find("calculate").unwrap();
        let (_, col) = point(text, at, 0);
        assert_eq!(offset(text, 1, col), Some(at));
        assert_eq!(
            find(&index, "python", &doc("call.py", text), 1, col + 3)
                .unwrap()
                .targets
                .len(),
            1
        );
        let (symbols, _) = extract(
            "cpp",
            "calc.cpp",
            "int Service::calculate(int x) { return x; }",
        )
        .unwrap();
        assert_eq!(symbols[0].name, "calculate");
    }
}
