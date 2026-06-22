# UI_RULES.md

Visual and UX rules for this repo.

Use this file to keep UI decisions consistent across screens, especially for small fixes and polish passes.

For file ownership and workflow, see:
- [AGENTS.md](c:\Users\joynoit\Desktop\joyno\AGENTS.md)
- [FEATURE_MAP.md](c:\Users\joynoit\Desktop\joyno\FEATURE_MAP.md)

## Purpose

This file exists to stop repeat debate over:
- typography weight
- spacing density
- accent use
- dark mode tone
- table vs drawer responsibility
- modal copy and modal hierarchy

The UI should feel:
- clear
- operational
- premium
- fast
- calm under heavy data

Avoid anything that feels:
- generic SaaS template
- too decorative
- too noisy
- too technical for agents
- visually louder than the task itself

## Core Product UX Rules

- Table = list only
- Drawer/profile = details only
- Archive = soft archive, not hard delete
- User-facing copy should describe product behavior, not implementation details
- Operational columns should always beat free-text columns in width fights
- When width gets tight, truncate content first and preserve actions/status visibility

## Copy Rules

### User-facing copy

- Write for agents and managers, not developers.
- Never mention:
  - database
  - backend
  - storage
  - duplicate detection internals
  - technical implementation details
- Describe what changes in the product, not what changes in the system.

### Tone

- direct
- simple
- operational
- calm
- not chatty
- not corporate-fluffy

### Good examples

- `This will remove the lead from the active list.`
- `You can restore it later if needed.`
- `No leads found.`
- `Save Changes`
- `Archive selected leads?`

### Avoid

- `This stays in the database`
- `Still counts toward duplicate detection`
- long explanatory modal paragraphs
- internal engineering language in agent flows

## Typography

### General

- Avoid overly bold typography.
- Prefer medium or semibold over heavy bold.
- Large headings should feel confident, not loud.
- Body copy should stay readable and slightly softer than headings.
- Buttons should not visually overpower the content they act on.

### Preferred hierarchy

- Page title:
  - strong, but not oversized
  - avoid unnecessary heavy weight
- Section title:
  - semibold
  - smaller than the page title
- Card title:
  - compact
  - clear
  - not shouty
- Body/meta:
  - readable contrast
  - enough line-height to breathe
- Button labels:
  - compact
  - calmer than the title

### Confirm modal typography

- Title should not be too heavy.
- Body copy should be brighter and easier to read.
- Buttons should not overpower the message.

## Spacing and Density

### General rule

- Prefer compact clarity over airy emptiness.
- Use enough breathing room to establish hierarchy, but avoid wasted space.

### What to avoid

- large dead zones
- cramped text blocks
- giant empty cards
- buttons too close to body copy
- repeated identical field rows without grouping

### Modal spacing

- clear separation between:
  - title
  - body copy
  - sections
  - actions
- forms should be grouped by task, not by raw field count

## Color System

### Accent color

- Default accent is blue, not yellow.
- Use yellow only when it is an intentional local design decision, not a global fallback.

### Accent usage

Use accent color for:
- primary actions
- selected states
- active tabs
- key highlights

Do not use accent color to tint:
- whole dark surfaces
- every card
- every chip
- the general atmosphere of a page

### Semantic colors

- success should feel clear, not neon
- warning should feel warm, not harsh
- danger should be readable without dominating the page
- low-priority states should stay visually quiet

## Dark Mode

### Direction

- Neutral charcoal / graphite
- Not navy
- Not blue-tinted dark mode

### Rules

- Blue should be reserved mostly for:
  - active states
  - links
  - primary actions
- Dark surfaces should separate by value, not hue.
- Remove bright white surfaces unless intentionally necessary.
- A component should not look like it belongs to a different theme than its parent.

### Chips in dark mode

- Prefer ghost or softly tinted chips.
- Avoid bright white pills.
- `Not set` should be especially quiet.

## Shapes and Borders

### Radii

- Dashboard card radius is `5px`.
- Elsewhere, preserve established component language unless the screen is being intentionally redesigned.

### Borders

- Borders should support structure, not shout for attention.
- Remove borders when they add glare without improving hierarchy.
- In dark mode, avoid sharp light borders on dark surfaces.

## Tables

### Purpose

- Table = scanning and action
- Drawer/profile = detail and context

### Rules

- Do not overload tables with too much visual metadata.
- Prioritize operational columns first.
- Free-text columns must be restrained.
- Preserve readability of:
  - status
  - owner
  - date/time
  - next action

### Leads table

