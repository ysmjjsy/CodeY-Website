use std::collections::BTreeMap;

use base64::Engine as _;
use codey_package_format::{
    parse_archive, AgentComponentKind, AgentPackageArchive, ExecutionTargetKind,
    PackageComponentSource, PackageDefinitionKind, PackageFormatError,
};
use thiserror::Error;

use crate::contracts::{
    MarketplaceCompatibility, MarketplacePrimaryResource, MarketplaceResourceSummary,
    MarketplaceUploadPreview, PackageMarketplaceMetadataDocument, PublishMarketplaceUploadRequest,
    PACKAGE_MARKETPLACE_MANIFEST_PATH, PACKAGE_MARKETPLACE_METADATA_SCHEMA_VERSION,
};

#[derive(Debug, Clone)]
pub struct InspectedArchive {
    pub archive: AgentPackageArchive,
    pub preview: MarketplaceUploadPreview,
}

pub fn inspect_archive(
    upload_id: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    bytes: &[u8],
) -> Result<InspectedArchive, ArchiveInspectionError> {
    let archive = parse_archive(bytes)?;
    let archive_length =
        u64::try_from(bytes.len()).map_err(|_| ArchiveInspectionError::TooLarge)?;
    let archive_hash = blake3::hash(bytes).to_hex().to_string();
    let files = decoded_files(&archive)?;
    let (resources, available_primary_resources) = marketplace_resources(&archive, &files)?;
    if available_primary_resources.is_empty() {
        return Err(ArchiveInspectionError::NoMarketplaceResource);
    }
    let manifest = &archive.package.manifest;
    let publication = marketplace_publication(&files, &available_primary_resources)?;
    let preview = MarketplaceUploadPreview {
        upload_id,
        expires_at,
        package_id: manifest.package_id.to_string(),
        version: manifest.version.clone(),
        package_revision_id: manifest.package_revision_id.clone(),
        package_content_hash: manifest.package_content_hash.clone(),
        archive_hash,
        archive_length,
        publisher_id: manifest.publisher.publisher_id.clone(),
        publisher_display_name: manifest.publisher.display_name.clone(),
        license: manifest.license.clone(),
        compatibility: MarketplaceCompatibility {
            codey_version_range: manifest.compatibility.codey_version_range.clone(),
            platforms: manifest.compatibility.platforms.iter().cloned().collect(),
            architectures: manifest
                .compatibility
                .architectures
                .iter()
                .cloned()
                .collect(),
        },
        available_primary_resources,
        resources,
        requested_permissions: manifest.requested_permissions.iter().cloned().collect(),
        publication,
        manifest: serde_json::to_value(manifest)?,
    };
    Ok(InspectedArchive { archive, preview })
}

fn marketplace_publication(
    files: &BTreeMap<String, Vec<u8>>,
    available_primary_resources: &[MarketplaceResourceSummary],
) -> Result<PublishMarketplaceUploadRequest, ArchiveInspectionError> {
    let metadata_bytes = files
        .get(PACKAGE_MARKETPLACE_MANIFEST_PATH)
        .ok_or(ArchiveInspectionError::MarketplaceMetadataMissing)?;
    let metadata: PackageMarketplaceMetadataDocument = serde_json::from_slice(metadata_bytes)
        .map_err(|error| ArchiveInspectionError::MarketplaceMetadata(error.to_string()))?;
    if metadata.schema_version != PACKAGE_MARKETPLACE_METADATA_SCHEMA_VERSION {
        return Err(ArchiveInspectionError::MarketplaceMetadata(
            "unsupported schema version".into(),
        ));
    }
    if !available_primary_resources
        .iter()
        .any(|resource| resource.resource == metadata.primary_resource)
    {
        return Err(ArchiveInspectionError::MarketplaceMetadata(
            "primary resource is not an embedded marketplace resource".into(),
        ));
    }
    let readme_markdown = referenced_utf8(files, metadata.readme_path.as_deref(), 256 * 1024)?;
    let changelog = referenced_utf8(files, metadata.changelog_path.as_deref(), 64 * 1024)?;
    let publication = PublishMarketplaceUploadRequest {
        primary_resource: metadata.primary_resource,
        title: metadata.title.trim().to_owned(),
        summary: metadata.summary.trim().to_owned(),
        tags: normalized_tags(&metadata.tags),
        readme_markdown,
        changelog,
    };
    if publication.title.is_empty()
        || publication.title.len() > 160
        || publication.summary.is_empty()
        || publication.summary.len() > 500
        || publication.tags.len() > 16
        || publication.tags.iter().any(|tag| tag.len() > 48)
    {
        return Err(ArchiveInspectionError::MarketplaceMetadata(
            "listing title, summary, or tags are invalid".into(),
        ));
    }
    Ok(publication)
}

fn referenced_utf8(
    files: &BTreeMap<String, Vec<u8>>,
    path: Option<&str>,
    max_bytes: usize,
) -> Result<String, ArchiveInspectionError> {
    let Some(path) = path else {
        return Ok(String::new());
    };
    let bytes = files.get(path).ok_or_else(|| {
        ArchiveInspectionError::MarketplaceMetadata(format!(
            "referenced marketplace file is missing: {path}"
        ))
    })?;
    if bytes.len() > max_bytes {
        return Err(ArchiveInspectionError::MarketplaceMetadata(format!(
            "referenced marketplace file exceeds {max_bytes} bytes: {path}"
        )));
    }
    String::from_utf8(bytes.clone()).map_err(|_| {
        ArchiveInspectionError::MarketplaceMetadata(format!(
            "referenced marketplace file is not UTF-8: {path}"
        ))
    })
}

