// Pointer-based drag & drop for checklist rows. Works with mouse, pen and
// touch. Dragging vertically picks the slot; dragging sideways picks the depth.

import { projectDrop } from './model.js';

const START_DISTANCE = 5;
const EDGE = 64; // px from the scroller edge where auto-scroll kicks in

/**
 * @param {PointerEvent} down   pointerdown on a row's handle
 * @param {object} o
 * @param {HTMLElement} o.row       the row being dragged
 * @param {HTMLElement} o.list      container holding the rows
 * @param {HTMLElement} o.scroller  scrolling ancestor
 * @param {number} o.depth          depth of the dragged item
 * @param {number} o.descendants    number of items carried along
 * @param {() => Array} o.getRows   activeRows() without the dragged subtree
 * @param {(target) => void} o.onDrop
 */
export function beginDrag(down, o) {
  const startX = down.clientX;
  const startY = down.clientY;
  let x = startX;
  let y = startY;
  let started = false;
  let rows, rowEls, ghost, indicator, ghostOffset, target, raf;

  const indentPx = () => parseFloat(getComputedStyle(o.row).getPropertyValue('--indent')) || 28;

  function start() {
    started = true;
    document.activeElement?.blur();
    const rect = o.row.getBoundingClientRect();
    ghostOffset = { x: startX - rect.left, y: startY - rect.top };

    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = `${Math.min(rect.width, 520)}px`;
    const box = document.createElement('span');
    box.className = 'box';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = o.row.querySelector('.text').value || 'Empty item';
    ghost.append(box, label);
    if (o.descendants) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `+${o.descendants}`;
      ghost.append(badge);
    }
    document.body.append(ghost);

    indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    o.list.append(indicator);

    document.documentElement.classList.add('dragging');
    o.row.classList.add('drag-src');
    hideSubtree(true);

    rows = o.getRows();
    rowEls = rows.map((r) => o.list.querySelector(`.row[data-id="${CSS.escape(r.id)}"]`));
    navigator.vibrate?.(8);
    tick();
  }

  // The dragged item's descendants follow it (they're hidden while dragging).
  function hideSubtree(hide) {
    const depth = o.depth;
    let el = o.row.nextElementSibling;
    while (el?.classList.contains('row') && Number(el.dataset.depth) > depth) {
      el.classList.toggle('drag-src', hide);
      el = el.nextElementSibling;
    }
  }

  function update() {
    ghost.style.transform = `translate(${x - ghostOffset.x}px, ${y - ghostOffset.y}px)`;

    const rects = rowEls.map((el) => el.getBoundingClientRect());
    let index = rects.findIndex((r) => y < r.top + r.height / 2);
    if (index === -1) index = rects.length;

    const want = o.depth + Math.round((x - startX) / indentPx());
    target = projectDrop(rows, index, want);

    const listTop = o.list.getBoundingClientRect().top;
    const top = index < rects.length ? rects[index].top : rects.length ? rects[rects.length - 1].bottom : listTop;
    indicator.style.top = `${top - listTop}px`;
    indicator.style.left = `${target.depth * indentPx() + 30}px`;
  }

  function tick() {
    const box = o.scroller.getBoundingClientRect();
    const bottom = Math.min(box.bottom, window.visualViewport?.height ?? box.bottom);
    let dy = 0;
    if (y < box.top + EDGE) dy = -Math.ceil((box.top + EDGE - y) / 4);
    else if (y > bottom - EDGE) dy = Math.ceil((y - (bottom - EDGE)) / 4);
    if (dy) o.scroller.scrollTop += Math.max(-24, Math.min(24, dy));
    update();
    raf = requestAnimationFrame(tick);
  }

  function onMove(e) {
    if (e.pointerId !== down.pointerId) return;
    x = e.clientX;
    y = e.clientY;
    if (!started && Math.hypot(x - startX, y - startY) >= START_DISTANCE) start();
    if (started) e.preventDefault();
  }

  function finish(commit) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    if (!started) return;
    cancelAnimationFrame(raf);
    if (commit) update();
    ghost.remove();
    indicator.remove();
    document.documentElement.classList.remove('dragging');
    o.row.classList.remove('drag-src');
    hideSubtree(false);
    if (commit && target) o.onDrop(target);
  }

  const onUp = (e) => e.pointerId === down.pointerId && finish(true);
  const onCancel = (e) => e.pointerId === down.pointerId && finish(false);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };

  down.preventDefault();
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
