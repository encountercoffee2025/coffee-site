# Agent handoff: 一遇 / Encounter Coffee

This document is the starting point for another AI agent receiving the ZIP. It describes the current implementation, not a proposal. Package provenance and exact file hashes are in the ZIP's root `RELEASE-MANIFEST.json`; a regular Git clone has no generated manifest until a package is built.

## 1. Scope and design

The user asked for a distinctive photographic coffee brand site, inspired by the full-screen, slowly fading images on Encounter Coffee's reference site. The implementation is original project code and illustrative images; it is not a copy of that site's source or its merchant backend.

The brand is **一遇**, with **ENCOUNTER COFFEE** in English. Do not restore the previous 四選淨豆 / Pure Select branding. The old `pure-select-*` storage keys remain intentionally compatible with existing browsers. The store model maps the previous default shop name to the current default without discarding orders or inventory; custom shop names are preserved.

Implemented features:

- Three full-screen hero photos: coffee beans, roastery and morning brewing. Default six-second fading carousel, manual controls, motion pause, hidden-tab handling and reduced-motion support.
- Four homepage palettes: `terra`, `forest`, `cobalt`, `nocturne`.
- Ten **roasted** coffee products, not green beans. Each has six distinct gallery entries, origin imagery, flavor notes, references, roast metadata and independent SKUs: a 200g bean bag plus optional drip and steep bags. Some generic bean/packaging/brewing images are shared between products.
- Functional local cart and order creation, with transactional stock changes and order snapshots.
- Operable demo admin: overview, product CRUD/visibility/images, stock adjustments, roast schedules/completion, order workflow, reports, settings and CSV/JSON export/import/reset.
- Chinese and English storefronts and admin UI, with responsive layouts and language-preserving navigation.

The user explicitly chose a **complete operable demo**, not real login/database/multi-user management. Do not imply that payments, shipping, authentication or shared server data exist.

## 2. Runtime and dependencies

Serve the folder containing `index.html`:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

No framework, bundler, npm dependencies or environment secrets are required. Python is only a convenient HTTP server and package builder. Node is only needed for tests. Modern browsers need JavaScript and writable localStorage; image upload uses `createImageBitmap` and canvas to resize JPEG/PNG/WebP images in the browser.

All runtime images are local under `assets/`, including the generated JPEG assets. Google Fonts are externally linked; if unavailable the CSS falls back to installed fonts. Official price references open external websites. Running the demo does not require access to the original author machine.

## 3. Source map

| Path | Responsibility |
| --- | --- |
| Seven root HTML files | Page shells, static homepage/editorial content and ordered script/style loading |
| `assets/catalog-data.js` | `window.COFFEE_SEED`: initial products, batches, orders, cart, ledger and settings |
| `assets/store.js` | `window.CoffeeStore`: validation, transactions, local persistence and state-change events |
| `assets/commerce.js` | Storefront rendering, filters, product galleries, quantity/weight calculations and checkout |
| `assets/admin.js` | Admin routes, forms/modals, inventory, batches, order workflow, reports, backup and image upload |
| `assets/home.js` | Homepage menus, themes, photo carousel, motion controls, featured filters/search and selection steps |
| `assets/en-dictionary.js` | English copy keyed by original Chinese text |
| `assets/i18n.js` | Language selection, text/attribute translation, dynamic content observer and internal link localization |
| `assets/home.css` | Shared palette tokens and homepage design |
| `assets/commerce.css` | Storefront/admin components and base responsive layouts |
| `assets/responsive.css` | English typography, language switch, editorial layouts and mobile corrections |
| `assets/catalog/` | Twelve added origin/bean/packaging/hero JPEG illustrations |
| `tests/store.test.cjs` | Eleven data/transaction/compatibility checks using a mocked localStorage |
| `tests/i18n.test.cjs` | Five localization/link/data-integrity checks |
| `scripts/package_site.py` | Reproducible committed-source ZIP and hash-manifest creation/verification |

Keep locale setup before page renderers. When changing CSS or JavaScript, bump the `v=` query suffix in the HTML asset URLs to avoid clients mixing old and new assets. Existing suffixes are version labels, not a build pipeline.

## 4. URLs and language behavior

- Chinese homepage: `/?lang=zh`; English homepage: `/?lang=en`.
- Product: `/product.html?id=mandheling&lang=en`.
- Product brew section: `/product.html?id=guji&lang=en#brew-guide`.
- Admin routes: `#overview`, `#products`, `#inventory`, `#roasting`, `#treats`, `#orders`, `#subscriptions`, `#reports`, `#settings`.
- Product with a preselected format: `/product.html?id=guji&format=drip`.
- Order deep link: `/admin-orders.html?order=ORDER_ID&lang=en#orders`.

Actual URLs have the repository subpath `/coffee-site/` on GitHub Pages. Use relative site links; do not assume deployment at a domain root.

The locale comes from `lang=en`; absent or other values select Traditional Chinese. The switch keeps other query parameters and the hash, but reloads the document. Locale views share the same browser storage. Currency remains NT$ and weight remains grams in English.

