use std::collections::BTreeSet;

use crate::contracts::{
    AgentComponentKind, ExecutionTargetKind, MarketplaceCatalogResponse, MarketplaceDiscovery,
    MarketplaceListingDetail, MarketplacePrimaryResource, MarketplaceUploadPreview,
    PackageMarketplaceMetadataDocument, PACKAGE_MARKETPLACE_METADATA_SCHEMA_VERSION,
};
use codey_package_format::{
    build_file_table, canonical_json_bytes, package_dependency_lock_hash, package_resource_digest,
    parse_archive, CodeyPackage, CodeyPackageArchive, PackageCompatibility, PackageDependencyLock,
    PackageId, PackageManifest, PackagePublisher, PackageResourceEntry, PackageResourceKind,
    PACKAGE_ARCHIVE_FORMAT_VERSION, PACKAGE_CANONICALIZATION_VERSION, PACKAGE_LOCK_PATH,
    PACKAGE_LOCK_SCHEMA_VERSION, PACKAGE_MANIFEST_SCHEMA_VERSION,
};
use reqwest::{Client, StatusCode};

use super::{
    build_router, inspect_archive, ArchiveInspectionError, MarketplaceServerConfig,
    MarketplaceSubmission,
};

#[test]
fn archive_inspection_requires_package_marketplace_metadata() {
    let bytes = build_archive_without_marketplace();
    let error = inspect_archive(
        ulid::Ulid::new().to_string(),
        chrono::Utc::now() + chrono::Duration::minutes(30),
        &bytes,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        ArchiveInspectionError::MarketplaceMetadataMissing
    ));
}

#[tokio::test]
async fn administrator_publishes_versioned_plan_catalog() {
    let data_root = secure_tempdir();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("http://{address}");
    let market_api = format!("{origin}/api/market/v1");
    let cloud_api = format!("{origin}/api/cloud/v1");
    let router = build_router(MarketplaceServerConfig {
        database_url: String::new(),
        data_root: data_root.path().to_path_buf(),
        web_base_url: format!("{origin}/market"),
        api_base_url: market_api.clone(),
        cloud_api_base_url: cloud_api.clone(),
        cloud_default_timezone: "Asia/Shanghai".into(),
        cors_origin: origin.clone(),
        max_package_bytes: 4 * 1024 * 1024,
        github_client_id: None,
        github_client_secret: None,
        admin_github_logins: BTreeSet::new(),
        admin_username: "plan-admin".into(),
        admin_password: "correct-horse-battery-staple".into(),
        payments: crate::cloud::CloudPaymentConfig::default(),
        cloud_secret_cipher: None,
    })
    .unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = Client::new();

    let catalog = client
        .get(format!("{cloud_api}/plans"))
        .send()
        .await
        .unwrap()
        .json::<crate::cloud::PlanCatalog>()
        .await
        .unwrap();
    assert_eq!(catalog.revision, 0);
    assert_eq!(catalog.plans.len(), 1);

    let login = client
        .post(format!("{market_api}/auth/login"))
        .header(reqwest::header::ORIGIN, &origin)
        .json(&serde_json::json!({
            "identifier": "plan-admin",
            "password": "correct-horse-battery-staple"
        }))
        .send()
        .await
        .unwrap();
    assert_response_status(&login, StatusCode::OK);
    let admin_cookie = session_cookie_header(&login);

    let publish = client
        .post(format!("{cloud_api}/admin/plans"))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, &admin_cookie)
        .json(&crate::cloud::PublishPlanRequest {
            plan_id: None,
            slug: "pro".into(),
            display_name: "Pro".into(),
            description: "Professional monthly plan".into(),
            display_name_i18n: Default::default(),
            description_i18n: Default::default(),
            tier_rank: 10,
            is_default: false,
            monthly_credit_micros: 100_000_000,
            offers: vec![crate::cloud::PlanOfferInput {
                region: "CN".into(),
                currency: "CNY".into(),
                payment_provider: crate::cloud::PaymentProvider::WechatPay,
                amount_minor: 2_900,
            }],
            benefits: vec![crate::cloud::PlanBenefitInput {
                code: "official-models".into(),
                resource_type: "model".into(),
                resource_id: None,
                action: "invoke".into(),
                limit: serde_json::json!({}),
            }],
            expected_revision: catalog.revision,
        })
        .send()
        .await
        .unwrap();
    assert_response_status(&publish, StatusCode::OK);
    let catalog = publish.json::<crate::cloud::PlanCatalog>().await.unwrap();
    assert_eq!(catalog.revision, 1);
    assert_eq!(catalog.plans.len(), 2);
    assert_eq!(catalog.plans[1].offers[0].amount_minor, 2_900);

    server.abort();
}

