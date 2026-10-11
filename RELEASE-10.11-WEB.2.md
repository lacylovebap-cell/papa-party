# 10.11-WEB.2

The menu now includes “安裝 PA Party App” for players, managers and visitors. Browsers that provide an install opportunity open their native prompt on an explicit click; other browsers receive compact iPhone/iPad, Android or desktop instructions. Accepted prompts are distinguished from confirmed installation. The dialog preserves focus, expanded instructions, scroll and the page's search state.

The manifest keeps the existing application ID, start URL and scope, names the app PA Party, and provides approved black brand PNG icons at 192/512 pixels, a separate maskable icon with the whole artwork inside the safe circle, and an Apple touch icon. The existing service worker and data APIs are unchanged by the installation feature.

Remembered Web Push bindings now retry on the next existing lifecycle refresh when a registration/subscription is missing or a binding fails. Only a successful upsert latches the binding, and stale account, Space, streamer or device completions cannot latch another identity. No new polling, automatic permission prompts or backend endpoints were introduced.

Validation: 853/853 regression tests pass; `node build.mjs` passes; independent lifecycle review passes. Browser checks at 320, 390, 820 and 1280 pixels show no horizontal overflow; opening/closing installation help retains the typed song search. Native prompt concurrency, dismissal, rejected results, standalone detection, stale results and cleanup are covered by controller tests. Icon dimensions and HTML install links are checked against actual PNG files.

This is a frontend release. It requires no database migration or Edge deployment and performs no production business-data writes. Physical Android/iPhone installation and background/lock-screen Push still require device acceptance. Android APK and Windows native installer artifacts remain separate unfinished work.

Installation behavior follows [Chrome's installation guidance](https://web.dev/articles/customize-install), [maskable icon safe-zone requirements](https://web.dev/articles/maskable-icon), and [WebKit's home-screen guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