Localization translates visible strings, titles, descriptions, accessibility labels, image alt text and supported dynamic messages. Option labels may be translated but their **values stay original** so filters and forms still match the model. English storefront/admin search includes translated catalog text.

The initial ten products have English display translations. Admin edits the **original shared content**, with an explanatory note. A new user-entered Chinese sentence is not automatically machine-translated; add appropriate dictionary entries, or implement explicit bilingual fields if the future scope requires independent translations. JSON backups retain raw state; English CSV exports translate known labels/content. Do not translate SKU IDs, record IDs, enum values, backup JSON or user-entered form data in place.

## 5. Data model and invariants

Main storage key: `pure-select-store-v1` (data `version` 3). Older saved data is upgraded in place on load or import. Version 2 → 3: 250g/500g bean SKUs are replaced by one 200g SKU (stock converted by total weight, ledger entries record both sides), cart lines for retired SKUs are dropped and planned batches convert to 200g packs; completed batches and orders keep their 250g/500g snapshots, and cancelling such an order records that the retired SKU is not restocked. Version 1 → 2: seed drip/steep SKUs are added to matching products with an upgrade ledger entry, seed treats, an empty subscription list and `settings.giftWrapFee` are added; existing orders, stock and custom content are kept. Other keys include `pure-select-theme` and `pure-select-motion`. Browser origins are independent: localhost, GitHub Pages, different ports and another domain do not share data.

`CoffeeStore.state()` returns a copy of state. Mutations read the latest saved state, clone, validate and commit. A failed persistence write must not partially apply an order or inventory update. Notifications use `coffee:change` plus cross-tab `storage` events. This does not provide server-side, multi-user transaction guarantees.

Public model API includes:

```text
state, validate, today, imageURL
cartDetails, addCart, setCart, createOrder, updateOrder
saveProduct, deleteProduct, adjustStock
addTreat, saveTreat, adjustTreatStock
createSubscription, updateSubscription
variantLabel, formatOf, lineKey, grinds, grindLabels, roastPrefs, plans, subStatuses
addBatch, updateBatch, saveSettings
exportData, importData, reset
statuses, payments
```

Important rules:

