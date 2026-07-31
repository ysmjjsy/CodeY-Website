use std::collections::BTreeMap;

use crate::package_format::{
    parse_archive, CodeyPackageArchive, PackageFormatError, PackageResourceEntry,
    PackageResourceKind,
};
use thiserror::Error;

use crate::contracts::{
    AgentComponentKind, ExecutionTargetKind, MarketplaceCompatibility, MarketplacePrimaryResource,
    MarketplaceResourceSummary, MarketplaceUploadPreview, PackageMarketplaceMetadataDocument,
    PublishMarketplaceUploadRequest, PACKAGE_MARKETPLACE_MANIFEST_PATH,
    PACKAGE_MARKETPLACE_METADATA_SCHEMA_VERSION,
};

const PACKAGE_RESOURCE_DESCRIPTOR_PATH: &str = "codey/resource.json";

#[derive(Debug, Clone)]
pub struct InspectedArchive {
    pub archive: CodeyPackageArchive,
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
    let (resources, available_primary_resources) = marketplace_resources(&archive)?;
    if available_primary_resources.is_empty() {
        return Err(ArchiveInspectionError::NoMarketplaceResource);
    }
    let manifest = &archive.package.manifest;
    let publication = marketplace_publication(&archive.files, &available_primary_resources)?;
    let package_content_hash = archive.package.content_root()?;
    let preview = MarketplaceUploadPreview {
        upload_id,
        expires_at,
        package_id: manifest.package_id.to_string(),
        version: manifest.version.clone(),
        package_revision_id: package_revision_id(&package_content_hash),
        package_content_hash,
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
        requested_permissions: derived_permissions(&archive),
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

fn marketplace_resources(
    archive: &CodeyPackageArchive,
) -> Result<
    (
        Vec<MarketplaceResourceSummary>,
        Vec<MarketplaceResourceSummary>,
    ),
    ArchiveInspectionError,
> {
    let mut resources = Vec::new();
    let mut available_primary_resources = Vec::new();
    for entry in &archive.package.manifest.resources {
        let resource = match entry.kind {
            PackageResourceKind::Agent
            | PackageResourceKind::Team
            | PackageResourceKind::Workflow => definition_resource(archive, entry)?,
            PackageResourceKind::Template => template_resource(archive, entry)?,
            PackageResourceKind::Skill
            | PackageResourceKind::Mcp
            | PackageResourceKind::Plugin
            | PackageResourceKind::Hook
            | PackageResourceKind::Prompt
            | PackageResourceKind::Asset => component_resource(archive, entry)?,
        };
        available_primary_resources.push(resource.clone());
        resources.push(resource);
    }
    resources.sort_by(resource_order);
    available_primary_resources.sort_by(resource_order);
    Ok((resources, available_primary_resources))
}

fn definition_resource(
    archive: &CodeyPackageArchive,
    entry: &PackageResourceEntry,
) -> Result<MarketplaceResourceSummary, ArchiveInspectionError> {
    let path = format!("{}/definition.json", entry.root);
    let document = json_file(archive, &path)?;
    let produces = match entry.kind {
        PackageResourceKind::Agent => ExecutionTargetKind::Agent,
        PackageResourceKind::Team => ExecutionTargetKind::Team,
        PackageResourceKind::Workflow => ExecutionTargetKind::Workflow,
        _ => return Err(ArchiveInspectionError::ResourceMetadata),
    };
    let definition_id = required_string(&document, "definitionId")?;
    let revision = required_string(&document, "revision")?;
    Ok(MarketplaceResourceSummary {
        resource: MarketplacePrimaryResource::Definition {
            produces,
            definition_id: definition_id.clone(),
            revision,
        },
        display_name: definition_display_name(&document).unwrap_or(definition_id),
        files: resource_files(archive, entry),
    })
}

fn template_resource(
    archive: &CodeyPackageArchive,
    entry: &PackageResourceEntry,
) -> Result<MarketplaceResourceSummary, ArchiveInspectionError> {
    let path = format!("{}/template.json", entry.root);
    let document = json_file(archive, &path)?;
    let produces = document
        .get("spec")
        .and_then(|spec| spec.get("produces"))
        .cloned()
        .ok_or(ArchiveInspectionError::TemplateMetadata)
        .and_then(|value| {
            serde_json::from_value::<ExecutionTargetKind>(value)
                .map_err(|_| ArchiveInspectionError::TemplateMetadata)
        })?;
    let template_id = required_string(&document, "definitionId")?;
    let revision = required_string(&document, "revision")?;
    Ok(MarketplaceResourceSummary {
        resource: MarketplacePrimaryResource::Template {
            produces,
            template_id: template_id.clone(),
            revision,
        },
        display_name: definition_display_name(&document).unwrap_or(template_id),
        files: resource_files(archive, entry),
    })
}

fn component_resource(
    archive: &CodeyPackageArchive,
    entry: &PackageResourceEntry,
) -> Result<MarketplaceResourceSummary, ArchiveInspectionError> {
    let path = format!("{}/{PACKAGE_RESOURCE_DESCRIPTOR_PATH}", entry.root);
    let document = json_file(archive, &path)?;
    let kind = serde_json::from_value::<AgentComponentKind>(
        document
            .get("kind")
            .cloned()
            .ok_or(ArchiveInspectionError::ResourceMetadata)?,
    )
    .map_err(|_| ArchiveInspectionError::ResourceMetadata)?;
    if kind == AgentComponentKind::BuiltinToolCapability {
        return Err(ArchiveInspectionError::ResourceMetadata);
    }
    Ok(MarketplaceResourceSummary {
        resource: MarketplacePrimaryResource::Component {
            kind,
            component_id: required_string(&document, "componentId")?,
            revision: required_string(&document, "revision")?,
        },
        display_name: required_string(&document, "logicalName")?,
        files: resource_files(archive, entry),
    })
}

fn resource_files(archive: &CodeyPackageArchive, entry: &PackageResourceEntry) -> Vec<String> {
    let prefix = format!("{}/", entry.root);
    let descriptor = format!("{prefix}{PACKAGE_RESOURCE_DESCRIPTOR_PATH}");
    archive
        .files
        .keys()
        .filter(|path| path.starts_with(&prefix) && *path != &descriptor)
        .filter_map(|path| path.strip_prefix(&prefix).map(str::to_owned))
        .collect()
}

fn json_file(
    archive: &CodeyPackageArchive,
    path: &str,
) -> Result<serde_json::Value, ArchiveInspectionError> {
    serde_json::from_slice(
        archive
            .files
            .get(path)
            .ok_or_else(|| ArchiveInspectionError::MissingFile(path.into()))?,
    )
    .map_err(ArchiveInspectionError::from)
}

fn required_string(
    document: &serde_json::Value,
    field: &str,
) -> Result<String, ArchiveInspectionError> {
    document
        .get(field)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or(ArchiveInspectionError::ResourceMetadata)
}

fn definition_display_name(document: &serde_json::Value) -> Option<String> {
    document
        .get("spec")
        .and_then(|spec| spec.get("displayName"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

fn derived_permissions(archive: &CodeyPackageArchive) -> Vec<String> {
    let mut permissions = archive
        .package
        .manifest
        .resources
        .iter()
        .filter(|resource| {
            let prefix = format!("{}/", resource.root);
            archive
                .package
                .manifest
                .files
                .iter()
                .any(|file| file.executable && file.path.starts_with(&prefix))
        })
        .map(|resource| format!("executable_resource:{}", resource.resource_ref))
        .collect::<Vec<_>>();
    permissions.extend(
        archive
            .package
            .manifest
            .resources
            .iter()
            .filter(|resource| resource.kind == PackageResourceKind::Mcp)
            .map(|resource| format!("mcp_server:{}", resource.resource_ref)),
    );
    permissions.sort();
    permissions.dedup();
    permissions
}

fn resource_order(
    left: &MarketplaceResourceSummary,
    right: &MarketplaceResourceSummary,
) -> std::cmp::Ordering {
    left.display_name
        .cmp(&right.display_name)
        .then_with(|| format!("{:?}", left.resource).cmp(&format!("{:?}", right.resource)))
}

fn package_revision_id(content_root: &str) -> String {
    let digest = blake3::hash(content_root.as_bytes());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest.as_bytes()[..16]);
    bytes[0] &= 0x7f;
    ulid::Ulid::from(u128::from_be_bytes(bytes)).to_string()
}

#[derive(Debug, Error)]
pub enum ArchiveInspectionError {
    #[error("package archive exceeds the configured limit")]
    TooLarge,
    #[error("package archive encoding is invalid")]
    Encoding,
    #[error("package does not contain a publishable marketplace resource")]
    NoMarketplaceResource,
    #[error("package does not contain marketplace/listing.json")]
    MarketplaceMetadataMissing,
    #[error("package marketplace metadata is invalid: {0}")]
    MarketplaceMetadata(String),
    #[error("package resource metadata is invalid")]
    ResourceMetadata,
    #[error("template metadata is invalid")]
    TemplateMetadata,
    #[error("package file is missing: {0}")]
    MissingFile(String),
    #[error(transparent)]
    Package(#[from] PackageFormatError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
