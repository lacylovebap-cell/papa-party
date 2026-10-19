# Public URL registry: isolated PostgreSQL validation

Tested the exact `supabase/migrations/202610190001_public_routes.sql` against a fresh, synthetic PostgreSQL **17.11** cluster. Only `127.0.0.1:55439` was used. No production query, credential, copied player data, Audit text, or outbound database connection was used.

The machine-readable evidence is `public-routes-postgres-validation-20261019.json`; the script exits nonzero if any assertion fails.

## Results

- Exact migration retained identical row digests for ten existing synthetic business/auth/Audit tables.
- Two independent `psql` processes submitted different new codes with the same expected revision. The first transaction deliberately held its advisory lock; `pg_stat_activity` confirmed that the second connection waited on `wait_event_type=Lock`, `wait_event=advisory`.
- After the first transaction committed, it succeeded and the second failed with `PUBLIC_ROUTE_VERSION_CONFLICT` (psql exit 3). The registry had revision 1, exactly one Audit entry, and three aliases (two seeds plus the one winning URL). The old `/pa` resolved directly to the winner; the losing URL did not exist.
- Retrying the committed value with an old revision changed no metadata, aliases or Audit.
- A deliberately failing Audit insert rolled back the new code, alias, revision and Audit as one transaction.
- A deliberately failing second child URL during a hall rename rolled back the hall and every child URL.
- All ten original synthetic business/auth/Audit table digests remained identical after every scenario.
- The local PostgreSQL server was stopped at the end. No test port remains listening.

## Repeat

From the repository root, with PostgreSQL 17 portable binaries installed locally:

```powershell
$env:PG17_BIN = (Resolve-Path '.local-public-route-validation/portable/pgsql/bin').Path
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' ops/validate-public-routes-postgres.mjs
```

The default port is 55439; an unused high port may be supplied as `PA_PG_TEST_PORT`. Every run creates a new cluster under `.local-public-route-validation/`, sanitizes inherited `PG*` connection settings, uses an explicit local host/user/database, runs the exact migration, and stops its server in `finally`. Its local trust authentication is restricted to this disposable test cluster bound to localhost. Keep the downloaded binaries, ZIP, database clusters and server logs excluded from Git.

## Scope and limitations

This is real PostgreSQL with separate backend processes, rather than PGlite serialization. It verifies the advisory-lock/CAS transaction behavior that the prior offline suite could not establish. Synthetic fixtures intentionally mirror only the existing identity/business columns required by the migration; this run does not prove production schema compatibility, Cloudflare behavior, UI authentication, deployment configuration or production capacity. Those require the separate bounded preflight and route/deployment checks. No new source, schema or migration fix was required by these tests.
