# 05 — Legacy UI fidelity

## Evidence base
* `ui-reference/` (static reconstruction built from the recovered Blade templates + original CSS/fonts/images) and `docs/legacy-ui/` (design tokens, layout, component inventory, 61 screens, 33 reconstruction screenshots).
* **There are no screenshots or live access to the original production site.** Per the evidence rules, the reference reconstruction is the visual baseline and no pixel-perfect claim is made.

## Technique: port, don't restyle
1. The verified legacy stylesheets and assets were copied byte-for-byte into `public/assets/` (`bootstrap.css`, `font-awesome.css`, `dropify.css`, `bootstrap-select.min.css`, `lightbox.min.css`, `front.css`, `media.css`, `admin.css`, fonts, images; hashes in `docs/legacy-ui/assets-manifest.json`). **No legacy CSS was edited.**
2. Layouts link them in the same order as the Blade masters (`app/layouts/*.vue`).
3. Blade/ui-reference markup was ported to Vue templates **with the same DOM and class names**; behaviour that Bootstrap/jQuery provided (dropdowns, collapse, tabs, modals, sidebar toggle) is re-implemented in `app/plugins/legacy-behaviour.client.ts` using the same `data-*` attributes.
4. Design tokens from `docs/legacy-ui/03-design-system.md` were not re-expressed as new variables: the original CSS is the contract.

## Fidelity deviations (all intentional and labelled)
| Area | Deviation | Reason |
|---|---|---|
| Book sort | only "الأحدث" / "الأكثر زيارة" | legacy "الأكثر طلباً/تعليقاً" were never implemented (audit 06) |
| Guest checkout | replaced by sign-in/register in the cart | security (no generated/mailed passwords) |
| Register / affiliate-register forms | nickname, phone, UTM/device capture omitted | no verified requirement; marketing capture not carried over |
| Admin tables / editors / date-range | plain tables, `<textarea>` HTML editor, native date input | visual parity of DataTables/Froala/daterangepicker was never required (legacy-ui/13) |
| Tablet header | 9 px link size at 768 px **kept** | legacy behaviour; changing it requires owner approval |
| Poster / social icons / logo | rendered only when set in site settings | originals were DB uploads that were not recovered |
| Fonts | `janna-bold.ttf` and `fontawesome-webfont.woff/woff2` aliases added under `public/assets/css/…` | legacy CSS references files that were absent in the recovered tree (404s); aliases are copies of the verified fonts, CSS untouched |
| Page headings | rendered by each page (`PageHeading`) | SSR ordering |
| Header/footer CMS links | data-driven from `pages` (`positions`) | same as legacy, now from the new table |

## Validation
`docs/implementation/ui-validation/README.md` — 15 representative screens × 1440/768/390 px: all HTTP 200, RTL, **zero horizontal overflow, zero page errors**; pixel-diff vs the reference between 0.6 % and ~21 % (differences explained by data, uploads and result counts — not structure). Owner sign-off checklist: `docs/legacy-ui/14-ui-acceptance-checklist.md` (not yet signed).
