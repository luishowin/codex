/* Small shared helpers. No framework, no build step. */

export const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const num = n => Number(n || 0).toLocaleString();

export const bytes = b => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(b);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 1 ? v.toFixed(2) : v.toFixed(v < 100 ? 1 : 0)} ${u[i]}`;
};

export const minutes = words => Math.max(1, Math.round((words || 0) / 220));

export const date = iso => (iso || '').slice(0, 10) || 'n/a';

export const pretty = name => String(name || '')
  .split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const strip = html => String(html || '')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

/* Highlight query terms inside already-escaped text, never inside tags. */
export function highlight(text, terms) {
  let out = esc(text);
  (terms || []).forEach(t => {
    if (t.length < 2) return;
    out = out.replace(
      new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi'),
      '<mark>$1</mark>');
  });
  return out;
}
