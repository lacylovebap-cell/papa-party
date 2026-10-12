# 10.12-WEB.2 — player record sorting

Player current operations and history each show compact newest/oldest buttons beside their own heading. Current operations sort by request time; history sorts by performed time when available. Changing one sort leaves the other unchanged. Manager waiting queues retain their manual performance order, while a selected player's detail list can sort its own current operations. Notice links choose the matching sorted page rather than highlighting a target on another page.

This is a frontend-only follow-up to the user-authorized tested-first release. The frontend release manifest/cache version is `10.12-WEB.2`; the unchanged backend `party-api` release probe remains `10.12-WEB.1`. No Supabase migration, privilege change, business-data write, notification broadcast or native release is part of this update. V2 message-center/scoped transport/native flags remain false.

Validation: 24 targeted rendering, notice landing and sync integration tests pass; the complete suite passes 1,067/1,067. The frontend build and syntax checks pass after the cache version update. A 320px local preview rendered by the actual player/queue functions places both sort controls beside their headings without horizontal overflow. That preview uses test-only data and is not production acceptance.

Production publication/version verification is pending until the Pages deployment has completed. Android background and lock-screen Push acceptance is also pending; foreground Web/PWA receipt has been reported by the user.
