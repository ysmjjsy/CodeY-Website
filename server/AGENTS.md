# AGENTS.md — server/

The Rust backend for the website: `server/market-server`, the single member of the
Cargo workspace declared in the repository-root `Cargo.toml`. It serves the
marketplace API, the cloud/account API, and the two discovery documents the desktop
app reads.

## Responsibilities

- Own the Axum router: `/.well-known/codey-market.json`, `/.well-known/codey-cloud.json`, `/api/market/v1/*`, `/api/cloud/v1/*`.
- Authenticate accounts (Argon2id passwords, session cookies, GitHub OAuth, desktop PKCE OAuth) and authorise marketplace admins.
- Stage, inspect and publish `.codeypkg` archives (`archive.rs`, `package_format.rs`).
- Implement the cloud domain under `src/cloud/`: plans, credits and billing, top-ups, payments, upstream providers, model catalog, entitlement signing and the model gateway.
- Persist everything through `src/store.rs` (marketplace) and `src/cloud/store.rs` (cloud).

## Boundaries

- `src/main.rs` binds a socket and calls `build_router`; routing, configuration and error shaping live in `src/lib.rs`. Do not add routes in `main.rs`.
- Environment parsing belongs in `MarketplaceServerConfig::from_environment`. Do not read variables ad hoc inside handlers.
- Schema is created by `CREATE TABLE IF NOT EXISTS` statements executed at store construction (`store.rs`, `cloud/store.rs`). There is no migrations directory — do not add one silently.
- Production runs Postgres; the test suite runs a bundled SQLite backend. `src/db.rs` selects them with `#[cfg(test)]`, so a query that passes in tests can still fail in production.
- Do not restate the environment table, deployment notes or desktop JSON contract — `server/market-server/README.md` owns that operator-facing prose.
- Do not commit `target/` or `.codey-market/`; both are gitignored build and runtime output.

## Key paths

| Path | What it does |
| --- | --- |
| `server/market-server/src/main.rs` | Binary entry: tracing setup, `CODEY_MARKET_ADDR`, graceful shutdown |
| `server/market-server/src/lib.rs` | `MarketplaceServerConfig`, `build_router`, handlers, `ApiError` → `{error:{code,message}}` |
| `server/market-server/src/db.rs` | Connection backend: SQLite under test, Postgres otherwise |
| `server/market-server/src/store.rs` | Marketplace store: users, sessions, uploads, submissions, releases |
| `server/market-server/src/auth.rs` | Password hashing, sessions, cookies, field validation, GitHub identity |
| `server/market-server/src/archive.rs` | `.codeypkg` archive inspection and upload preview |
| `server/market-server/src/package_format.rs` | Package manifest, dependency lock, digests and canonicalisation |
| `server/market-server/src/contracts.rs` | Marketplace request/response types and the schema version |
| `server/market-server/src/cloud/` | `billing`, `catalog`, `contracts`, `discovery`, `entitlement`, `gateway`, `models`, `payment`, `period`, `provider_catalog`, `store`, `topup` |
| `server/market-server/src/tests.rs` | `#[cfg(test)]` integration tests driven through the router |
| `server/market-server/examples/validate_package_batch.rs` | Batch-validates every `.codeypkg` under a directory |
| `server/market-server/Cargo.toml` | Crate manifest; versions are inherited from the workspace |
| `Cargo.toml` | Workspace root: members, pinned dependency versions, `unsafe_code = "forbid"`, clippy levels |

## Commands / Verification

- `cargo run -p codey-market-server` — run this backend by itself, for backend development.
- `cargo test -p codey-market-server` — the suite in `src/tests.rs`.
- `pnpm dev` / `pnpm start` — the normal entry points; `scripts/run-site.mjs` starts this service, builds it in dev, and proxies it in production.
- `pnpm build` — `scripts/build-site.mjs` runs `cargo build -p codey-market-server --release` into `.codey-market/target`.
- `cargo clippy -p codey-market-server` — the workspace sets clippy `all` and `pedantic` to warn.
