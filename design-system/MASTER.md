# JoynoSync Design System

## Status and Scope

This document is the canonical UI/UX standard for the entire JoynoSync system.
It applies to every web page, mobile screen, component, modal, table, form,
empty state, and future interface unless a documented page-level override exists
under `design-system/pages/`.

Page-level overrides may adapt layout for a specific workflow, but they must not
weaken the accessibility, consistency, or content-first rules in this document.

## Core Philosophy

> Quiet, structured, content-first, flexible, and extremely low-friction.

> Make the interface disappear and let the information become the product.

JoynoSync is Notion-inspired, not a visual copy of Notion. Preserve the product's
own identity while using document-like hierarchy, restrained surfaces, and simple
interactions.

Every design decision must prefer clarity, hierarchy, usability, and simplicity
over visual decoration. The finished product should feel calm, intelligent,
minimal, premium, flexible, organized, fast, content-focused, professional, and
timeless.

## System-Wide Rules

### 1. Content Before Decoration

- Make the user's information and current task the visual focus.
- The product must feel like a working environment, never a marketing website.
- Every visible element must improve clarity, navigation, comprehension, or
  interaction. Remove anything that does not.
- Avoid decorative gradients, glow, glass effects, oversized illustrations,
  ornamental icons, and unnecessary shadows.
- Do not wrap every piece of content in a card.
- Use a decorative element only when it improves comprehension or orientation.

### 2. Generous, Structured Whitespace

- Use whitespace to group related information and separate distinct sections.
- Keep a consistent 4px/8px spacing rhythm.
- Prefer clear vertical spacing over extra containers or dividers.
- Give page titles and major sections enough room to breathe without wasting
  working space in data-heavy views.

### 3. Restrained, Semantic Color

- Use clean white or off-white surfaces, dark charcoal primary text, and muted
  gray secondary text and metadata in light mode.
- Use neutral charcoal and graphite surfaces in dark mode, never navy or
  blue-tinted dark surfaces.
- Use color to communicate state, priority, selection, or action—not decoration.
- Use semantic design tokens instead of scattered raw color values.
- Avoid neon colors and large decorative fields of accent color.
- Never rely on color alone; pair status color with text, an icon, or another cue.
- Maintain WCAG AA contrast: at least 4.5:1 for normal text and 3:1 for large
  text and meaningful interface graphics.

### 4. Typography Creates the Hierarchy

- Use one clear page title per view.
- Use weight, size, spacing, and alignment before adding color or containers.
- Page titles are large and confident without becoming oversized; section
  headings are clear and medium weight; metadata is small and muted; body text
  remains compact and highly readable.
- Use a consistent type scale rather than arbitrary sizes.
- Avoid unnecessary font families, weights, sizes, and stylistic variations.
- Keep body line height comfortable and long-form text to a readable measure.
- Use tabular figures for aligned numeric data where appropriate.

### 5. Everything Interactive Feels Approachable

- Rows, blocks, tags, text actions, and controls should clearly communicate when
  they can be opened, edited, selected, or rearranged.
- The workspace should feel flexible: users can manipulate, organize, filter,
  edit, and rearrange content without the interface becoming visually loud.
- Do not style static content as interactive.
- Provide visible hover, pressed, selected, disabled, loading, and focus states.
- Interaction feedback must not shift surrounding layout.
- Keep primary actions clear and secondary actions visually quieter.

### 6. Prefer Simple, Document-Like Components

- Present sections as structured content before reaching for a large card.
- Prefer simple rows, sections, lists, tables, tabs, dropdowns, and lightweight
  cards that read as parts of one continuous workspace.
- Use cards only when their boundary communicates a real grouping or interaction.
- Prefer a title, concise supporting value, and a quiet action over an icon-heavy
  promotional block.
- Dashboard cards, when genuinely needed, use the established 5px radius.
- Keep other corner radii small or moderate and consistent.

### 7. High Information Density Without Visual Noise

- Use alignment, spacing, typography, subtle dividers, and muted metadata to make
  dense information scannable.
- Keep tables focused on list-level information.
- Put detailed information in a drawer or profile view.
- Avoid oversized controls and excessive vertical padding in operational tables.
- Keep columns and repeated fields consistently aligned.

### 8. Subtle Borders and Restrained Elevation

- Use thin, low-contrast borders to separate adjacent surfaces when spacing alone
  is insufficient.
- Surfaces should feel like sections of one workspace, not floating islands.
- Reserve shadows or elevation for overlays, menus, dialogs, and meaningful layer
  changes.
- Use a consistent elevation scale; never invent one-off shadows.

### 9. Functional, Consistent Icons

- Every icon must represent a recognizable object, state, or action.
- Use one SVG icon family and a consistent stroke style within each visual layer.
- Keep icons small and restrained; never add icon grids or icons merely to fill
  empty space.
- Do not use emoji as structural icons.
- Icon-only controls require an accessible label and tooltip where helpful.
- The visual icon may be small, but its interactive target must remain at least
  44 by 44 CSS pixels on touch interfaces.

### 10. Progressive Disclosure

- Show the minimum information needed to understand and act on the current view.
- Reveal secondary details through drawers, expansion, menus, or dedicated pages.
- Keep advanced options hidden until they become relevant.
- Never hide a critical state or required action behind hover-only behavior.

### 11. Consistent Interaction Patterns

