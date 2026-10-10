# Changelog

## 0.2.6 — 2026-10-10

- Show admin panels of other plugins in the product and category editors (for example the Flex SEO section); they receive the unsaved record and save right after it.
- Run the `commerce.catalog.deleted` action when a product or category is deleted permanently.

## 0.2.5 — 2026-10-10

- Apply `public.head` and `public.title` on storefront pages with a `commerce` context (page type, canonical path, product, category, pagination and filter state) so SEO plugins can output meta tags and structured data.
- Expose the effective price in minor units as `price_minor` on public product records.
- Show order and sales dates in the administration with the platform `DateTime` component (local time and relative time) instead of raw UTC strings.

## 0.2.4 — 2026-10-10

- Preserve a newly filled cart and its checkout request key when a previous order submission is replayed.
- Reject malformed and unsafe terms/privacy/shipping URLs in shop settings.
- Create the sample Econt shipping page as a draft and link it only after publication; preserve existing pages and configured URLs.
- Replace the outdated mixed-language README with English documentation of the current catalogue, cart, checkout, order lifecycle and integration hooks.
- Repair the favourites test browser fixture and add settings validation, shipping-conflict and disabled-checkout regression checks.
- Add isolated MySQL execution for the order-store test suite.
