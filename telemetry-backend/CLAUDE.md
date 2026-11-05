# telemetry-backend

- Own pnpm package: `cd telemetry-backend && pnpm test|typecheck|build`.
- Badge generator + legacy `POST /telemetry` forwarder. Legacy bridges map to plain `sha256(username)`, so a legacy→direct upgrade gets a new id once. Delete the ingest half once `source=legacy` traffic drops to ~0.
