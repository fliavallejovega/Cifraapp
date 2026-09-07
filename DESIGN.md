# Design

The durable visual system. Product truth lives in `PRODUCT.md`; this file owns
how the product looks and moves, and it is authoritative over any component that
disagrees with it.

---

## Direction contract

**THESIS.** Money is a level, not a number. This product shows how much is
actually available the way an instrument shows how much is actually in the
chamber: against a marked scale, with named thresholds, and with the committed
volume visible below the surface. It refuses the category default — the hero
metric card, a big figure over a small label with three supporting stats — because
that arrangement can only report a quantity, and the whole product exists to show
a quantity _in relation to_ what is already spoken for.

**OWN-WORLD.** A private bank's reading room. The world is deep ink and warm
ivory — the ledger on the desk, the panel behind it — with one metal in the
whole building: brass, spent only where the eye should land first. The gauge
survives from the first direction because it is the product's argument in
visual form; it now reads in brass against ink. Structure is surfaces on a
desk: a document sits ON the paper, held by a hairline and a soft offset
shadow, never printed into it.

**STORY.** A person opens the product and, within one screen, knows what is
actually theirs to spend, what has already been claimed and by what, and what the
next money that arrives should do. They leave able to say a number out loud with
confidence.

**FIRST VIEWPORT.** The available level, full-measure, against a scale with real
labeled values and threshold marks — buffer minimum, committed line, current
surface. The figure sits as a read-out beneath the scale, not on top of it.
Below the fold line, the claims against it, itemized with dates, each showing the
gradation it consumes.

**FORM.** Private-bank console. One piece of chrome with two postures: the
fixed ink column on a desk, and the same column as the drawer beneath the page
on a phone — revealed by sliding the page aside, never covered by an overlay.
Light-first, from the use scene: a person reviewing a statement at a desk in
daylight. Installable: the product ships as a PWA whose OS chrome tints to the
panel ink.

**REVISED, deliberately.** The first system (v1, "instrument face") was pure
paper-and-graphite with no cards, no chrome and no accent. It was coherent and
it read as unfinished — the user's words: básico, sin vida. This revision keeps
its spine (the gauge, tabular money, hairline discipline, one accent spent
rarely) and overturns three refusals on purpose: cards exist, a brand hue
exists (brass), and the product has navigation chrome. Each reversal is listed
below next to the refusal it replaces.

---

## Refused, deliberately

These are the category's defaults. Each was available and rejected.

- **Cards as decoration.** v2 admits cards as real surfaces — a statement, a
  reading, a form — held by a hairline and a soft offset shadow. What stays
  refused: nested cards, same-size icon+heading+text grids, and a card around
  anything whose only job is to be scanned as a column.
- **The hero-metric template.** Big number, small label, supporting stats,
  accent color.
- **Progress rings and sparklines as ornament.** A gauge is content here; a ring
  drawn because a number needed decoration is not.
- **Uppercase tracked eyebrows over every section.** One kicker register exists;
  it is not applied everywhere.
- **Gradient text, glass, blur as decoration.** Blur belongs to a specific
  effect — a scroll edge where floating chrome overlaps content — never as
  surface flavor. The one gradient that exists is the panel's own ink-on-ink
  fade, invisible as a gradient and felt as depth.
- **Colored `border-left` accents** on rows, callouts and alerts.
- **Emoji, AI sparkles, robot iconography.**
- **Color as the only carrier of state.** Every status is also a word.

---

## Color

Light is the default, from the use scene. Dark is fully designed, not derived.

Strategy: **two worlds, one metal.** Warm ivory carries the paper world; deep
navy ink carries the panel world (sidebar, drawer, the one hero card per
screen); brass is the only brand hue and is spent, not sprayed: the wordmark,
the active destination, the headline reading, a threshold. Semantic hue is
never the only signal.

