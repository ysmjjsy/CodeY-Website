use std::collections::BTreeSet;

use crate::contracts::{
    MarketplaceCatalogResponse, MarketplaceDiscovery, MarketplaceListingDetail,
    MarketplacePrimaryResource, MarketplaceUploadPreview, PublishMarketplaceUploadRequest,
};
use base64::Engine as _;
use codey_package_format::{
    package_content_hash, package_dependency_lock_hash, AgentComponentKind, AgentPackage,
    AgentPackageArchive, DecimalU64, ExecutionTargetKind, PackageArchiveFile, PackageCompatibility,
    PackageComponentEntry, PackageComponentSource, PackageDefinitionEntry, PackageDefinitionKind,
    PackageDependencyLock, PackageFileChecksum, PackageId, PackageManifest, PackagePublisher,
    AGENT_PACKAGE_ARCHIVE_FORMAT_VERSION, AGENT_PACKAGE_CANONICALIZATION_VERSION,
    AGENT_PACKAGE_MANIFEST_SCHEMA_VERSION,
};
use reqwest::{Client, StatusCode};

use super::{build_router, MarketplaceServerConfig, MarketplaceSubmission};

#[tokio::test]
async fn api_account_upload_review_publish_and_download_round_trip() {
    let archive = build_archive();
    let data_root = secure_tempdir();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("http://{address}");
    let api_base_url = format!("{origin}/api/market/v1");
    let router = build_router(MarketplaceServerConfig {
        data_root: data_root.path().to_path_buf(),
        web_base_url: format!("{origin}/market"),
        api_base_url: api_base_url.clone(),
        cors_origin: origin.clone(),
        max_package_bytes: 4 * 1024 * 1024,
        github_client_id: Some("github-client".into()),
        github_client_secret: Some("github-secret".into()),
        admin_github_logins: BTreeSet::new(),
    })
    .unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let discovery = client
        .get(format!("{origin}/.well-known/codey-market.json"))
        .send()
        .await
        .unwrap();
    assert_eq!(discovery.status(), StatusCode::OK);
    assert_eq!(
        discovery
            .json::<MarketplaceDiscovery>()
            .await
            .unwrap()
            .api_base_url,
        api_base_url
    );

    let github_start = client
        .get(format!("{api_base_url}/auth/github"))
        .send()
        .await
        .unwrap();
    assert_eq!(github_start.status(), StatusCode::TEMPORARY_REDIRECT);
    let github_location = github_start
        .headers()
        .get(reqwest::header::LOCATION)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(github_location.starts_with("https://github.com/login/oauth/authorize?"));
    assert!(github_location.contains("code_challenge="));
    assert!(github_location.contains("state="));
    assert!(github_start
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .any(|value| value
            .to_str()
            .unwrap()
            .starts_with("codey_market_oauth_state=")));

    let register = client
        .post(format!("{api_base_url}/auth/register"))
        .header(reqwest::header::ORIGIN, &origin)
        .json(&serde_json::json!({
            "username": "publisher",
            "email": "publisher@example.com",
            "displayName": "Market Publisher",
            "password": "correct-horse-battery-staple"
        }))
        .send()
        .await
        .unwrap();
    assert_response_status(&register, StatusCode::OK);
    let registration_cookie = session_cookie_header(&register);
    let logout = client
        .post(format!("{api_base_url}/auth/logout"))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, registration_cookie)
        .send()
        .await
        .unwrap();
    assert_response_status(&logout, StatusCode::NO_CONTENT);

    let username_login = client
        .post(format!("{api_base_url}/auth/login"))
        .header(reqwest::header::ORIGIN, &origin)
        .json(&serde_json::json!({
            "identifier": "publisher",
            "password": "correct-horse-battery-staple"
        }))
        .send()
        .await
        .unwrap();
    assert_response_status(&username_login, StatusCode::OK);
    let username_cookie = session_cookie_header(&username_login);
    client
        .post(format!("{api_base_url}/auth/logout"))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, username_cookie)
        .send()
        .await
        .unwrap();

    let email_login = client
        .post(format!("{api_base_url}/auth/login"))
        .header(reqwest::header::ORIGIN, &origin)
        .json(&serde_json::json!({
            "identifier": "publisher@example.com",
            "password": "correct-horse-battery-staple"
        }))
        .send()
        .await
        .unwrap();
    assert_response_status(&email_login, StatusCode::OK);
    let publisher_cookie = session_cookie_header(&email_login);

    let boundary = "codey-market-test-boundary";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"fixture.codeypkg\"\r\nContent-Type: application/vnd.codey.agent-package+json\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(&archive);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let upload = client
        .post(format!("{api_base_url}/uploads"))
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, &publisher_cookie)
        .body(body)
        .send()
        .await
        .unwrap();
    assert_response_status(&upload, StatusCode::CREATED);
    let preview = upload.json::<MarketplaceUploadPreview>().await.unwrap();
    assert_eq!(
        preview.archive_hash,
        blake3::hash(&archive).to_hex().to_string()
    );
    assert!(!preview.available_primary_resources.is_empty());
    assert!(preview
        .available_primary_resources
        .iter()
        .any(|resource| matches!(
            resource.resource,
            MarketplacePrimaryResource::Definition {
                produces: ExecutionTargetKind::Workflow,
                ..
            }
        )));

    let publish = client
        .post(format!(
            "{api_base_url}/uploads/{}/publish",
            preview.upload_id
        ))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, &publisher_cookie)
        .json(&PublishMarketplaceUploadRequest {
            primary_resource: preview.available_primary_resources[0].resource.clone(),
            title: "Repository analyst".into(),
            summary: "Analyze a repository with a reusable Agent template.".into(),
            tags: vec!["repository".into(), "analysis".into()],
            readme_markdown: "# Repository analyst".into(),
            changelog: "Initial release".into(),
        })
        .send()
        .await
        .unwrap();
    assert_response_status(&publish, StatusCode::ACCEPTED);
    let submission = publish.json::<MarketplaceSubmission>().await.unwrap();

    let catalog_before_review = client
        .get(format!("{api_base_url}/listings?q=repository"))
        .send()
        .await
        .unwrap()
        .json::<MarketplaceCatalogResponse>()
        .await
        .unwrap();
    assert!(catalog_before_review.listings.is_empty());

    let register_admin = client
        .post(format!("{api_base_url}/auth/register"))
        .header(reqwest::header::ORIGIN, &origin)
        .json(&serde_json::json!({
            "username": "reviewer",
            "email": "reviewer@example.com",
            "displayName": "Market Reviewer",
            "password": "correct-horse-battery-staple"
        }))
        .send()
        .await
        .unwrap();
    assert_response_status(&register_admin, StatusCode::OK);
    let admin_cookie = session_cookie_header(&register_admin);
    rusqlite::Connection::open(data_root.path().join("marketplace.sqlite3"))
        .unwrap()
        .execute(
            "UPDATE marketplace_user SET role='admin' WHERE username='reviewer'",
            [],
        )
        .unwrap();

    let pending = client
        .get(format!("{api_base_url}/admin/submissions"))
        .header(reqwest::header::COOKIE, &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_response_status(&pending, StatusCode::OK);
    assert_eq!(
        pending
            .json::<Vec<MarketplaceSubmission>>()
            .await
            .unwrap()
            .len(),
        1
    );

    let approve = client
        .post(format!(
            "{api_base_url}/admin/submissions/{}/approve",
            submission.submission_id
        ))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, &admin_cookie)
        .json(&serde_json::json!({"note": "Verified"}))
        .send()
        .await
        .unwrap();
    assert_response_status(&approve, StatusCode::OK);
    let approved = approve.json::<MarketplaceSubmission>().await.unwrap();
    let release = approved.release.expect("approved submission has a release");

    let catalog = client
        .get(format!("{api_base_url}/listings?q=repository"))
        .send()
        .await
        .unwrap()
        .json::<MarketplaceCatalogResponse>()
        .await
        .unwrap();
    assert_eq!(catalog.listings.len(), 1);
    assert_eq!(catalog.listings[0].listing_id, release.listing_id);

    let listing = client
        .get(format!("{api_base_url}/listings/{}", release.listing_id))
        .send()
        .await
        .unwrap()
        .json::<MarketplaceListingDetail>()
        .await
        .unwrap();
    assert_eq!(listing.releases.len(), 1);
    assert_eq!(listing.summary.download_count, 0);

    let download = client
        .get(format!(
            "{api_base_url}/releases/{}/artifact",
            release.summary.release_id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), StatusCode::OK);
    assert_eq!(
        download.headers().get("etag").unwrap().to_str().unwrap(),
        format!("\"{}\"", preview.archive_hash)
    );
    assert_eq!(download.bytes().await.unwrap().as_ref(), archive.as_slice());

    let listing = client
        .get(format!("{api_base_url}/listings/{}", release.listing_id))
        .send()
        .await
        .unwrap()
        .json::<MarketplaceListingDetail>()
        .await
        .unwrap();
    assert_eq!(listing.summary.download_count, 1);

    server.abort();
    let _ = server.await;
}

