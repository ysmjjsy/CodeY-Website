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
| `CODEY_MARKET_DATA_ROOT` | `.codey-market` | SQLite database, staged uploads, and artifacts |
| `CODEY_MARKET_WEB_BASE_URL` | `http://127.0.0.1:4321/market` | Public marketplace page |
| `CODEY_MARKET_API_BASE_URL` | `http://127.0.0.1:8787/api/market/v1` | Public API base URL |
| `CODEY_MARKET_CORS_ORIGIN` | `http://127.0.0.1:4321` | Website origin allowed to call the API |
| `CODEY_MARKET_GITHUB_CLIENT_ID` | unset | GitHub OAuth App client ID |
| `CODEY_MARKET_GITHUB_CLIENT_SECRET` | unset | GitHub OAuth App client secret |
| `CODEY_MARKET_ADMIN_GITHUB_LOGINS` | unset | Comma-separated GitHub logins promoted to administrators |

Local accounts support login by either username or email. Passwords are stored as Argon2id
hashes. GitHub login is enabled only when both OAuth variables are configured. The OAuth App
callback is `<website-origin>/api/market/v1/auth/github/callback`.

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
