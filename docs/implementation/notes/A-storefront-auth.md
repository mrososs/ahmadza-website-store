# Slice A — public storefront + auth

## Implemented
- Pages (layout `default`, legacy markup/classes ported from `ui-reference`): `/book/[id]/[[slug]]`, `/categories`, `/authors`, `/maker/[id]/[[slug]]`, `/articles`, `/post/[id]/[[slug]]`, `/p/[slug]`, `/contact`, `error.vue` (legacy 404), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/confirm`.
- Legacy URL redirects (301): `/product/{id}` → `/book/{id}`, `/article/{id}` → `/post/{id}`; `/maker/{id}` is served directly.
- Middleware (stable names): `auth`, `guest`, `admin` (`app/middleware/*.ts`). UX guards only — private APIs re-check on the server.
- Server: `POST /api/contact` (zod + honeypot + rate limit 5/10 min/IP, service-role insert), `POST /api/views/{book|article}/{id}` (rate limited, `increment_view`), `GET /sitemap.xml`, `GET /robots.txt`.
- DB: migration `20261107000000_storefront_comments.sql` → `public.book_comments(book)` (SECURITY DEFINER; legacy visibility rule: approved ∧ (public ∨ buyer ∨ admin) ∨ own).
- Queries: `shared/queries/storefront.ts` (articles search, comments, favourites). Composables: `useFavourite`, `useAuthForms` (`safeRedirect`, `authMessage`, `useZodForm`). Components: `CardTile`, `ShareLinks`.
- Auth: Supabase Auth only (no password stored/mailed by us). Register/forgot give the same answer for known/unknown e-mails (no enumeration). `?redirect=` is validated as a same-site path.
- Personalised state (owned, favourite, comments, session menu) is fetched client-side after mount; SSR/SWR HTML is identical for all visitors. Book media paths never reach the browser (links go to `/api/library/download/:mediaId`, implemented by slice B).

## Business-rule coverage
| Rule | Status | Implementation | Test |
|---|---|---|---|
| AUTH-02 registration validation | preserved (zod + Supabase min length 8) | `pages/register.vue`, `shared/schemas` | `tests/api/auth.test.ts` |
| AUTH-04 / AUTH-09 verification | fixed — confirmation e-mail now sent, login blocked until confirmed | `pages/register.vue`, `pages/confirm.vue` | auth.test (Mailpit, `email_not_confirmed`) |
| AUTH-05 login | preserved on Supabase Auth | `pages/login.vue` | auth.test |
| AUTH-07 e-mail oracle | fixed (no enumeration) | register/forgot pages | auth.test (recovery) |
| AUTH-12 password reset | replaced by Supabase recovery link | `forgot-password.vue`, `reset-password.vue`, `confirm.vue` | auth.test |
| AUTH-16/22 admin role | fixed — `user_roles`, never user metadata | `middleware/admin.ts` | auth.test (self-promotion refused) |
| CAT-03/04 status & visibility | preserved; drafts/archived 404 | `getBook`, RLS | storefront.test |
| CAT-06/08 categories & makers | preserved (links in book page, `/search?category`) | `pages/book/*`, `maker/*` | storefront.test |
| CAT-15/16 media gate, preview | preserved in UI; enforcement in slice B route | `pages/book/*` | (slice B) |
| CAT-21 related books | preserved as data (semantics pending owner) | `relatedBooks` | — |
| CAT-23 search | preserved (title, Arabic-normalised) | `BookListing`, `listBooks` | storefront.test |
| CAT-24 view counting | preserved, atomic + rate limited | `api/views` | storefront.test |
| CAT-25 comments | preserved: pending moderation, buyers see all | `book_comments`, book page | `tests/db/comments.test.ts` |
| CAT-27 favourites | preserved (RLS-owned) | `useFavourite` | (RLS in foundation) |
| CAT-31 contact | preserved + honeypot + rate limit | `api/contact.post.ts` | storefront.test |
| CAT-32/33 articles/pages | preserved, HTML sanitised on save (slice C) | `post/*`, `p/*` | storefront.test |
| CAT-36 URL ids | replaced by numeric ids + 301s | `product/`, `article/` | storefront.test |
| CAT-37 statistics | preserved (foundation) | — | — |

## Deviations (labelled)
- Sort options: only «الأحدث» / «الأكثر زيارة» on the book grid (legacy «الأكثر طلباً/تعليقاً» were unimplemented). Articles keep desc/asc/view.
- Register form omits nickname, phone, UTM/device capture (legacy marketing fields; no verified requirement).
- Page headings are rendered by each page (`PageHeading`) rather than by the layout (SSR ordering).

## Blockers / open
- `/api/library/download/:mediaId` is slice B; book page links to it.
- Comments/ favourites/ related-books are client-fetched, so they are absent from the SSR HTML (by design for cache safety).
- Rate limiter is in-memory (per instance).