fn session_cookie_header(response: &reqwest::Response) -> String {
    response
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}

fn assert_response_status(response: &reqwest::Response, expected: StatusCode) {
    assert_eq!(
        response.status(),
        expected,
        "unexpected response status: expected {expected}, got {}",
        response.status()
    );
}

fn build_archive() -> Vec<u8> {
    let skill_content = b"# Repository analyst\n\nInspect the repository before answering.";
    let skill_path = "SKILL.md";
    let skill_hash = blake3::hash(skill_content).to_hex().to_string();
    let workflow_content = br#"{"spec":{"displayName":"Repository workflow"}}"#;
    let workflow_path = "definitions/workflow.json";
    let workflow_hash = blake3::hash(workflow_content).to_hex().to_string();
    let checksums = vec![
        PackageFileChecksum {
            relative_path: skill_path.into(),
            length: DecimalU64::new(skill_content.len() as u64),
            blake3: skill_hash.clone(),
        },
        PackageFileChecksum {
            relative_path: workflow_path.into(),
            length: DecimalU64::new(workflow_content.len() as u64),
            blake3: workflow_hash.clone(),
        },
    ];
    let mut dependency_lock = PackageDependencyLock {
        schema_version: 1,
        dependencies: Vec::new(),
        content_hash: String::new(),
    };
    dependency_lock.content_hash = package_dependency_lock_hash(&dependency_lock).unwrap();
    let mut manifest = PackageManifest {
        schema_version: AGENT_PACKAGE_MANIFEST_SCHEMA_VERSION,
        archive_format_version: AGENT_PACKAGE_ARCHIVE_FORMAT_VERSION,
        canonicalization_version: AGENT_PACKAGE_CANONICALIZATION_VERSION,
        package_id: PackageId::new("com.codey.repository-analyst").unwrap(),
        package_revision_id: ulid::Ulid::new().to_string(),
        namespace: "market-test".into(),
        version: "1.0.0".into(),
        publisher: PackagePublisher {
            publisher_id: "publisher.market-test".into(),
            display_name: "Marketplace Test Publisher".into(),
            source_url: None,
        },
        source: None,
        license: "Apache-2.0".into(),
        compatibility: PackageCompatibility {
            codey_version_range: ">=0.1.4".into(),
            platforms: BTreeSet::new(),
            architectures: BTreeSet::new(),
        },
        definitions: vec![PackageDefinitionEntry {
            kind: PackageDefinitionKind::Workflow,
            definition_id: ulid::Ulid::new().to_string(),
            revision: ulid::Ulid::new().to_string(),
            relative_path: workflow_path.into(),
            content_hash: workflow_hash.clone(),
        }],
        templates: Vec::new(),
        components: vec![PackageComponentEntry {
            component_id: ulid::Ulid::new().to_string(),
            revision: ulid::Ulid::new().to_string(),
            kind: AgentComponentKind::Skill,
            logical_name: "repository-analyst".into(),
            source: PackageComponentSource::Embedded {
                relative_path: skill_path.into(),
                content_hash: skill_hash.clone(),
            },
            requested_capabilities: BTreeSet::new(),
        }],
        dependencies: Vec::new(),
        requested_permissions: BTreeSet::new(),
        migrations: Vec::new(),
        package_content_hash: String::new(),
    };
    manifest.package_content_hash =
        package_content_hash(&manifest, &dependency_lock, &checksums).unwrap();
    AgentPackageArchive {
        archive_format_version: AGENT_PACKAGE_ARCHIVE_FORMAT_VERSION,
        package: AgentPackage {
            manifest,
            dependency_lock,
            checksums,
            signature: None,
        },
        files: vec![
            PackageArchiveFile {
                relative_path: skill_path.into(),
                length: DecimalU64::new(skill_content.len() as u64),
                blake3: skill_hash,
                unix_mode: 0o644,
                modified_unix_seconds: DecimalU64::new(0),
                content_base64: base64::engine::general_purpose::STANDARD.encode(skill_content),
            },
            PackageArchiveFile {
                relative_path: workflow_path.into(),
                length: DecimalU64::new(workflow_content.len() as u64),
                blake3: workflow_hash,
                unix_mode: 0o644,
                modified_unix_seconds: DecimalU64::new(0),
                content_base64: base64::engine::general_purpose::STANDARD.encode(workflow_content),
            },
        ],
    }
    .canonical_bytes()
    .unwrap()
}

fn secure_tempdir() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}
