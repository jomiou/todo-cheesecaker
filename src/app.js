import * as M from './model.js';
import { beginDrag } from './drag.js';

const KEY = 'cheesecaker:v1';
const $ = (sel) => document.querySelector(sel);
const el = {
  app: $('#app'),
  noteList: $('#note-list'),
  scroller: $('#scroller'),
  note: $('#note'),
  empty: $('#empty'),
  title: $('#note-title'),
  active: $('#active-list'),
  done: $('#done-list'),
  doneSection: $('#done-section'),
  doneToggle: $('#done-toggle'),
  doneCount: $('#done-count'),
  deleteNote: $('#delete-note'),
  toolbar: $('#item-toolbar'),
  toast: $('#toast'),
  toastText: $('#toast-text'),
  rowTemplate: $('#row-template'),
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const needsAutoSize = !CSS.supports('field-sizing', 'content');

let state = load();
let renderedNoteId = null;
let focusedId = null; // item whose text field has focus; drives the toolbar
let openedFromList = false;

// ---------- Storage ----------

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved?.notes)) {
      saved.notes.forEach((n) => M.normalize(n.items));
      return saved;
    }
  } catch {
    // Unreadable storage: start fresh.
  }
  return seed();
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or quota: keep working in memory.
  }
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => document.hidden && save());

// Another tab changed the notes.
addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue || document.activeElement?.matches('textarea, input')) return;
  state = load();
  route();
});

function seed() {
  const make = (title, lines, minutesAgo) => {
    const t = Date.now() - minutesAgo * 60_000;
    return { id: M.uid(), title, items: M.buildTree(M.parseLines(lines.join('\n'))), createdAt: t, updatedAt: t, doneCollapsed: false };
  };
  const welcome = make('Welcome to Cheesecaker', [
    '- Tick a box and the item sinks to the bottom',
    '- Untick it and it hops back to exactly where it was',
    '- Press Enter for a new item, Tab to nest it',
    '  - Shift+Tab (or Backspace at the start) un-nests',
    '  - Nest as deep as you like',
    '- Drag the ⠿ handle to rearrange, sideways to nest',
    '- On a phone, use the toolbar that appears while editing',
    '- [x] Paste a list from anywhere: bullets and [x] boxes are understood',
  ], 0);
  const cheesecake = make('Cheesecake', [
    '- Base',
    '  - [x] Digestive biscuits',
    '  - Butter',
    '- Filling',
    '  - Cream cheese',
    '  - Sugar',
    '  - Eggs',
    '  - Vanilla',
    '- Topping',
    '  - Strawberries',
  ], 5);
  return { notes: [welcome, cheesecake], activeId: welcome.id };
}

// ---------- Helpers ----------

