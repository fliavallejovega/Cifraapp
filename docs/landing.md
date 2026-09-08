# The home page, as a sales page

> Revised 2026-09-08: rebuilt as a full-width, Apple-like page — centred display
> type, the product's position panel as an animated hero (level fills, reading
> counts up), cinematic feature rows with the product's own surfaces, a bento
> grid, scroll reveals via `motion`, a translucent fixed bar, an ink close.
> Every animation is once-on-view, and `prefers-reduced-motion` keeps only the
> fade. Two deliberate departures from DESIGN.md's refusals — display type at
> hero scale and one soft brass wash behind the hero panel — are the user's
> explicit direction («premium, Apple-like») and are confined to this page.

Written 2026-09-08, when the landing was rebuilt to sell. The earlier page was
honest and inert: one demonstration gauge, four refusals, a price. It told a
reader what the product would not do before showing anything it does.

## What the page has to achieve

A person who has never heard the name lands from a search for family finances
in Panama and, without signing up, (1) understands in one screen what the
product answers, (2) gets that answer for their own numbers, and (3) sees each
thing the product does rendered as the product, not described. Sign-up is then
the way to keep what they already built.

## Order, and why

1. **Headline and one-line claim.** The answer the product gives, in the
   words a family uses. Primary action «Empezar gratis»; secondary action
   jumps to the calculator. Under the buttons, three facts that are true and
   verifiable from the plan catalogue: free with 250 movements a month, no bank
   connection, export at any time.
2. **Try it with your numbers.** Five figures, prefilled with the
   demonstration household so the answer appears before any work is asked.
   The same arithmetic as the product, in the browser. Keeping the numbers is
   the sign-up: they are stored locally and the setup questionnaire opens with
   them filled in. This is the reciprocity and endowment move from
   `ux-ui-rules/references/conversion.md`, and it is legitimate because the
   value handed over is real.
3. **Six capabilities, each as a device.** Import without duplicates, the
   monthly plan, debt strategies, the tax reserve, goals with a monthly
   figure, and the grounded assistant. Each block is a title, a benefit in
   plain words, and the product's own surface with demonstration data. Every
   figure is internally consistent with the others (the $1,245 available in
   the hero is the $1,245 the assistant quotes). The section carries one
   «Demostración» label; the numbers are not presented as anybody's.
4. **Who it is for.** Three doors: couples and families, the self-employed,
   accountants.
5. **Plans.** All active plans, from the database, with the three limits a
   family actually decides on: people, assistant queries, tax module. Free is
   a plan, not a trial, and the page says so. The «provisional» note from the
   pricing page stays because product truth says the figures are not committed.
6. **Refusals.** Kept, shortened. In this category they are the
   differentiator, and after the capabilities they read as discipline rather
   than as a list of things missing.
7. **FAQ**, from the database, also emitted as `FAQPage` structured data.
8. **Close.** One line and the primary action again.

## What is deliberately absent

- Testimonials, logos, ratings, «trusted by». There are none. PRODUCT.md
  forbids a fabricated substitute and the page has no placeholder for one.
- Countdowns, «limited», «only today». Nothing on the page is scarce.
- Screenshots. The devices are the real components with demonstration data,
  so they cannot drift from the product and they render in both themes.
- A stated number of screens, migrations, or lines of code. Not a benefit.

## SEO

- Title leads with the category («app de finanzas familiares»), then the name.
- Description under 160 characters, in each language, with the category and
  the country.
- Canonical plus `hreflang` for `es`, `en` and `x-default`.
- Open Graph and Twitter cards, with a generated image per locale.
- `SoftwareApplication` with the offer range and `FAQPage`, both from the same
  rows the page renders. No `aggregateRating`, ever, until real reviews exist.
- `sitemap.xml` listing only the public routes, in both languages, and
  `robots.txt` that disallows every product route by name from the same list
  the request guard uses.

## Measuring it

Nothing on the page reports conversion yet. When analytics exist, the events
worth recording are: calculator edited, «keep these numbers» clicked, sign-up
completed with a draft present versus without.
