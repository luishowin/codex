/* Article view. Reads one document from the film plus its optional art. */

import { esc, num, minutes } from '../util.js';
import { api } from '../api.js';

/* Infobox values come from source wikitext and sometimes carry CSS noise.
   Drop the rule text rather than show a stylesheet inside a table cell. */
function metaRows(meta) {
  const box = meta && meta.infobox;
  if (!box || typeof box !== 'object') return [];
  const rows = [];
  for (const [k, raw] of Object.entries(box)) {
    let v = String(raw == null ? '' : raw)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\.mw-parser-output[^{]*\{[^}]*\}/g, ' ')
      .replace(/\[\s*\d+\s*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!v || v === 'none' || /mw-parser-output/.test(v)) continue;
    rows.push([k, v.length > 90 ? v.slice(0, 88) + '…' : v]);
    if (rows.length >= 7) break;
  }
  return rows;
}

function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`).join('');
}

function table(s, id) {
  const head = (s.headers || []).length
    ? `<thead><tr>${s.headers.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead>`
    : '';
  const body = (s.rows || []).map(row =>
    `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `${s.h ? `<h2 id="s${id}">${esc(s.h)}</h2>` : ''}<table>${head}<tbody>${body}</tbody></table>`;
}

/* Where this page sits in its book. Only shown when the film says it belongs to
   a container with siblings -- on a flat codex there is no "next section". */
function navHTML(d, route) {
  const nav = d.nav;
  if (!nav || nav.total < 2) return '';
  const link = (step, back) => step
    ? `<button class="bn${back ? '' : ' r'}" data-open="${esc(route.codex)}/${step.id}">
         <span>${back ? '← Previous' : 'Next →'}</span><b>${esc(step.title)}</b></button>`
    : `<span class="bn${back ? '' : ' r'} off"></span>`;
  return `<nav class="booknav">
    ${link(nav.prev, true)}
    <span class="bp">${nav.position} of ${num(nav.total)}</span>
    ${link(nav.next, false)}
  </nav>`;
}

export async function mount(el, route, ctx) {
  el.innerHTML = '<div class="art"><p class="loading">Opening…</p></div>';

  let d, art;
  try {
    [d, art] = await Promise.all([
      api.doc(route.codex, route.id),
      api.art(route.codex, route.id),
    ]);
  } catch (e) {
    el.innerHTML = '<div class="art"><p class="loading">That document could not be read. Is the codex still loaded?</p></div>';
    return;
  }
  if (!d || d.error) {
    el.innerHTML = '<div class="art"><p class="loading">Not found in this codex.</p></div>';
    return;
  }

  const sections = d.sections || [];
  const first = sections.find(s => s.t) || {};
  const dup = d.lead && first.t && first.t.slice(0, 60).trim() === d.lead.slice(0, 60).trim();
  const box = metaRows(d.meta);
  const boxHTML = box.length
    ? `<aside class="box"><b>At a glance</b><dl>${box.map(r =>
        `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl></aside>`
    : '';
  const hero = art && art.hero_url
    ? `<figure class="hero"><img src="${esc(art.hero_url)}" alt="${esc(art.subject || '')}"${
        art.width ? ` width="${art.width}"` : ''}${art.height ? ` height="${art.height}"` : ''} decoding="async">
       <figcaption><span class="subj">${esc(art.subject || '')}</span>
         <span>${esc(art.artist || 'Unknown')}</span>
         <span>· ${esc(art.licence || '')}</span>
         ${art.source_url ? `<a href="${esc(art.source_url)}" target="_blank" rel="noreferrer noopener">source</a>` : ''}
       </figcaption></figure>`
    : '';
  const flag = d.image_dependent
    ? `<div class="warnbox">⚠ Some text referred to pictures the source archive could not supply.
        Those sentences are kept verbatim rather than rewritten.</div>`
    : '';

  ctx.state.doc = {
    codex: route.codex, id: route.id, title: d.title,
    sections: sections.map((s, i) => ({ h: s.h, id: `s${i}` })),
    related: (d.related || []).length,
  };
  ctx.afterArticle(d);

  el.innerHTML = `<article class="art${ctx.state.readerFont === 'serif' ? ' serif' : ''}" data-id="${d.id}">
    <div class="src">
      <span>${esc(ctx.codexTitle(route.codex))}</span><span>·</span>
      ${d.context ? `<span>${esc(d.context)}</span><span>·</span>` : ''}
      <span>${minutes(d.word_count)} min read</span><span>·</span>
      <span>${num(d.word_count)} words</span><span>·</span><span>Offline</span>
    </div>
    <h1 id="top">${esc(d.title)}</h1>
    ${boxHTML}
    <p class="lede">${esc(d.lead || '')}</p>
    ${hero}${flag}
    ${sections.map((s, i) => s.k === 'table' ? table(s, i)
      : `${s.h ? `<h2 id="s${i}">${esc(s.h)}</h2>` : ''}${paragraphs(s.t)}`).join('')}
    ${(d.related || []).length ? `<h2 id="s-rel">Related${d.related[0].source === 'similar'
        ? ' <span style="font-weight:400;font-size:12px;color:var(--mute)">(similar)</span>' : ''}</h2>
      <div class="rel">${d.related.map(x => `<button data-open="${esc(route.codex)}/${x.id}">${esc(x.title)}${
        x.context ? ` <span style="color:var(--mute)">· ${esc(x.context)}</span>` : ''}</button>`).join('')}</div>` : ''}
    ${navHTML(d, route)}
    <div class="end"><span>${esc(d.path || 'Local film')}</span><span>Read from a local codex</span></div>
  </article>`;

  ctx.state.scrollTop = 0;
}