const note = () => state.notes.find((n) => n.id === state.activeId);
const find = (id) => (note() ? M.locate(note().items, id) : null);
const rowId = (node) => node.closest('.row')?.dataset.id;
const visibleIds = () => [...el.note.querySelectorAll('.row')].map((r) => r.dataset.id);
const recent = () => [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function touch() {
  const n = note();
  if (n) n.updatedAt = Date.now();
}

function textField(id) {
  return el.note.querySelector(`.row[data-id="${CSS.escape(id)}"] .text`);
}

function focusItem(id, caret = 'end') {
  const ta = id && textField(id);
  if (!ta) return;
  ta.focus();
  const pos = caret === 'end' ? ta.value.length : Math.min(Number(caret) || 0, ta.value.length);
  ta.setSelectionRange(pos, pos);
}

function caretOf(id) {
  const ta = document.activeElement;
  return ta?.matches?.('.text') && rowId(ta) === id ? ta.selectionStart : 'end';
}

function fit(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

// ---------- Routing ----------
// "#/" shows the note list (mobile), "#/n/<id>" a note. On wide screens both are visible.

function route() {
  const id = location.hash.match(/^#\/n\/(.+)$/)?.[1];
  if (id && state.notes.some((n) => n.id === id)) {
    state.activeId = id;
    el.app.dataset.view = 'note';
  } else {
    el.app.dataset.view = 'list';
    openedFromList = false;
    if (!note()) state.activeId = recent()[0]?.id ?? null;
  }
  render();
}

function go(hash) {
  if (location.hash !== hash) history.pushState(null, '', hash);
  route();
}

function goToList() {
  if (openedFromList) history.back();
  else go('#/');
}

addEventListener('popstate', route);
addEventListener('hashchange', route);

// ---------- Rendering ----------

function render({ animate = false, focus = null } = {}) {
  const before = animate && !reduceMotion.matches ? rowPositions() : null;
  renderSidebar();
  renderNote();
  if (before) flip(before);
  if (focus) focusItem(focus.id, focus.caret);
}

function renderSidebar() {
  el.noteList.replaceChildren(
    ...recent().map((n) => {
      const a = document.createElement('a');
      a.className = 'note-link';
      a.href = `#/n/${n.id}`;
      if (n.id === state.activeId) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
      const title = document.createElement('span');
      title.className = 't';
      title.textContent = n.title.trim() || 'Untitled';
      title.classList.toggle('untitled', !n.title.trim());

      const { total, done } = M.counts(n.items);
      const open = M.layout(n.items).active
        .filter((r) => !r.item.checked && r.item.text.trim())
        .slice(0, 3)
        .map((r) => r.item.text.trim());
      const preview = document.createElement('span');
      preview.className = 'preview';
      preview.textContent = open.join(' · ') || (total ? 'All done' : 'Empty list');

      const meta = document.createElement('span');
      meta.className = 'meta';
      const bar = document.createElement('span');
      bar.className = 'progress';
      const fill = document.createElement('i');
      fill.style.width = `${total ? (done / total) * 100 : 0}%`;
      bar.append(fill);
      meta.append(bar, `${done}/${total}`);

      a.append(title, preview, meta);
      return a;
    }),
  );
}

let sidebarTimer;
function renderSidebarSoon() {
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(renderSidebar, 400);
}

function renderNote() {
  const n = note();
  el.note.hidden = !n;
  el.empty.hidden = !!n;
  el.deleteNote.hidden = !n;
  if (!n) {
    el.active.replaceChildren();
    el.done.replaceChildren();
    renderedNoteId = null;
    return;
  }
  if (renderedNoteId !== n.id || document.activeElement !== el.title) el.title.value = n.title;
  if (renderedNoteId !== n.id) el.scroller.scrollTop = 0;
  renderedNoteId = n.id;

  const { active, done } = M.layout(n.items);
  el.active.replaceChildren(...active.map(rowElement));
  el.doneSection.hidden = done.length === 0;
  el.doneCount.textContent = plural(done.length, 'checked item');
  el.doneToggle.setAttribute('aria-expanded', String(!n.doneCollapsed));
  el.done.replaceChildren(...(n.doneCollapsed ? [] : done.map(rowElement)));
  if (needsAutoSize) el.note.querySelectorAll('.text').forEach(fit);
}

function rowElement({ item, depth }) {
  const row = el.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = item.id;
  row.dataset.depth = depth;
  row.style.setProperty('--depth', depth);
  row.classList.toggle('checked', item.checked);
  row.querySelector('input').checked = item.checked;
  const ta = row.querySelector('.text');
  ta.value = item.text;
  ta.placeholder = 'List item';
  return row;
}

// FLIP: animate rows from where they were to where they are now.
function rowPositions() {
  const map = new Map();
  for (const row of el.note.querySelectorAll('.row')) {
    map.set(row.dataset.id, { x: row.querySelector('.check').getBoundingClientRect().left, y: row.getBoundingClientRect().top });
  }
  return map;
}

function flip(before) {
  const after = rowPositions();
  for (const row of el.note.querySelectorAll('.row')) {
    const a = before.get(row.dataset.id);
    const b = after.get(row.dataset.id);
    if (!a) {
      row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
      continue;
    }
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      row.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 280,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  }
}

// ---------- Mutations ----------

function commit(opts = {}) {
  const n = note();
  if (!n) return;
  M.normalize(n.items);
  touch();
  save();
  render({ animate: true, ...opts });
}

let undoSnapshot = null;
let toastTimer;
function withUndo(message, mutate) {
  undoSnapshot = JSON.stringify(state);
  mutate();
  el.toastText.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 6000);
}
$('#toast-undo').addEventListener('click', () => {
  if (!undoSnapshot) return;
  state = JSON.parse(undoSnapshot);
  undoSnapshot = null;
  el.toast.hidden = true;
  save();
  route();
});

function addItem() {
  const item = M.makeItem();
  note().items.push(item);
  commit({ focus: { id: item.id } });
}

// Keeps focus on whatever row ends up in the toggled/deleted item's place,
// preferring rows in the same state (so you can tick your way down a list).
function focusSlot(slot, checked) {
  if (slot < 0) return;
  const rows = [...el.note.querySelectorAll('.row')];
  const same = rows.slice(slot).find((r) => r.classList.contains('checked') === checked);
  const row = same ?? rows[Math.min(slot, rows.length - 1)];
  focusItem(row?.dataset.id, 'end');
}

function toggle(id, checked, keepFocus) {
  const slot = keepFocus ? visibleIds().indexOf(id) : -1;
  M.setChecked(note().items, id, checked);
  commit();
  focusSlot(slot, !checked);
}

function deleteItem(id, keepFocus) {
  const loc = find(id);
  if (!loc) return;
  const slot = keepFocus ? visibleIds().indexOf(id) : -1;
  const count = M.counts([loc.item]).total;
  withUndo(count > 1 ? `Deleted ${count} items` : 'Item deleted', () => M.removeItem(note().items, id));
  commit();
  focusSlot(slot, loc.item.checked);
}

function runAction(action, id) {
  const items = note().items;
  const caret = caretOf(id);
  const keep = { focus: { id, caret } };
  switch (action) {
    case 'indent':
      M.indent(items, id) ? commit(keep) : focusItem(id, caret);
      break;
    case 'outdent':
      M.outdent(items, id) ? commit(keep) : focusItem(id, caret);
      break;
    case 'up':
    case 'down':
      M.move(items, id, action === 'up' ? -1 : 1) ? commit(keep) : focusItem(id, caret);
      break;
    case 'check':
      toggle(id, !find(id).item.checked, true);
      break;
    case 'delete':
      deleteItem(id, true);
      break;
  }
}

function onEnter(ta, loc) {
  const { item, siblings, index, depth } = loc;
  if (item.checked) {
    ta.blur();
    return;
  }
  // Enter on an empty nested item un-nests it, like in most editors.
  if (!item.text && depth > 0 && !item.children.length) {
    M.outdent(note().items, item.id);
    commit({ focus: { id: item.id } });
    return;
  }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const fresh = M.makeItem();
  if (start === 0 && end === 0 && item.text) {
    siblings.splice(index, 0, fresh); // caret at the start: open a line above
    commit({ focus: { id: item.id, caret: 0 } });
    return;
  }
  fresh.text = item.text.slice(end);
  item.text = item.text.slice(0, start);
  if (item.children.some((c) => !c.checked)) item.children.unshift(fresh);
  else siblings.splice(index + 1, 0, fresh);
  commit({ focus: { id: fresh.id, caret: 0 } });
}

function onBackspace(e, ta, loc) {
  if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return;
  const items = note().items;
  const { item, depth } = loc;
  if (depth > 0) {
    e.preventDefault();
    M.outdent(items, item.id);
    commit({ focus: { id: item.id, caret: 0 } });
    return;
  }
  const ids = visibleIds();
  const prevId = ids[ids.indexOf(item.id) - 1];
  const prev = prevId ? find(prevId).item : null;
  if (!item.text && !item.children.length) {
    e.preventDefault();
    M.removeItem(items, item.id);
    commit();
    if (prevId) focusItem(prevId, 'end');
    else el.title.focus();
    return;
  }
  if (prev && prev.checked === item.checked && !item.children.length) {
    e.preventDefault();
    const caret = prev.text.length;
    prev.text += item.text;
    M.removeItem(items, item.id);
    commit({ focus: { id: prevId, caret } });
  }
}

function onPaste(e, ta, loc) {
  const text = e.clipboardData?.getData('text/plain');
  if (!text || !text.trim().includes('\n')) return;
  e.preventDefault();
  const lines = M.parseLines(text);
  const base = lines[0].depth;
  const [first, ...rest] = M.buildTree(lines.map((l) => ({ ...l, depth: Math.max(0, l.depth - base) })));
  const { item } = loc;
  item.text = item.text.slice(0, ta.selectionStart) + first.text + item.text.slice(ta.selectionEnd);
  item.children.push(...first.children);
  M.insertAfter(note().items, item.id, ...rest);
  let last = rest.at(-1) ?? first.children.at(-1) ?? item;
  while (last.children.length) last = last.children.at(-1);
  commit({ focus: { id: last.id } });
}

function newNote() {
  const now = Date.now();
  const n = { id: M.uid(), title: '', items: [M.makeItem()], createdAt: now, updatedAt: now, doneCollapsed: false };
  state.notes.push(n);
  save();
  openedFromList = el.app.dataset.view === 'list';
  go(`#/n/${n.id}`);
  el.title.focus();
}

// ---------- Events: notes ----------

el.noteList.addEventListener('click', (e) => {
  const link = e.target.closest('.note-link');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  openedFromList = el.app.dataset.view === 'list' || openedFromList;
  go(link.getAttribute('href'));
});

$('#new-note').addEventListener('click', newNote);
$('#new-note-fab').addEventListener('click', newNote);
$('#empty-new').addEventListener('click', newNote);
$('#back').addEventListener('click', goToList);

el.deleteNote.addEventListener('click', () => {
  const n = note();
  if (!n) return;
  withUndo(`Deleted “${n.title.trim() || 'Untitled'}”`, () => {
    state.notes = state.notes.filter((x) => x !== n);
    state.activeId = recent()[0]?.id ?? null;
  });
  save();
  if (el.app.dataset.view === 'note') goToList();
  else render();
});

el.title.addEventListener('input', () => {
  note().title = el.title.value;
  touch();
  saveSoon();
  renderSidebarSoon();
});

el.title.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const first = el.active.querySelector('.text');
  if (first) first.focus();
  else if (e.key === 'Enter') addItem();
});

