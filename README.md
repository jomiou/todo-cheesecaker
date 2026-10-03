# Cheesecaker 🍰

A small, fast notes app built around checklists. No build step, no dependencies, and your notes stay in your browser.

## What it does

- **Add, edit and rearrange entries.** Type straight into the list. Press Enter for a new item, or drag the ⠿ handle to move an item and everything nested under it.
- **Indent and nest entries.** Tab and Shift+Tab, the toolbar buttons, or dragging sideways. Nest as deep as you like.
- **Checked entries sink to the bottom.** Top-level items move into a collapsible "checked items" section. Nested items sink to the bottom of their own group.
- **Unchecked entries go back to where they were.** Every list keeps its original order behind the scenes, so an unchecked item returns to its old spot, even if you've rearranged things in the meantime.
- Checking a parent checks its children. Unchecking it restores only the children that it checked.
- You can paste a multi-line list from anywhere. Indentation, bullets (`-`, `*`, `•`, `1.`) and Markdown boxes (`[ ]`, `[x]`) are understood.
- Undo for deleted items and notes, "Uncheck all", and "Delete all" checked items.
- **Mobile friendly.** Single-pane layout on phones, 44px touch targets, touch drag-and-drop, and an item toolbar (indent, outdent, move, check, delete) that stays above the on-screen keyboard. It can be added to the home screen.
- Light and dark themes follow your system setting.

## Keyboard

| Key | Action |
| --- | --- |
| Enter | New item (splits the text at the caret). On an empty nested item it un-nests |
| Tab / Shift+Tab | Indent / outdent |
| Alt+↑ / Alt+↓ | Move item (with its children) |
| Ctrl/⌘+Enter | Check / uncheck |
| Backspace at start | Un-nest, merge with the previous item, or delete an empty item |
| ↑ / ↓ | Move between items |
| Esc | Cancel a drag / leave the item |

## Run it

It's a static site. Serve the folder with anything, for example:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173. Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://`.

It works as-is on GitHub Pages: Settings → Pages → deploy from the `main` branch, root folder.

## Tests

```bash
npm test
```

These are the list logic's unit tests (`src/model.js`), using Node's built-in test runner. Node 20 or newer is needed.

## How it's built

- `src/model.js`: pure functions over the checklist tree. Each item's `children` array keeps the original order. "Checked at the bottom" is only applied when the list is rendered, which is why unchecking can restore the old position exactly.
- `src/drag.js`: pointer-event drag and drop. Vertical position picks the slot and horizontal offset picks the depth.
- `src/app.js`: rendering, editing, routing (`#/n/<id>`), localStorage persistence, and the mobile toolbar.
