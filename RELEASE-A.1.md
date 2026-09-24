# PA Party 9.24-A.1

Release A has been deployed. This checkpoint completes the urgent visible fixes requested before Release B and corrects the saved-request hourly rule.

- The approved PA • PARTY logo is fully visible on desktop and narrow phones.
- A saved request keeps the hour in which it entered the queue. Completing the performance in a later hour does not move its reserved slot; stored credit is still charged only on completion.
- A full-hour saved-request attempt is logged privately at most once per eligible player and hour. A player without available stored credit is not counted. The dialog offers a linked live-request button when no stored credit is available or the hour is full.
- Crown-song requests show the card's live price and separate double fee. The queue now records the crown double fee instead of zero.
- Price copy, the gold-plan label, and a live-request price-help link match the approved wording. Test players remain excluded from formal daily statistics.

## Verification

All 36 automated tests and the static build pass. The isolated production QA room verified a zero-credit attempt was excluded, the first eligible full-hour attempt was recorded, and repeat attempts were deduplicated. Existing production entity values and the 怕怕 song order were unchanged; the QA room was returned to inactive. The only differences in `_order` were the QA room's position relative to the 怕怕 room. Browser checks covered the logo and mobile layout.

## Deployment and recovery

Apply the additive `202609240002_failed_request_event.sql` migration, deploy the current `party-api` Edge Function, then publish this static site as `9.24-A.1`. The previous complete version is the `release/9.24-A` branch; rolling back the frontend and function does not require deleting the additive event table or restoring older business records.

Release B notifications, C messaging, D songbook/player center, E performance/badges, F cards and remaining presentation requests, and G presence/activity remain planned. The full badge definitions have not yet been implemented.
