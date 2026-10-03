import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';

// Build a tree from an outline like "a\n  b\n  [x] c", using the text as id.
function tree(outline) {
  const items = M.buildTree(M.parseLines(outline));
  const setIds = (list) => list.forEach((n) => { n.id = n.text; setIds(n.children); });
  setIds(items);
  return items;
}

const shown = (rows) => rows.map((r) => '  '.repeat(r.depth) + (r.item.checked ? '[x] ' : '') + r.item.text);

test('checked items sink to the bottom of their group', () => {
  const items = tree('a\nb\nc\nd');
  M.setChecked(items, 'b', true);
  const { active, done } = M.layout(items);
  assert.deepEqual(shown(active), ['a', 'c', 'd']);
  assert.deepEqual(shown(done), ['[x] b']);
});

test('unchecking returns an item to its original spot', () => {
  const items = tree('a\nb\nc\nd');
  M.setChecked(items, 'b', true);
  M.setChecked(items, 'c', true);
  M.setChecked(items, 'b', false);
  assert.deepEqual(shown(M.layout(items).active), ['a', 'b', 'd']);
  M.setChecked(items, 'c', false);
  assert.deepEqual(shown(M.layout(items).active), ['a', 'b', 'c', 'd']);
});

test('items keep their original spot even after the list is rearranged', () => {
  const items = tree('a\nb\nc\nd');
  M.setChecked(items, 'b', true);
  M.move(items, 'd', -1); // a, d, c  (b hidden between a and c)
  M.setChecked(items, 'b', false);
  assert.deepEqual(shown(M.layout(items).active), ['a', 'b', 'd', 'c']);
});

test('checked children sink within their parent', () => {
  const items = tree('p\n  x\n  y\n  z\nq');
  M.setChecked(items, 'x', true);
  assert.deepEqual(shown(M.layout(items).active), ['p', '  y', '  z', '  [x] x', 'q']);
});

test('checking a parent cascades; unchecking restores only cascaded children', () => {
  const items = tree('p\n  x\n  y\nq');
  M.setChecked(items, 'x', true);
  M.setChecked(items, 'p', true);
  assert.deepEqual(shown(M.layout(items).done), ['[x] p', '  [x] x', '  [x] y']);
  M.setChecked(items, 'p', false);
  assert.deepEqual(shown(M.layout(items).active), ['p', '  y', '  [x] x', 'q']);
});

test('unchecking a child unchecks its ancestors', () => {
  const items = tree('p\n  x\n    deep\nq');
  M.setChecked(items, 'p', true);
  M.setChecked(items, 'deep', false);
  assert.deepEqual(shown(M.layout(items).active), ['p', '  x', '    deep', 'q']);
});

test('indent and outdent', () => {
  const items = tree('a\nb\nc');
  assert.equal(M.indent(items, 'a'), false);
  M.indent(items, 'b');
  M.indent(items, 'c');
  M.indent(items, 'c');
  assert.deepEqual(shown(M.layout(items).active), ['a', '  b', '    c']);
  M.outdent(items, 'c');
  assert.deepEqual(shown(M.layout(items).active), ['a', '  b', '  c']);
  M.outdent(items, 'b');
  assert.deepEqual(shown(M.layout(items).active), ['a', 'b', '  c']);
});

test('outdent keeps the item in place by adopting following siblings', () => {
  const items = tree('p\n  x\n  y\n  z\nq');
  M.outdent(items, 'y');
  assert.deepEqual(shown(M.layout(items).active), ['p', '  x', 'y', '  z', 'q']);
});

test('indent skips over checked siblings', () => {
  const items = tree('a\n[x] b\nc');
  M.indent(items, 'c');
  assert.deepEqual(shown(M.layout(items).active), ['a', '  c']);
});

test('move swaps with siblings and hops out at the edges', () => {
  const items = tree('a\n  x\n  y\nb');
  M.move(items, 'b', -1);
  assert.deepEqual(shown(M.layout(items).active), ['b', 'a', '  x', '  y']);
  M.move(items, 'x', -1);
  assert.deepEqual(shown(M.layout(items).active), ['b', 'x', 'a', '  y']);
  M.move(items, 'y', 1);
  assert.deepEqual(shown(M.layout(items).active), ['b', 'x', 'a', 'y']);
});

test('move skips checked siblings', () => {
  const items = tree('a\n[x] b\nc');
  M.move(items, 'c', -1);
  assert.deepEqual(items.map((n) => n.id), ['c', 'a', 'b']);
});

test('projectDrop clamps depth to valid positions', () => {
  const items = tree('a\n  b\nc\nd');
  const rows = M.activeRows(items, 'd');
  // Between b and c: may be a child of b, sibling of b, or sibling of a.
  assert.deepEqual(M.projectDrop(rows, 2, 9), { depth: 2, parentId: 'b', afterId: null });
  assert.deepEqual(M.projectDrop(rows, 2, 1), { depth: 1, parentId: 'a', afterId: 'b' });
  assert.deepEqual(M.projectDrop(rows, 2, -3), { depth: 0, parentId: null, afterId: 'a' });
  // Between a and b: b is a's child, so the drop must go at least one level in.
  assert.deepEqual(M.projectDrop(rows, 1, 0), { depth: 1, parentId: 'a', afterId: null });
  // Top of the list.
  assert.deepEqual(M.projectDrop(rows, 0, 3), { depth: 0, parentId: null, afterId: null });
});

test('moveTo relocates a subtree and refuses to nest into itself', () => {
  const items = tree('a\n  b\nc');
  assert.equal(M.moveTo(items, 'a', { parentId: 'b', afterId: null }), false);
  M.moveTo(items, 'c', { parentId: 'a', afterId: null });
  assert.deepEqual(shown(M.layout(items).active), ['a', '  c', '  b']);
});

test('dragged items land before hidden checked siblings correctly', () => {
  const items = tree('a\n[x] b\nc\nd');
  const rows = M.activeRows(items, 'd');
  M.moveTo(items, 'd', M.projectDrop(rows, 1, 0)); // between a and c
  assert.deepEqual(shown(M.layout(items).active), ['a', 'd', 'c']);
  M.setChecked(items, 'b', false);
  assert.deepEqual(shown(M.layout(items).active), ['a', 'd', 'b', 'c']);
});

test('parseLines understands bullets, checkboxes and indentation', () => {
  const lines = M.parseLines('- [ ] milk\n    - [x] oat\n* eggs\n\n1. flour');
  assert.deepEqual(lines, [
    { text: 'milk', depth: 0, checked: false },
    { text: 'oat', depth: 1, checked: true },
    { text: 'eggs', depth: 0, checked: false },
    { text: 'flour', depth: 0, checked: false },
  ]);
});

test('removeWhere and counts', () => {
  const items = tree('a\n  [x] b\n[x] c\n  d');
  assert.deepEqual(M.counts(items), { total: 4, done: 3 });
  assert.equal(M.removeWhere(items, (n) => n.checked), 2);
  assert.deepEqual(shown(M.layout(items).active), ['a']);
});
