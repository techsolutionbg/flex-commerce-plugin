# Flex Commerce 0.2.4 validation report

Date: 2026-10-10. Local Flex CMS workspace, Docker PHP 8.3.35, PHPUnit 12.5.35 and host Node.js.

| Check | Result |
| --- | --- |
| Commerce PHP suite, SQLite | 37 tests, 279 assertions, passed |
| Commerce JavaScript suites | 22 tests, passed |
| OrderStore suite, isolated MySQL tables | 6 tests, 34 assertions, passed |
| Accounts PHP suite, including commerce integration | 36 tests, 311 assertions, passed |
| Platform regression suite | 180 tests, 984 assertions, no failures; one existing skip |

The PHP checks cover catalogue CRUD, money validation, optimistic versions, category/media validation, public visibility, filtering, pagination, sale prices, favourites, cart quantities, order snapshots, replay protection, price/stock/delivery conflicts, status transitions, sales and one-time stock restoration. Added regressions verify unsafe settings links, draft shipping-page creation/publication and preservation of a new cart on previous-order replay.

JavaScript tests exercise the admin editor, image ordering/primary selection, confirmations, cart mutation ordering, checkout field/office validation, quote refresh after conflict, login-required behavior and favourites persistence/errors. These use simulated browser/React fixtures. Node emits a harmless module-type inference warning from the platform package configuration.

MySQL order tests create random-prefixed tables and drop those tables afterward. They exercise order persistence and transaction behavior on the database engine used locally; they are not a concurrent-worker stress test.

Accounts integration tests cover customer association, prefilling, account order access, session expiry, checkout login requirements and local Econt delivery validation in addition to the Accounts authentication flows.

A local browser check verified catalogue rendering, quick view, adding an existing demo product, cart pricing, checkout rendering with Econt methods, and rejection of a blank form. No console errors were observed during these interactions. The test cart item was removed afterward. No browser order was submitted and no business stock was changed by this browser check.

## Limits

This validation is not exhaustive end-to-end certification. Live Econt office lookup, courier pricing and waybill creation were not exercised. External SMTP authentication, delivery and spam handling were not verified. No online payment integration exists. Notifications have no retry queue. The sample shipping text still requires store-owner review. Existing published shipping pages are preserved. The PHP tests run in temporary databases/tables and do not validate every active-theme override or production deployment.
