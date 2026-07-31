#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::io::{Cursor, Read, Write};
use std::str::FromStr;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use thiserror::Error;
use yaml_rust2::{Yaml, YamlLoader};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const PACKAGE_MANIFEST_SCHEMA_VERSION: u16 = 1;
pub const PACKAGE_LOCK_SCHEMA_VERSION: u16 = 1;
pub const PACKAGE_ARCHIVE_FORMAT_VERSION: u16 = 1;
pub const PACKAGE_CANONICALIZATION_VERSION: u16 = 1;
pub const PACKAGE_ARCHIVE_MEDIA_TYPE: &str = "application/vnd.codey.package+zip";
pub const PACKAGE_MANIFEST_PATH: &str = "codey/manifest.json";
pub const PACKAGE_LOCK_PATH: &str = "codey/lock.json";
pub const PACKAGE_SIGNATURE_PATH: &str = "codey/signatures/ed25519.json";
pub const MAX_PACKAGE_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_PACKAGE_EXPANDED_BYTES: usize = 1024 * 1024 * 1024;
pub const MAX_PACKAGE_FILE_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_PACKAGE_FILES: usize = 16_384;
pub const MAX_PACKAGE_PATH_BYTES: usize = 1024;

const SIGNATURE_DOMAIN: &[u8] = b"CODEY-PACKAGE-V1\0";

#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct PackageId(String);

impl PackageId {
    pub fn new(value: impl Into<String>) -> Result<Self, PackageFormatError> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 256
            || !value.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'.' | b'_' | b'-' | b'/')
            })
            || !value
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            || !value
                .bytes()
                .last()
                .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            || value.contains("//")
        {
            return Err(PackageFormatError::InvalidPackageId);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PackageId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Serialize for PackageId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for PackageId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl JsonSchema for PackageId {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "PackageId".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$"
        })
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct DecimalU64(u64);

impl DecimalU64 {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl fmt::Display for DecimalU64 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl FromStr for DecimalU64 {
    type Err = PackageFormatError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.is_empty()
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(PackageFormatError::InvalidDecimalU64);
        }
        value
            .parse::<u64>()
            .map(Self)
            .map_err(|_| PackageFormatError::InvalidDecimalU64)
    }
}

impl Serialize for DecimalU64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for DecimalU64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

impl JsonSchema for DecimalU64 {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "DecimalU64".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({"type": "string", "pattern": "^(0|[1-9][0-9]*)$"})
    }
}

#[derive(
    Debug, Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum PackageResourceKind {
    Agent,
    Team,
    Workflow,
    Template,
    Skill,
    Mcp,
    Plugin,
    Hook,
    Prompt,
    Asset,
}