#[tokio::test]
async fn desktop_oauth_pkce_links_the_website_account_and_cloud_profile() {
    let data_root = secure_tempdir();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("http://{address}");
    let market_api = format!("{origin}/api/market/v1");
    let cloud_api = format!("{origin}/api/cloud/v1");
    let router = build_router(MarketplaceServerConfig {
        database_url: String::new(),
        data_root: data_root.path().to_path_buf(),
        web_base_url: format!("{origin}/market"),
        api_base_url: market_api.clone(),
        cloud_api_base_url: cloud_api.clone(),
        cloud_default_timezone: "Asia/Shanghai".into(),
        cors_origin: origin.clone(),
        max_package_bytes: 4 * 1024 * 1024,
        github_client_id: None,
        github_client_secret: None,
        admin_github_logins: BTreeSet::new(),
        admin_username: "configured-admin".into(),
        admin_password: "configured-admin-password".into(),
        payments: crate::cloud::CloudPaymentConfig::default(),
        cloud_secret_cipher: None,
    })
    .unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let discovery = client
        .get(format!("{origin}/.well-known/codey-cloud.json"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(discovery["webBaseUrl"], origin);
    let register = client
        .post(format!("{market_api}/auth/register"))
        .header(reqwest::header::ORIGIN, &origin)
        .json(&serde_json::json!({
            "username": "desktop-user",
            "email": "desktop@example.com",
            "displayName": "Desktop User",
            "password": "correct-horse-battery-staple"
        }))
        .send()
        .await
        .unwrap();
    assert_response_status(&register, StatusCode::OK);
    let cookie = session_cookie_header(&register);

    let verifier = crate::auth::random_token(32).unwrap();
    let challenge = crate::auth::pkce_challenge(&verifier);
    let redirect_uri = "http://127.0.0.1:45678/oauth/callback";
    let state = "desktop-oauth-state-1234567890";
    let authorize = client
        .get(format!("{cloud_api}/oauth/authorize"))
        .header(reqwest::header::COOKIE, &cookie)
        .query(&[
            ("response_type", "code"),
            ("client_id", "codey-desktop"),
            ("redirect_uri", redirect_uri),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(authorize.status(), StatusCode::TEMPORARY_REDIRECT);
    let callback = url::Url::parse(
        authorize
            .headers()
            .get(reqwest::header::LOCATION)
            .unwrap()
            .to_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        callback
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1,
        state
    );
    let code = callback
        .query_pairs()
        .find(|(key, _)| key == "code")
        .unwrap()
        .1
        .into_owned();
    let token = client
        .post(format!("{cloud_api}/oauth/token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", "codey-desktop"),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect_uri),
            ("device_name", "Integration Mac"),
        ])
        .send()
        .await
        .unwrap();
    assert_response_status(&token, StatusCode::OK);
    let token = token.json::<crate::cloud::OAuthTokenPair>().await.unwrap();
    let cloud_me = client
        .get(format!("{cloud_api}/me"))
        .bearer_auth(&token.access_token)
        .send()
        .await
        .unwrap();
    assert_response_status(&cloud_me, StatusCode::OK);
    let profile = cloud_me.json::<serde_json::Value>().await.unwrap();
    assert_eq!(profile["user"]["username"], "desktop-user");
    assert_eq!(profile["subscription"]["planId"], "plan-free");
    assert_eq!(profile["subscription"]["billingTimezone"], "Asia/Shanghai");

    let devices = client
        .get(format!("{cloud_api}/devices"))
        .bearer_auth(&token.access_token)
        .send()
        .await
        .unwrap();
    assert_response_status(&devices, StatusCode::OK);
    assert_eq!(
        devices
            .json::<Vec<crate::cloud::OAuthDeviceSession>>()
            .await
            .unwrap()
            .len(),
        1
    );
    server.abort();
}

#[tokio::test]
async fn api_account_upload_review_publish_and_download_round_trip() {
    let archive = build_archive();
    let data_root = secure_tempdir();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let origin = format!("http://{address}");
    let api_base_url = format!("{origin}/api/market/v1");
    let router = build_router(MarketplaceServerConfig {
        database_url: String::new(),
        data_root: data_root.path().to_path_buf(),
        web_base_url: format!("{origin}/market"),
        api_base_url: api_base_url.clone(),
        cloud_api_base_url: format!("{origin}/api/cloud/v1"),
        cloud_default_timezone: "UTC".into(),
        cors_origin: origin.clone(),
        max_package_bytes: 4 * 1024 * 1024,
        github_client_id: Some("github-client".into()),
        github_client_secret: Some("github-secret".into()),
        admin_github_logins: BTreeSet::new(),
        admin_username: "configured-admin".into(),
        admin_password: "configured-admin-password".into(),
        payments: crate::cloud::CloudPaymentConfig::default(),
        cloud_secret_cipher: None,
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
        "--{boundary}\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"fixture.codeypkg\"\r\nContent-Type: application/vnd.codey.package+zip\r\n\r\n"
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
    assert_eq!(preview.publication.title, "Repository analyst");
    assert_eq!(preview.publication.tags, vec!["analysis", "repository"]);
    assert_eq!(
        preview
            .resources
            .iter()
            .find(|resource| matches!(
                resource.resource,
                MarketplacePrimaryResource::Component {
                    kind: AgentComponentKind::Skill,
                    ..
                }
            ))
            .map(|resource| resource.files.as_slice()),
        Some(["SKILL.md".to_owned()].as_slice())
    );

    let mut changed_publication = preview.publication.clone();
    changed_publication.title = "Changed in browser".into();
    let changed_publish = client
        .post(format!(
            "{api_base_url}/uploads/{}/publish",
            preview.upload_id
        ))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, &publisher_cookie)
        .json(&changed_publication)
        .send()
        .await
        .unwrap();
    assert_response_status(&changed_publish, StatusCode::BAD_REQUEST);

    let publish = client
        .post(format!(
            "{api_base_url}/uploads/{}/publish",
            preview.upload_id
        ))
        .header(reqwest::header::ORIGIN, &origin)
        .header(reqwest::header::COOKIE, &publisher_cookie)
        .json(&preview.publication)
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

    let reviewed = client
        .get(format!("{api_base_url}/admin/reviews"))
        .header(reqwest::header::COOKIE, &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_response_status(&reviewed, StatusCode::OK);
    let reviewed = reviewed.json::<Vec<MarketplaceSubmission>>().await.unwrap();
    assert_eq!(reviewed.len(), 1);
    assert_eq!(reviewed[0].review_note.as_deref(), Some("Verified"));
    assert_eq!(
        reviewed[0]
            .reviewer
            .as_ref()
            .map(|user| user.username.as_str()),
        Some("reviewer")
    );

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
    let skill_content = b"---\nname: repository-analyst\ndescription: Inspect repositories.\n---\n\nInspect the repository before answering.";
    let skill_root = "resources/skills/repository-analyst";
    let skill_path = format!("{skill_root}/SKILL.md");
    let component_id = ulid::Ulid::new().to_string();
    let component_revision = ulid::Ulid::new().to_string();
    let component_descriptor_path = format!("{skill_root}/codey/resource.json");
    let component_descriptor = canonical_json_bytes(&serde_json::json!({
        "schemaVersion": 1,
        "componentId": component_id,
        "revision": component_revision,
        "kind": "skill",
        "logicalName": "repository-analyst",
        "entrypoint": "SKILL.md",
        "dependencies": []
    }))
    .unwrap();
    let workflow_id = ulid::Ulid::new().to_string();
    let workflow_revision = ulid::Ulid::new().to_string();
    let workflow_root = format!("resources/workflows/{}", workflow_id.to_ascii_lowercase());
    let workflow_path = format!("{workflow_root}/definition.json");
    let workflow_content = canonical_json_bytes(&serde_json::json!({
        "schemaVersion": 1,
        "kind": "workflow",
        "definitionId": workflow_id,
        "revision": workflow_revision,
        "spec": {"displayName": "Repository workflow"},
        "contentHash": blake3::hash(b"workflow").to_hex().to_string(),
        "dependencies": [],
        "componentRevisions": [],
        "bindings": []
    }))
    .unwrap();
    let readme_content = b"# Repository analyst\n\nAnalyze a repository with package evidence.";
    let readme_path = "marketplace/README.md";
    let changelog_content = b"Initial release";
    let changelog_path = "marketplace/CHANGELOG.md";
    let marketplace_content = canonical_json_bytes(&PackageMarketplaceMetadataDocument {
        schema_version: PACKAGE_MARKETPLACE_METADATA_SCHEMA_VERSION,
        primary_resource: MarketplacePrimaryResource::Component {
            kind: AgentComponentKind::Skill,
            component_id: component_id.clone(),
            revision: component_revision.clone(),
        },
        title: "Repository analyst".into(),
        summary: "Analyze a repository with a reusable Agent template.".into(),
        tags: vec!["repository".into(), "analysis".into()],
        readme_path: Some(readme_path.into()),
        changelog_path: Some(changelog_path.into()),
    })
    .unwrap();
    let marketplace_path = "marketplace/listing.json";
    let mut dependency_lock = PackageDependencyLock {
        schema_version: PACKAGE_LOCK_SCHEMA_VERSION,
        packages: Vec::new(),
        external_artifacts: Vec::new(),
        content_hash: String::new(),
    };
    dependency_lock.content_hash = package_dependency_lock_hash(&dependency_lock).unwrap();
    let files = std::collections::BTreeMap::from([
        (skill_path, skill_content.to_vec()),
        (component_descriptor_path, component_descriptor),
        (workflow_path, workflow_content),
        (readme_path.into(), readme_content.to_vec()),
        (changelog_path.into(), changelog_content.to_vec()),
        (marketplace_path.into(), marketplace_content),
        (
            PACKAGE_LOCK_PATH.into(),
            canonical_json_bytes(&dependency_lock).unwrap(),
        ),
    ]);
    let file_table = build_file_table(&files, &BTreeSet::new()).unwrap();
    let resources = vec![
        PackageResourceEntry {
            resource_ref: "skill/repository-analyst".into(),
            kind: PackageResourceKind::Skill,
            format: "agentskills.io/skill/1".into(),
            root: skill_root.into(),
            digest: package_resource_digest(skill_root, &file_table).unwrap(),
        },
        PackageResourceEntry {
            resource_ref: format!("workflow/{}", workflow_id.to_ascii_lowercase()),
            kind: PackageResourceKind::Workflow,
            format: "codey.workflow-definition/1".into(),
            root: workflow_root.clone(),
            digest: package_resource_digest(&workflow_root, &file_table).unwrap(),
        },
    ];
    let manifest = PackageManifest {
        schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
        archive_format_version: PACKAGE_ARCHIVE_FORMAT_VERSION,
        canonicalization_version: PACKAGE_CANONICALIZATION_VERSION,
        package_id: PackageId::new("com.codey.repository-analyst").unwrap(),
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
        resources,
        dependencies: Vec::new(),
        files: file_table,
        extensions: Default::default(),
    };
    CodeyPackageArchive {
        package: CodeyPackage {
            manifest,
            dependency_lock,
            signature: None,
        },
        files,
    }
    .encode()
    .unwrap()
}

fn build_archive_without_marketplace() -> Vec<u8> {
    let mut archive = parse_archive(&build_archive()).unwrap();
    archive
        .files
        .retain(|path, _| !path.starts_with("marketplace/"));
    archive.package.manifest.files = build_file_table(&archive.files, &BTreeSet::new()).unwrap();
    archive.encode().unwrap()
}

fn secure_tempdir() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}