```
--ink              deep navy ink, primary text
--ink-secondary    supporting text, still ≥4.5:1
--ink-tertiary     scale labels, ≥4.5:1 on ground
--ground           warm ivory paper
--ground-sunk      recessed regions (the chamber, quiet strips)
--ground-raised    floating chrome only
--surface          a card's face; --surface-border its hairline
--rule             hairline gradations
--rule-strong      major gradations and threshold marks
--brand            brass — wordmark, active mark, the headline reading
--brand-strong     brass with more ink, for text-sized uses
--brand-sunk       the faint brass wash behind a selected row
--panel            the ink world; --panel-raised, --panel-ink,
                   --panel-ink-secondary, --panel-rule complete it
--signal           threshold crossed
--negative         outflow / deficit
--positive         inflow / surplus
--caution          approaching a threshold
```

**The panel scope.** Components read colors from tokens, so the panel remaps
the tokens (`panel-scope`) instead of teaching every component a dark variant.
An Amount, a Gauge or a Status dropped onto the panel is correct without
knowing where it is; the gauge's level turns brass there via
`--color-gauge-level`.

Rules:

1. `--signal` may not be used decoratively. If it appears, a threshold was
   crossed, and the interface also says so in words.
1a. `--brand` is rationed: at most the wordmark, one active mark per posture,
   and one headline reading per screen. Brass on every button is no longer
   brass.
2. Secondary text on a tinted surface is tinted from that hue, never gray.
3. Contrast floor: 4.5:1 body and placeholder, 3:1 large text and meaningful
   graphics. Verified, not assumed.

---

## Type

Two faces, each doing a job the other cannot.

**Figures and gradation labels.** A face with true tabular figures and
unambiguous digit shapes. Money is measurement, so monospaced/tabular figures are
correct usage here, not a costume for "technical". Every column of money is
`font-variant-numeric: tabular-nums`, always, without exception — a figure column
that ripples as values change is a defect.

**Interface and prose.** A workhorse with a wide weight range, optical sizing
where available.

Tracking is size-specific. One `letter-spacing` for all sizes is wrong
somewhere:

| Role                        | Tracking | Leading |
| --------------------------- | -------- | ------- |
| Read-out (the level figure) | −0.03em  | 0.95    |
| Display                     | −0.022em | 1.05    |
| Title                       | −0.014em | 1.15    |
| Body                        | 0        | 1.5     |
| Scale label / caption       | +0.02em  | 1.3     |

Body measure 65–75ch. Display capped at 6rem. Tracking floor −0.04em. Headings
balanced; body pretty. Layout spacing in `rem`, so a user's larger text setting
grows the layout rather than overflowing it.

---

## The gauge

The system's signature device, and the reason the direction exists.

**Anatomy.**

```
  major ─┐        threshold      surface
         ▼            ▼             ▼
  ├───┬───┬───┬───┬───╫───┬───┬───┬─█████████
  0        1k        2k   ▲       3k
                      minor    read-out below
```

- **Scale** — real labeled values, not 0–100%. Major gradations carry numbers;
  minors do not.
- **Threshold marks** — named, and the name is visible or reachable: buffer
  minimum, committed line, goal target. A gauge without thresholds is a progress
  bar.
- **Surface** — a defined line, not a rounded pill cap. The level has a top edge
  because a level has a top edge.
- **Chamber** — the region below the surface is `--ground-sunk`. Claimed volume
  is drawn within it, itemized on demand.
- **Read-out** — the figure sits beneath the scale, tabular, as an instrument
  read-out. Never centered over the fill.

**Rules.**

1. The level only rises when money actually arrives. Committing money lowers it.
   The animation direction must reflect this; a level that rises when a bill is
   added is lying.
2. A gauge always shows its scale. A bare fill with no gradations is not this
   product's device.
3. Never render a gauge for a quantity that has no meaningful ceiling.
4. Screen readers get the numbers and the threshold, not the geometry.

---

## Space and structure

Base unit 4px, expressed in `rem`. Tight within a group, generous between
groups, more space above a heading than below it.