$('#add-item').addEventListener('click', addItem);

el.doneToggle.addEventListener('click', () => {
  const n = note();
  n.doneCollapsed = !n.doneCollapsed;
  save();
  render();
});

$('#uncheck-all').addEventListener('click', () => {
  M.uncheckAll(note().items);
  commit();
});

$('#clear-done').addEventListener('click', () => {
  const items = note().items;
  const { done } = M.counts(items);
  withUndo(`Deleted ${plural(done, 'checked item')}`, () => M.removeWhere(items, (i) => i.checked));
  commit();
});

// ---------- Events: checklist items ----------

el.note.addEventListener('change', (e) => {
  if (e.target.matches('.check input')) toggle(rowId(e.target), e.target.checked, false);
});

el.note.addEventListener('click', (e) => {
  const del = e.target.closest('.del');
  if (del) deleteItem(rowId(del), false);
});

el.note.addEventListener('input', (e) => {
  const ta = e.target;
  if (!ta.matches('.text')) return;
  const loc = find(rowId(ta));
  if (!loc) return;
  if (ta.value.includes('\n')) ta.value = ta.value.replace(/\n/g, ' '); // e.g. from dictation
  loc.item.text = ta.value;
  if (needsAutoSize) fit(ta);
  touch();
  saveSoon();
  renderSidebarSoon();
});

