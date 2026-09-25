# 9.24-B.2 — Streamer navigation and crown request fees

Crown requests now use the same double fee as ordinary live requests (currently 500). Only the singer's amount varies by crown tier. The card-opening fee of 18,188 remains separate and existing card/history records are not rewritten. Both frontend quotes and server-created requests use this rule; card management and help explicitly label the card-opening charge.

The shared header includes a streamer selector and a dynamically named home button. Switching preserves the current songbook, player-center tab, gallery, or authorized administration section. Unsupported routes fall back to the target homepage. Streamer administrators cannot switch into another streamer's management screen. PA Party stays the platform brand; template messages use the current streamer's name. A streamer without a banner receives a neutral background instead of a broken image.

The existing 700px mobile breakpoint is retained, with header controls wrapping to accommodate the selector and notifications.

## Verification and deployment

55 unit/regression tests and static Build pass. Added coverage includes all crown tier prices with the ordinary double fee, historical card-fee preservation, same-page switching and player credit tabs, restricted management navigation, dynamic template names and empty streamer settings.

Deploy the generated Edge bundle before publishing the frontend so persisted fees agree with displayed fees. No schema migration or business-data rewrite is needed. Predecessor: `release/9.24-B.1`, commit `28de4c1231fccaeaf80de8ed19e8cf8d4cd6399a`. Retain a B.2 checkpoint after final live verification.

Background/locked-device Push acceptance remains pending from B.1. Homepage color/image/module customization, messages, final badge rules and the other queued batches are not completed by this release.
