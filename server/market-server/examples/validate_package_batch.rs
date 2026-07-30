use std::path::{Path, PathBuf};

use chrono::{Duration, Utc};
use codey_market_server::inspect_archive;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: validate_package_batch <directory>")?;
    let mut packages = Vec::new();
    collect_packages(&root, &mut packages)?;
    packages.sort();
    for (index, path) in packages.iter().enumerate() {
        let bytes = std::fs::read(path)?;
        let inspected = inspect_archive(
            format!("batch-validation-{index}"),
            Utc::now() + Duration::minutes(5),
            &bytes,
        )?;
        if inspected.preview.publication.title.trim().is_empty() {
            return Err(format!("empty marketplace title: {}", path.display()).into());
        }
    }
    println!("validated {} marketplace packages", packages.len());
    Ok(())
}

fn collect_packages(root: &Path, output: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_packages(&path, output)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("codeypkg") {
            output.push(path);
        }
    }
    Ok(())
}
