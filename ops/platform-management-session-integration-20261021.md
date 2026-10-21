# Existing-account management entry

The bridge uses the existing verified Account and its current device/legacy token. It creates no second login identity and changes no business role. A player who also owns or has an explicit hall-management grant can open the separate management view while their player operations remain player operations.

## SQL and Edge

Apply `platform-management-session-proposed.sql` after the approved base management proposal. `papa_management_session(subject)` is stable, service-role only and returns five capability fields plus a fixed list of at most five sections. It reads enabled Account, president/owner and active Space membership authority; it reads no operational events, ledger, private messages or passwords. Scope changes/revocation take effect on the next check. Each subsequent directory/detail/write RPC independently authorizes its verified Account, so a cached entry button grants no authority.

Edge integration imports `readManagementSession(api,who)` from `supabase/functions/party-api/management-session.js`, resolves the existing actor with `requested_room=null` for the metadata operation and returns the helper's response for `platformManagementSession`. Directory entry should require a verified Account rather than a `super_admin` business role; its existing SQL remains the scope authority. This deliberately does not widen legacy business read/write actors.

## Client

`createManagementEntry({api,identity,changed})` uses the current `admin || session` object as identity. Its API transport must use that same identity through the existing refresh flow; the integration can add a metadata-only `platformSession:true` transport selector. This selector must not replace role, player ID, streamer ID, device session or login storage.

Load once per authenticated identity to discover the optional entry. Repeated render requests coalesce or use the cache; errors remain cached until explicit retry. Call `load({force:true})` when opening the centre to recheck revocation. `identity()` returns the current verified-capability owner or null. Late responses after logout/identity change are discarded. No timer, Realtime or background polling is introduced.

Sections are `overview`, `halls`, `streamers`, `accounts`, `cleanup`. `permissions` contains `streamers`, `administrators`, `reports`; `president` is independent of the business session role. Administrators-only hall managers can list their own hall to open its grant editor. This does not allow a different Space or grant new streamer credentials.

## Targeted tests

`tests/platform-management-session.test.js`: five tests passed. Coverage includes president/owner/delegate capabilities, hall/Account disable, grant revocation, exact Space isolation, browser denial/service-role execution, no Audit or membership mutation, original player role retention, strict bounded response projection, request coalescing, explicit refresh, stale-response rejection and synchronous-render recursion prevention.

Account creation/password login, owner transfer, tenant type changes and new-tenant business provisioning are separate workflows. This bridge supports existing verified accounts and does not claim those workflows have been implemented.
