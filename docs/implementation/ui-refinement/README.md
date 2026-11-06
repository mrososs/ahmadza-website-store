# UI refinement pass

Goal: polish the execution of the preserved legacy AAWRAQ UI (same layout, palette, fonts, DOM) without redesigning it. Business logic, Supabase
schema/RLS/auth/payment/affiliate/import code were **not** touched (see "Unchanged").

## Defects found (audit of the live render + computed CSS)
| # | Problem | Cause (legacy CSS) |
|---|---|---|
| 1 | Type badge hung outside the card's top-left corner | `.type_book{position:absolute;left:0}` with no positioned parent |
| 2 | Covers/logo tiny in a huge white box, lots of dead space | fixed 180 px image box, `object-fit:cover`; the default cover is a 635×952 white canvas with a small mark |
| 3 | Titles 12 px, one line, centred; weak hierarchy | `.name{font-size:12px;white-space:nowrap}` |
| 4 | Heavy `50px/100px` blur shadows, cards of unequal height | legacy `box-shadow`, no flex layout |
| 5 | Price and cart button unbalanced in the footer | 8/4 column split, currency nudged with `top:3px` |
| 6 | Cart button ambiguous (no label), tiny on mobile (25 px) | icon only, `.under .cart` heights |
| 7 | Filter panel: half-width oversized green button | two `col-sm-6` |
| 8 | "إخفاء الكتب المجانية" looked like plain text | bare link in a panel |
| 9 | Header links cramped / wrapped, logo floating, no focus states | `margin:3px;padding:2px 3px`, `box-shadow:none` |
| 10 | Sidebar items: single-line overflow, weak metadata | no clamping, tight padding |
| 11 | No visible keyboard focus anywhere | legacy `outline:none` |
| 12 | Product info rows glued label to value | no spacing between `span` and value |
| 13 | Very wide pages on large screens | full-width `container-fluid` |

## What changed
* **New, additive stylesheet** `public/css/aawraq-refine.css` (design tokens + refinements), linked after `front.css`/`media.css` in `app/layouts/default.vue`. All rules are scoped under `.body` (the storefront shell); the legacy CSS files are unchanged and the Webmin admin/affiliate shells are unaffected.
* **Tokens:** brand greens/cream/tan/gold from the legacy palette, spacing scale, radius, control height (44 px), soft card shadows, focus ring, container max width (1560 px).
* **Cards (`BookCard.vue`, `CardTile.vue`):** 4:5 media area with `object-fit: contain`, badge inside the card, two-line title clamp with reserved height so footers align, price + muted currency, "مجاني" label for free books, 44×40 cart button with hover/focus/disabled states and descriptive `aria-label`, placeholder state (`is-placeholder`) cropping the legacy brand mark, whole card focusable with visible ring, subtle hover shadow.
* **Grid:** flex equal-height cards, consistent gutters; 4 / 3 / 2 / 2 / 2 columns at 1440 / 1024 / 768 / 390 / 360 px (legacy breakpoints).
* **Header:** vertically centred, logo 96 px, 14 px links with comfortable hit areas and hover surface, visible search focus, mobile logo/cart sizing.
* **Filter (`BookListing.vue`):** select + button on one row (9/3 columns, equal 44 px height), stacked on phones; free-books toggle styled as a labelled control.
* **Sidebar (`SiteSidebar` via CSS):** padded items, two-line clamp, muted metadata, hover colour, rounded bottom edge.
* **Typography:** Janna (original) kept; scale 19 / 15 / 14 px for headings / titles / navigation, line-height 1.7 for Arabic content.
* **Other:** product page cover frame (contain), pagination touch targets (44 px on mobile), honeypot field no longer widens the page, admin off-canvas sidebar contained (`overflow-x: clip`).

Files: `public/css/aawraq-refine.css` (new), `app/layouts/default.vue`, `app/layouts/admin.vue` (1 line), `app/components/books/BookCard.vue`, `BookListing.vue`, `app/components/storefront/CardTile.vue`, `app/pages/contact.vue` (honeypot), `tests/e2e/ui-refinement.spec.ts` (new).

## Validation (`npx playwright test -c tests/e2e/playwright.config.ts ui-refinement`)
55 runs = 11 pages × {1440, 1024, 768, 390, 360} px. Asserted per run: HTTP < 400, `dir=rtl`, no horizontal overflow, no page errors; on grids additionally:
equal card heights per row, badges inside card bounds, touch-sized cart buttons (≥ 40×36), no distorted covers.
Measured card size (home): 240×411 @1440 (4 cols), 226×393 @1024 (3), 226×390 @768 (2), 174×318 @390 (2), 159×299 @360 (2).
`before/` holds the pre-refinement captures, `after/` the final captures + `results.json`.

## Remaining issues
* All demo books use the legacy default cover (no real covers were recovered), so the grid shows the brand mark on every card; real 2:3 covers will fit the 4:5 frame with `contain`.
* Admin / affiliate (Webmin) screens were not redesigned (no reference evidence); they only received the overflow containment.
* Legacy details not changed: empty-comment notice overlapping its heading chip on the book page, tablet header at 768 px uses small links.
* Not yet run: automated accessibility (axe/Lighthouse), real-device testing, comparison against screenshots of the original site (none exist).

## Unchanged (confirmation)
No change to `supabase/` (migrations, RLS, storage), `server/` business logic, auth, payments, affiliate/commission code, import scripts, or data. All pages still read from local Supabase.
