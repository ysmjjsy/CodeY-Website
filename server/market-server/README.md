# CodeY Website Marketplace Server

The marketplace server stores accounts, authenticated sessions, review submissions, canonical
`.codeypkg` artifacts, and public marketplace metadata. Uploads remain private until an
administrator approves them.

```bash
cargo run -p codey-market-server
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEY_MARKET_ADDR` | `127.0.0.1:8787` | Listen address |
| `CODEY_DATABASE_URL` | required | PostgreSQL connection URL for accounts, marketplace, and cloud data |
| `CODEY_MARKET_DATA_ROOT` | `.codey-market` | Staged uploads and published artifacts |
| `CODEY_MARKET_WEB_BASE_URL` | `http://127.0.0.1:4321/market` | Public marketplace page |
| `CODEY_MARKET_API_BASE_URL` | `http://127.0.0.1:8787/api/market/v1` | Public API base URL |
| `CODEY_MARKET_CORS_ORIGIN` | `http://127.0.0.1:4321` | Website origin allowed to call the API |
| `CODEY_CLOUD_ENTITLEMENT_SIGNING_KEY` | generated and persisted | Unpadded base64url Ed25519 PKCS#8 key used to sign Desktop model entitlements |
| `CODEY_CLOUD_ENTITLEMENT_KEY_ID` | `codey-cloud-v1` | Stable ID published with the entitlement verification key |
| `CODEY_MARKET_GITHUB_CLIENT_ID` | unset | GitHub OAuth App client ID |
| `CODEY_MARKET_GITHUB_CLIENT_SECRET` | unset | GitHub OAuth App client secret |
| `CODEY_MARKET_ADMIN_GITHUB_LOGINS` | unset | Comma-separated GitHub logins promoted to administrators |
| `CODEY_MARKET_ADMIN_USERNAME` | `admin` | Local administrator username |
| `CODEY_MARKET_ADMIN_PASSWORD` | `a773949603` | Local administrator password |
| `CODEY_REGISTRATION_SMTP_HOST` | unset | SMTP host; registration is disabled when unset |
| `CODEY_REGISTRATION_SMTP_PORT` | `587` | SMTP port |
| `CODEY_REGISTRATION_SMTP_SECURITY` | `starttls` | `tls`, `starttls`, or `none` |
| `CODEY_REGISTRATION_SMTP_USERNAME` | unset | Optional SMTP username; configure with the password |
| `CODEY_REGISTRATION_SMTP_PASSWORD` | unset | Optional SMTP password; configure with the username |
| `CODEY_REGISTRATION_EMAIL_FROM` | unset | Verification sender mailbox; required with the SMTP host |

Local accounts support login by either username or email. Passwords are stored as Argon2id
hashes. The configured local administrator is created on startup; changing its configured password
updates the stored hash on the next startup. GitHub login is enabled only when both OAuth variables
are configured. The OAuth App callback is
`<website-origin>/api/market/v1/auth/github/callback`.

Local registration requires SMTP configuration and a six-digit email verification code. Codes
expire after ten minutes. The server rate-limits sends by email and reverse-proxy client address,
stores only code hashes, and activates the account only after the default cloud subscription has
been provisioned.

The normal development and production entry points live in `CodeY-Website`: `pnpm dev` and
`pnpm start` manage this service and proxy both `/.well-known/codey-market.json` and
`/api/market/v1/*` through the website origin. The website does not require a public marketplace
API environment variable. Running the Cargo command above starts this backend by itself and is
intended for backend development.

The desktop reads `~/.codey/config/marketplace.json`:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "websiteUrl": "https://codey.example/market"
}
```

The desktop derives the API address from the website's `/.well-known/codey-market.json` response.
Desktop account login uses `/.well-known/codey-cloud.json`. The response publishes the Cloud API
address and entitlement verification key. If no signing key is configured, the server creates
`cloud-entitlement-ed25519.pk8` under `CODEY_MARKET_DATA_ROOT`; that file must remain persistent
across deployments.