1. Each product has one required bean variant with grams exactly 200, SKU `${productId}-200`, plus optional `drip` and `steep` variants (SKU `${productId}-${format}`, `count` 10, `grams` 100), all with integer prices and integer stock in **bags**. Editing product content must not overwrite stock; a newly enabled format starts at 0 and a format can be removed only at 0 stock with no order history. The product page asks, in order: 1 roast level (`light-medium` 淺中焙, `medium` 中焙, `medium-dark` 中深焙; applies to every format, roasted to order, roasts of one SKU share its stock; default = the product `roast` mapped 淺焙→淺中焙, preselected without a badge), 2 format, 3 grind (`whole`, `pour`, `espresso`; beans only). Cart and order lines are keyed by SKU + grind + roast, and lines of one SKU share its stock. Subscription roast preferences use the same codes plus `any`; older 淺焙/中焙/中深焙 values remain valid.
1a. Treats (`state.treats`) have their own integer stock in pieces, reserved by orders and restored by cancellation, with ledger product IDs `treat:<id>`. Order items for treats have `kind: "treat"` and `grams: 0`. The checkout no longer offers a gift box (removed at the owner's request); `giftWrap`/`giftFee`/`gift.card` remain supported in the model for older orders; the checkout textarea is now an optional customer note stored as `customerNote` (≤200 chars, shown in admin as 顧客備註). Orders may carry `delivery` (`711`, `family`, `home`; rates in `settings.shippingRates`, charged only below `settings.freeShipping`; for pickup the address field holds the store name/number), `gift: {wrap, card}` and `giftFee`; `total = subtotal + shipping + giftFee`.
1b. Subscriptions (`state.subscriptions`) snapshot the plan name and price from `window.COFFEE_PLANS`, move `active ⇄ paused → cancelled`, and are local records only: there is no recurring billing.
2. Product galleries require 5–12 entries and at least five distinct image URLs. Image URLs are validated as local asset paths, HTTPS or supported image data URLs. Keep escaped text rendering and image validation when adding UI.
3. Cart lines do not reserve stock. Creating an order checks current availability and prices, deducts stock, records snapshots and clears the cart atomically. Historical order prices do not change when product prices change.
4. Fulfillment progresses `new → confirmed → packing → shipped → completed`. Shipping requires a tracking number. Cancellation before shipping restores stock once; shipped/completed orders need a separate future returns implementation.
5. Cancelling a paid order records `refund_pending`, then may be marked `refunded`. These are local status records, not money movements. Other payment enums are `unpaid` and `paid`.
6. Batches progress `planned → roasting → completed`; completion adds each bag size's quantity only once and updates the product's latest batch. A future scheduled date cannot be completed early.
7. Inventory is aggregated by SKU. Displaying the latest completed batch does **not** provide FIFO or per-bag lot traceability.
8. Products with order history cannot be deleted. Hide them instead. Stock changes require a reason and produce ledger entries.
9. JSON imports validate duplicate IDs/SKUs, numeric types, totals, timestamps, images and record associations before replacing saved data.
10. Dates used by the model are in `Asia/Taipei`. Seed dates and durations are deliberately fictional demo values, not current inventory promises.

## 6. Content and asset provenance

The initial catalog covers Yirgacheffe, Guji, Kenya Nyeri, Colombia Huila, Guatemala Antigua, Brazil Cerrado, Costa Rica Tarrazú, Indonesia Lintong Mandheling, Panama Geisha and Taiwan Alishan.

- `docs/coffee-price-survey-2026-10-13.md`: official source links, original weights/prices, researched flavor/variety information and unknowns. The site's own 200g, drip and steep prices are separate **demo prices**, not supplier quotes or direct normalized comparisons.
- `docs/catalog-images.md`: added image index and website paths.
- `docs/catalog-image-prompts-a.md`, `docs/catalog-image-prompts-b.md`, `assets/coffee-roast-hero.prompt.md`: historical built-in imagegen prompts.

Images are illustrations, not verified photos of a specific farm, package or batch. Historical generation logs mention absolute paths to original PNGs on the author's machine; these are provenance notes, not runtime dependencies. The package includes the committed website JPEGs, not those external original PNG files. No specific third-party asset license is asserted by this handoff; review rights if repurposing outside the user's project.

The shop email is existing demo contact copy, not a configured mail integration. About/story pages use the same responsive visual language; older unconnected membership/contact-form placeholders were removed.

## 7. Verification workflow

Run from the project root:

```sh
node tests/store.test.cjs
node tests/i18n.test.cjs
```

Expected: 11 store checks and 5 localization checks pass. They cover valid seed/gallery/SKUs, live-price order snapshots, overselling, cancellation, shipping/tracking, batch idempotency, storage rollback, import validation, historical product deletion, old-brand migration, English product copy, link/query/hash preservation and raw-data integrity.

Also check JavaScript syntax with `node --check` for changed files, local asset/link references and `git diff --check`. Use a real browser for interactions and visual verification. Previous viewport checks: 320×740, 390×844, 768×1024, 1280×900, and an 844×390 landscape homepage. Ten English product pages have been checked at 320px; the long Mandheling origin/altitude field exposed an overflow and was fixed using shrinkable grid columns.

Suggested manual regression:

1. Both languages: hero auto/manual controls, pause, menu, palette and featured search/filter.
2. English catalog: search `mango`, filter Kenya, sort by price and roast date.
3. Product: all gallery controls/lightbox, format and grind choice, price and stock, bag-count × weight.
4. Switch languages on a product link; preserve ID/hash and cart data.
5. Demo checkout and admin cancellation; verify stock is deducted/restored once.
6. Complete a roast batch once; verify stock and latest date/duration update.
7. Mobile product/batch modals, editable image rows, order forms, overflow-contained admin tables and 16px form fonts.
8. Backup preview/paste import and CSV headers. Use fictional customer data for demos.

Known verification limits: responsive checks used browser viewport emulation, not physical iPhone/Android devices. CSV/JSON content, previews, copy fallback and paste import were checked; the built-in browser did not return a completed native download event during earlier export testing. Do not describe native admin file downloads as fully verified. The release ZIP is independently checksum-verified.

## 8. Git and deployment

Repository: `https://github.com/tsglee/coffee-site.git`. Canonical deployed branch: **main**. GitHub Pages uses the branch root with legacy Pages builds; `.nojekyll` is included. There is no custom Actions workflow or build step.

The user requested completed versions be committed/pushed and shared as public links. Keep local `main`, `origin/main` and the remote main commit aligned when delivering a release. Avoid forced resets/pushes and preserve any user's working changes. Before continuing:

```sh
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
```

Work on a `codex/` branch when appropriate, validate, commit and push. After authorized deployment to main, confirm the Pages build belongs to the new main commit and inspect the live site, rather than only checking a local preview.

For an extracted ZIP, **there is no `.git` directory or history**. To continue in the existing repository, clone it normally and use the manifest's `git.commit` to identify the snapshot:

```sh
git clone https://github.com/tsglee/coffee-site.git
cd coffee-site
git show SNAPSHOT_COMMIT
```

For an independent project, the extracted files can be placed in a new repository. Do not attach a newly initialized, unrelated history to the existing repository and force-push it. Files can also be hosted directly on a static host; preserve relative asset paths and serve over HTTP/HTTPS.

## 9. What the ZIP includes and omits

Included: every tracked file at the packaged Git commit, all runtime images, both languages, the full admin demo, tests, source/provenance docs, this guide, the package script and a generated release manifest. The manifest records the commit, tree, branch, public/repository URLs, release date and SHA-256/size of each included source file.

Omitted: Git history, local ignored/untracked files, server processes, browser localStorage, external original generated PNGs, credentials and a production backend. To transfer browser changes, use the admin's JSON export/import separately; the source ZIP starts with the committed seed catalog. It does not silently extract user/browser data.

To rebuild a package from a clean Git checkout, run the command in README. To verify any received ZIP, run the package script's `--verify` mode, which needs Python only and does not require a Git checkout.
