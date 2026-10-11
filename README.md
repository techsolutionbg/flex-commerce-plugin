# Flex Commerce 0.4.0

Flex Commerce adds a product catalogue, session cart, cash-on-delivery checkout and order administration to Flex CMS. Storefront pages use the active theme's layout; the plugin provides its own default Twig views and JavaScript interfaces. The administration and customer-facing messages are currently Bulgarian.

## Requirements

- Flex CMS 0.1.62 or later and the platform's PHP 8.3+ runtime and dependencies.
- A configured platform database, media library and active theme with a `page.twig` layout.
- Platform storefront React runtime and shared lightbox assets.
- Platform mail settings for order confirmation messages.

This is a Flex CMS extension, not a standalone shop application. Flex Accounts, Flex Econt, Flex Reviews and Flex Galleries are optional; the built-in catalogue and fixed-rate guest checkout work without them.

## Installation and updates

Place this repository's contents in `plugins/flex/commerce` so that `plugin.json` is directly inside that directory. Alternatively, use the platform extension installer with an appropriately packaged ZIP. Enable the plugin and grant the declared `admin.ui`, `routes.admin`, `routes.public` and `frontend.assets` permissions.

Installation, activation and updates create missing commerce tables and add missing product columns. Back up the database before an update. Deactivation preserves products, categories, settings, sales and orders. This plugin does not implement automatic data deletion on uninstall.

Before accepting orders, configure the shop currency, delivery fee, payment and checkout switches, shop notification email, and the terms/privacy/shipping pages. Set up and test the platform mail transport. Product and order records from a development database are not part of this repository.

## Product and category administration

The plugin adds Products, Categories, Sales, Orders and Settings administration pages.

Products have a name, unique slug, optional unique SKU, rich description, currency, regular price, optional sale price, available stock, category links and a featured-product switch. Categories are flat and can contain multiple products; a product can belong to multiple categories.

Supported currencies are EUR, BGN and USD. Prices are validated as decimal strings and stored as integer minor units, with two decimal places. Zero-price products and zero sale prices are allowed. A sale price must be lower than the regular price. Promotions have no scheduled start or end date. Changing the default currency does not convert existing product prices.

Products and categories can be active, inactive or draft. Trash and restoration are available, as are bulk actions. Only active, non-trashed records appear publicly. Permanent deletion requires moving the record to trash first. A category cannot be permanently removed while a product still references it. Version checks reject stale edits rather than overwriting another editor's changes.

Product images reference existing image media. Up to 200 images can be attached, reordered and assigned product-specific alt text, captions, titles, links and descriptions. The explicit primary image appears first. Removing an attachment does not delete the underlying media file. The editor uses the platform's media picker, rich-text editor and confirmation components.

## Public catalogue

| Address | Purpose |
| --- | --- |
| `/catalog` | Catalogue, search and filters |
| `/catalog/category/{slug}` | Products in an active category |
| `/product/{slug}` | Product details |
| `/favourites` | Products saved in this browser |
| `/cart` | Current session cart |
| `/checkout` | Checkout form |
| `/order-received` | Confirmation of the session's latest order |

Legacy namespaced catalogue, category, product, cart and favourites page URLs redirect to these public addresses. JSON endpoints retain the `/plugins/flex/commerce` prefix.

Catalogue filters cover literal name/SKU search, stock availability, sale products and price ranges. Sorting supports newest, name and price. Prices are grouped by currency when sorting; currencies are not converted. Pagination displays 12 products per page with stable ordering. Search and catalogue filters also work as ordinary GET requests without JavaScript.

Product pages display image galleries, price, availability and category links. Quick view reuses the product template and can be restored from `?preview={slug}`. Product description HTML is sanitized before display. Twig autoescaping protects names and other text. Public records do not include administrative version or audit data.

Place `[commerce_catalog]` on its own paragraph in a published CMS page to embed the catalogue. Surrounding page content remains editable. Examples inside `pre` and `code` elements remain literal. No catalogue CMS page is automatically created.

Featured-product and bestseller queries provide up to eight products by default. Bestsellers are ranked by non-cancelled recorded quantities, not by cart additions. A theme must render these sections to display them on its home page.

