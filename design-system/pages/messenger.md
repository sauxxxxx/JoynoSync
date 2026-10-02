# Messenger

Messenger extends the JoynoSync workspace system with a communication-first layout.

## Structure

- The inbox is a stable left rail with search, type filters, and clear unread and selected states.
- The active conversation owns the main canvas. Messages remain the dominant content.
- Conversation details open as a temporary right drawer and never reserve an empty column.
- The composer is a single floating work surface. Attachment, emoji, and quick-reply tools remain behind one disclosure control.

## Visual Rules

- Use neutral charcoal for selected actions and sent messages; do not use blue as the default interaction color.
- Conversation rows are list items, not cards. Selection uses one quiet filled state and a subtle outline.
- Message actions appear on hover or keyboard focus, while essential message content and delivery state remain visible.
- Elevation is reserved for menus, the details drawer, and the floating composer.
- Loading skeletons must mirror the final inbox, thread, composer, and drawer geometry.

## Desktop Scope

This composition applies at 1025px and wider. Existing tablet and mobile behavior remains unchanged until the dedicated responsive redesign.
