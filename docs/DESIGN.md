# LuvAll Sports — visual design

The interface follows a "court-side editorial" direction drawn from the academy's mood board: huge condensed
uppercase headlines over court imagery, slanted section cuts, very rounded photo tiles with pill actions, and
mint / court-green / hard-court-blue package cards. The home page (`client/src/pages/public/Home.tsx`) is the
reference implementation; everything below exists to keep other screens consistent with it.

## Tokens (`client/src/index.css`)

| Role | Token / class | Use |
| --- | --- | --- |
| Paper | `bg-paper` (#f1f2ee) | Page background (light grey with a green bias). |
| Card | `bg-white` / `bg-card` | Cards, tiles, form panels. |
| Ink | `text-ink`, `text-muted` | Text; `text-court-950` for big headings on paper. |
| Court green | `court-950/900/court/700/600/100/50` | Brand: dark bands, primary buttons, footer, portal sidebar. |
| Hard-court blue | `hard-900/700/hard/400/100` | Secondary surface: slanted bands, one plan card, info accents. |
| Mint | `bg-mint`, `bg-mint-100` | Soft highlight cards (first plan, first testimonial, success panels). |
| Ball lime | `ball`, `ball-600`, `ball-100` | Accent only: CTA button, arrow discs, numbers/eyebrows on dark, active nav. Never body text on paper. |
| Clay | `clay` | Kids level, sparing. |

Lime on light backgrounds fails contrast — put lime text only on dark (court-950, hard, photos with scrim).

## Type

- **Display — Anton** (`font-display`, `.mega`, `.display-title`): always UPPERCASE, single weight (never add
  `font-bold`; `font-synthesis` is off). Use for: hero headlines (`.mega`), section titles (`.display-title`),
  page titles in portals (`PageHeader`), big numbers (prices, stats, counts), names on photo tiles.
- **UI/body — Figtree** (default `font-sans`): everything else. Card titles `font-bold` (not Anton) when the card
  is dense (batch names, list rows). Eyebrows: `text-xs font-semibold uppercase tracking-[0.14em]`.

## Shapes and depth

- Radius: tiles and cards `rounded-3xl`; hero/feature panels `rounded-[2rem]`; buttons, chips, nav, list rows
  `rounded-full`. Inputs `rounded-xl`.
- Shadows: `shadow-[var(--shadow-card)]` at rest, `shadow-[var(--shadow-lift)]` on hover or floating panels.
  Prefer whitespace and fills over borders; use `border-line` hairlines only inside cards.
- Over photos: `.scrim-bottom` for text legibility, `.glass` (light frosted) or `.glass-dark` panels, white/ball
  chips (`rounded-full px-2.5 py-1 text-xs font-semibold`).
- Surfaces: `.court-diagonals` (court-line pattern on dark/blue panels), `.court-lines` (grid on dark),
  `.slant-both` / `.slant-bottom` (diagonal section edges — at most one slanted band per page).

## Components

- Buttons (`buttonClass` / `Button` / `LinkButton`, all pills): `ball` = main call to action on dark or the
  page's single most important action; `primary` (court green) = standard action; `light` (white pill) = action on
  photos/colour; `glass` = secondary on photos/dark; `secondary` = neutral; `hard` = blue.
- `SeeMore` — "See all →" link with the lime arrow disc; use as the action of a `SectionHeading`.
- `SectionHeading` — eyebrow on a hairline rule + `.display-title` + intro + action.
- `PageHero` — top band of every inner public page (court or hard tone, optional photo).
- `BatchCard` (photo tile, pass the program image), `CoachCard` (portrait tile, name in Anton), `PostCard`,
  `PlanCard` (mint / court / blue package cards), `Img` (painted-court placeholder when no image).
- Portals: `PageHeader` (Anton uppercase title), `Stat` (Anton number), `Card`, `CardHeader`, `Badge`,
  `StatusBadge`, `Table/Th/Td`, `Field/Input/Select/Textarea`, `EmptyState`, `Notice`.

## Patterns

- Inner public pages: `PageHero` → content sections separated by `py-16`–`py-24`, each opened by a
  `SectionHeading` when there is more than one section.
- Listings: grids of photo tiles (`gap-5`, `sm:grid-cols-2 lg:grid-cols-3`); filters as pill chips
  (`rounded-full`, active = `bg-court text-white`).
- Detail pages: big rounded photo or court panel, Anton title, key facts as a white `rounded-3xl` side card with
  the price/CTA (sticky on desktop).
- Forms (contact, sign-in, enrollment): white `rounded-3xl` panel on paper; on sign-in/register pair it with a
  court photo panel with an Anton headline.
- Phone first for student and coach screens: big tap targets (h-11+), full-width primary actions.

## Don'ts

- No new colours or fonts outside the tokens; no emoji as icons; no numbered markers unless the content is a real
  sequence (the enrollment steps are).
- Don't put Anton on long paragraphs, form labels or table cells.
- Don't stack more than one slanted band or more than one mega headline per page.