Favourites are stored in browser local storage, limited to 1,000 product IDs and synchronized between tabs. They are not synchronized with customer accounts. Unavailable products are removed from displayed results. Storage failures preserve the previous state and show an error.

## Cart and checkout

Cart contents belong to the platform session. Add, set and remove actions require CSRF protection. A cart supports up to 100 different products. Quantities are checked against current available stock; displaying the cart removes unavailable items and clamps quantities to stock. Cart totals remain separate for each currency. Adding an item does not reserve stock.

Checkout accepts one currency per order: every product must use the shop's configured currency. Built-in payment is cash on delivery. Fixed delivery uses `shipping_minor`; a positive `free_shipping_minor` threshold waives that fee once the product subtotal reaches it. A zero threshold disables free shipping.

The server quotes current product prices, quantities and delivery and returns a fingerprint. On submission it checks customer details, agreement to terms, the payment method, the session request key and the fingerprint. A transaction locks settings and product rows, checks the quote again, stores an immutable item/customer snapshot and reduces stock. Changed prices, delivery fees or unavailable quantities reject submission so the customer can review again.

A repeated request key returns the original order without creating another order or reducing stock again. A replay of the previous key preserves a newly filled cart and its current checkout key. A successful submission of the current key clears the cart and rotates that key.

The confirmation page exposes only the latest order recorded in the same session and expires after 30 minutes. Customer details are not placed in its URL. Store closure blocks commerce requests, and checkout/payment settings can separately stop order acceptance.

## Order administration and sales

Orders have a generated `FC-...` number, customer/delivery snapshot, line-item snapshots, subtotal, shipping fee, total, currency, status, payment status, version and change history.

Allowed status transitions are:

- `new` to `processing` or `cancelled`.
- `processing` to `shipped`, `completed` or `cancelled`.
- `shipped` to `completed` or `cancelled`.
- `completed` to `cancelled`.
- `cancelled` remains cancelled.

Keeping the same status is allowed when updating payment status. Payment status can be unpaid, paid or refunded; this records an administrative decision and does not collect or refund money.

Completing an order records its quantities in the sales ledger. Cancellation cancels those sales and restores product stock once. A cancelled order cannot reopen. Version checks protect administrative updates. Product names and prices in existing orders remain unchanged when the catalogue is edited.

Manual sales reporting records already completed sales by reference and product, with reversible cancellation. It does not change stock. References beginning with `FC-` are reserved for commerce orders and must be managed through Orders. Reports show aggregate quantities and the latest 100 sales records.

## Emails

The platform mailer sends text confirmations to the customer when enabled and to the configured shop address when non-empty. Messages contain the order number, items, amounts and delivery details; the shop message also contains the customer note.

A database notification marker prevents repeated sending. Delivery errors are logged without cancelling the order. The marker is claimed before sending: there is currently no automatic retry, per-recipient delivery status or guarantee that a message reached an inbox. Configure and test SMTP separately before using a live shop.

## Optional integrations

Flex Accounts can prefill customer details, require login, associate an order with an account and display that customer's orders. Those capabilities and customer authentication belong to the Accounts plugin.

Flex Econt supplies office/address methods, courier quote adjustments, delivery validation and its own checkout assets through commerce hooks. Select `econt` shipping mode and configure that plugin to use it. If no courier methods are registered, Commerce currently falls back to fixed-rate address delivery. Live courier pricing, office lookup and waybill creation belong to Flex Econt and require its own configuration and tests.

Flex Reviews uses the product-tabs hook for moderated product reviews. The free-shipping bar uses cart/shop settings. None of these extensions is bundled here.

A sample Econt shipping information page is created as a **draft** at `dostavka-econt` if that slug is unused. Review and edit its wording for your store before publishing. Commerce sets an empty shipping-page URL only after that page is published. Existing pages and explicitly configured URLs are preserved. Existing published pages from earlier versions are not automatically unpublished.

## Templates and extension hooks

Default templates are in `templates/`. A theme may override matching files in its own `commerce/` directory, including `catalog.twig`, `product.twig`, `product-card.twig`, `cart.twig`, `checkout.twig`, `favourites.twig` and `order-received.twig`. Keep Twig autoescaping enabled. Only the sanitized product description should be rendered as raw HTML.