- The same control must behave the same way across the system.
- Reuse existing dropdown, menu, modal, table, toast, and confirmation patterns.
- Preserve filters, selection, scroll position, and input when users navigate back.
- Destructive actions require clear wording, separation from routine actions, and
  confirmation or a reliable undo path.

### 12. Keyboard and Accessibility First

- Every essential workflow must be usable without a mouse.
- Tab order follows visual order and focus is always visible.
- Use semantic HTML and accessible names for controls.
- Forms require persistent labels, local error messages, and a clear recovery path.
- Move focus appropriately after route changes, dialogs, and validation failures.
- Respect browser zoom, text scaling, and `prefers-reduced-motion`.

### 13. Simple, Stable Navigation

- Keep top-level navigation limited to essential workspace destinations.
- Clearly distinguish primary navigation from secondary actions and settings.
- Always show the current location.
- Keep navigation placement and behavior consistent across views.
- Use an overflow menu when actions do not fit instead of cramming the header.

### 14. Avoid Dashboard Syndrome

- Do not default to grids of oversized metric cards, decorative charts, or giant
  icons simply because a view is called a dashboard.
- Prefer structured lists, tables, grouped sections, and concise summaries.
- Use charts only when a visual trend or comparison is easier to understand than
  the equivalent text or table.
- Pair charts with readable labels and an accessible data alternative.

### 15. Responsive Product Standard and Current Desktop Scope

- Responsiveness remains a permanent product requirement. Layouts must reorganize
  intelligently for their viewport and must never merely shrink a desktop layout.
- The current redesign rollout is desktop-first. Design and acceptance work for
  this phase targets 1024px, 1280px, and 1440px-and-wider desktop layouts.
- Do not redesign mobile or tablet interfaces during the current rollout. Preserve
  their existing behavior and fix only regressions introduced by desktop work.
- A dedicated future phase will redesign and validate tablet and mobile layouts at
  768px and 375px.
- Prevent unintended horizontal scrolling and content hidden behind fixed elements.
- Reserve space for asynchronous content to avoid layout shifts.

### 16. Subtle, Functional Micro-Interactions

- Use restrained transitions to communicate state changes and improve perceived
  responsiveness.
- Keep routine interface transitions fast and understated, normally 150–300ms.
- Prefer transform and opacity when motion is necessary.
- Motion must never block interaction, shift surrounding layout, or exist only to
  attract attention.
- Respect `prefers-reduced-motion` and preserve all functionality without motion.

### 17. Never Default to Generic SaaS Design

Do not introduce any of the following without a specific functional reason:

- giant gradient hero sections
- excessive rounded cards or repetitive three-card layouts
- floating glassmorphism panels, glowing blobs, or neon effects
- huge decorative icons, icon grids, or decorative illustrations
- strong or excessive shadows
- fake statistics, filler dashboards, or unnecessary charts
- decorative UI elements or excessive animation

Empty space is part of the design. Never fill it merely because it exists.

## Component Decisions

### Tables and Lists

- Table equals list-level information only.
- Keep headers, sort state, filters, and row actions predictable.
- Use subtle row hover and selected states.
- Make sortable headers keyboard accessible and expose their current sort state.
- Use pagination or virtualization for large data sets.

### Drawers and Profiles

- Drawer/profile equals details only.
- Maintain a clear title, compact metadata, grouped properties, and an obvious
  close or back action.
- Reveal secondary fields progressively instead of turning the list into a form.

### Forms

- Use visible labels rather than placeholder-only labels.
- Group related fields and keep optional or advanced inputs collapsed when useful.
- Validate after the user finishes a field, not on every keystroke.
- During submission, prevent duplicate actions and show progress followed by a
  clear success or recoverable error state.

### Modals and Menus

- Use modals for focused decisions, not primary navigation.
- Keep copy concise and action-specific.
- Provide keyboard focus trapping, Escape handling where safe, and focus return.
- Use elevation only to clarify that the surface sits above the current content.

### Empty, Loading, and Error States

- Empty states explain what is absent and provide the most useful next action.
- Prefer stable skeletons for content loads that are visibly delayed.
- Errors state what happened in user language and how to recover.
- Do not expose database, storage, backend, or duplicate-detection internals in
  user-facing copy.

## Review Checklist

Before shipping any UI change, confirm:

- [ ] Content is more prominent than its container or decoration.
- [ ] Spacing, typography, and alignment create a clear hierarchy.
- [ ] Color is semantic, restrained, accessible, and not the only signal.
- [ ] Cards, borders, icons, and shadows exist for a functional reason.
- [ ] Primary and secondary actions are visually distinct.
- [ ] Detailed information is progressively disclosed.
- [ ] Existing interaction patterns are reused consistently.
- [ ] The workflow works with keyboard, touch, zoom, and reduced motion.
- [ ] Loading, empty, error, and disabled states are clear.
- [ ] Light and dark modes both preserve contrast and hierarchy.
- [ ] Responsive layouts were checked at the standard viewport widths.
- [ ] The current desktop scope was respected without unintentionally redesigning
      or breaking deferred mobile layouts.
- [ ] The UI contains no generic SaaS decoration or filler content.
- [ ] The result feels like a quiet workspace, not a promotional SaaS dashboard.

## Page-Level Overrides

If a page requires a justified exception, document only the difference in:

`design-system/pages/<page-name>.md`

The override must explain why it is necessary. All rules not explicitly overridden
continue to come from this master document.