Structure comes from **surfaces on paper**. A screen is: its header, at most
one ink panel carrying the headline reading, cards for its documents, and space
between them. Inside a card the old law still rules — rows are separated by
hairlines, never enclosed again; a card inside a card is the failure mode that
made v1 ban cards outright. Where a region must recede, it recedes by ground
tone (`sunk`), not by another border.

**Chrome.** One piece of furniture, two postures. Desktop: the fixed ink
column — monogram and wordmark, the five destinations with their icons, the
household and the way out at the foot. Phone: the same column is the drawer
beneath the page (`cajón revelado`): the page slides aside, shrinks and rounds
to reveal it; the visible strip of page is the way back. Icons are one set,
outline, 1.5px, drawn in-house — never a mixed family.

Elevation is reserved for things that genuinely float over content — a sheet, a
command menu, a toast. Shadows carry an offset and a soft blur; a zero-offset
halo is decoration and is not used.

---

## Motion

Behavior, not decoration. Springs, because springs can be interrupted.

| Interaction                             | Damping                               | Response |
| --------------------------------------- | ------------------------------------- | -------- |
| Default UI (appear, reposition, reveal) | 1.0 — critically damped, no overshoot | 0.3–0.4  |
| Momentum: flick, drag release, throw    | 0.8                                   | 0.3–0.4  |
| Sheet / drawer                          | 0.8                                   | 0.3      |

Rules:

1. **Animate from the presentation value**, never the target. An interrupted
   animation must continue from where it visibly is.
2. **Feedback on pointer-down**, not on release.
3. **Hand off gesture velocity** at release; project momentum with
   `current + (v/1000)·d/(1−d)`, `d ≈ 0.998`, then snap to the nearest target of
   the projection.
4. **Enter and exit along the same path.** What slid in from the right leaves to
   the right.
5. **Anchor to the source.** A sheet or popover originates from its trigger.
6. **Overshoot only after momentum.** A panel that merely faded in does not
   bounce.
7. **Numbers transition, they do not blink.** Money read-outs interpolate,
   respecting tabular width so nothing reflows mid-transition.
8. **One authored moment per surface**, not an identical entrance on every
   section.

`prefers-reduced-motion` gets a gentler equivalent — a short cross-fade,
instantly settled values — never the removal of feedback.
`prefers-reduced-transparency` makes translucent chrome solid.
`prefers-contrast: more` gives near-solid grounds with defined borders.

---

## States

Every interactive element ships hover, active, focus-visible, disabled, loading
and error. Every data surface ships loading, empty and error.

Focus is always visible. A keystroke in this product eventually moves money.

Empty states teach rather than apologize:

> No goals — _"Give your money somewhere to go."_
> No transactions — _"Import your first statement."_
> No budget — _"Build a budget from what you actually spend."_

---

## Copy register

The product speaks like a competent financial professional, not like a machine
describing itself.

| Never                              | Always                                              |
| ---------------------------------- | --------------------------------------------------- |
| "AI detected…"                     | "We noticed…"                                       |
| "Your AI assistant suggests…"      | "Recommended allocation"                            |
| "Model confidence 97%"             | "High confidence"                                   |
| "Your tax bill" (unless finalized) | "Estimated tax reserve"                             |
| "100% automated"                   | "1,284 analyzed · 97% categorized · 18 need review" |

Controls name their action. Errors name the problem and the recovery. Every
string lives in `messages/{es,en}.json`; Spanish is the default and is written
first, not translated from English as an afterthought.

---

## Money display

Formatting happens in exactly one place: `formatMoney` in `@app/domain`. Never
in a component.

- `$1,234.56` and `B/. 1,234.56`
- True minus `−` (U+2212), which aligns with digits, never a hyphen
- Tabular figures in every column
- Leading `+` only for deltas and inflows, never for a balance
- Cents dropped only where explicitly asked, never in a statement
