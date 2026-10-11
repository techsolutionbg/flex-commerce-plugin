# Changelog

## 0.5.0 — 2026-10-11

- While the theme loads the next page, the catalogue, categories and favourites show a product grid placeholder and products a product layout (`flex:page-skeleton`, Flex Starter 1.3.0+).
- Open the cart, checkout, order confirmation, "buy now" and quick-view pages without reloading (`navigateTo()` in `cart.js`, through the theme's page navigation where available).
- Show catalogue products straight from the server instead of hiding them behind a placeholder until the scripts run; the inline scripts of the catalogue and the order confirmation moved into the storefront and checkout modules.

## 0.4.0 — 2026-10-11

- Start the cart (count, cart button, "add to cart") without React and ask the theme for its React runtime only for the cart drawer, the cart page, the checkout and the catalogue column selector (`storefrontRuntime()` in `cart.js`). With Flex Starter 1.2.0 pages without these load no React at all.
- Fetch the cart only on pages that show it.
- Works with themes that still load React on every page.

## 0.3.0 — 2026-10-11

- Load the storefront files only on pages with products (catalogue, categories, products, favourites, cart, home page highlights, `[commerce_catalog]` and quick-view links) and the checkout files only on checkout and order pages, through Flex CMS 0.1.62 asset groups. Every page keeps the cart, toasts and a small `header.js` for the favourites count.
- Remove the hand-written `<link>`/`<script>` tags from storefront pages, so each file loads once under its versioned URL.
- Requires Flex CMS 0.1.62.

## 0.2.9 — 2026-10-11

- Fix the sales page, which failed with "Възникна грешка в интерфейса на разширението" since 0.2.5: the history table formats and sorts dates with helpers that were not passed to the page.

## 0.2.8 — 2026-10-11

- Fix the category editor, which failed with "Възникна грешка в интерфейса на разширението" for every saved category: category records have no images, and the editor read their media list unconditionally.

## 0.2.7 — 2026-10-10

- Name the product and category editor sections (`commerce.product.editor.images`, `.basic`, `.pricing`, `.categories`, `commerce.category.editor.basic`) and the catalogue, sales and order tables (`commerce.products.list`, `commerce.categories.list`, `commerce.sales.ranking`, `commerce.sales.history`, `commerce.orders.list`) as admin extension points, so other plugins can add content, columns and actions there (Flex CMS 0.1.60+).
- Share the edited record and the save coordination with extensions inside the editor.

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
