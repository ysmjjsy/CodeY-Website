use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::contracts::{
    MarketplaceCatalogResponse, MarketplaceListingDetail, MarketplaceListingKind,
    MarketplaceListingSummary, MarketplaceReleaseDetail, MarketplaceReleaseSummary,
    MarketplaceUploadPreview, PublishMarketplaceUploadRequest,
};
use crate::db::{params, Connection, OptionalExtension, TransactionBehavior};
use chrono::{DateTime, Utc};
use thiserror::Error;

use crate::auth::{
    GitHubIdentity, MarketplaceAdminUser, MarketplaceAuthError, MarketplaceUser,
    MarketplaceUserRole, OAuthState, StoredUser,
};

#[derive(Clone)]
pub struct MarketplaceStore {
    connection: Arc<Mutex<Connection>>,
    root: Arc<PathBuf>,
}

impl std::fmt::Debug for MarketplaceStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MarketplaceStore")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub struct StoredUpload {
    pub preview: MarketplaceUploadPreview,
    pub archive_path: PathBuf,
    pub owner_user_id: String,
}

#[derive(Debug, Clone)]
pub struct DownloadArtifact {
    pub release: MarketplaceReleaseDetail,
    pub archive_path: PathBuf,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketplaceSubmissionStatus {
    Pending,
    Approved,
    Rejected,
}

impl MarketplaceSubmissionStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }

    fn parse(value: &str) -> Result<Self, MarketplaceStoreError> {
        match value {
            "pending" => Ok(Self::Pending),
            "approved" => Ok(Self::Approved),
            "rejected" => Ok(Self::Rejected),
            _ => Err(MarketplaceStoreError::InvalidSubmissionStatus(
                value.to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSubmission {
    pub submission_id: String,
    pub owner: MarketplaceUser,
    pub preview: MarketplaceUploadPreview,
    pub request: PublishMarketplaceUploadRequest,
    pub status: MarketplaceSubmissionStatus,
    pub review_note: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub reviewer: Option<MarketplaceUser>,
    pub release: Option<MarketplaceReleaseDetail>,
    #[serde(skip)]
    pub artifact_path: PathBuf,
}

impl MarketplaceStore {
    pub fn open(
        root: impl Into<PathBuf>,
        database_url: &str,
    ) -> Result<Self, MarketplaceStoreError> {
        let root = root.into();
        std::fs::create_dir_all(root.join("artifacts"))?;
        std::fs::create_dir_all(root.join("uploads"))?;
        let connection = crate::db::connect(root.join("marketplace.sqlite3"), database_url)?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS marketplace_listing (
                listing_id TEXT PRIMARY KEY,
                package_id TEXT NOT NULL UNIQUE,
                detail_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS marketplace_release (
                release_id TEXT PRIMARY KEY,
                listing_id TEXT NOT NULL,
                package_id TEXT NOT NULL,
                version TEXT NOT NULL,
                archive_hash TEXT NOT NULL,
                archive_path TEXT NOT NULL,
                detail_json TEXT NOT NULL,
                published_at TEXT NOT NULL,
                UNIQUE(package_id, version),
                FOREIGN KEY(listing_id) REFERENCES marketplace_listing(listing_id)
            );
            CREATE INDEX IF NOT EXISTS idx_marketplace_release_listing
                ON marketplace_release(listing_id, published_at DESC);
            CREATE TABLE IF NOT EXISTS marketplace_upload (
                upload_id TEXT PRIMARY KEY,
                preview_json TEXT NOT NULL,
                archive_path TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                owner_user_id TEXT
            );
            CREATE TABLE IF NOT EXISTS marketplace_user (
                user_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT,
                display_name TEXT NOT NULL,
                password_hash TEXT,
                github_id INTEGER UNIQUE,
                github_login TEXT,
                avatar_url TEXT,
                role TEXT NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                registration_status TEXT NOT NULL DEFAULT 'active',
                email_verified_at TEXT,
                terms_accepted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_user_username_ci
                ON marketplace_user(LOWER(username));
            CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_user_email_ci
                ON marketplace_user(LOWER(email)) WHERE email IS NOT NULL;
            CREATE TABLE IF NOT EXISTS marketplace_session (
                session_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES marketplace_user(user_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_marketplace_session_user
                ON marketplace_session(user_id);
            CREATE TABLE IF NOT EXISTS marketplace_registration_challenge (
                challenge_id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_registration_challenge_email
                ON marketplace_registration_challenge(LOWER(email), created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_registration_challenge_source
                ON marketplace_registration_challenge(source_hash, created_at DESC);
            CREATE TABLE IF NOT EXISTS marketplace_oauth_state (
                state_hash TEXT PRIMARY KEY,
                code_verifier TEXT NOT NULL,
                return_url TEXT,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS marketplace_submission (
                submission_id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                owner_json TEXT NOT NULL,
                preview_json TEXT NOT NULL,
                request_json TEXT NOT NULL,
                artifact_path TEXT NOT NULL,
                status TEXT NOT NULL,
                reviewer_user_id TEXT,
                reviewer_json TEXT,
                review_note TEXT,
                submitted_at TEXT NOT NULL,
                reviewed_at TEXT,
                release_json TEXT,
                FOREIGN KEY(owner_user_id) REFERENCES marketplace_user(user_id),
                FOREIGN KEY(reviewer_user_id) REFERENCES marketplace_user(user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_marketplace_submission_status
                ON marketplace_submission(status, submitted_at);
            CREATE INDEX IF NOT EXISTS idx_marketplace_submission_owner
                ON marketplace_submission(owner_user_id, submitted_at DESC);",
        )?;
        if !column_exists(&connection, "marketplace_upload", "owner_user_id")? {
            connection.execute(
                "ALTER TABLE marketplace_upload ADD COLUMN owner_user_id TEXT",
                params![],
            )?;
        }
        if !column_exists(&connection, "marketplace_oauth_state", "return_url")? {
            connection.execute(
                "ALTER TABLE marketplace_oauth_state ADD COLUMN return_url TEXT",
                params![],
            )?;
        }
        if !column_exists(&connection, "marketplace_submission", "reviewer_json")? {
            connection.execute(
                "ALTER TABLE marketplace_submission ADD COLUMN reviewer_json TEXT",
                params![],
            )?;
        }
        if !column_exists(&connection, "marketplace_user", "active")? {
            connection.execute(
                "ALTER TABLE marketplace_user ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE",
                params![],
            )?;
        }
        if !column_exists(&connection, "marketplace_user", "registration_status")? {
            connection.execute(
                "ALTER TABLE marketplace_user ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'active'",
                params![],
            )?;
        }
        if !column_exists(&connection, "marketplace_user", "email_verified_at")? {
            connection.execute(
                "ALTER TABLE marketplace_user ADD COLUMN email_verified_at TEXT",
                params![],
            )?;
        }
        if !column_exists(&connection, "marketplace_user", "terms_accepted_at")? {
            connection.execute(
                "ALTER TABLE marketplace_user ADD COLUMN terms_accepted_at TEXT",
                params![],
            )?;
        }
        let store = Self {
            connection: Arc::new(Mutex::new(connection)),
            root: Arc::new(root),
        };
        store.backfill_submission_reviewers()?;
        Ok(store)
    }

    fn backfill_submission_reviewers(&self) -> Result<(), MarketplaceStoreError> {
        let reviewer_ids = {
            let connection = self.connection()?;
            let mut statement = connection.prepare(
                "SELECT DISTINCT reviewer_user_id FROM marketplace_submission
                 WHERE reviewer_user_id IS NOT NULL AND reviewer_json IS NULL",
            )?;
            let reviewer_ids = statement
                .query_map(params![], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            reviewer_ids
        };
        for reviewer_id in reviewer_ids {
            let Some(reviewer) = self.user_by_id(&reviewer_id)? else {
                continue;
            };
            self.connection()?.execute(
                "UPDATE marketplace_submission SET reviewer_json=?1
                 WHERE reviewer_user_id=?2 AND reviewer_json IS NULL",
                params![serde_json::to_string(&reviewer.user)?, reviewer_id],
            )?;
        }
        Ok(())
    }

    #[must_use]
    pub fn upload_path(&self, upload_id: &str) -> PathBuf {
        self.root
            .join("uploads")
            .join(format!("{upload_id}.codeypkg"))
    }

    #[must_use]
    pub fn artifact_path(&self, archive_hash: &str) -> PathBuf {
        self.root
            .join("artifacts")
            .join(format!("{archive_hash}.codeypkg"))
    }

    pub fn save_upload(
        &self,
        preview: &MarketplaceUploadPreview,
        archive_path: &Path,
        owner_user_id: &str,
    ) -> Result<(), MarketplaceStoreError> {
        let json = serde_json::to_string(preview)?;
        self.connection()?.execute(
            "INSERT INTO marketplace_upload(
                upload_id, preview_json, archive_path, expires_at, owner_user_id
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(upload_id) DO UPDATE SET
                preview_json=excluded.preview_json,
                archive_path=excluded.archive_path,
                expires_at=excluded.expires_at,
                owner_user_id=excluded.owner_user_id",
            params![
                preview.upload_id,
                json,
                archive_path.to_string_lossy(),
                preview.expires_at.to_rfc3339(),
                owner_user_id,
            ],
        )?;
        Ok(())
    }

    pub fn upload(&self, upload_id: &str) -> Result<Option<StoredUpload>, MarketplaceStoreError> {
        let row = self
            .connection()?
            .query_row(
                "SELECT preview_json, archive_path, owner_user_id FROM marketplace_upload
                 WHERE upload_id=?1 AND expires_at>?2",
                params![upload_id, Utc::now().to_rfc3339()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        row.map(|(json, path, owner_user_id)| {
            Ok(StoredUpload {
                preview: serde_json::from_str(&json)?,
                archive_path: PathBuf::from(path),
                owner_user_id: owner_user_id.ok_or(MarketplaceStoreError::UnownedUpload)?,
            })
        })
        .transpose()
    }

    pub fn remove_upload(&self, upload_id: &str) -> Result<(), MarketplaceStoreError> {
        self.connection()?.execute(
            "DELETE FROM marketplace_upload WHERE upload_id=?1",
            [upload_id],
        )?;
        Ok(())
    }

    pub fn expired_upload_paths(&self) -> Result<Vec<PathBuf>, MarketplaceStoreError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT archive_path FROM marketplace_upload WHERE expires_at<=?1")?;
        let paths = statement
            .query_map([Utc::now().to_rfc3339()], |row| row.get::<_, String>(0))?
            .map(|row| row.map(PathBuf::from))
            .collect::<Result<Vec<_>, _>>()?;
        connection.execute(
            "DELETE FROM marketplace_upload WHERE expires_at<=?1",
            [Utc::now().to_rfc3339()],
        )?;
        Ok(paths)
    }

    pub fn publish(
        &self,
        preview: &MarketplaceUploadPreview,
        request: &PublishMarketplaceUploadRequest,
        artifact_path: &Path,
        publisher_id: &str,
        publisher_display_name: &str,
    ) -> Result<MarketplaceReleaseDetail, MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT detail_json, archive_hash FROM marketplace_release
                 WHERE package_id=?1 AND version=?2",
                params![preview.package_id.as_str(), preview.version],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if existing.1 != preview.archive_hash {
                return Err(MarketplaceStoreError::VersionConflict);
            }
            return Ok(serde_json::from_str(&existing.0)?);
        }

        let now = Utc::now();
        let existing_listing = transaction
            .query_row(
                "SELECT listing_id, detail_json FROM marketplace_listing WHERE package_id=?1",
                [preview.package_id.as_str()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let listing_id = existing_listing
            .as_ref()
            .map_or_else(|| ulid::Ulid::new().to_string(), |row| row.0.clone());
        let release_id = ulid::Ulid::new().to_string();
        let kind = request
            .primary_resource
            .listing_kind()
            .ok_or(MarketplaceStoreError::InvalidPrimaryResource)?;
        let release_summary = MarketplaceReleaseSummary {
            release_id: release_id.clone(),
            version: preview.version.clone(),
            package_revision_id: preview.package_revision_id.clone(),
            package_content_hash: preview.package_content_hash.clone(),
            archive_hash: preview.archive_hash.clone(),
            archive_length: preview.archive_length,
            compatibility: preview.compatibility.clone(),
            published_at: now,
        };
        let release = MarketplaceReleaseDetail {
            summary: release_summary.clone(),
            listing_id: listing_id.clone(),
            package_id: preview.package_id.clone(),
            kind,
            primary_resource: request.primary_resource.clone(),
            title: request.title.trim().to_owned(),
            summary_text: request.summary.trim().to_owned(),
            readme_markdown: request.readme_markdown.clone(),
            changelog: request.changelog.clone(),
            license: preview.license.clone(),
            publisher_id: publisher_id.to_owned(),
            publisher_display_name: publisher_display_name.to_owned(),
            tags: normalized_tags(&request.tags),
            requested_permissions: preview.requested_permissions.clone(),
            resources: preview.resources.clone(),
            manifest: preview.manifest.clone(),
        };
        let existing_detail = existing_listing
            .as_ref()
            .map(|row| serde_json::from_str::<MarketplaceListingDetail>(&row.1))
            .transpose()?;
        if existing_detail
            .as_ref()
            .is_some_and(|detail| detail.summary.publisher_id != publisher_id)
        {
            return Err(MarketplaceStoreError::PublisherConflict);
        }
        let mut releases = existing_detail
            .as_ref()
            .map_or_else(Vec::new, |detail| detail.releases.clone());
        releases.push(release_summary.clone());
        releases.sort_by(compare_releases);
        let current_latest = existing_detail
            .as_ref()
            .map(|detail| &detail.summary.latest_release);
        let replaces_latest = current_latest.is_none_or(|current| {
            compare_versions(&release_summary.version, &current.version).is_gt()
        });
        let detail = if replaces_latest {
            let created_at = existing_detail
                .as_ref()
                .map_or(now, |detail| detail.summary.created_at);
            let download_count = existing_detail
                .as_ref()
                .map_or(0, |detail| detail.summary.download_count);
            MarketplaceListingDetail {
                summary: MarketplaceListingSummary {
                    listing_id: listing_id.clone(),
                    package_id: preview.package_id.clone(),
                    kind,
                    primary_resource: request.primary_resource.clone(),
                    title: release.title.clone(),
                    summary: release.summary_text.clone(),
                    tags: release.tags.clone(),
                    publisher_id: publisher_id.to_owned(),
                    publisher_display_name: publisher_display_name.to_owned(),
                    latest_release: release_summary,
                    download_count,
                    created_at,
                    updated_at: now,
                },
                readme_markdown: release.readme_markdown.clone(),
                license: release.license.clone(),
                requested_permissions: release.requested_permissions.clone(),
                resources: release.resources.clone(),
                releases,
            }
        } else {
            let Some(mut detail) = existing_detail else {
                return Err(MarketplaceStoreError::CatalogIntegrity);
            };
            detail.summary.updated_at = now;
            detail.releases = releases;
            detail
        };
        let detail_json = serde_json::to_string(&detail)?;
        transaction.execute(
            "INSERT INTO marketplace_listing(listing_id, package_id, detail_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(package_id) DO UPDATE SET
                detail_json=excluded.detail_json,
                updated_at=excluded.updated_at",
            params![
                listing_id,
                preview.package_id.as_str(),
                detail_json,
                detail.summary.created_at.to_rfc3339(),
                detail.summary.updated_at.to_rfc3339(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO marketplace_release(
                release_id, listing_id, package_id, version, archive_hash, archive_path,
                detail_json, published_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                release_id,
                listing_id,
                preview.package_id.as_str(),
                preview.version,
                preview.archive_hash,
                artifact_path.to_string_lossy(),
                serde_json::to_string(&release)?,
                now.to_rfc3339(),
            ],
        )?;
        transaction.commit()?;
        Ok(release)
    }

    pub fn catalog(
        &self,
        query: Option<&str>,
        kind: Option<MarketplaceListingKind>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<MarketplaceCatalogResponse, MarketplaceStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT detail_json FROM marketplace_listing ORDER BY updated_at DESC, listing_id DESC",
        )?;
        let mut listings = statement
            .query_map(params![], |row| row.get::<_, String>(0))?
            .map(|row| {
                serde_json::from_str::<MarketplaceListingDetail>(&row?)
                    .map(|detail| detail.summary)
                    .map_err(MarketplaceStoreError::from)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let normalized_query = query
            .map(|value| value.trim().to_lowercase())
            .filter(|v| !v.is_empty());
        listings.retain(|listing| {
            kind.is_none_or(|expected| listing.kind == expected)
                && normalized_query.as_ref().is_none_or(|query| {
                    listing.title.to_lowercase().contains(query)
                        || listing.summary.to_lowercase().contains(query)
                        || listing.package_id.to_lowercase().contains(query)
                        || listing
                            .tags
                            .iter()
                            .any(|tag| tag.to_lowercase().contains(query))
                })
        });
        let offset = cursor
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let end = offset.saturating_add(limit).min(listings.len());
        let page = listings.get(offset..end).unwrap_or_default().to_vec();
        Ok(MarketplaceCatalogResponse {
            listings: page,
            next_cursor: (end < listings.len()).then(|| end.to_string()),
        })
    }

    pub fn listing(
        &self,
        listing_id: &str,
    ) -> Result<Option<MarketplaceListingDetail>, MarketplaceStoreError> {
        let connection = self.connection()?;
        json_row(
            &connection,
            "SELECT detail_json FROM marketplace_listing WHERE listing_id=?1",
            listing_id,
        )
    }

    pub fn release(
        &self,
        release_id: &str,
    ) -> Result<Option<MarketplaceReleaseDetail>, MarketplaceStoreError> {
        let connection = self.connection()?;
        json_row(
            &connection,
            "SELECT detail_json FROM marketplace_release WHERE release_id=?1",
            release_id,
        )
    }

    pub fn download(
        &self,
        release_id: &str,
    ) -> Result<Option<DownloadArtifact>, MarketplaceStoreError> {
        let connection = self.connection()?;
        let row = connection
            .query_row(
                "SELECT detail_json, archive_path FROM marketplace_release WHERE release_id=?1",
                [release_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((release_json, archive_path)) = row else {
            return Ok(None);
        };
        Ok(Some(DownloadArtifact {
            release: serde_json::from_str(&release_json)?,
            archive_path: PathBuf::from(archive_path),
        }))
    }

    pub fn record_download(&self, listing_id: &str) -> Result<(), MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut listing = transaction
            .query_row(
                "SELECT detail_json FROM marketplace_listing WHERE listing_id=?1",
                [listing_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|json| serde_json::from_str::<MarketplaceListingDetail>(&json))
            .transpose()?
            .ok_or(MarketplaceStoreError::CatalogIntegrity)?;
        listing.summary.download_count = listing.summary.download_count.saturating_add(1);
        transaction.execute(
            "UPDATE marketplace_listing SET detail_json=?1 WHERE listing_id=?2",
            params![serde_json::to_string(&listing)?, listing_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn create_registration_challenge(
        &self,
        email: &str,
        code_hash: &str,
        source_hash: &str,
        now: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> Result<String, MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let minute_ago = (now - chrono::Duration::minutes(1)).to_rfc3339();
        let hour_ago = (now - chrono::Duration::hours(1)).to_rfc3339();
        let recent_email = transaction.query_row(
            "SELECT COUNT(*) FROM marketplace_registration_challenge
             WHERE LOWER(email)=LOWER(?1) AND created_at>?2",
            params![email, minute_ago],
            |row| row.get::<_, i64>(0),
        )?;
        let hourly_email = transaction.query_row(
            "SELECT COUNT(*) FROM marketplace_registration_challenge
             WHERE LOWER(email)=LOWER(?1) AND created_at>?2",
            params![email, hour_ago],
            |row| row.get::<_, i64>(0),
        )?;
        let hourly_source = transaction.query_row(
            "SELECT COUNT(*) FROM marketplace_registration_challenge
             WHERE source_hash=?1 AND created_at>?2",
            params![source_hash, hour_ago],
            |row| row.get::<_, i64>(0),
        )?;
        if recent_email != 0 || hourly_email >= 5 || hourly_source >= 20 {
            return Err(MarketplaceStoreError::RegistrationRateLimited);
        }
        transaction.execute(
            "UPDATE marketplace_registration_challenge SET consumed_at=?1
             WHERE LOWER(email)=LOWER(?2) AND consumed_at IS NULL",
            params![now.to_rfc3339(), email],
        )?;
        let challenge_id = ulid::Ulid::new().to_string();
        transaction.execute(
            "INSERT INTO marketplace_registration_challenge(
                challenge_id, email, code_hash, source_hash, expires_at, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                challenge_id,
                email,
                code_hash,
                source_hash,
                expires_at.to_rfc3339(),
                now.to_rfc3339(),
            ],
        )?;
        transaction.commit()?;
        Ok(challenge_id)
    }

    pub fn delete_registration_challenge(
        &self,
        challenge_id: &str,
    ) -> Result<(), MarketplaceStoreError> {
        self.connection()?.execute(
            "DELETE FROM marketplace_registration_challenge WHERE challenge_id=?1",
            [challenge_id],
        )?;
        Ok(())
    }

    pub fn consume_registration_challenge(
        &self,
        email: &str,
        code_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<(), MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let challenge = transaction
            .query_row(
                "SELECT challenge_id, code_hash, attempt_count
                 FROM marketplace_registration_challenge
                 WHERE LOWER(email)=LOWER(?1) AND consumed_at IS NULL AND expires_at>?2
                 ORDER BY created_at DESC LIMIT 1",
                params![email, now.to_rfc3339()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((challenge_id, expected_hash, attempts)) = challenge else {
            return Err(MarketplaceStoreError::RegistrationCodeInvalid);
        };
        if attempts >= 5 || expected_hash != code_hash {
            transaction.execute(
                "UPDATE marketplace_registration_challenge SET attempt_count=attempt_count+1
                 WHERE challenge_id=?1",
                [challenge_id],
            )?;
            transaction.commit()?;
            return Err(MarketplaceStoreError::RegistrationCodeInvalid);
        }
        transaction.execute(
            "UPDATE marketplace_registration_challenge SET consumed_at=?1
             WHERE challenge_id=?2",
            params![now.to_rfc3339(), challenge_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn create_or_resume_verified_local_user(
        &self,
        username: &str,
        email: &str,
        display_name: &str,
        password_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<MarketplaceUser, MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let username_owner = transaction
            .query_row(
                "SELECT user_id, registration_status FROM marketplace_user
                 WHERE LOWER(username)=LOWER(?1)",
                [username],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let email_owner = transaction
            .query_row(
                "SELECT user_id, registration_status FROM marketplace_user
                 WHERE LOWER(email)=LOWER(?1)",
                [email],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;

        let user_id = match email_owner {
            Some((email_user_id, status)) if status != "active" => {
                if username_owner
                    .as_ref()
                    .is_some_and(|(username_user_id, _)| username_user_id != &email_user_id)
                {
                    return Err(MarketplaceStoreError::IdentityAlreadyExists);
                }
                transaction.execute(
                    "UPDATE marketplace_user SET username=?1, display_name=?2, password_hash=?3,
                        active=FALSE, registration_status='provisioning', email_verified_at=?4,
                        terms_accepted_at=?4, updated_at=?4 WHERE user_id=?5",
                    params![
                        username,
                        display_name,
                        password_hash,
                        now.to_rfc3339(),
                        email_user_id,
                    ],
                )?;
                email_user_id
            }
            Some(_) => return Err(MarketplaceStoreError::IdentityAlreadyExists),
            None if username_owner.is_some() => {
                return Err(MarketplaceStoreError::IdentityAlreadyExists);
            }
            None => {
                let user_id = ulid::Ulid::new().to_string();
                transaction.execute(
                    "INSERT INTO marketplace_user(
                        user_id, username, email, display_name, password_hash, role, active,
                        registration_status, email_verified_at, terms_accepted_at, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'user', FALSE, 'provisioning', ?6, ?6, ?6, ?6)",
                    params![
                        user_id,
                        username,
                        email,
                        display_name,
                        password_hash,
                        now.to_rfc3339(),
                    ],
                )?;
                user_id
            }
        };
        transaction.commit()?;
        drop(connection);
        self.user_by_id(&user_id)?
            .map(|stored| stored.user)
            .ok_or(MarketplaceStoreError::AccountIntegrity)
    }

    pub fn activate_registered_user(
        &self,
        user_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), MarketplaceStoreError> {
        let updated = self.connection()?.execute(
            "UPDATE marketplace_user SET active=TRUE, registration_status='active', updated_at=?1
             WHERE user_id=?2 AND registration_status='provisioning'",
            params![now.to_rfc3339(), user_id],
        )?;
        if updated == 0 {
            return Err(MarketplaceStoreError::AccountIntegrity);
        }
        Ok(())
    }

    pub fn create_local_user(
        &self,
        username: &str,
        email: &str,
        display_name: &str,
        password_hash: &str,
        role: MarketplaceUserRole,
    ) -> Result<MarketplaceUser, MarketplaceStoreError> {
        if self.user_by_identifier(username)?.is_some() || self.user_by_identifier(email)?.is_some()
        {
            return Err(MarketplaceStoreError::IdentityAlreadyExists);
        }
        let user_id = ulid::Ulid::new().to_string();
        let now = Utc::now();
        self.connection()?.execute(
            "INSERT INTO marketplace_user(
                user_id, username, email, display_name, password_hash, role, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                user_id,
                username,
                email,
                display_name,
                password_hash,
                role.as_str(),
                now.to_rfc3339(),
            ],
        )?;
        Ok(MarketplaceUser {
            user_id,
            username: username.to_owned(),
            email: Some(email.to_owned()),
            display_name: display_name.to_owned(),
            avatar_url: None,
            github_login: None,
            role,
            created_at: now,
        })
    }

    pub fn upsert_local_admin(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<(), MarketplaceStoreError> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let user_id = transaction
            .query_row(
                "SELECT user_id FROM marketplace_user WHERE LOWER(username)=LOWER(?1)",
                [username],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(user_id) = user_id {
            transaction.execute(
                "UPDATE marketplace_user
                 SET password_hash=?1, role='admin', active=TRUE, updated_at=?2
                 WHERE user_id=?3",
                params![password_hash, now, user_id],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO marketplace_user(
                    user_id, username, display_name, password_hash, role, created_at, updated_at
                 ) VALUES (?1, ?2, 'Administrator', ?3, 'admin', ?4, ?4)",
                params![ulid::Ulid::new().to_string(), username, password_hash, now],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn user_by_identifier(
        &self,
        identifier: &str,
    ) -> Result<Option<StoredUser>, MarketplaceStoreError> {
        self.user_by_sql(
            "SELECT user_id, username, email, display_name, password_hash, github_id,
                    github_login, avatar_url, role, created_at, active
             FROM marketplace_user
             WHERE LOWER(username)=LOWER(?1) OR LOWER(email)=LOWER(?1)",
            identifier,
        )
    }

    pub fn user_by_id(&self, user_id: &str) -> Result<Option<StoredUser>, MarketplaceStoreError> {
        self.user_by_sql(
            "SELECT user_id, username, email, display_name, password_hash, github_id,
                    github_login, avatar_url, role, created_at, active
             FROM marketplace_user WHERE user_id=?1",
            user_id,
        )
    }

    pub fn update_user_profile(
        &self,
        user_id: &str,
        display_name: &str,
        email: Option<&str>,
    ) -> Result<Option<MarketplaceUser>, MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(email) = email {
            let identity_owner = transaction
                .query_row(
                    "SELECT user_id FROM marketplace_user
                     WHERE user_id<>?1
                       AND (LOWER(username)=LOWER(?2) OR LOWER(email)=LOWER(?2))",
                    params![user_id, email],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if identity_owner.is_some() {
                return Err(MarketplaceStoreError::IdentityAlreadyExists);
            }
        }
        let updated = transaction.execute(
            "UPDATE marketplace_user
             SET display_name=?1, email=?2, updated_at=?3
             WHERE user_id=?4",
            params![display_name, email, Utc::now().to_rfc3339(), user_id],
        )?;
        transaction.commit()?;
        drop(connection);
        if updated == 0 {
            return Ok(None);
        }
        Ok(self.user_by_id(user_id)?.map(|record| record.user))
    }

    pub fn user_by_github_id(
        &self,
        github_id: u64,
    ) -> Result<Option<StoredUser>, MarketplaceStoreError> {
        let github_id =
            i64::try_from(github_id).map_err(|_| MarketplaceStoreError::InvalidGitHubId)?;
        let row = self
            .connection()?
            .query_row(
                "SELECT user_id, username, email, display_name, password_hash, github_id,
                        github_login, avatar_url, role, created_at, active
                 FROM marketplace_user WHERE github_id=?1",
                [github_id],
                stored_user_row,
            )
            .optional()?;
        row.map(stored_user_from_row).transpose()
    }

    pub fn users(&self) -> Result<Vec<MarketplaceAdminUser>, MarketplaceStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT user_id, username, email, display_name, password_hash, github_id,
                    github_login, avatar_url, role, created_at, active
             FROM marketplace_user
             ORDER BY created_at DESC, username ASC",
        )?;
        let users = statement
            .query_map(params![], stored_user_row)?
            .map(|row| {
                let stored = stored_user_from_row(row?)?;
                Ok(MarketplaceAdminUser {
                    has_password: stored.password_hash.is_some(),
                    github_connected: stored.github_id.is_some(),
                    active: stored.active,
                    user: stored.user,
                })
            })
            .collect();
        users
    }

    pub fn update_user_role(
        &self,
        user_id: &str,
        role: MarketplaceUserRole,
    ) -> Result<Option<MarketplaceUser>, MarketplaceStoreError> {
        let updated = self.connection()?.execute(
            "UPDATE marketplace_user SET role=?1, updated_at=?2 WHERE user_id=?3",
            params![role.as_str(), Utc::now().to_rfc3339(), user_id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        Ok(self.user_by_id(user_id)?.map(|record| record.user))
    }

    pub fn update_user_active(
        &self,
        user_id: &str,
        active: bool,
    ) -> Result<bool, MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let updated = transaction.execute(
            "UPDATE marketplace_user SET active=?1, updated_at=?2 WHERE user_id=?3",
            params![active, Utc::now().to_rfc3339(), user_id],
        )?;
        if updated != 0 && !active {
            transaction.execute(
                "DELETE FROM marketplace_session WHERE user_id=?1",
                [user_id],
            )?;
        }
        transaction.commit()?;
        Ok(updated != 0)
    }

    pub fn upsert_github_user(
        &self,
        identity: &GitHubIdentity,
        role: MarketplaceUserRole,
    ) -> Result<MarketplaceUser, MarketplaceStoreError> {
        if let Some(existing) = self.user_by_github_id(identity.github_id)? {
            let effective_role = if existing.user.is_admin() {
                MarketplaceUserRole::Admin
            } else {
                role
            };
            self.update_github_user(&existing.user.user_id, identity, effective_role)?;
            return self
                .user_by_id(&existing.user.user_id)?
                .map(|record| record.user)
                .ok_or(MarketplaceStoreError::AccountIntegrity);
        }
        if let Some(email) = identity.email.as_deref() {
            if let Some(existing) = self.user_by_identifier(email)? {
                let effective_role = if existing.user.is_admin() {
                    MarketplaceUserRole::Admin
                } else {
                    role
                };
                self.update_github_user(&existing.user.user_id, identity, effective_role)?;
                return self
                    .user_by_id(&existing.user.user_id)?
                    .map(|record| record.user)
                    .ok_or(MarketplaceStoreError::AccountIntegrity);
            }
        }
        let mut username = crate::auth::validate_username(&identity.login)
            .unwrap_or_else(|_| format!("github-{}", identity.github_id));
        if self.user_by_identifier(&username)?.is_some() {
            username = format!(
                "{}-{}",
                username.chars().take(20).collect::<String>(),
                identity.github_id
            );
        }
        let user_id = ulid::Ulid::new().to_string();
        let now = Utc::now();
        let github_id = i64::try_from(identity.github_id)
            .map_err(|_| MarketplaceStoreError::InvalidGitHubId)?;
        self.connection()?.execute(
            "INSERT INTO marketplace_user(
                user_id, username, email, display_name, github_id, github_login, avatar_url,
                role, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                user_id,
                username,
                identity.email,
                identity.display_name,
                github_id,
                identity.login,
                identity.avatar_url,
                role.as_str(),
                now.to_rfc3339(),
            ],
        )?;
        self.user_by_id(&user_id)?
            .map(|record| record.user)
            .ok_or(MarketplaceStoreError::AccountIntegrity)
    }

    pub fn create_session(
        &self,
        session_hash: &str,
        user_id: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), MarketplaceStoreError> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM marketplace_session WHERE expires_at<=?1",
            [Utc::now().to_rfc3339()],
        )?;
        connection.execute(
            "INSERT INTO marketplace_session(session_hash, user_id, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session_hash,
                user_id,
                Utc::now().to_rfc3339(),
                expires_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn user_for_session(
        &self,
        session_hash: &str,
    ) -> Result<Option<MarketplaceUser>, MarketplaceStoreError> {
        let row = self
            .connection()?
            .query_row(
                "SELECT u.user_id, u.username, u.email, u.display_name, u.password_hash,
                        u.github_id, u.github_login, u.avatar_url, u.role, u.created_at, u.active
                 FROM marketplace_session s
                 JOIN marketplace_user u ON u.user_id=s.user_id
                 WHERE s.session_hash=?1 AND s.expires_at>?2 AND u.active=TRUE",
                params![session_hash, Utc::now().to_rfc3339()],
                stored_user_row,
            )
            .optional()?;
        row.map(stored_user_from_row)
            .transpose()
            .map(|record| record.map(|record| record.user))
    }

    pub fn delete_session(&self, session_hash: &str) -> Result<(), MarketplaceStoreError> {
        self.connection()?.execute(
            "DELETE FROM marketplace_session WHERE session_hash=?1",
            [session_hash],
        )?;
        Ok(())
    }

    pub fn save_oauth_state(
        &self,
        state_hash: &str,
        code_verifier: &str,
        return_url: Option<&str>,
        expires_at: DateTime<Utc>,
    ) -> Result<(), MarketplaceStoreError> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM marketplace_oauth_state WHERE expires_at<=?1",
            [Utc::now().to_rfc3339()],
        )?;
        connection.execute(
            "INSERT INTO marketplace_oauth_state(state_hash, code_verifier, return_url, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                state_hash,
                code_verifier,
                return_url,
                expires_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn consume_oauth_state(
        &self,
        state_hash: &str,
    ) -> Result<Option<OAuthState>, MarketplaceStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state = transaction
            .query_row(
                "SELECT code_verifier, return_url FROM marketplace_oauth_state
                 WHERE state_hash=?1 AND expires_at>?2",
                params![state_hash, Utc::now().to_rfc3339()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        transaction.execute(
            "DELETE FROM marketplace_oauth_state WHERE state_hash=?1",
            [state_hash],
        )?;
        transaction.commit()?;
        Ok(state.map(|(code_verifier, return_url)| OAuthState {
            code_verifier,
            return_url,
        }))
    }

    fn update_github_user(
        &self,
        user_id: &str,
        identity: &GitHubIdentity,
        role: MarketplaceUserRole,
    ) -> Result<(), MarketplaceStoreError> {
        let github_id = i64::try_from(identity.github_id)
            .map_err(|_| MarketplaceStoreError::InvalidGitHubId)?;
        self.connection()?.execute(
            "UPDATE marketplace_user SET
                email=COALESCE(email, ?1), github_id=?2, github_login=?3,
                avatar_url=?4, role=?5, updated_at=?6
             WHERE user_id=?7",
            params![
                identity.email,
                github_id,
                identity.login,
                identity.avatar_url,
                role.as_str(),
                Utc::now().to_rfc3339(),
                user_id,
            ],
        )?;
        Ok(())
    }

    fn user_by_sql(
        &self,
        sql: &str,
        value: &str,
    ) -> Result<Option<StoredUser>, MarketplaceStoreError> {
        let row = self
            .connection()?
            .query_row(sql, [value], stored_user_row)
            .optional()?;
        row.map(stored_user_from_row).transpose()
    }

    pub fn create_submission(
        &self,
        owner: &MarketplaceUser,
        preview: &MarketplaceUploadPreview,
        request: &PublishMarketplaceUploadRequest,
        artifact_path: &Path,
    ) -> Result<MarketplaceSubmission, MarketplaceStoreError> {
        if self.pending_submissions()?.iter().any(|submission| {
            submission.preview.package_id == preview.package_id
                && submission.preview.version == preview.version
        }) {
            return Err(MarketplaceStoreError::SubmissionAlreadyPending);
        }
        let submission_id = ulid::Ulid::new().to_string();
        let submitted_at = Utc::now();
        self.connection()?.execute(
            "INSERT INTO marketplace_submission(
                submission_id, owner_user_id, owner_json, preview_json, request_json,
                artifact_path, status, submitted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
            params![
                submission_id,
                owner.user_id,
                serde_json::to_string(owner)?,
                serde_json::to_string(preview)?,
                serde_json::to_string(request)?,
                artifact_path.to_string_lossy(),
                submitted_at.to_rfc3339(),
            ],
        )?;
        Ok(MarketplaceSubmission {
            submission_id,
            owner: owner.clone(),
            preview: preview.clone(),
            request: request.clone(),
            status: MarketplaceSubmissionStatus::Pending,
            review_note: None,
            submitted_at,
            reviewed_at: None,
            reviewer: None,
            release: None,
            artifact_path: artifact_path.to_path_buf(),
        })
    }

    pub fn submission(
        &self,
        submission_id: &str,
    ) -> Result<Option<MarketplaceSubmission>, MarketplaceStoreError> {
        let row = self
            .connection()?
            .query_row(
                "SELECT submission_id, owner_json, preview_json, request_json, artifact_path,
                        status, review_note, submitted_at, reviewed_at, release_json, reviewer_json
                 FROM marketplace_submission WHERE submission_id=?1",
                [submission_id],
                submission_row,
            )
            .optional()?;
        row.map(submission_from_row).transpose()
    }

    pub fn pending_submissions(&self) -> Result<Vec<MarketplaceSubmission>, MarketplaceStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT submission_id, owner_json, preview_json, request_json, artifact_path,
                    status, review_note, submitted_at, reviewed_at, release_json, reviewer_json
             FROM marketplace_submission WHERE status='pending' ORDER BY submitted_at ASC",
        )?;
        let submissions = statement
            .query_map(params![], submission_row)?
            .map(|row| submission_from_row(row?))
            .collect();
        submissions
    }

    pub fn reviewed_submissions(
        &self,
    ) -> Result<Vec<MarketplaceSubmission>, MarketplaceStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT submission_id, owner_json, preview_json, request_json, artifact_path,
                    status, review_note, submitted_at, reviewed_at, release_json, reviewer_json
             FROM marketplace_submission
             WHERE status IN ('approved', 'rejected')
             ORDER BY reviewed_at DESC, submitted_at DESC",
        )?;
        let submissions = statement
            .query_map(params![], submission_row)?
            .map(|row| submission_from_row(row?))
            .collect();
        submissions
    }

    pub fn submissions_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<MarketplaceSubmission>, MarketplaceStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT submission_id, owner_json, preview_json, request_json, artifact_path,
                    status, review_note, submitted_at, reviewed_at, release_json, reviewer_json
             FROM marketplace_submission WHERE owner_user_id=?1 ORDER BY submitted_at DESC",
        )?;
        let submissions = statement
            .query_map([user_id], submission_row)?
            .map(|row| submission_from_row(row?))
            .collect();
        submissions
    }

    pub fn finish_submission(
        &self,
        submission_id: &str,
        reviewer: &MarketplaceUser,
        status: MarketplaceSubmissionStatus,
        review_note: Option<&str>,
        release: Option<&MarketplaceReleaseDetail>,
    ) -> Result<MarketplaceSubmission, MarketplaceStoreError> {
        if status == MarketplaceSubmissionStatus::Pending {
            return Err(MarketplaceStoreError::InvalidSubmissionTransition);
        }
        let updated = self.connection()?.execute(
            "UPDATE marketplace_submission SET
                status=?1, reviewer_user_id=?2, reviewer_json=?3, review_note=?4,
                reviewed_at=?5, release_json=?6
             WHERE submission_id=?7 AND status='pending'",
            params![
                status.as_str(),
                reviewer.user_id,
                serde_json::to_string(reviewer)?,
                review_note.map(str::trim).filter(|value| !value.is_empty()),
                Utc::now().to_rfc3339(),
                release.map(serde_json::to_string).transpose()?,
                submission_id,
            ],
        )?;
        if updated != 1 {
            return Err(MarketplaceStoreError::InvalidSubmissionTransition);
        }
        self.submission(submission_id)?
            .ok_or(MarketplaceStoreError::SubmissionIntegrity)
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, MarketplaceStoreError> {
        self.connection
            .lock()
            .map_err(|_| MarketplaceStoreError::LockPoisoned)
    }
}

type StoredUserRow = (
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<i64>,
    Option<String>,
    Option<String>,
    String,
    String,
    bool,
);

fn stored_user_row(row: &crate::db::Row<'_>) -> crate::db::Result<StoredUserRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

fn stored_user_from_row(row: StoredUserRow) -> Result<StoredUser, MarketplaceStoreError> {
    let github_id = row
        .5
        .map(u64::try_from)
        .transpose()
        .map_err(|_| MarketplaceStoreError::InvalidGitHubId)?;
    Ok(StoredUser {
        user: MarketplaceUser {
            user_id: row.0,
            username: row.1,
            email: row.2,
            display_name: row.3,
            avatar_url: row.7,
            github_login: row.6,
            role: MarketplaceUserRole::parse(&row.8)?,
            created_at: parse_timestamp(&row.9)?,
        },
        password_hash: row.4,
        github_id,
        active: row.10,
    })
}

type SubmissionRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn submission_row(row: &crate::db::Row<'_>) -> crate::db::Result<SubmissionRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

fn submission_from_row(row: SubmissionRow) -> Result<MarketplaceSubmission, MarketplaceStoreError> {
    Ok(MarketplaceSubmission {
        submission_id: row.0,
        owner: serde_json::from_str(&row.1)?,
        preview: serde_json::from_str(&row.2)?,
        request: serde_json::from_str(&row.3)?,
        artifact_path: PathBuf::from(row.4),
        status: MarketplaceSubmissionStatus::parse(&row.5)?,
        review_note: row.6,
        submitted_at: parse_timestamp(&row.7)?,
        reviewed_at: row.8.as_deref().map(parse_timestamp).transpose()?,
        release: row.9.as_deref().map(serde_json::from_str).transpose()?,
        reviewer: row.10.as_deref().map(serde_json::from_str).transpose()?,
    })
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, MarketplaceStoreError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| MarketplaceStoreError::InvalidTimestamp(error.to_string()))
}

#[cfg(test)]
fn column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, MarketplaceStoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map(params![], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names.iter().any(|name| name == column))
}

#[cfg(not(test))]
fn column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, MarketplaceStoreError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name=?1 AND column_name=?2
            )",
            params![table, column],
            |row| row.get::<_, bool>(0),
        )
        .map_err(MarketplaceStoreError::from)
}

fn json_row<T: serde::de::DeserializeOwned>(
    connection: &Connection,
    sql: &str,
    id: &str,
) -> Result<Option<T>, MarketplaceStoreError> {
    let json = connection
        .query_row(sql, [id], |row| row.get::<_, String>(0))
        .optional()?;
    json.map(|json| serde_json::from_str(&json).map_err(MarketplaceStoreError::from))
        .transpose()
}

fn compare_releases(
    left: &MarketplaceReleaseSummary,
    right: &MarketplaceReleaseSummary,
) -> std::cmp::Ordering {
    compare_versions(&right.version, &left.version)
        .then_with(|| right.published_at.cmp(&left.published_at))
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    match (semver::Version::parse(left), semver::Version::parse(right)) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

fn normalized_tags(tags: &[String]) -> Vec<String> {
    let mut tags = tags
        .iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .take(16)
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();
    tags
}

#[derive(Debug, Error)]
pub enum MarketplaceStoreError {
    #[error("marketplace version already exists with different content")]
    VersionConflict,
    #[error("marketplace package belongs to a different publisher")]
    PublisherConflict,
    #[error("marketplace primary resource is invalid")]
    InvalidPrimaryResource,
    #[error("username or email already exists")]
    IdentityAlreadyExists,
    #[error("registration verification requests are temporarily rate limited")]
    RegistrationRateLimited,
    #[error("registration verification code is invalid or expired")]
    RegistrationCodeInvalid,
    #[error("stored account is inconsistent")]
    AccountIntegrity,
    #[error("GitHub account identifier is invalid")]
    InvalidGitHubId,
    #[error("staged upload has no authenticated owner")]
    UnownedUpload,
    #[error("the package version already has a pending submission")]
    SubmissionAlreadyPending,
    #[error("submission status is invalid: {0}")]
    InvalidSubmissionStatus(String),
    #[error("submission transition is invalid")]
    InvalidSubmissionTransition,
    #[error("stored submission is inconsistent")]
    SubmissionIntegrity,
    #[error("stored timestamp is invalid: {0}")]
    InvalidTimestamp(String),
    #[error("marketplace catalog is inconsistent")]
    CatalogIntegrity,
    #[error("marketplace store lock was poisoned")]
    LockPoisoned,
    #[error(transparent)]
    Database(#[from] crate::db::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Auth(#[from] MarketplaceAuthError),
}

#[cfg(test)]
mod tests {
    use crate::contracts::{
        AgentComponentKind, MarketplaceCompatibility, MarketplacePrimaryResource,
        MarketplaceResourceSummary,
    };
    use chrono::{Duration, Utc};

    use super::*;

    fn preview(package_id: &str, version: &str, hash: &str) -> MarketplaceUploadPreview {
        let resource = MarketplaceResourceSummary {
            resource: MarketplacePrimaryResource::Component {
                kind: AgentComponentKind::Skill,
                component_id: ulid::Ulid::new().to_string(),
                revision: ulid::Ulid::new().to_string(),
            },
            display_name: "Repository analyst".into(),
            files: vec!["SKILL.md".into()],
        };
        MarketplaceUploadPreview {
            upload_id: ulid::Ulid::new().to_string(),
            expires_at: Utc::now() + Duration::minutes(30),
            package_id: package_id.into(),
            version: version.into(),
            package_revision_id: ulid::Ulid::new().to_string(),
            package_content_hash: format!("package-{hash}"),
            archive_hash: hash.into(),
            archive_length: 128,
            publisher_id: "publisher.test".into(),
            publisher_display_name: "Test Publisher".into(),
            license: "Apache-2.0".into(),
            compatibility: MarketplaceCompatibility {
                codey_version_range: ">=0.1.4".into(),
                platforms: vec!["macos".into()],
                architectures: vec!["aarch64".into()],
            },
            available_primary_resources: vec![resource.clone()],
            resources: vec![resource.clone()],
            requested_permissions: vec!["workspace.read".into()],
            publication: PublishMarketplaceUploadRequest {
                primary_resource: resource.resource,
                title: "Repository analyst".into(),
                summary: "Repository analyst summary".into(),
                tags: vec!["analysis".into(), "repository".into()],
                readme_markdown: "# Repository analyst".into(),
                changelog: "Initial release".into(),
            },
            manifest: serde_json::json!({"schemaVersion": 1}),
        }
    }

    fn request(preview: &MarketplaceUploadPreview, title: &str) -> PublishMarketplaceUploadRequest {
        PublishMarketplaceUploadRequest {
            primary_resource: preview.available_primary_resources[0].resource.clone(),
            title: title.into(),
            summary: format!("{title} summary"),
            tags: vec!["Repository".into(), "analysis".into(), "repository".into()],
            readme_markdown: format!("# {title}"),
            changelog: "Initial release".into(),
        }
    }

    #[test]
    fn configured_admin_is_created_and_its_password_is_refreshed() {
        let root = tempfile::tempdir().unwrap();
        let store = MarketplaceStore::open(root.path(), "").unwrap();
        let initial_password = crate::auth::hash_password("initial-admin-password").unwrap();
        store
            .upsert_local_admin("admin", &initial_password)
            .unwrap();

        let initial = store.user_by_identifier("admin").unwrap().unwrap();
        assert!(initial.user.is_admin());
        assert!(initial.active);
        assert!(crate::auth::verify_password(
            "initial-admin-password",
            initial.password_hash.as_deref().unwrap()
        ));

        let replacement_password =
            crate::auth::hash_password("replacement-admin-password").unwrap();
        store
            .update_user_active(&initial.user.user_id, false)
            .unwrap();
        store
            .upsert_local_admin("admin", &replacement_password)
            .unwrap();
        let replacement = store.user_by_identifier("admin").unwrap().unwrap();
        assert!(replacement.user.is_admin());
        assert!(replacement.active);
        assert!(crate::auth::verify_password(
            "replacement-admin-password",
            replacement.password_hash.as_deref().unwrap()
        ));
        assert!(!crate::auth::verify_password(
            "initial-admin-password",
            replacement.password_hash.as_deref().unwrap()
        ));
    }

    #[test]
    fn existing_user_schema_receives_active_column() {
        let root = tempfile::tempdir().unwrap();
        let database_path = root.path().join("marketplace.sqlite3");
        let connection = crate::db::Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE marketplace_user (
                    user_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    email TEXT,
                    display_name TEXT NOT NULL,
                    password_hash TEXT,
                    github_id INTEGER UNIQUE,
                    github_login TEXT,
                    avatar_url TEXT,
                    role TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO marketplace_user(
                    user_id, username, display_name, role, created_at, updated_at
                ) VALUES ('legacy-user', 'legacy', 'Legacy user', 'user',
                          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
            )
            .unwrap();
        drop(connection);

        let store = MarketplaceStore::open(root.path(), "").unwrap();
        let user = store.user_by_identifier("legacy").unwrap().unwrap();
        assert!(user.active);
    }

    #[test]
    fn verified_registration_is_rate_limited_resumable_and_activated_once() {
        let root = tempfile::tempdir().unwrap();
        let store = MarketplaceStore::open(root.path(), "").unwrap();
        let now = Utc::now();
        let email = "new-user@example.com";
        let code_hash = crate::auth::token_hash("123456");
        store
            .create_registration_challenge(
                email,
                &code_hash,
                "source-hash",
                now,
                now + Duration::minutes(10),
            )
            .unwrap();
        assert!(matches!(
            store.create_registration_challenge(
                email,
                &code_hash,
                "source-hash",
                now,
                now + Duration::minutes(10),
            ),
            Err(MarketplaceStoreError::RegistrationRateLimited)
        ));
        assert!(matches!(
            store.consume_registration_challenge(email, &crate::auth::token_hash("000000"), now,),
            Err(MarketplaceStoreError::RegistrationCodeInvalid)
        ));
        store
            .consume_registration_challenge(email, &code_hash, now)
            .unwrap();

        let first = store
            .create_or_resume_verified_local_user(
                "first-name",
                email,
                "New User",
                "password-hash",
                now,
            )
            .unwrap();
        assert!(!store.user_by_id(&first.user_id).unwrap().unwrap().active);
        let resumed = store
            .create_or_resume_verified_local_user(
                "final-name",
                email,
                "Final User",
                "replacement-hash",
                now + Duration::seconds(1),
            )
            .unwrap();
        assert_eq!(resumed.user_id, first.user_id);
        assert_eq!(resumed.username, "final-name");

        store
            .activate_registered_user(&resumed.user_id, now + Duration::seconds(2))
            .unwrap();
        assert!(store.user_by_id(&resumed.user_id).unwrap().unwrap().active);
        assert!(matches!(
            store.create_or_resume_verified_local_user(
                "final-name",
                email,
                "Final User",
                "replacement-hash",
                now + Duration::seconds(3),
            ),
            Err(MarketplaceStoreError::IdentityAlreadyExists)
        ));
    }

    #[test]
    fn publish_keeps_versions_immutable_and_selects_latest_semver() {
        let root = tempfile::tempdir().unwrap();
        let store = MarketplaceStore::open(root.path(), "").unwrap();
        let v2 = preview("com.codey.repository-analyst", "2.0.0", "hash-v2");
        let v1 = preview("com.codey.repository-analyst", "1.0.0", "hash-v1");
        let first = store
            .publish(
                &v2,
                &request(&v2, "Repository analyst 2"),
                Path::new("v2.codeypkg"),
                "user.publisher",
                "Test Publisher",
            )
            .unwrap();
        store
            .publish(
                &v1,
                &request(&v1, "Repository analyst 1"),
                Path::new("v1.codeypkg"),
                "user.publisher",
                "Test Publisher",
            )
            .unwrap();

        let detail = store.listing(&first.listing_id).unwrap().unwrap();
        assert_eq!(detail.summary.title, "Repository analyst 2");
        assert_eq!(detail.summary.latest_release.version, "2.0.0");
        assert_eq!(detail.releases.len(), 2);
        assert_eq!(detail.releases[0].version, "2.0.0");
        assert_eq!(detail.summary.tags, vec!["analysis", "repository"]);

        let conflicting = preview("com.codey.repository-analyst", "2.0.0", "different-hash");
        assert!(matches!(
            store.publish(
                &conflicting,
                &request(&conflicting, "Changed"),
                Path::new("changed.codeypkg"),
                "user.publisher",
                "Test Publisher"
            ),
            Err(MarketplaceStoreError::VersionConflict)
        ));
    }

    #[test]
    fn catalog_filters_and_download_count_are_persistent() {
        let root = tempfile::tempdir().unwrap();
        let store = MarketplaceStore::open(root.path(), "").unwrap();
        let value = preview("com.codey.repository-analyst", "1.0.0", "hash-v1");
        let release = store
            .publish(
                &value,
                &request(&value, "Repository analyst"),
                Path::new("artifact.codeypkg"),
                "user.publisher",
                "Test Publisher",
            )
            .unwrap();

        assert_eq!(
            store
                .catalog(Some("repository"), None, None, 24)
                .unwrap()
                .listings
                .len(),
            1
        );
        assert!(store
            .catalog(Some("missing"), None, None, 24)
            .unwrap()
            .listings
            .is_empty());
        assert_eq!(
            store
                .catalog(None, Some(MarketplaceListingKind::Skill), None, 24)
                .unwrap()
                .listings
                .len(),
            1
        );
        store.record_download(&release.listing_id).unwrap();
        drop(store);

        let reopened = MarketplaceStore::open(root.path(), "").unwrap();
        let detail = reopened.listing(&release.listing_id).unwrap().unwrap();
        assert_eq!(detail.summary.download_count, 1);
        assert_eq!(
            reopened
                .download(&release.summary.release_id)
                .unwrap()
                .unwrap()
                .archive_path,
            PathBuf::from("artifact.codeypkg")
        );
    }

    #[test]
    fn rejected_submission_never_enters_catalog() {
        let root = tempfile::tempdir().unwrap();
        let store = MarketplaceStore::open(root.path(), "").unwrap();
        let password = crate::auth::hash_password("correct-horse-battery-staple").unwrap();
        let owner = store
            .create_local_user(
                "publisher",
                "publisher@example.com",
                "Publisher",
                &password,
                MarketplaceUserRole::User,
            )
            .unwrap();
        let reviewer = store
            .create_local_user(
                "reviewer",
                "reviewer@example.com",
                "Reviewer",
                &password,
                MarketplaceUserRole::Admin,
            )
            .unwrap();
        let value = preview("com.codey.rejected", "1.0.0", "rejected-hash");
        let submission = store
            .create_submission(
                &owner,
                &value,
                &request(&value, "Rejected template"),
                Path::new("rejected.codeypkg"),
            )
            .unwrap();
        let rejected = store
            .finish_submission(
                &submission.submission_id,
                &reviewer,
                MarketplaceSubmissionStatus::Rejected,
                Some("Unsafe permissions"),
                None,
            )
            .unwrap();
        assert_eq!(rejected.status, MarketplaceSubmissionStatus::Rejected);
        assert_eq!(rejected.review_note.as_deref(), Some("Unsafe permissions"));
        assert!(store
            .catalog(None, None, None, 24)
            .unwrap()
            .listings
            .is_empty());
    }
}