| Hook | Purpose |
| --- | --- |
| `public.content` | Expand the catalogue shortcode |
| `public.head` / `public.title` | Applied on storefront pages with a `commerce` context (see below) |
| `commerce.product.tabs` | Add product tabs |
| `commerce.checkout.assets` | Add checkout scripts/styles |
| `commerce.shipping.methods` | Register delivery methods |
| `commerce.checkout.quote` | Adjust a delivery quote |
| `commerce.checkout.data` | Add checkout payload/prefill data |
| `commerce.order.validate` | Validate/enrich customer delivery data |
| `commerce.order.placed` | Handle a committed new order |
| `commerce.order.updated` | Handle an order status/payment change |

Hooks run trusted installed-plugin code. Integrations must preserve valid item quantities, prices, currencies and delivery data. An order-placed action runs after the database commit; an exception in an integration does not undo the stored order.

The product and category editors show admin panels of other plugins (`commerce.product.editor`, `commerce.category.editor`, Flex CMS 0.1.59+), for example the SEO section of Flex SEO. Panels receive the unsaved record and save after it. Since 0.2.7 the editor sections and the catalogue, sales and order tables are named extension points (Flex CMS 0.1.60+): `commerce.product.editor.images`, `.basic`, `.pricing`, `.categories`, `commerce.category.editor.basic`, `commerce.products.list`, `commerce.categories.list`, `commerce.sales.ranking`, `commerce.sales.history` and `commerce.orders.list`. See `docs/admin-extension-points.md` in Flex CMS. Permanently deleting a product or category runs the `commerce.catalog.deleted` action with `['kind' => 'product'|'category', 'id' => int]`.

Storefront pages apply `public.head` and `public.title` with `['commerce' => [...], 'request' => ServerRequestInterface|null]`. The `commerce` array contains `type` (`product`, `catalog`, `category`, `cart`, `favourites`, `checkout`, `order`, `error` or `closed`), the HTTP `status`, and when available `path` (canonical site path), `product` (the public product record, including `price_minor`), `category`, `page` and `filtered` (true for search, filter or non-default sort listings). SEO plugins use it for meta tags, canonical URLs, `noindex` and structured data.

## Storage and project layout

Commerce uses `flex_commerce_products`, `flex_commerce_categories`, `flex_commerce_settings`, `flex_commerce_orders` and `flex_commerce_sales`, with the configured database prefix. It also reads platform media and settings and can create the shipping-page draft in platform Pages. Order/customer snapshots contain personal information; include these tables in your backup and retention procedures.

- `src/`: stores, controllers, notifications and plugin lifecycle/routes.
- `templates/`: default Twig storefront views.
- `assets/`: browser/admin modules, styles and bundled Notyf files.
- `tests/`: PHP and JavaScript tests and a development smoke helper.
- `plugin.json`: identity, compatibility, permissions and assets.

## Development checks

Run from the Flex CMS project root with its development dependencies installed:

```sh
vendor/bin/phpunit plugins/flex/commerce/tests --display-warnings
node --test plugins/flex/commerce/tests/admin.test.cjs plugins/flex/commerce/tests/cart.test.cjs plugins/flex/commerce/tests/checkout.test.cjs plugins/flex/commerce/tests/favourites.test.cjs
vendor/bin/phpunit plugins/flex/accounts/tests --display-warnings
```

For the isolated MySQL order tests, use the local platform database configuration and set `FLEX_COMMERCE_TEST_MYSQL=1`. Those tests create random-prefixed tables and remove them afterward. Use a development database. See `TEST_REPORT.md` for the checks performed and their limits. The repository does not contain the platform's vendor dependencies.

## Current scope

There are no built-in online payments, automated refunds, tax calculations, coupons, scheduled promotions, stock reservations, customer-synchronized favourites or notification retry queue. Cart/checkout require the platform JavaScript runtime. Automated tests do not establish live courier or external SMTP delivery correctness.

## Licensing

This plugin is licensed under the GNU General Public License, version 2 or (at your option) any later version (`GPL-2.0-or-later`). The full text of version 2 is in [`LICENSE`](LICENSE). Bundled third-party code, such as `assets/vendor/notyf`, remains subject to its own license notices.
