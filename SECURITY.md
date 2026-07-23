# Security Policy

## Reporting

Do not open a public issue containing mailbox tokens, administrator cookies, email addresses, message
content, Cloudflare account identifiers, or bootstrap secrets. Report security issues privately to the
repository owner and rotate any exposed credential immediately.

## Deployment gate

Production deployment is blocked when this command reports a high or critical vulnerability:

```powershell
npm audit --omit=dev --audit-level=high
```

As of 2026-07-23 this production audit reports zero vulnerabilities.

## Known development-tooling advisory

A full `npm audit` currently reports four high findings in `sharp 0.34.5`, pulled transitively by
Miniflare and Wrangler through the Cloudflare Vitest integration. The affected package is used by local
Cloudflare tooling and is not included in the deployed Worker or Pages bundle. This project does not use
Miniflare's local Images processing with untrusted input.

Cloudflare's latest stable Miniflare at the time of review still pins `sharp 0.34.5`. Do not use
`npm audit fix --force`: npm proposes a breaking downgrade of the Cloudflare test integration. Remove
this exception as soon as a compatible Cloudflare release uses `sharp >=0.35.0`, then rerun the entire
test suite and Wrangler dry-run.

## Secret handling

- Store `ADMIN_BOOTSTRAP_SECRET` with `wrangler secret put`.
- Never place secrets in `wrangler.toml`, `.env`, logs, screenshots, issues, or commits.
- Remove or rotate the bootstrap secret after the first administrator setup.
- Disable Email Routing catch-all before incident investigation or rollback.