impl PackageResourceKind {
    #[must_use]
    pub const fn path_segment(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Team => "team",
            Self::Workflow => "workflow",
            Self::Template => "template",
            Self::Skill => "skill",
            Self::Mcp => "mcp",
            Self::Plugin => "plugin",
            Self::Hook => "hook",
            Self::Prompt => "prompt",
            Self::Asset => "asset",
        }
    }

    #[must_use]
    pub const fn directory_segment(self) -> &'static str {
        match self {
            Self::Agent => "agents",
            Self::Team => "teams",
            Self::Workflow => "workflows",
            Self::Template => "templates",
            Self::Skill => "skills",
            Self::Mcp => "mcp",
            Self::Plugin => "plugins",
            Self::Hook => "hooks",
            Self::Prompt => "prompts",
            Self::Asset => "assets",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackagePublisher {
    pub publisher_id: String,
    pub display_name: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageCompatibility {
    pub codey_version_range: String,
    #[serde(default)]
    pub platforms: BTreeSet<String>,
    #[serde(default)]
    pub architectures: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageResourceEntry {
    pub resource_ref: String,
    pub kind: PackageResourceKind,
    pub format: String,
    pub root: String,
    pub digest: String,
}

impl PackageResourceEntry {
    fn validate(&self) -> Result<(), PackageFormatError> {
        validate_resource_ref(&self.resource_ref, self.kind)?;
        if self.format.trim().is_empty() || self.format.len() > 128 {
            return Err(PackageFormatError::InvalidResource);
        }
        validate_relative_package_path(&self.root)?;
        if !self
            .root
            .starts_with(&format!("resources/{}/", self.kind.directory_segment()))
            || self.root.rsplit_once('/').map(|(_, name)| name)
                != self.resource_ref.split_once('/').map(|(_, name)| name)
        {
            return Err(PackageFormatError::InvalidResource);
        }
        validate_blake3(&self.digest)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageDependency {
    pub package_id: PackageId,
    pub version_range: String,
    pub source: Option<String>,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageLockedDependency {
    pub package_id: PackageId,
    pub version: String,
    pub content_root: String,
    pub source: Option<String>,
    pub publisher_key_id: Option<String>,
    #[serde(default)]
    pub resources: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageLockedExternalArtifact {
    pub artifact_ref: String,
    pub source: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageDependencyLock {
    pub schema_version: u16,
    #[serde(default)]
    pub packages: Vec<PackageLockedDependency>,
    #[serde(default)]
    pub external_artifacts: Vec<PackageLockedExternalArtifact>,
    pub content_hash: String,
}

impl PackageDependencyLock {
    pub fn validate(&self) -> Result<(), PackageFormatError> {
        if self.schema_version != PACKAGE_LOCK_SCHEMA_VERSION {
            return Err(PackageFormatError::UnsupportedSchemaVersion);
        }
        let mut package_ids = BTreeSet::new();
        for package in &self.packages {
            if !package_ids.insert(package.package_id.clone())
                || package.version.trim().is_empty()
                || package.version.len() > 128
            {
                return Err(PackageFormatError::InvalidDependencyLock);
            }
            validate_blake3(&package.content_root)?;
            for (resource_ref, digest) in &package.resources {
                validate_untyped_resource_ref(resource_ref)?;
                validate_blake3(digest)?;
            }
        }
        let mut artifacts = BTreeSet::new();
        for artifact in &self.external_artifacts {
            if artifact.artifact_ref.trim().is_empty()
                || artifact.source.trim().is_empty()
                || !artifacts.insert(&artifact.artifact_ref)
                || !is_lower_hex(&artifact.sha256, 64)
            {
                return Err(PackageFormatError::InvalidDependencyLock);
            }
        }
        validate_blake3(&self.content_hash)?;
        if package_dependency_lock_hash(self)? != self.content_hash {
            return Err(PackageFormatError::InvalidDependencyLock);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageFileEntry {
    pub path: String,
    pub length: DecimalU64,
    pub blake3: String,
    #[serde(default)]
    pub executable: bool,
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageManifest {
    pub schema_version: u16,
    pub archive_format_version: u16,
    pub canonicalization_version: u16,
    pub package_id: PackageId,
    pub namespace: String,
    pub version: String,
    pub publisher: PackagePublisher,
    pub source: Option<String>,
    pub license: String,
    pub compatibility: PackageCompatibility,
    #[serde(default)]
    pub resources: Vec<PackageResourceEntry>,
    #[serde(default)]
    pub dependencies: Vec<PackageDependency>,
    pub files: Vec<PackageFileEntry>,
    #[serde(default)]
    pub extensions: BTreeMap<String, Value>,
}

impl PackageManifest {
    pub fn validate(&self) -> Result<(), PackageFormatError> {
        if self.schema_version != PACKAGE_MANIFEST_SCHEMA_VERSION
            || self.archive_format_version != PACKAGE_ARCHIVE_FORMAT_VERSION
            || self.canonicalization_version != PACKAGE_CANONICALIZATION_VERSION
        {
            return Err(PackageFormatError::UnsupportedSchemaVersion);
        }
        if self.namespace.trim().is_empty()
            || self.namespace.len() > 256
            || self.version.trim().is_empty()
            || self.version.len() > 128
            || self.publisher.publisher_id.trim().is_empty()
            || self.publisher.display_name.trim().is_empty()
            || self.license.trim().is_empty()
            || self.resources.is_empty()
            || self.files.is_empty()
            || self.files.len() > MAX_PACKAGE_FILES
        {
            return Err(PackageFormatError::InvalidManifest);
        }

        let mut resource_refs = BTreeSet::new();
        let mut resource_roots = BTreeSet::new();
        for resource in &self.resources {
            resource.validate()?;
            if !resource_refs.insert(resource.resource_ref.as_str())
                || !resource_roots.insert(resource.root.as_str())
            {
                return Err(PackageFormatError::DuplicateResource);
            }
        }

        let mut dependency_ids = BTreeSet::new();
        for dependency in &self.dependencies {
            if dependency.package_id == self.package_id
                || dependency.version_range.trim().is_empty()
                || dependency.version_range.len() > 128
                || !dependency_ids.insert(dependency.package_id.clone())
            {
                return Err(PackageFormatError::InvalidDependency);
            }
        }

        let mut paths = BTreeSet::new();
        let mut folded_paths = BTreeSet::new();
        let mut previous_path: Option<&str> = None;
        for file in &self.files {
            validate_relative_package_path(&file.path)?;
            validate_blake3(&file.blake3)?;
            if file.path == PACKAGE_MANIFEST_PATH
                || file.path == PACKAGE_SIGNATURE_PATH
                || file.path.starts_with("codey/signatures/")
                || file.length.get() > u64::try_from(MAX_PACKAGE_FILE_BYTES).unwrap_or(u64::MAX)
                || previous_path.is_some_and(|previous| previous >= file.path.as_str())
                || !paths.insert(file.path.as_str())
                || !folded_paths.insert(file.path.to_lowercase())
            {
                return Err(PackageFormatError::DuplicatePackagePath);
            }
            if file.executable && !executable_path_allowed(&file.path, &self.resources) {
                return Err(PackageFormatError::ExecutableFileDenied);
            }
            previous_path = Some(&file.path);
        }
        if !paths.contains(PACKAGE_LOCK_PATH) {
            return Err(PackageFormatError::MissingLock);
        }
        for resource in &self.resources {
            let prefix = format!("{}/", resource.root);
            if !paths
                .iter()
                .any(|path| *path == resource.root || path.starts_with(&prefix))
            {
                return Err(PackageFormatError::InvalidResource);
            }
        }
        for key in self.extensions.keys() {
            if !valid_extension_key(key) {
                return Err(PackageFormatError::InvalidExtension);
            }
        }
        canonical_json_bytes(&self.extensions)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PackageSignatureAlgorithm {
    Ed25519,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageSignatureEnvelope {
    pub algorithm: PackageSignatureAlgorithm,
    pub key_id: String,
    pub content_root: String,
    pub signature: String,
}

impl PackageSignatureEnvelope {
    fn validate(&self, expected_content_root: &str) -> Result<(), PackageFormatError> {
        if self.key_id.trim().is_empty()
            || self.signature.trim().is_empty()
            || self.content_root != expected_content_root
        {
            return Err(PackageFormatError::InvalidSignatureEnvelope);
        }
        validate_blake3(&self.content_root)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeyPackage {
    pub manifest: PackageManifest,
    pub dependency_lock: PackageDependencyLock,
    pub signature: Option<PackageSignatureEnvelope>,
}

impl CodeyPackage {
    pub fn validate(&self) -> Result<(), PackageFormatError> {
        self.manifest.validate()?;
        self.dependency_lock.validate()?;
        let dependency_ids = self
            .manifest
            .dependencies
            .iter()
            .map(|dependency| &dependency.package_id)
            .collect::<BTreeSet<_>>();
        let locked_ids = self
            .dependency_lock
            .packages
            .iter()
            .map(|dependency| &dependency.package_id)
            .collect::<BTreeSet<_>>();
        if dependency_ids != locked_ids {
            return Err(PackageFormatError::InvalidDependencyLock);
        }
        let content_root = self.content_root()?;
        if let Some(signature) = &self.signature {
            signature.validate(&content_root)?;
        }
        Ok(())
    }

    pub fn content_root(&self) -> Result<String, PackageFormatError> {
        package_content_root(&self.manifest)
    }

    pub fn signature_payload(&self) -> Result<Vec<u8>, PackageFormatError> {
        let content_root = self.content_root()?;
        let mut payload = Vec::with_capacity(SIGNATURE_DOMAIN.len() + content_root.len());
        payload.extend_from_slice(SIGNATURE_DOMAIN);
        payload.extend_from_slice(content_root.as_bytes());
        Ok(payload)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CodeyPackageArchive {
    pub package: CodeyPackage,
    pub files: BTreeMap<String, Vec<u8>>,
}

impl CodeyPackageArchive {
    pub fn validate(&self) -> Result<(), PackageFormatError> {
        self.package.validate()?;
        validate_payload_files(&self.package.manifest, &self.files)?;
        let lock_bytes = self
            .files
            .get(PACKAGE_LOCK_PATH)
            .ok_or(PackageFormatError::MissingLock)?;
        if canonical_json_bytes(&self.package.dependency_lock)? != *lock_bytes {
            return Err(PackageFormatError::InvalidDependencyLock);
        }
        for resource in &self.package.manifest.resources {
            if package_resource_digest(&resource.root, &self.package.manifest.files)?
                != resource.digest
            {
                return Err(PackageFormatError::ResourceDigestMismatch);
            }
            validate_resource_profile(resource, &self.files)?;
        }
        Ok(())
    }

    pub fn encode(&self) -> Result<Vec<u8>, PackageFormatError> {
        self.validate()?;
        let mut entries = self.files.clone();
        entries.insert(
            PACKAGE_MANIFEST_PATH.to_owned(),
            canonical_json_bytes(&self.package.manifest)?,
        );
        if let Some(signature) = &self.package.signature {
            entries.insert(
                PACKAGE_SIGNATURE_PATH.to_owned(),
                canonical_json_bytes(signature)?,
            );
        }
        encode_zip(&entries)
    }
}

pub fn parse_archive(bytes: &[u8]) -> Result<CodeyPackageArchive, PackageFormatError> {
    parse_archive_with_limit(bytes, MAX_PACKAGE_ARCHIVE_BYTES)
}

pub fn parse_archive_with_limit(
    bytes: &[u8],
    max_archive_bytes: usize,
) -> Result<CodeyPackageArchive, PackageFormatError> {
    if bytes.is_empty() || bytes.len() > max_archive_bytes {
        return Err(PackageFormatError::ArchiveTooLarge);
    }
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;
    if zip.len() == 0 || zip.len() > MAX_PACKAGE_FILES.saturating_add(2) {
        return Err(PackageFormatError::ArchiveFileCount);
    }
    let mut entries = BTreeMap::new();
    let mut folded_paths = BTreeSet::new();
    let mut expanded = 0_usize;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index)?;
        if file.is_dir()
            || file.encrypted()
            || !matches!(
                file.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
            || file.unix_mode().is_some_and(|mode| {
                let file_type = mode & 0o170_000;
                file_type != 0 && file_type != 0o100_000
            })
        {
            return Err(PackageFormatError::UnsafeArchiveEntry);
        }
        let path = file.name().to_owned();
        validate_relative_package_path(&path)?;
        if !folded_paths.insert(path.to_lowercase()) || entries.contains_key(&path) {
            return Err(PackageFormatError::DuplicatePackagePath);
        }
        let declared_size =
            usize::try_from(file.size()).map_err(|_| PackageFormatError::ArchiveTooLarge)?;
        if declared_size > MAX_PACKAGE_FILE_BYTES {
            return Err(PackageFormatError::ArchiveTooLarge);
        }
        expanded = expanded
            .checked_add(declared_size)
            .ok_or(PackageFormatError::ArchiveTooLarge)?;
        if expanded > MAX_PACKAGE_EXPANDED_BYTES {
            return Err(PackageFormatError::ArchiveTooLarge);
        }
        let mut content = Vec::with_capacity(declared_size);
        file.by_ref()
            .take(u64::try_from(MAX_PACKAGE_FILE_BYTES).unwrap_or(u64::MAX) + 1)
            .read_to_end(&mut content)?;
        if content.len() != declared_size || content.len() > MAX_PACKAGE_FILE_BYTES {
            return Err(PackageFormatError::ArchiveIntegrity);
        }
        entries.insert(path, content);
    }

    let manifest_bytes = entries
        .remove(PACKAGE_MANIFEST_PATH)
        .ok_or(PackageFormatError::MissingManifest)?;
    let manifest: PackageManifest = serde_json::from_slice(&manifest_bytes)?;
    if canonical_json_bytes(&manifest)? != manifest_bytes {
        return Err(PackageFormatError::NonCanonicalManifest);
    }
    let lock_bytes = entries
        .get(PACKAGE_LOCK_PATH)
        .ok_or(PackageFormatError::MissingLock)?;
    let dependency_lock: PackageDependencyLock = serde_json::from_slice(lock_bytes)?;
    if canonical_json_bytes(&dependency_lock)? != *lock_bytes {
        return Err(PackageFormatError::InvalidDependencyLock);
    }
    let signature = entries
        .remove(PACKAGE_SIGNATURE_PATH)
        .map(|signature_bytes| {
            let signature: PackageSignatureEnvelope = serde_json::from_slice(&signature_bytes)?;
            if canonical_json_bytes(&signature)? != signature_bytes {
                return Err(PackageFormatError::InvalidSignatureEnvelope);
            }
            Ok(signature)
        })
        .transpose()?;
    if entries
        .keys()
        .any(|path| path.starts_with("codey/signatures/"))
    {
        return Err(PackageFormatError::UnsafeArchiveEntry);
    }
    let archive = CodeyPackageArchive {
        package: CodeyPackage {
            manifest,
            dependency_lock,
            signature,
        },
        files: entries,
    };
    archive.validate()?;
    if archive.encode()? != bytes {
        return Err(PackageFormatError::NonCanonicalArchive);
    }
    Ok(archive)
}

pub fn package_dependency_lock_hash(
    dependency_lock: &PackageDependencyLock,
) -> Result<String, PackageFormatError> {
    let mut canonical_lock = dependency_lock.clone();
    canonical_lock.content_hash.clear();
    canonical_blake3_hash(&canonical_lock)
}

pub fn package_content_root(manifest: &PackageManifest) -> Result<String, PackageFormatError> {
    canonical_blake3_hash(manifest)
}

pub fn package_resource_digest(
    root: &str,
    files: &[PackageFileEntry],
) -> Result<String, PackageFormatError> {
    validate_relative_package_path(root)?;
    let prefix = format!("{root}/");
    let scoped = files
        .iter()
        .filter(|file| file.path == root || file.path.starts_with(&prefix))
        .map(|file| {
            (
                file.path.as_str(),
                file.length,
                file.blake3.as_str(),
                file.executable,
            )
        })
        .collect::<Vec<_>>();
    if scoped.is_empty() {
        return Err(PackageFormatError::InvalidResource);
    }
    canonical_blake3_hash(&scoped)
}

#[cfg(test)]
pub fn build_file_table(
    files: &BTreeMap<String, Vec<u8>>,
    executable_paths: &BTreeSet<String>,
) -> Result<Vec<PackageFileEntry>, PackageFormatError> {
    if files.is_empty() || files.len() > MAX_PACKAGE_FILES {
        return Err(PackageFormatError::ArchiveFileCount);
    }
    let mut entries = Vec::with_capacity(files.len());
    let mut folded_paths = BTreeSet::new();
    let mut total = 0_usize;
    for (path, bytes) in files {
        validate_relative_package_path(path)?;
        if path == PACKAGE_MANIFEST_PATH
            || path == PACKAGE_SIGNATURE_PATH
            || path.starts_with("codey/signatures/")
            || !folded_paths.insert(path.to_lowercase())
            || bytes.len() > MAX_PACKAGE_FILE_BYTES
        {
            return Err(PackageFormatError::InvalidPackagePath);
        }
        total = total
            .checked_add(bytes.len())
            .ok_or(PackageFormatError::ArchiveTooLarge)?;
        if total > MAX_PACKAGE_EXPANDED_BYTES {
            return Err(PackageFormatError::ArchiveTooLarge);
        }
        entries.push(PackageFileEntry {
            path: path.clone(),
            length: DecimalU64::new(
                u64::try_from(bytes.len()).map_err(|_| PackageFormatError::ArchiveTooLarge)?,
            ),
            blake3: blake3::hash(bytes).to_hex().to_string(),
            executable: executable_paths.contains(path),
            media_type: media_type_for_path(path).map(str::to_owned),
        });
    }
    if executable_paths
        .iter()
        .any(|path| !files.contains_key(path))
    {
        return Err(PackageFormatError::ExecutableFileDenied);
    }
    Ok(entries)
}

pub fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, PackageFormatError> {
    let value = serde_json::to_value(value)?;
    let canonical = canonicalize_value(value)?;
    Ok(serde_json::to_vec(&canonical)?)
}

fn canonical_blake3_hash<T: Serialize>(value: &T) -> Result<String, PackageFormatError> {
    Ok(blake3::hash(&canonical_json_bytes(value)?)
        .to_hex()
        .to_string())
}

fn canonicalize_value(value: Value) -> Result<Value, PackageFormatError> {
    match value {
        Value::Array(values) => values
            .into_iter()
            .map(canonicalize_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => {
            let mut sorted = BTreeMap::new();
            for (key, value) in values {
                sorted.insert(key, canonicalize_value(value)?);
            }
            Ok(Value::Object(sorted.into_iter().collect()))
        }
        Value::Number(number) if number.is_f64() => Err(PackageFormatError::FloatingPoint),
        value => Ok(value),
    }
}

fn validate_payload_files(
    manifest: &PackageManifest,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PackageFormatError> {
    if files.len() != manifest.files.len() {
        return Err(PackageFormatError::UndeclaredFile);
    }
    let expected = manifest
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    for (path, bytes) in files {
        let entry = expected
            .get(path.as_str())
            .ok_or(PackageFormatError::UndeclaredFile)?;
        if entry.length.get() != u64::try_from(bytes.len()).unwrap_or(u64::MAX)
            || entry.blake3 != blake3::hash(bytes).to_hex().as_str()
        {
            return Err(PackageFormatError::ArchiveIntegrity);
        }
    }
    Ok(())
}

fn encode_zip(entries: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, PackageFormatError> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(9))
            .unix_permissions(0o644);
        for (path, bytes) in entries {
            writer.start_file(path, options)?;
            writer.write_all(bytes)?;
        }
        writer.finish()?;
    }
    let bytes = cursor.into_inner();
    if bytes.len() > MAX_PACKAGE_ARCHIVE_BYTES {
        return Err(PackageFormatError::ArchiveTooLarge);
    }
    Ok(bytes)
}

fn executable_path_allowed(path: &str, resources: &[PackageResourceEntry]) -> bool {
    resources.iter().any(|resource| {
        let scripts = format!("{}/scripts/", resource.root);
        let binaries = format!("{}/bin/", resource.root);
        match resource.kind {
            PackageResourceKind::Skill | PackageResourceKind::Hook => {
                path.starts_with(&scripts) || path.starts_with(&binaries)
            }
            PackageResourceKind::Mcp | PackageResourceKind::Plugin => path.starts_with(&binaries),
            _ => false,
        }
    })
}

fn validate_resource_ref(
    resource_ref: &str,
    kind: PackageResourceKind,
) -> Result<(), PackageFormatError> {
    validate_untyped_resource_ref(resource_ref)?;
    let Some((prefix, _)) = resource_ref.split_once('/') else {
        return Err(PackageFormatError::InvalidResource);
    };
    if prefix != kind.path_segment() {
        return Err(PackageFormatError::InvalidResource);
    }
    Ok(())
}

fn validate_untyped_resource_ref(resource_ref: &str) -> Result<(), PackageFormatError> {
    if resource_ref.is_empty()
        || resource_ref.len() > 256
        || resource_ref.matches('/').count() != 1
        || !resource_ref.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'_' | b'-' | b'/')
        })
        || resource_ref.starts_with('/')
        || resource_ref.ends_with('/')
    {
        return Err(PackageFormatError::InvalidResource);
    }
    Ok(())
}

fn valid_extension_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 256
        && key.contains('.')
        && key.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'_' | b'-' | b'/')
        })
}

fn validate_blake3(value: &str) -> Result<(), PackageFormatError> {
    if is_lower_hex(value, 64) {
        Ok(())
    } else {
        Err(PackageFormatError::InvalidDigest)
    }
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub fn validate_relative_package_path(path: &str) -> Result<(), PackageFormatError> {
    if path.is_empty()
        || path.len() > MAX_PACKAGE_PATH_BYTES
        || path.starts_with('/')
        || path.contains('\\')
        || path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.chars().any(char::is_control)
        })
    {
        return Err(PackageFormatError::InvalidPackagePath);
    }
    Ok(())
}

#[cfg(test)]
fn media_type_for_path(path: &str) -> Option<&'static str> {
    let extension = path.rsplit_once('.').map(|(_, extension)| extension)?;
    match extension.to_ascii_lowercase().as_str() {
        "json" => Some("application/json"),
        "md" => Some("text/markdown"),
        "txt" => Some("text/plain"),
        "yaml" | "yml" => Some("application/yaml"),
        "mcpb" | "zip" => Some("application/zip"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "svg" => Some("image/svg+xml"),
        "wasm" => Some("application/wasm"),
        _ => None,
    }
}

fn validate_resource_profile(
    resource: &PackageResourceEntry,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PackageFormatError> {
    if resource.format != expected_resource_format(resource.kind) {
        return Err(PackageFormatError::InvalidResourceProfile(
            resource.resource_ref.clone(),
        ));
    }
    match resource.kind {
        PackageResourceKind::Skill => validate_skill_profile(resource, files),
        PackageResourceKind::Mcp => validate_mcp_profile(resource, files),
        PackageResourceKind::Plugin => validate_plugin_profile(resource, files),
        _ => Ok(()),
    }
}

const fn expected_resource_format(kind: PackageResourceKind) -> &'static str {
    match kind {
        PackageResourceKind::Agent => "codey.agent-definition/1",
        PackageResourceKind::Team => "codey.team-definition/1",
        PackageResourceKind::Workflow => "codey.workflow-definition/1",
        PackageResourceKind::Template => "codey.template-definition/1",
        PackageResourceKind::Skill => "agentskills.io/skill/1",
        PackageResourceKind::Mcp => "modelcontextprotocol.io/registry-server/1",
        PackageResourceKind::Plugin => "codey.plugin/1",
        PackageResourceKind::Hook => "codey.hook/1",
        PackageResourceKind::Prompt => "codey.prompt/1",
        PackageResourceKind::Asset => "codey.asset/1",
    }
}

fn resource_file<'a>(
    resource: &PackageResourceEntry,
    files: &'a BTreeMap<String, Vec<u8>>,
    relative_path: &str,
) -> Result<&'a [u8], PackageFormatError> {
    files
        .get(&format!("{}/{relative_path}", resource.root))
        .map(Vec::as_slice)
        .ok_or_else(|| PackageFormatError::InvalidResourceProfile(resource.resource_ref.clone()))
}

fn validate_skill_profile(
    resource: &PackageResourceEntry,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PackageFormatError> {
    let markdown = std::str::from_utf8(resource_file(resource, files, "SKILL.md")?)
        .map_err(|_| PackageFormatError::InvalidResourceProfile(resource.resource_ref.clone()))?
        .replace("\r\n", "\n");
    let frontmatter = markdown
        .strip_prefix("---\n")
        .and_then(|markdown| {
            markdown
                .split_once("\n---\n")
                .map(|(frontmatter, _)| frontmatter)
                .or_else(|| markdown.strip_suffix("\n---"))
        })
        .ok_or_else(|| PackageFormatError::InvalidResourceProfile(resource.resource_ref.clone()))?;
    let documents = YamlLoader::load_from_str(frontmatter)
        .map_err(|_| PackageFormatError::InvalidResourceProfile(resource.resource_ref.clone()))?;
    let document = documents.first().unwrap_or(&Yaml::BadValue);
    let name = yaml_string(document, "name")
        .ok_or_else(|| PackageFormatError::InvalidResourceProfile(resource.resource_ref.clone()))?;
    let description = yaml_string(document, "description")
        .ok_or_else(|| PackageFormatError::InvalidResourceProfile(resource.resource_ref.clone()))?;
    let expected_name = resource
        .resource_ref
        .split_once('/')
        .map(|(_, name)| name)
        .unwrap_or_default();
    if name != expected_name
        || name.len() > 64
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || description.trim().is_empty()
        || description.chars().count() > 1024
    {
        return Err(PackageFormatError::InvalidResourceProfile(
            resource.resource_ref.clone(),
        ));
    }
    Ok(())
}

fn yaml_string<'a>(document: &'a Yaml, key: &str) -> Option<&'a str> {
    document.as_hash()?.get(&Yaml::String(key.into()))?.as_str()
}

fn validate_mcp_profile(
    resource: &PackageResourceEntry,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PackageFormatError> {
    let document: Value = serde_json::from_slice(resource_file(resource, files, "server.json")?)?;
    let packages = document
        .get("packages")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let remotes = document
        .get("remotes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let valid = document
        .get("$schema")
        .and_then(Value::as_str)
        .is_some_and(|schema| {
            schema.starts_with("https://static.modelcontextprotocol.io/schemas/")
                && schema.ends_with("/server.schema.json")
        })
        && document
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(valid_mcp_registry_name)
        && document
            .get("version")
            .and_then(Value::as_str)
            .is_some_and(|version| semver::Version::parse(version).is_ok())
        && (!packages.is_empty() || !remotes.is_empty())
        && packages.iter().all(|package| valid_mcp_package(package))
        && remotes.iter().all(|remote| valid_mcp_remote(remote));
    if !valid {
        return Err(PackageFormatError::InvalidResourceProfile(
            resource.resource_ref.clone(),
        ));
    }
    Ok(())
}

fn valid_mcp_registry_name(name: &str) -> bool {
    if name.len() > 255 || name.matches('/').count() != 1 {
        return false;
    }
    let Some((namespace, server)) = name.split_once('/') else {
        return false;
    };
    !namespace.is_empty()
        && namespace.contains('.')
        && !server.is_empty()
        && namespace
            .bytes()
            .chain(server.bytes())
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-".contains(&byte))
}

fn valid_mcp_package(package: &Value) -> bool {
    let Some(package) = package.as_object() else {
        return false;
    };
    let Some(registry_type) = package.get("registryType").and_then(Value::as_str) else {
        return false;
    };
    let Some(identifier) = package.get("identifier").and_then(Value::as_str) else {
        return false;
    };
    if identifier.trim().is_empty()
        || package
            .get("transport")
            .and_then(Value::as_object)
            .and_then(|transport| transport.get("type"))
            .and_then(Value::as_str)
            != Some("stdio")
    {
        return false;
    }
    match registry_type {
        "npm" | "pypi" | "nuget" => {
            package
                .get("version")
                .and_then(Value::as_str)
                .is_some_and(|version| {
                    !version.trim().is_empty()
                        && !version
                            .bytes()
                            .any(|byte| b"<>^~*|, \t\r\n".contains(&byte))
                })
        }
        "oci" => identifier.contains(':') || identifier.contains("@sha256:"),
        "mcpb" => package
            .get("fileSha256")
            .and_then(Value::as_str)
            .is_some_and(valid_sha256),
        _ => false,
    }
}

fn valid_mcp_remote(remote: &Value) -> bool {
    let Some(remote) = remote.as_object() else {
        return false;
    };
    let valid_transport = remote
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| matches!(kind, "streamable-http" | "sse"));
    let valid_url = remote
        .get("url")
        .and_then(Value::as_str)
        .and_then(|url| url::Url::parse(url).ok())
        .is_some_and(|url| matches!(url.scheme(), "http" | "https"));
    valid_transport && valid_url
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_plugin_profile(
    resource: &PackageResourceEntry,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PackageFormatError> {
    let document: Value = serde_json::from_slice(resource_file(resource, files, "plugin.json")?)?;
    let valid = document.as_object().is_some_and(|object| {
        object.keys().all(|key| {
            matches!(
                key.as_str(),
                "name"
                    | "version"
                    | "description"
                    | "authors"
                    | "repository"
                    | "capabilities"
                    | "dependencies"
                    | "min_harness_version"
            )
        }) && object
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| !name.trim().is_empty())
            && object
                .get("version")
                .and_then(Value::as_str)
                .is_some_and(|version| semver::Version::parse(version).is_ok())
            && object
                .get("min_harness_version")
                .and_then(Value::as_str)
                .is_some_and(|version| semver::VersionReq::parse(version).is_ok())
    });
    if !valid {
        return Err(PackageFormatError::InvalidResourceProfile(
            resource.resource_ref.clone(),
        ));
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum PackageFormatError {
    #[error("package id is invalid")]
    InvalidPackageId,
    #[error("decimal u64 is invalid")]
    InvalidDecimalU64,
    #[error("package schema or archive version is unsupported")]
    UnsupportedSchemaVersion,
    #[error("package manifest is invalid")]
    InvalidManifest,
    #[error("package resource is invalid")]
    InvalidResource,
    #[error("package resource profile is invalid: {0}")]
    InvalidResourceProfile(String),
    #[error("package resources are duplicated")]
    DuplicateResource,
    #[error("package dependency is invalid")]
    InvalidDependency,
    #[error("package dependency lock is invalid")]
    InvalidDependencyLock,
    #[error("package digest is invalid")]
    InvalidDigest,
    #[error("package resource digest does not match its files")]
    ResourceDigestMismatch,
    #[error("package path is invalid")]
    InvalidPackagePath,
    #[error("package paths are duplicated or collide by case")]
    DuplicatePackagePath,
    #[error("package contains an undeclared file")]
    UndeclaredFile,
    #[error("package manifest is missing")]
    MissingManifest,
    #[error("package dependency lock is missing")]
    MissingLock,
    #[error("package signature envelope is invalid")]
    InvalidSignatureEnvelope,
    #[error("package extension namespace is invalid")]
    InvalidExtension,
    #[error("executable package file is outside an executable resource")]
    ExecutableFileDenied,
    #[error("package archive entry is unsafe")]
    UnsafeArchiveEntry,
    #[error("package archive contains too many files")]
    ArchiveFileCount,
    #[error("package manifest is not canonical JSON")]
    NonCanonicalManifest,
    #[error("package ZIP is not canonically encoded")]
    NonCanonicalArchive,
    #[error("package archive integrity check failed")]
    ArchiveIntegrity,
    #[error("package archive exceeds its size limit")]
    ArchiveTooLarge,
    #[error("floating point values are not allowed in canonical package JSON")]
    FloatingPoint,
    #[error("package JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("package ZIP is invalid: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("package I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package_fixture() -> CodeyPackageArchive {
        let mut lock = PackageDependencyLock {
            schema_version: PACKAGE_LOCK_SCHEMA_VERSION,
            packages: Vec::new(),
            external_artifacts: Vec::new(),
            content_hash: String::new(),
        };
        lock.content_hash = package_dependency_lock_hash(&lock).unwrap();
        let files = BTreeMap::from([
            (
                PACKAGE_LOCK_PATH.to_owned(),
                canonical_json_bytes(&lock).unwrap(),
            ),
            (
                "resources/skills/test-skill/SKILL.md".to_owned(),
                b"---\nname: test-skill\ndescription: Test skill.\n---\n".to_vec(),
            ),
        ]);
        let file_table = build_file_table(&files, &BTreeSet::new()).unwrap();
        let root = "resources/skills/test-skill";
        let resource = PackageResourceEntry {
            resource_ref: "skill/test-skill".to_owned(),
            kind: PackageResourceKind::Skill,
            format: "agentskills.io/skill/1".to_owned(),
            root: root.to_owned(),
            digest: package_resource_digest(root, &file_table).unwrap(),
        };
        let manifest = PackageManifest {
            schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
            archive_format_version: PACKAGE_ARCHIVE_FORMAT_VERSION,
            canonicalization_version: PACKAGE_CANONICALIZATION_VERSION,
            package_id: PackageId::new("com.codey.test/test-skill").unwrap(),
            namespace: "com.codey.test".to_owned(),
            version: "1.0.0".to_owned(),
            publisher: PackagePublisher {
                publisher_id: "test".to_owned(),
                display_name: "Test".to_owned(),
                source_url: None,
            },
            source: None,
            license: "MIT".to_owned(),
            compatibility: PackageCompatibility {
                codey_version_range: ">=1.0.0".to_owned(),
                platforms: BTreeSet::new(),
                architectures: BTreeSet::new(),
            },
            resources: vec![resource],
            dependencies: Vec::new(),
            files: file_table,
            extensions: BTreeMap::new(),
        };
        CodeyPackageArchive {
            package: CodeyPackage {
                manifest,
                dependency_lock: lock,
                signature: None,
            },
            files,
        }
    }

    #[test]
    fn package_id_and_decimal_encodings_are_canonical() {
        assert_eq!(
            PackageId::new("com.codey/example").unwrap().as_str(),
            "com.codey/example"
        );
        assert!(PackageId::new("Com.CodeY/example").is_err());
        assert_eq!(
            serde_json::to_string(&DecimalU64::new(42)).unwrap(),
            "\"42\""
        );
        assert!(serde_json::from_str::<DecimalU64>("\"042\"").is_err());
    }

    #[test]
    fn canonical_json_sorts_object_keys() {
        assert_eq!(
            canonical_json_bytes(&serde_json::json!({"z": 1, "a": {"b": 2, "a": 1}})).unwrap(),
            br#"{"a":{"a":1,"b":2},"z":1}"#
        );
    }

    #[test]
    fn deterministic_zip_round_trip_preserves_content_root() {
        let package = package_fixture();
        let first = package.encode().unwrap();
        let second = package.encode().unwrap();
        assert_eq!(first, second);
        let parsed = parse_archive(&first).unwrap();
        assert_eq!(
            parsed.package.content_root().unwrap(),
            package.package.content_root().unwrap()
        );
        assert_eq!(parsed.files, package.files);
    }

    #[test]
    fn semantically_valid_noncanonical_zip_is_rejected() {
        let package = package_fixture();
        let mut entries = package.files.clone();
        entries.insert(
            PACKAGE_MANIFEST_PATH.to_owned(),
            canonical_json_bytes(&package.package.manifest).unwrap(),
        );
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Stored)
                .unix_permissions(0o644);
            for (path, bytes) in entries {
                writer.start_file(path, options).unwrap();
                writer.write_all(&bytes).unwrap();
            }
            writer.finish().unwrap();
        }

        assert!(matches!(
            parse_archive(&cursor.into_inner()),
            Err(PackageFormatError::NonCanonicalArchive)
        ));
    }

    #[test]
    fn undeclared_payload_is_rejected() {
        let mut package = package_fixture();
        package
            .files
            .insert("resources/skills/test-skill/extra.txt".to_owned(), vec![1]);
        assert!(matches!(
            package.validate(),
            Err(PackageFormatError::UndeclaredFile)
        ));
    }

    #[test]
    fn invalid_native_resource_profile_is_rejected() {
        let mut package = package_fixture();
        package.files.insert(
            "resources/skills/test-skill/SKILL.md".to_owned(),
            b"# Missing frontmatter\n".to_vec(),
        );
        package.package.manifest.files =
            build_file_table(&package.files, &BTreeSet::new()).unwrap();
        package.package.manifest.resources[0].digest = package_resource_digest(
            &package.package.manifest.resources[0].root,
            &package.package.manifest.files,
        )
        .unwrap();

        assert!(matches!(
            package.validate(),
            Err(PackageFormatError::InvalidResourceProfile(_))
        ));
    }

    #[test]
    fn executable_asset_is_rejected() {
        let mut package = package_fixture();
        let entry = package
            .package
            .manifest
            .files
            .iter_mut()
            .find(|entry| entry.path.ends_with("SKILL.md"))
            .unwrap();
        entry.executable = true;
        assert!(matches!(
            package.validate(),
            Err(PackageFormatError::ExecutableFileDenied)
        ));
    }
}
