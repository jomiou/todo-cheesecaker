// Checklist data model.
//
// Items form a tree: { id, text, checked, auto, children }. Every `children`
// array (and the root array) is kept in the items' *original* order. Checked
// items are only *rendered* after their unchecked siblings, so unchecking an
// item drops it straight back into the spot it came from.
//
// Invariant: a checked item has only checked descendants. Checking cascades
// down (marking cascaded items `auto`), unchecking cascades up to ancestors and
// back down to items that were only checked by a cascade.

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeItem(text = '', checked = false) {
  return { id: uid(), text, checked, auto: false, children: [] };
}

/** Find an item: { item, parent, siblings, index, depth } or null. */
export function locate(items, id, parent = null, depth = 0) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.id === id) return { item, parent, siblings: items, index: i, depth };
    const found = locate(item.children, id, item, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Items from the root down to (and including) the item with `id`. */
export function pathTo(items, id) {
  for (const item of items) {
    if (item.id === id) return [item];
    const sub = pathTo(item.children, id);
    if (sub) return [item, ...sub];
  }
  return null;
}

/** Siblings in display order: unchecked first, then checked, each in original order. */
export function displayOrder(siblings) {
  return [...siblings.filter((i) => !i.checked), ...siblings.filter((i) => i.checked)];
}

/**
 * Rows to render. `active` holds unchecked top-level items (with their whole
 * subtree, checked children sinking to the bottom of each group); `done`
 * holds checked top-level items and their subtrees.
 */
export function layout(items) {
  const active = [];
  const done = [];
  const walk = (list, depth, out) => {
    for (const item of displayOrder(list)) {
      out.push({ item, depth });
      walk(item.children, depth + 1, out);
    }
  };
  for (const item of displayOrder(items)) {
    const out = item.checked ? done : active;
    out.push({ item, depth: 0 });
    walk(item.children, 1, out);
  }
  return { active, done };
}

/** Flat list of unchecked rows in display order, skipping the subtree of `excludeId`. */
export function activeRows(items, excludeId = null) {
  const out = [];
  const walk = (list, depth, parentId) => {
    for (const item of list) {
      if (item.checked || item.id === excludeId) continue;
      out.push({ id: item.id, depth, parentId });
      walk(item.children, depth + 1, item.id);
    }
  };
  walk(items, 0, null);
  return out;
}

export function setChecked(items, id, checked) {
  const path = pathTo(items, id);
  if (!path) return false;
  const item = path[path.length - 1];
  item.checked = checked;
  item.auto = false;
  if (checked) {
    const cascade = (node) => {
      for (const child of node.children) {
        if (!child.checked) {
          child.checked = true;
          child.auto = true;
        }
        cascade(child);
      }
    };
    cascade(item);
  } else {
    // Restore children that were only checked because this item was.
    const restore = (node) => {
      for (const child of node.children) {
        if (child.checked && child.auto) {
          child.checked = false;
          child.auto = false;
          restore(child);
        }
      }
    };
    restore(item);
    for (const ancestor of path.slice(0, -1)) {
      ancestor.checked = false;
      ancestor.auto = false;
    }
  }
  return true;
}

export function uncheckAll(items) {
  for (const item of items) {
    item.checked = false;
    item.auto = false;
    uncheckAll(item.children);
  }
}

/** Remove every item matching `pred` (with its subtree). Returns the number removed. */
export function removeWhere(items, pred) {
  let removed = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) {
      items.splice(i, 1);
      removed++;
    } else {
      removed += removeWhere(items[i].children, pred);
    }
  }
  return removed;
}

export function removeItem(items, id) {
  const loc = locate(items, id);
  if (!loc) return null;
  loc.siblings.splice(loc.index, 1);
  return loc.item;
}

/** Insert `nodes` right after the item `refId`, as its siblings. */
export function insertAfter(items, refId, ...nodes) {
  const loc = locate(items, refId);
  if (!loc) return false;
  loc.siblings.splice(loc.index + 1, 0, ...nodes);
  return true;
}

/** Make the item the last child of the previous sibling in the same section. */
export function indent(items, id) {
  const loc = locate(items, id);
  if (!loc) return false;
  let p = loc.index - 1;
  while (p >= 0 && loc.siblings[p].checked !== loc.item.checked) p--;
  if (p < 0) return false;
  loc.siblings.splice(loc.index, 1);
  loc.siblings[p].children.push(loc.item);
  return true;
}

/**
 * Make the item the next sibling of its parent. Like in a text editor, it
 * keeps its place on screen: the siblings that followed it become its children.
 */