fn normalized_tags(tags: &[String]) -> Vec<String> {
    let mut tags = tags
        .iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();
    tags
}

fn decoded_files(
    archive: &AgentPackageArchive,
) -> Result<BTreeMap<String, Vec<u8>>, ArchiveInspectionError> {
    archive
        .files
        .iter()
        .map(|file| {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&file.content_base64)
                .map_err(|_| ArchiveInspectionError::Encoding)?;
            Ok((file.relative_path.clone(), bytes))
        })
        .collect()
}

fn marketplace_resources(
    archive: &AgentPackageArchive,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<
    (
        Vec<MarketplaceResourceSummary>,
        Vec<MarketplaceResourceSummary>,
    ),
    ArchiveInspectionError,
> {
    let manifest = &archive.package.manifest;
    let mut resources = Vec::new();
    let mut available_primary_resources = Vec::new();
    for entry in &manifest.definitions {
        let produces = match entry.kind {
            PackageDefinitionKind::Agent => ExecutionTargetKind::Agent,
            PackageDefinitionKind::Team => ExecutionTargetKind::Team,
            PackageDefinitionKind::Workflow => ExecutionTargetKind::Workflow,
        };
        let envelope = definition_envelope(files, &entry.relative_path)?;
        let resource = MarketplaceResourceSummary {
            resource: MarketplacePrimaryResource::Definition {
                produces,
                definition_id: entry.definition_id.clone(),
                revision: entry.revision.clone(),
            },
            display_name: definition_display_name(&envelope)
                .unwrap_or_else(|| entry.definition_id.clone()),
        };
        available_primary_resources.push(resource.clone());
        resources.push(resource);
    }
    for entry in &manifest.templates {
        let envelope = definition_envelope(files, &entry.relative_path)?;
        let produces = envelope
            .get("spec")
            .and_then(|spec| spec.get("produces"))
            .cloned()
            .ok_or(ArchiveInspectionError::TemplateMetadata)
            .and_then(|value| {
                serde_json::from_value::<ExecutionTargetKind>(value)
                    .map_err(|_| ArchiveInspectionError::TemplateMetadata)
            })?;
        let resource = MarketplaceResourceSummary {
            resource: MarketplacePrimaryResource::Template {
                produces,
                template_id: entry.template_id.clone(),
                revision: entry.revision.clone(),
            },
            display_name: definition_display_name(&envelope)
                .unwrap_or_else(|| entry.template_id.clone()),
        };
        available_primary_resources.push(resource.clone());
        resources.push(resource);
    }
    for entry in &manifest.components {
        if !matches!(
            entry.kind,
            AgentComponentKind::Skill | AgentComponentKind::Mcp
        ) {
            continue;
        }
        let resource = MarketplaceResourceSummary {
            resource: MarketplacePrimaryResource::Component {
                kind: entry.kind,
                component_id: entry.component_id.clone(),
                revision: entry.revision.clone(),
            },
            display_name: entry.logical_name.clone(),
        };
        if matches!(&entry.source, PackageComponentSource::Embedded { .. }) {
            available_primary_resources.push(resource.clone());
        }
        resources.push(resource);
    }
    resources.sort_by(|left, right| {
        left.display_name
            .cmp(&right.display_name)
            .then_with(|| format!("{:?}", left.resource).cmp(&format!("{:?}", right.resource)))
    });
    available_primary_resources.sort_by(|left, right| {
        left.display_name
            .cmp(&right.display_name)
            .then_with(|| format!("{:?}", left.resource).cmp(&format!("{:?}", right.resource)))
    });
    Ok((resources, available_primary_resources))
}

fn definition_envelope(
    files: &BTreeMap<String, Vec<u8>>,
    path: &str,
) -> Result<serde_json::Value, ArchiveInspectionError> {
    let bytes = files
        .get(path)
        .ok_or_else(|| ArchiveInspectionError::MissingFile(path.to_owned()))?;
    serde_json::from_slice(bytes).map_err(ArchiveInspectionError::from)
}

fn definition_display_name(envelope: &serde_json::Value) -> Option<String> {
    envelope
        .get("spec")
        .and_then(|spec| spec.get("displayName"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

#[derive(Debug, Error)]
pub enum ArchiveInspectionError {
    #[error("package archive is not canonical")]
    NonCanonical,
    #[error("package archive exceeds the configured limit")]
    TooLarge,
    #[error("package archive encoding is invalid")]
    Encoding,
    #[error(
        "package does not contain an Agent, Team, Workflow, Skill, or MCP marketplace resource"
    )]
    NoMarketplaceResource,
    #[error("package does not contain marketplace/manifest.json")]
    MarketplaceMetadataMissing,
    #[error("package marketplace metadata is invalid: {0}")]
    MarketplaceMetadata(String),
    #[error("template metadata is invalid")]
    TemplateMetadata,
    #[error("package file is missing: {0}")]
    MissingFile(String),
    #[error(transparent)]
    Package(#[from] PackageFormatError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
