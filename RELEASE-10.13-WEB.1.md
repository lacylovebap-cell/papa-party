# 10.13-WEB.1 — preserve Taipei 19:00 accounting shows

The user confirmed that PA Party changes shows at Taipei 19:00. This patch retains the existing 19:00 home labels and aligns Core, server aggregation, current-date selection and local historical previews with the same show boundary. A show continues across midnight; the next show begins only at 19:00. Prior-show summaries are withheld until the existing scoped refresh supplies the new show. No additional polling, full history downloads or accounting mutations are introduced.

This patch retains the complete 10.12-WEB.5 accounting protections, message center and earlier navigation/modal layout fixes. The preceding release was published successfully by [Pages run 38273564381](https://github.com/lacylovebap-cell/papa-party/actions/runs/38273564381), and its accounting/app/style assets matched the reviewed source. See RELEASE-10.12-WEB.5.md for the preceding additive SQL installation and unchanged formal data fingerprints.

202610130001 replaces only the service-only accounting summary function. It changes query time bounds to 19:00 through the next day's 19:00; it does not rewrite receipts, balances, allocations, performances, timestamps, events or Audit. Existing function permissions remain unchanged. Historical correction and event archival are separate proposals and have not been executed.

Regression checks include pre-19:00 versus exactly 19:00, midnight within a show, archived performances, scoped server/Core parity and rejection of a prior-show aggregate. Android background/lock-screen delivery and Windows/native/scoped transport work retain their documented status.

Validation: 1,120/1,120 regression tests passed; Web and Edge builds passed. Production SQL/Edge installation succeeded. Revision remained 3913; all entity-kind hashes, event-independent notification and legacy preference hashes were unchanged. Function ACLs were unchanged; only papa_accounting_summary definition changed. Previous Edge source is backed up outside Git. The final Pages publication is verified separately after its workflow completes.
