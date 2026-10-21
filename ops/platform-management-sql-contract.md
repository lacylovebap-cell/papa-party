# Platform management SQL contract — local proposal, 2026-10-21

Status: local PGlite verification only. No production query, migration, data correction, deployment or credential creation was performed for this proposal.

## Files and execution order

1. `ops/platform-management-proposed.sql`
2. `ops/platform-management-directory-proposed.sql`

Existing dependencies: Space/Account foundation, canonical `papa_v2_revision`, global `meta/1`, `papa_manager_account_links`, and `papa_streamer_accounts`.

The proposal adds six metadata columns (three Space, two Membership, one streamer mapping), one append-only management Audit table and a Space/time Audit index. It does not backfill tenant types/owners, infer the identity of Space 001, move mappings, delete rows or rewrite existing business JSON.

## RPCs

All functions are revoked from PUBLIC/anon/authenticated and explicitly executable by service_role only. The server must pass the verified session Account ID, never a caller-selected identity.

- `papa_manage_space(subject uuid, operation uuid, action_name text, payload jsonb)`
  - create: `{name,kind:'hall'|'independent',ownerAccountId}`. Creates a suspended tenant and explicit owner membership. The Account must already exist and be enabled.
  - edit: `{spaceId,revision,name}`. Name only. Owner transfer and type reclassification are not silently included.
  - suspend / restore: `{spaceId,revision}`. President only. Restore is blocked with `SPACE_PROVISIONING_REQUIRED` for tenants created by this proposal, until an independently approved provisioning capability exists.
  - membership: `{spaceId,revision,accountId,status:'active'|'suspended',permissions:string[],role?:'space_admin'|'streamer_admin',streamerId?:string}`. Default role is space_admin. Streamer role requires the exact mapped streamer ID; other roles cannot have a streamer ID. This reuses existing Accounts/Memberships, sets `permissions_explicit=true`, and never changes passwords, player data or global account enabled status.
  - archive_streamer / restore_streamer: `{spaceId,revision,streamerId}`. Requires owner/president or scoped streamer-management authority. Archive requires an already disabled descriptor. Restore removes archive metadata and leaves the descriptor disabled.
  - Returned value is the canonical changed Space/Membership/mapping row; replay returns the recorded result after rechecking actor authority. Operation conflicts, stale revisions, cross-Space IDs and delegated escalation are rejected. All changes and their Audit insertion are one transaction.
- `papa_management_directory(subject,section_name,search_text='',requested_page=1)`
  - Sections: overview, halls, streamers, accounts, cleanup. Returns `{rows,total,page,pages,registryRevision}`; overview additionally returns summary.
  - At most 20 rows. Registry revision is `papa_v2_revision.revision`, and only canonical `meta/1` is read.
  - Streamer row: `{id,name,slug,active,spaceId,spaceName,archivedAt,revision,descriptor}`. Revision here is the Space management revision. Descriptor retains the existing metadata and adds canonical spaceId.
  - Account row: `{id,name,disabledAt,managerKey}`. Name comes only from a verified legacy binding or manager key/current streamer descriptor, not fuzzy identity matching. No password/hash is returned.
  - President sees all Spaces; enabled owners/scoped space_admin see only their permitted active Spaces. Access to this RPC does not add a new login role.
- `papa_management_detail(subject,requested_space,requested_streamer=null,search_text='',requested_page=1)`
  - Returns `{space,streamer,memberships,total,page,pages,canManageMemberships,registryRevision}`.
  - Space: `{id,name,status,kind,ownerAccountId,revision,provisioningPending}`.
  - Streamer: `{descriptor,settings,archivedAt}` or null. Settings are the already stored selected-room registry settings, not global settings.
  - Memberships: at most 20 entries, `{id,accountId,role,streamerId,status,permissions,permissionsExplicit,effectivePermissions,managerKey,name}`.
  - UI should preselect effectivePermissions for a legacy grant. Explicitly saving a legacy grant deliberately switches it to the selected granular permissions.
- `papa_management_dependencies(subject,requested_space,requested_streamer)`
  - Returns only `{spaceId,streamerId,name,entityCounts,memberships,auditPresent,routeAliases,safeToDelete:false,permanentDeleteAuthorized:false,unchecked}`.
  - entityCounts covers songs/queue/ledger/crowns/cards/wishes in the canonical mapped Space. Audit is existence-only. Unavailable optional Audit/route relations return null, not fabricated zero.
  - The report explicitly lists unexamined shared-catalog/JSON/player/medal/message/payment/device/backup and future relations. A zero count never authorizes permanent deletion.
- `papa_management_access(subject,requested_space,requested_streamer,required_permission)`
  - Scoped management read/helper check. Accepted permissions: songs, queue, players, announcements, streamers, reports, administrators.
- `papa_management_room_permission(subject,requested_streamer,permission_name)`
  - One authoritative boolean check for the Edge request. A disabled Account, missing mapping, inactive non-president Space, missing/suspended membership or wrong streamer is denied.
  - Explicit permissions: only selected capabilities. The special `all` read gate requires songs+queue+players+announcements+reports; `all` cannot be stored as a grant.
  - Legacy permissions_explicit=false: only the original streamer_admin own-room scope is retained, with existing manager link and enabled legacy credential required. No implicit hall-wide privilege is invented for space_admin.
  - Owner/president status is read from trusted DB relations. This helper does not promote a player session into an administrator session.

## Integrity and existing routes

- Management Audit is append-only; update/delete attempts are rejected.
- Archived streamers are protected against stale registry reactivation by a metadata trigger that locks referenced mappings. This trigger operates only on canonical global meta/1 writes. Restore archive first, then explicitly enable via the existing registry workflow.
- No public-route table is written. Existing canonical URLs, historical aliases, QR targets and stable IDs remain unchanged.
- No Realtime subscription, poll, player history download, full event export or Storage object is introduced.

## Verification

`node --test tests/platform-management-lifecycle.test.js tests/platform-management-proposal.test.js`: 8 tests passed. Coverage includes preservation, existing/new-tenant activation boundaries, exact operation replay, membership revocation, delegated scope/escalation, archive history/alias preservation, stale writer rejection, canonical-meta de-duplication, scoped pagination, verified names without secrets, cleanup uncertainty, legacy/explicit permission behavior, revision conflict, Audit-failure rollback and browser-role denial.

A final focused test additionally verified that service_role can execute the directory while it still cannot read management Audit directly: 1 test passed. The local Promise/CAS test uses PGlite's serialized backend; it is not proof of production multi-process concurrency.

## Approval risks and remaining integration

- Production migration is not approved. Applying this proposal would briefly lock metadata tables while adding columns/indexes/triggers/functions. Only tiny management metadata/Audit grows; the existing event table is not scanned or rebuilt.
- Registry writes will additionally acquire mapping share locks. Existing registry writers must preserve their current lock order; an actual multi-session Postgres interleaving check remains advisable before production approval.
- Before enabling granular grants, Edge must enforce room_permission centrally, including restrictive `all` for old all-data snapshots. Narrow-role module read models and a space_admin login bridge are not provided here. New tenants remain suspended to prevent unsafe partial provisioning.
- Owner transfer, tenant reclassification, account login creation/rebinding/password reset, cross-Space moves and permanent deletion are outside these RPCs. They require separate complete integration and their applicable approvals; they are not advertised as completed by this SQL.
- Rollback should disable the management UI/Edge entry points and revoke execution of the new RPCs. Keep the additive columns/table/Audit intact; do not drop history or rewind existing business data. Function/trigger rollback must be reviewed against any archived mappings already created.
