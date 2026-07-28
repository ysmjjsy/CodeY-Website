use chrono::{DateTime, Utc};
use codey_package_format::{AgentComponentKind, ExecutionTargetKind, MAX_PACKAGE_ARCHIVE_BYTES};
use serde::{Deserialize, Serialize};

pub const MARKETPLACE_SCHEMA_VERSION: u16 = 1;
pub const MAX_PACKAGE_BYTES: usize = MAX_PACKAGE_ARCHIVE_BYTES;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketplaceListingKind {
    AgentTemplate,
    TeamTemplate,
    WorkflowTemplate,
    Skill,
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum MarketplacePrimaryResource {
    Definition {
        produces: ExecutionTargetKind,
        definition_id: String,
        revision: String,
    },
    Template {
        produces: ExecutionTargetKind,
        template_id: String,
        revision: String,
    },
    Component {
        kind: AgentComponentKind,
        component_id: String,
        revision: String,
    },
}

impl MarketplacePrimaryResource {
    pub const fn listing_kind(&self) -> Option<MarketplaceListingKind> {
        match self {
            Self::Definition {
                produces: ExecutionTargetKind::Agent,
                ..
            }
            | Self::Template {
                produces: ExecutionTargetKind::Agent,
                ..
            } => Some(MarketplaceListingKind::AgentTemplate),
            Self::Definition {
                produces: ExecutionTargetKind::Team,
                ..
            }
            | Self::Template {
                produces: ExecutionTargetKind::Team,
                ..
            } => Some(MarketplaceListingKind::TeamTemplate),
            Self::Definition {
                produces: ExecutionTargetKind::Workflow,
                ..
            }
            | Self::Template {
                produces: ExecutionTargetKind::Workflow,
                ..
            } => Some(MarketplaceListingKind::WorkflowTemplate),
            Self::Component {
                kind: AgentComponentKind::Skill,
                ..
            } => Some(MarketplaceListingKind::Skill),
            Self::Component {
                kind: AgentComponentKind::Mcp,
                ..
            } => Some(MarketplaceListingKind::Mcp),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceResourceSummary {
    pub resource: MarketplacePrimaryResource,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceCompatibility {
    pub codey_version_range: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub architectures: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceReleaseSummary {
    pub release_id: String,
    pub version: String,
    pub package_revision_id: String,
    pub package_content_hash: String,
    pub archive_hash: String,
    pub archive_length: u64,
    pub compatibility: MarketplaceCompatibility,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceListingSummary {
    pub listing_id: String,
    pub package_id: String,
    pub kind: MarketplaceListingKind,
    pub primary_resource: MarketplacePrimaryResource,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub publisher_id: String,
    pub publisher_display_name: String,
    pub latest_release: MarketplaceReleaseSummary,
    pub download_count: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceListingDetail {
    #[serde(flatten)]
    pub summary: MarketplaceListingSummary,
    pub readme_markdown: String,
    pub license: String,
    #[serde(default)]
    pub requested_permissions: Vec<String>,
    #[serde(default)]
    pub resources: Vec<MarketplaceResourceSummary>,
    #[serde(default)]
    pub releases: Vec<MarketplaceReleaseSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceReleaseDetail {
    #[serde(flatten)]
    pub summary: MarketplaceReleaseSummary,
    pub listing_id: String,
    pub package_id: String,
    pub kind: MarketplaceListingKind,
    pub primary_resource: MarketplacePrimaryResource,
    pub title: String,
    pub summary_text: String,
    pub readme_markdown: String,
    pub changelog: String,
    pub license: String,
    pub publisher_id: String,
    pub publisher_display_name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub requested_permissions: Vec<String>,
    #[serde(default)]
    pub resources: Vec<MarketplaceResourceSummary>,
    pub manifest: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceCatalogResponse {
    pub listings: Vec<MarketplaceListingSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceUploadPreview {
    pub upload_id: String,
    pub expires_at: DateTime<Utc>,
    pub package_id: String,
    pub version: String,
    pub package_revision_id: String,
    pub package_content_hash: String,
    pub archive_hash: String,
    pub archive_length: u64,
    pub publisher_id: String,
    pub publisher_display_name: String,
    pub license: String,
    pub compatibility: MarketplaceCompatibility,
    #[serde(default)]
    pub available_primary_resources: Vec<MarketplaceResourceSummary>,
    #[serde(default)]
    pub resources: Vec<MarketplaceResourceSummary>,
    #[serde(default)]
    pub requested_permissions: Vec<String>,
    pub manifest: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::{MarketplaceListingKind, MarketplacePrimaryResource};
    use codey_package_format::ExecutionTargetKind;

    #[test]
    fn workflow_resources_are_publishable_workflow_templates() {
        for resource in [
            MarketplacePrimaryResource::Definition {
                produces: ExecutionTargetKind::Workflow,
                definition_id: "workflow-id".into(),
                revision: "workflow-revision".into(),
            },
            MarketplacePrimaryResource::Template {
                produces: ExecutionTargetKind::Workflow,
                template_id: "template-id".into(),
                revision: "template-revision".into(),
            },
        ] {
            assert_eq!(
                resource.listing_kind(),
                Some(MarketplaceListingKind::WorkflowTemplate)
            );
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishMarketplaceUploadRequest {
    pub primary_resource: MarketplacePrimaryResource,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub readme_markdown: String,
    #[serde(default)]
    pub changelog: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceDiscovery {
    pub schema_version: u16,
    pub web_base_url: String,
    pub api_base_url: String,
    pub max_package_bytes: u64,
    pub upload_enabled: bool,
}