// Some mobile keyboards skip keydown for Enter; catch the line break here instead.
el.note.addEventListener('beforeinput', (e) => {
  if (!e.target.matches('.text') || !['insertLineBreak', 'insertParagraph'].includes(e.inputType)) return;
  e.preventDefault();
  const loc = find(rowId(e.target));
  if (loc) onEnter(e.target, loc);
});

el.note.addEventListener('paste', (e) => {
  if (!e.target.matches('.text')) return;
  const loc = find(rowId(e.target));
  if (loc) onPaste(e, e.target, loc);
});

el.note.addEventListener('keydown', (e) => {
  const ta = e.target;
  if (!ta.matches('.text') || e.isComposing) return;
  const id = rowId(ta);
  const loc = find(id);
  if (!loc) return;
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (mod) toggle(id, !loc.item.checked, true);
    else onEnter(ta, loc);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    runAction(e.shiftKey ? 'outdent' : 'indent', id);
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    runAction(e.key === 'ArrowUp' ? 'up' : 'down', id);
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !mod) {
    const up = e.key === 'ArrowUp';
    const singleLine = ta.offsetHeight <= parseFloat(getComputedStyle(ta).minHeight) + 1;
    const atEdge = singleLine || (up ? ta.selectionStart === 0 : ta.selectionEnd === ta.value.length);
    if (!atEdge) return;
    const ids = visibleIds();
    const j = ids.indexOf(id) + (up ? -1 : 1);
    if (j >= 0 && j < ids.length) {
      e.preventDefault();
      focusItem(ids[j], ta.selectionStart);
    } else if (j < 0) {
      e.preventDefault();
      el.title.focus();
    }
  } else if (e.key === 'Backspace') {
    onBackspace(e, ta, loc);
  } else if (e.key === 'Escape') {
    ta.blur();
  }
});

// Drag & drop via the ⠿ handle (unchecked items).
el.active.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle || e.button > 0) return;
  const row = handle.closest('.row');
  if (row.classList.contains('checked')) return;
  const id = row.dataset.id;
  const loc = find(id);
  beginDrag(e, {
    row,
    list: el.active,
    scroller: el.scroller,
    depth: loc.depth,
    descendants: M.counts(loc.item.children).total,
    getRows: () => M.activeRows(note().items, id),
    onDrop: (target) => {
      M.moveTo(note().items, id, target);
      commit();
    },
  });
});

// ---------- Item toolbar ----------

let blurTimer;
el.note.addEventListener('focusin', (e) => {
  if (!e.target.matches('.text')) return;
  clearTimeout(blurTimer);
  focusedId = rowId(e.target);
  el.toolbar.hidden = false;
});
el.note.addEventListener('focusout', (e) => {
  if (!e.target.matches('.text')) return;
  clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    if (document.activeElement?.matches?.('.text')) return;
    focusedId = null;
    el.toolbar.hidden = true;
  }, 150);
});

// Don't steal focus from the text field (keeps the phone keyboard open).
el.toolbar.addEventListener('mousedown', (e) => e.preventDefault());
el.toolbar.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (action && focusedId && find(focusedId)) runAction(action, focusedId);
});

// Keep the toolbar and toast above the on-screen keyboard.
const vv = window.visualViewport;
if (vv) {
  const sync = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

if (needsAutoSize) {
  let t;
  addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => el.note.querySelectorAll('.text').forEach(fit), 100);
  });
}

route();
