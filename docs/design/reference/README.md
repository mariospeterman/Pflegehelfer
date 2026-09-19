# Pflegehelfer visual references

Status: canonical visual appendix

Updated: 2026-09-19

These supplied light and dark mockups define the desired visual mood and
interaction hierarchy for the existing OpenUI PWA. They are references, not
literal product screenshots, clinical evidence, permission policy, responsive
CSS, or a second product contract.

## Reference assets

| Asset | SHA-256 | Purpose |
| --- | --- | --- |
| `pflegehelfer-light-reference.png` | `464b5d80eb827c8fb7b9a03d1ba1a85abd5e7b3d84165070f9bfaef0ab90d4b1` | Light-theme composition, density, paper/glass restraint and blue action hierarchy. |
| `pflegehelfer-dark-reference.png` | `bca1c876b1b0741feef534dc48339963173df043d8213ea8aa16f95f02ae33a1` | Dark-theme surface elevation, contrast and restrained blue/red semantics. |

Both files are 941 × 1672 RGB PNGs supplied on 19 September 2026.

## What to carry into the product

- One calm conversation is the primary workspace. The composer, contextual
  actions and generated clinical UI belong to that conversation.
- Mobile uses a compact header with menu, current scope and current user.
  Preserve enough subject and audience identity to prevent wrong-context work.
- Assistant and employee messages have a clear reading order. Generated detail
  is compact, expandable and subordinate to the conversation.
- Use a white/off-white light theme and graphite/near-black dark theme, with
  pharmaceutical blue for primary actions. Reserve red for warnings/errors and
  green for confirmed success.
- Keep restrained translucent chrome around navigation and the composer.
  Clinical facts and review controls use calm opaque surfaces with WCAG 2.2 AA
  contrast.
- Desktop adds a collapsible sidebar and optional contextual inspector around a
  readable chat column. Tablet adapts the layout; it does not stretch the phone
  composition.
- Maintain 44–48 CSS-pixel bedside targets, visible focus, keyboard operation,
  reduced motion/transparency and a composer that remains usable with zoom and
  the virtual keyboard.

## Deliberate overrides

Do not copy the mockups literally where they contradict the product contract:

- Keep the canonical Pflegehelfer Edelweiss/negative-space-plus mark. The
  heart/shield cross in the images is not the product logo and must not replace
  it.
- Do not emit `Stabil`, `keine dringenden Massnahmen`, `Wunde reizlos`, or other
  conclusions unless an authorized current source supports the exact statement.
  Normal-looking measurements never justify a generated global status.
- The depicted identity, age, room, diagnosis, allergy, measurements, times and
  work statements are visual examples only. Runtime content must come from the
  active authorized patient/encounter and retain source, occurrence time, unit,
  certainty and review state.
- Do not represent a patient as online. A green indicator is allowed only for a
  real directory/system state whose meaning is explicit and authorized.
- Do not make the large patient card mandatory. Prefer the smallest useful
  summary and progressive disclosure.
- Do not keep all depicted bottom controls visible at once. Attachment,
  dictation, read-aloud, send and stop/cancel controls are state-dependent and
  must have distinct accessible names.
- Do not use emoji as core action icons. Use the maintained SVG icon set. A
  conversational greeting may contain ordinary text punctuation or symbols,
  but safety and navigation affordances cannot depend on emoji.

## Implementation boundary

The references do not change data ownership or authority. Models may author
natural dialogue and choose bounded presentation. The server authenticates,
authorizes and resolves every clinical fact, proposal revision and action.
Review controls appear only after the latest durable proposal and one-use
authority are valid. A partial stream, rendered card or click is never clinical
evidence by itself.

The binding behavior and ownership contracts remain
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) and
[`../../execution/PFLEGEHELFER_COMPLETION.md`](../../execution/PFLEGEHELFER_COMPLETION.md).

## Visual acceptance

Inspect the running integrated profile at 360×800, 390×844, tablet portrait and
landscape, 1024 px and 1440 px widths in light, dark and system themes. Include
200% text/zoom, keyboard-only use, reduced motion/transparency and a reduced
viewport representative of the mobile keyboard. Store actual screenshots as
dated acceptance evidence; never relabel these generated references as runtime
screenshots.
