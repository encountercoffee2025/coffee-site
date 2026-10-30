# 一遇 / Encounter Coffee

A bilingual, responsive roasted-coffee storefront and operable administration demo. Plain HTML, CSS and JavaScript; no build step, npm installation, backend or database is required.

- Live Chinese site: https://tsglee.github.io/coffee-site/?lang=zh
- Live English site: https://tsglee.github.io/coffee-site/?lang=en
- Repository: https://github.com/tsglee/coffee-site
- **For another AI agent: read [docs/AGENT-HANDOFF.md](docs/AGENT-HANDOFF.md) first.**

## Run locally

Unzip the handoff package and open a terminal in `encounter-coffee/`, the directory containing `index.html`:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173/?lang=en or http://127.0.0.1:4173/?lang=zh. Stop the server with Ctrl+C. Use HTTP rather than double-clicking HTML files so all pages share a consistent browser storage origin.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Three-photo hero carousel, four palettes, featured coffees, selection story, brew guide and FAQ |
| `shop.html` | Ten roasted coffees with an origin filter, English/Chinese search and sorting (roast and format are chosen on the product page) |
| `product.html?id=guji` | Six-image gallery; step order: roast level (淺中焙/中焙/中深焙) → format (200g beans, drip, steep) → grind (beans only); stock, flavor, origin, roast date and duration |
| `treats.html` | Four handmade treats with their own stock |
| `subscribe.html` | Three subscription plans, delivery cycle, roast/grind preference and demo sign-up |
| `checkout.html` | Shared demo cart (coffee and treats), delivery method (7-ELEVEN NT$60 / FamilyMart NT$60 / home NT$80, free over the threshold), optional order notes, weight/price calculations and local demo orders |
| `admin-orders.html` | Products and formats, stock, roast batches, treats, orders, subscriptions, reports, settings and backup tools |
| `story.html`, `about.html` | Responsive brand story and contact information |

Append `?lang=en` to a page URL, or `&lang=en` when an existing product query is present. The EN / 繁中 switch keeps the product ID and anchor. Both languages use the same stored demo data.

## Validate

Node.js is needed only for tests (Node 18+ recommended):

```sh
node tests/store.test.cjs
node tests/i18n.test.cjs
```

There are 27 logic/localization checks. Browser viewport validation is documented in [docs/ENGLISH-RWD.md](docs/ENGLISH-RWD.md).

## Package a committed snapshot

In a clean Git checkout, using Python 3.9+:

```sh
python3 scripts/package_site.py --release-date 2026-10-14
```

This creates one ZIP in the ignored `dist/` directory, containing the committed source, all tracked website assets, tests, instructions and a generated `RELEASE-MANIFEST.json` with the exact Git commit and per-file SHA-256 hashes. It excludes Git history and browser-saved data.

Verify a received archive with:

```sh
python3 scripts/package_site.py --verify /path/to/encounter-coffee-package.zip
```

See the handoff guide for GitHub Pages deployment, repository synchronization and how to continue development from an extracted source snapshot.

## Demo boundaries

Data is saved in this browser's `localStorage`. There is no real authentication, multi-user database, payment, shipping or email service. Prices, stock, roast dates, batches and customer/order records are sample data. Product/origin images are illustrative. Do not treat this as a production commerce backend.

The package contains the initial catalog, not edits made inside a user's browser. To transfer those edits too, export a JSON backup in Admin → Store & data settings and import it in the receiving browser. Google Fonts and official reference links require internet; local site assets and system-font fallbacks remain usable without it.
