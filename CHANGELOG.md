# Changelog

## 0.2.4 — 2026-10-10

- Preserve a newly filled cart and its checkout request key when a previous order submission is replayed.
- Reject malformed and unsafe terms/privacy/shipping URLs in shop settings.
- Create the sample Econt shipping page as a draft and link it only after publication; preserve existing pages and configured URLs.
- Replace the outdated mixed-language README with English documentation of the current catalogue, cart, checkout, order lifecycle and integration hooks.
- Repair the favourites test browser fixture and add settings validation, shipping-conflict and disabled-checkout regression checks.
- Add isolated MySQL execution for the order-store test suite.
