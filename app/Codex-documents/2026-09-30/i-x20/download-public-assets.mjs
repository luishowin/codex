#!/usr/bin/env node
/**
 * Mirrors public, same-origin assets referenced by a webpage.
 * Usage: node download-public-assets.mjs [page-url] [output-directory]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const entry = new URL(process.argv[2] ?? 'https://spacebunny-macos.vercel.app/');
const output = path.resolve(process.argv[3] ?? 'site-mirror');
const seen = new Set();
const queue = [entry.href];

function localPath(url) {
  const pathname = decodeURIComponent(url.pathname);
  const clean = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  return path.join(output, clean.replace(/^\/+/, ''));
}

function urlsIn(text, base, type) {
  const matches = [];
  const add = raw => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return;
    try {
      const url = new URL(raw, base);
      if (url.origin === entry.origin) matches.push(url.href);
    } catch { /* Ignore malformed URLs. */ }
  };

  if (type === 'text/html') {
    for (const match of text.matchAll(/<(?:script|link|img|source)[^>]+(?:src|href)=["']([^"']+)["']/gi)) add(match[1]);
  }
  if (type === 'text/css') {
    for (const match of text.matchAll(/(?:@import\s+(?:url\()?|url\()["']?([^"')\s]+)/gi)) add(match[1]);
  }
  if (/(javascript|json)/.test(type) || /\.m?js(?:$|\?)/.test(base.pathname)) {
    // ES modules, dynamic imports, source maps, and quoted same-origin asset paths.
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|sourceMappingURL=|["'])([^"'\s)]+(?:\.m?js|\.css|\.map|\.json|\.wasm)(?:\?[^"'\s)]*)?)/g)) add(match[1]);
  }
  return matches;
}

while (queue.length) {
  const href = queue.shift();
  const url = new URL(href);
  url.hash = '';
  if (seen.has(url.href)) continue;
  seen.add(url.href);

  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (new URL(response.url).origin !== entry.origin) throw new Error('redirected off origin');

    const bytes = new Uint8Array(await response.arrayBuffer());
    const destination = localPath(url);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    console.log(`saved ${url.pathname} (${bytes.length.toLocaleString()} bytes)`);

    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (/^(text\/html|text\/css|(?:application|text)\/(?:javascript|json))$/.test(type) || /\.m?js(?:$|\?)/.test(url.pathname)) {
      const text = new TextDecoder().decode(bytes);
      for (const next of urlsIn(text, url, type)) if (!seen.has(next)) queue.push(next);
    }
  } catch (error) {
    console.warn(`skipped ${url.href}: ${error.message}`);
  }
}

console.log(`\nDone. ${seen.size} public URL(s) processed into ${output}`);
