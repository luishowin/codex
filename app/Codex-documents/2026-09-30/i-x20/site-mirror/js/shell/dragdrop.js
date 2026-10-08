// Lightweight pointer-based drag and drop shared by Finder and the Desktop.
const zones = new WeakMap();
let active = null;

export function dropZone(node, { accept = () => true, onDrop, hoverClass = 'drop' } = {}) {
  zones.set(node, { accept, onDrop, hoverClass });
  return node;
}
export function isDropZone(node) {
  let cur = node;
  while (cur && cur !== document.body) {
    if (zones.has(cur)) return true;
    cur = cur.parentElement;
  }
  return false;
}
function findZone(x, y, payload) {
  let node = document.elementFromPoint(x, y);
  while (node && node !== document.body) {
    const zone = zones.get(node);
    if (zone && zone.accept(payload)) return { node, zone };
    node = node.parentElement;
  }
  return null;
}

/** Start a drag. Returns a cancel function. */
export function startDrag(event, payload, renderGhost) {
  if (active) return;
  const ghost = renderGhost ? renderGhost(payload) : null;
  if (ghost) document.body.append(ghost);
  let lastZone = null;
  const move = e => {
    if (ghost) {
      ghost.style.left = e.clientX + 12 + 'px';
      ghost.style.top = e.clientY + 10 + 'px';
    }
    const found = findZone(e.clientX, e.clientY, payload);
    if (lastZone && lastZone.node !== found?.node) lastZone.zone.hoverClass && lastZone.node.classList.remove(lastZone.zone.hoverClass);
    if (found) found.node.classList.add(found.zone.hoverClass || 'drop');
    lastZone = found || null;
    active.hover = found || null;
  };
  const up = (e, cancelled = false) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    document.removeEventListener('keydown', cancel, true);
    ghost?.remove();
    if (lastZone) lastZone.node.classList.remove(lastZone.zone.hoverClass || 'drop');
    if (active.hover && !cancelled) {
      const { zone } = active.hover;
      zone.onDrop?.(payload, e);
    }
    active = null;
    document.body.style.cursor = '';
  };
  const cancel = e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    up(e, true);
  };
  active = { payload, hover: null };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  document.addEventListener('keydown', cancel, true);
  document.body.style.cursor = 'copy';
}export const _debug = {
  get active() { return active; },
  findZone: (x, y, payload) => findZone(x, y, payload),
};
