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

**OWN-WORLD.** Panama's defining machine is a system for holding, measuring and
releasing a resource under control. Its visual language is gauges: engraved
gradations, major and minor ticks, named threshold marks, a defined surface line,
and read-outs in tabular figures. The palette is paper-white ground, graphite
ink, and a single reserved signal used only where a threshold is crossed.
Hairlines are gradations, not card borders. There are no cards.

**STORY.** A person opens the product and, within one screen, knows what is
actually theirs to spend, what has already been claimed and by what, and what the
next money that arrives should do. They leave able to say a number out loud with
confidence.

**FIRST VIEWPORT.** The available level, full-measure, against a scale with real
labeled values and threshold marks — buffer minimum, committed line, current
surface. The figure sits as a read-out beneath the scale, not on top of it.
Below the fold line, the claims against it, itemized with dates, each showing the
gradation it consumes.

**FORM.** Instrument gauge. Chosen from the audience's own world rather than
from the fintech catalogue, and pinned by the user against three alternatives.
Light-first, from the use scene: a person reviewing a statement at a desk in
daylight.

---

## Refused, deliberately

These are the category's defaults. Each was available and rejected.

- **Cards as page structure.** Same-size rounded rectangles holding icon +
  heading + text. Nested cards especially. Structure comes from gradation rules
  and space.
- **The hero-metric template.** Big number, small label, supporting stats,
  accent color.
- **Progress rings and sparklines as ornament.** A gauge is content here; a ring
  drawn because a number needed decoration is not.
- **Uppercase tracked eyebrows over every section.** One kicker register exists;
  it is not applied everywhere.
- **Gradient text, glass, blur as decoration.** Blur belongs to a specific
  effect — a scroll edge where floating chrome overlaps content — never as
  surface flavor.
- **Colored `border-left` accents** on rows, callouts and alerts.
- **Emoji, AI sparkles, robot iconography.**
- **Color as the only carrier of state.** Every status is also a word.

---

## Color

Light is the default, from the use scene. Dark is fully designed, not derived.

Strategy: **restrained** — neutrals carry the surface, one signal color appears
only where a threshold is crossed or a value is negative. Semantic hue is never
the only signal.

```
--ink              graphite, primary text
--ink-secondary    supporting text, still ≥4.5:1
--ink-tertiary     scale labels, ≥4.5:1 on ground
--ink-faint        gradation hairlines only, never text
--ground           the paper
--ground-sunk      recessed regions (the chamber below the surface line)
--ground-raised    floating chrome only
--rule             hairline gradations
--rule-strong      major gradations and threshold marks
--signal           the single reserved accent — threshold crossed
--negative         outflow / deficit
--positive         inflow / surplus
--caution          approaching a threshold
```

Rules:

1. `--signal` may not be used decoratively. If it appears, a threshold was
   crossed, and the interface also says so in words.
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

Structure comes from **gradation rules and space**, not from boxes. A row of
data is separated by a hairline, not enclosed in a container. Where a region must
recede, it recedes by ground tone, not by a border and a shadow.

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