export function outdent(items, id) {
  const loc = locate(items, id);
  if (!loc || !loc.parent) return false;
  const parentLoc = locate(items, loc.parent.id);
  const following = loc.siblings.splice(loc.index).slice(1);
  loc.item.children.push(...following);
  parentLoc.siblings.splice(parentLoc.index + 1, 0, loc.item);
  // A checked item that adopted unchecked children must become unchecked.
  if (loc.item.checked && following.some((n) => !n.checked)) loc.item.checked = loc.item.auto = false;
  return true;
}

/**
 * Move the item (with its subtree) one step up (dir < 0) or down (dir > 0)
 * past the neighbouring sibling in the same section. At the edge of its group
 * it hops out to sit just before / after its parent.
 */
export function move(items, id, dir) {
  const loc = locate(items, id);
  if (!loc) return false;
  const { siblings, index, item } = loc;
  const sameSection = (n) => n.checked === item.checked;
  if (dir < 0) {
    for (let j = index - 1; j >= 0; j--) {
      if (sameSection(siblings[j])) {
        siblings.splice(index, 1);
        siblings.splice(j, 0, item);
        return true;
      }
    }
  } else {
    for (let j = index + 1; j < siblings.length; j++) {
      if (sameSection(siblings[j])) {
        siblings.splice(index, 1);
        siblings.splice(j, 0, item);
        return true;
      }
    }
  }
  if (!loc.parent) return false;
  const parentLoc = locate(items, loc.parent.id);
  siblings.splice(index, 1);
  parentLoc.siblings.splice(dir < 0 ? parentLoc.index : parentLoc.index + 1, 0, item);
  return true;
}

/**
 * Work out where a dragged item lands. `rows` is activeRows() without the
 * dragged subtree, `index` the insertion point in it, `wantDepth` the depth the
 * pointer suggests. Returns { depth, parentId, afterId } (afterId null = first child).
 */
export function projectDrop(rows, index, wantDepth) {
  const prev = rows[index - 1];
  const next = rows[index];
  if (!prev) return { depth: 0, parentId: null, afterId: null };
  const max = prev.depth + 1;
  const min = next ? next.depth : 0;
  const depth = Math.max(min, Math.min(max, wantDepth));
  if (depth === prev.depth + 1) return { depth, parentId: prev.id, afterId: null };
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].depth === depth) return { depth, parentId: rows[i].parentId, afterId: rows[i].id };
  }
  return { depth: 0, parentId: null, afterId: null };
}

export function moveTo(items, id, { parentId, afterId }) {
  if (parentId && pathTo(items, parentId)?.some((n) => n.id === id)) return false;
  const item = removeItem(items, id);
  if (!item) return false;
  const list = parentId ? locate(items, parentId).item.children : items;
  const at = afterId ? list.findIndex((n) => n.id === afterId) + 1 : 0;
  list.splice(at, 0, item);
  return true;
}

export function counts(items) {
  let total = 0;
  let done = 0;
  const walk = (list) => {
    for (const item of list) {
      total++;
      if (item.checked) done++;
      walk(item.children);
    }
  };
  walk(items);
  return { total, done };
}

/** Fill in missing fields and enforce the "checked parent ⇒ checked children" invariant. */
export function normalize(items, parentChecked = false) {
  for (const item of items) {
    item.id ||= uid();
    item.text = String(item.text ?? '');
    item.checked = !!item.checked;
    item.auto = !!item.auto;
    item.children = Array.isArray(item.children) ? item.children : [];
    if (parentChecked && !item.checked) {
      item.checked = true;
      item.auto = true;
    }
    normalize(item.children, item.checked);
  }
  return items;
}

/**
 * Parse pasted text into { text, depth, checked } lines. Understands
 * indentation, bullets ("-", "*", "•", "1.") and Markdown checkboxes ("[x]").
 */
export function parseLines(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  const indents = lines.map((l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length);
  const levels = [...new Set(indents)].sort((a, b) => a - b);
  return lines.map((line, i) => {
    let body = line.trim();
    const bullet = body.match(/^(?:[-*+•]|\d+[.)])\s+/);
    if (bullet) body = body.slice(bullet[0].length);
    const box = body.match(/^\[([ xX])\]\s*/);
    if (box) body = body.slice(box[0].length);
    return { text: body, depth: levels.indexOf(indents[i]), checked: !!box && box[1] !== ' ' };
  });
}

/** Turn parsed lines into a list of item trees. */
export function buildTree(lines) {
  const roots = [];
  const stack = [];
  for (const line of lines) {
    const depth = Math.min(line.depth, stack.length);
    const node = makeItem(line.text, line.checked);
    if (depth === 0) roots.push(node);
    else stack[depth - 1].children.push(node);
    stack.length = depth;
    stack.push(node);
  }
  return normalize(roots);
}