- `Lead` is important, but should not bully the rest of the table.
- `Interest` must be hard-capped and ellipsized.
- `Timezone` stays compact.
- Show full truncated value on hover where helpful.
- Avoid noisy phone metadata in the list view.
- Keep extra context for drawer/profile.

### Right-side operational columns

Protect width for:
- `Status`
- `Owner`
- `Last Touch`
- `Next Follow-up`

These should not collapse because of long free-text columns.

## Drawers and Profiles

### Rule

- List view stays light
- Drawer/profile handles depth

### Profile pages

- Should feel premium and structured
- Use calmer hierarchy
- Avoid oversized/bold text
- Keep accent blue
- Maintain tighter, cleaner spacing
- If a user gives a visual reference, follow its structure and rhythm closely without importing unrelated decoration

## Modals

### Rules

- Modals should feel focused and intentional.
- Confirmation modals should be short and calm.
- Form modals should use grouping and section hierarchy.
- Inputs should not feel like a wall of identical controls.

### Attendance manual modal

Preferred structure:
1. top row:
   - team member
   - date
2. work session section:
   - clock in
   - clock out
3. optional break section
4. live summary strip

### CTA labels

- Use explicit action labels:
  - `Save Changes`
  - `Save Attendance`
  - `Archive`
- Avoid vague labels when the context is operational.

## Bulk Bars

### Leads bulk bar

- Compact
- centered
- content-width
- not a full-width slab

Theme:
- light mode = black
- dark mode = white

### Bulk actions

- Keep count clear:
  - `x of x selected`
- Action label should be compact
- Icons should sit close to the label
- Avoid unnecessary borders around the action trigger
- The bar should stand out enough from the table to be easy to find

## Menus and Popovers

### Rules

- Popovers should feel attached to their trigger.
- Do not let them float awkwardly or detach visually.
- Match the theme of the parent surface.
- Avoid menus that look like unrelated generic components.

### Bulk status popover

- Should anchor directly to the bulk bar trigger
- Must use the real status semantic colors
- Must not look like an unrelated white floating card in dark mode

## Chips / Pills / Badges

### Rules

- Keep chips calm.
- Use them only when they add scanning value.
- Avoid bright white fills in dark mode.

### Status chips

- Semantic color should stay consistent everywhere.
- Same status should not swap color treatment between row view and popover view.

### Low-priority chips

- `Not set` should be visually quiet.
- Borderless or backgroundless is acceptable if readability stays good.

## Dashboard Rules

### Current direction

- Cleaner
- less cluttered
- less redundant summary furniture
- no bright white cards in dark mode

### Established rules

- Card radius = `5px`
- Remove panels that do not help actionability
- Simplify when a panel feels decorative rather than operational

## Calendar Rules

### Work calendar / calls performance

- Month text, month arrows, and selected date must stay in sync
- Avoid separate visible-month and selected-date states drifting out of sync
- Side panels that steal useful width should be removed unless they are clearly actionable

## Attendance Rules

### Team Attendance

- Edit/add must preserve manager filters
- Saving one record must never collapse the table to one agent unexpectedly
- Manager actions must work on real attendance records, not just local display state

### Break tracking

- Reporting should be clear and transparent
- If policy rules are involved, the UI should make them understandable

## Notifications

### Rule

- Notification UI must feel user-ready, not technical
- Bell/inbox copy should reflect user actions and business context
- Toasts should be brief and readable

## Responsive Behavior

### Rule

- Preserve functionality first
- Then preserve clarity
- Avoid squeezing operational columns into unreadable states

### When width is tight

- truncate free-text first
- keep status/owner/follow-up readable
- move details to drawer/profile instead of bloating the list

## Visual Anti-Patterns

Do not introduce:
- overly bold titles
- giant empty containers
- white cards on dark shells without purpose
- blue-tinted dark mode
- technical modal copy
- status colors that differ for the same meaning
- detached popovers
- noisy pills in dense tables
- free-text columns that destroy table balance

## Pre-Ship Checklist

Before shipping a UI tweak, check:
- Is the copy user-facing, not technical?
- Is the typography too bold?
- Is the spacing calmer and clearer?
- Does dark mode stay neutral charcoal?
- Did a free-text field accidentally crush operational columns?
- Is the popover attached and theme-matched?
- Does the change preserve the table/list vs drawer/detail split?

## When To Update This File

Update `UI_RULES.md` when:
- a visual rule becomes stable
- a repeated UI decision keeps coming up
- a color/spacing/copy preference is clearly established
- a new screen gets a strong design direction worth preserving
