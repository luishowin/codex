const main = document.querySelector("main");
const params = Object.fromEntries(new URLSearchParams(location.search));
const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const href = (args) => "/reader?" + new URLSearchParams(args);
const link = (args, label) =>
  `<a href="${escape(href(args))}">${escape(label)}</a>`;
const safeURL = (value) => (/^https?:\/\//i.test(value || "") ? value : "");
const storage = "codex.reader.";
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(storage + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(storage + key, JSON.stringify(value));
    return true;
  } catch {
    announce("This browser could not save to local storage.");
    return false;
  }
}
let timer;
function announce(text) {
  $("status").textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => ($("status").textContent = ""), 4500);
}
function pref() {
  const theme = read("theme", "");
  document.documentElement.dataset.theme = theme;
  $("theme").textContent =
    (theme ||
      (matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light")) === "dark"
      ? "Light mode"
      : "Dark mode";
}
$("theme").onclick = () => {
  write("theme", $("theme").textContent === "Dark mode" ? "dark" : "light");
  pref();
};
pref();

async function api(args = {}) {
  const r = await fetch("/api/reader?" + new URLSearchParams(args), {
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "This edition could not be opened.");
  return data;
}
let packs, pack, book, scope, doc, citation;
function card(args, title, detail, label) {
  return `<a class="card" href="${escape(href(args))}"><span class="label">${escape(label)}</span><strong>${escape(title)}</strong><small>${escape(detail)}</small></a>`;
}
function searchForm(label, route) {
  const hidden = Object.entries(route)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`,
    )
    .join("");
  return `<form class="cell search" role="search" action="/reader">${hidden}<input name="q" type="search" aria-label="${label}" placeholder="${label}" value="${escape(params.q || "")}" required><button aria-label="Search" title="Search"><span class="shortcut" aria-hidden="true">/</span><span class="submit-icon" aria-hidden="true">↵</span></button></form>`;
}
function item(row, route) {
  return `<a href="${escape(href({ ...route, path: row.path }))}"><strong>${escape(row.title)}</strong><span class="description">${escape(row.snippet || "")}</span></a>`;
}
function stamp(p, b) {
  return { cassette: p.id, book: b.id, edition: b.edition };
}
function isAvailable(route) {
  return packs.some(
    (p) =>
      p.id === route.cassette &&
      p.books.some((b) => b.id === route.book && b.edition === route.edition),
  );
}
async function library() {
  const last = read("last", null);
  const count = packs.reduce((sum, p) => sum + p.books.length, 0);
  const recent =
    last && isAvailable(last.route)
      ? '<div class="rows"><a href="' +
        escape(href(last.route)) +
        '"><strong>' +
        escape(last.title) +
        '</strong><span class="description">' +
        escape(last.book) +
        "</span></a></div>"
      : '<p class="empty">Your last article will appear here.</p>';
  main.innerHTML = `<div class="hero"><h1>Codex</h1>
    <p class="tagline">Your offline library.</p>
    <p class="meta"><span class="offline">Offline</span> · ${packs.length} cassettes · ${count} books</p></div>
    <nav class="quick" aria-label="Library sections"><a href="#cassettes">Library</a><a href="/reader?desk=1#bookmarks">Bookmarks</a></nav>
    <section><h2>Continue reading</h2>${recent}</section>
    <section id="cassettes"><h2>Cassettes</h2><div class="cards">${packs
      .map((p) =>
        card(
          { cassette: p.id },
          p.title,
          p.books.length + " books",
          "Cassette",
        ),
      )
      .join("")}</div></section>`;
  if (!packs.length)
    main.insertAdjacentHTML(
      "beforeend",
      "<p>No cassettes are inserted. Place a cassette folder in the data directory’s cassettes folder, then reopen the library.</p>",
    );
  if (!params.q) return;
  const section = document.createElement("section");
  main.append(section);
  section.innerHTML = "<h2>Search results</h2>";
  let found = false;
  for (const p of packs) {
    for (const b of p.books) {
      const route = stamp(p, b);
      const data = await api({ ...route, q: params.q });
      if (data.items.length) {
        found = true;
        section.insertAdjacentHTML(
          "beforeend",
          `<h3>${escape(b.title)}</h3><div class="rows">${data.items
            .slice(0, 10)
            .map((r) => item(r, route))
            .join("")}</div>`,
        );
      }
    }
  }
  if (!found)
    section.insertAdjacentHTML("beforeend", "<p>No entry in this library</p>");
}
function cassette() {
  main.innerHTML = `<h1>${escape(pack.title)}</h1><p class="meta">${pack.books.length} books</p><h2>Books</h2><div class="cards">${pack.books
    .map((b) =>
      card(
        stamp(pack, b),
        b.title,
        [b.date, b.count.toLocaleString() + " entries"]
          .filter(Boolean)
          .join(" · "),
        "Book",
      ),
    )
    .join("")}</div>`;
}
async function index() {
  const res = await api({
    ...scope,
    ...(params.q ? { q: params.q } : {}),
    ...(params.letter ? { letter: params.letter } : {}),
    ...(params.after ? { after: params.after } : {}),
    ...(params.start ? { start: params.start } : {}),
  });
  const letters =
    pack.id === "shelf"
      ? '<nav class="letters" aria-label="Index letters">' +
        [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ#"]
          .map((l) => link({ ...scope, letter: l }, l))
          .join("") +
        "</nav>"
      : "";
  const next =
    res.items.length === 100 && !params.q
      ? link(
          {
            ...scope,
            ...(pack.id === "shelf"
              ? { letter: params.letter || "A", after: res.items.at(-1).title }
              : { start: Number(params.start || 0) + 100 }),
          },
          "Next entries →",
        )
      : "";
  main.innerHTML =
    `<h1>${escape(book.title)}</h1><p class="meta">${escape(book.date)} · ${book.count.toLocaleString()} entries</p>` +
    letters +
    (params.q ? "<h2>Search results</h2>" : "<h2>Index</h2>") +
    (res.items.length
      ? '<div class="rows">' +
        res.items.map((r) => item(r, scope)).join("") +
        "</div>"
      : "<p>No entry in this edition</p>") +
    next;
}

const tags = new Set(
  "p h2 h3 h4 h5 h6 ul ol li table caption thead tbody tfoot tr th td em i b strong sup sub blockquote br code pre dl dt dd a cite".split(
    " ",
  ),
);
function rich(node) {
  if (typeof node === "string") return escape(node);
  if (!node || !tags.has(node.tag) || !Array.isArray(node.children)) return "";
  let children = node.children.map(rich).join("");
  let tag = node.tag;
  let attrs = node.anchor ? ' id="src-' + escape(node.anchor) + '"' : "";
  if (tag === "a") {
    if (node.ref)
      attrs += ' href="#src-' + escape(encodeURIComponent(node.ref)) + '"';
    else if (node.url && safeURL(node.url))
      attrs += ' href="' + escape(node.url) + '" rel="noreferrer"';
    else if (node.path)
      attrs += ' href="' + escape(href({ ...scope, path: node.path })) + '"';
    else tag = "span";
  }
  if (tag === "th" || tag === "td") {
    for (const key of ["colspan", "rowspan"])
      if (Number.isInteger(node[key]) && node[key] > 0)
        attrs += " " + key + '="' + node[key] + '"';
    if (/^[\s\d.,+−–°%]+(\s|$)/u.test(children)) attrs += ' class="numeric"';
  }
  if (tag === "br") return "<br>";
  const html = "<" + tag + attrs + ">" + children + "</" + tag + ">";
  return tag === "table"
    ? '<div class="table-wrap" tabindex="0">' + html + "</div>"
    : html;
}
function legacyBody(d) {
  const paras = (t) =>
    String(t || "")
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((p) => "<p>" + escape(p) + "</p>")
      .join("");
  let body = "";
  if (d.lead && !d.sections.some((s) => s.t?.startsWith(d.lead.slice(0, 60))))
    body += paras(d.lead);
  for (const s of d.sections) {
    if (s.h) body += "<h2>" + escape(s.h) + "</h2>";
    if (s.k === "table") {
      const row = (cells, tag) =>
        "<tr>" +
        cells
          .map((c) => "<" + tag + ">" + escape(c) + "</" + tag + ">")
          .join("") +
        "</tr>";
      body +=
        '<div class="table-wrap"><table>' +
        row(s.headers || [], "th") +
        (s.rows || []).map((r) => row(r, "td")).join("") +
        "</table></div>";
    } else body += paras(s.t);
  }
  return body;
}
const articleRoute = () => ({ ...scope, path: doc.path });
function snapshot() {
  return {
    route: articleRoute(),
    title: doc.title,
    source: doc.meta?.source || book.source,
    source_id: doc.meta?.source_id || doc.path,
    book: book.title,
    date: book.date,
  };
}
function routeKey(route) {
  return JSON.stringify([
    route.cassette,
    route.book,
    route.edition,
    route.path,
  ]);
}
function bookmarks() {
  return read("bookmarks", []);
}
function bookmarked() {
  return bookmarks().some(
    (b) => routeKey(b.route) === routeKey(articleRoute()),
  );
}
function saveFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
async function exportArticle(html) {
  const title = doc.title,
    clone = $("page").cloneNode(true);
  for (const a of clone.querySelectorAll("a")) {
    // Preserve external references and local footnotes in standalone exports.
    if (a.getAttribute("href")?.startsWith("/reader"))
      a.replaceWith(...a.childNodes);
  }
  if (html) {
    let embedded = "";
    if (/[\u{12000}-\u{1254F}]/u.test(clone.textContent)) {
      const font = await fetch(
        "/static/reader/fonts/NotoSansCuneiform-Regular.ttf",
      );
      if (!font.ok)
        throw new Error("The offline glyph font could not be exported.");
      const licence = await fetch("/static/reader/fonts/Cuneiform-LICENSE.txt");
      if (!licence.ok)
        throw new Error("The embedded font license could not be read.");
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Embedded font license";
      const terms = document.createElement("pre");
      terms.textContent = await licence.text();
      details.append(summary, terms);
      clone.append(details);
      const reader = new FileReader();
      const data = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        font.blob().then((b) => reader.readAsDataURL(b), reject);
      });
      embedded =
        "@font-face{font-family:Signs;src:url(" +
        data +
        ");unicode-range:U+12000-1254F}";
    }
    saveFile(
      title + ".html",
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
        escape(title) +
        "</title><style>" +
        embedded +
        "body{max-width:65ch;margin:3em auto;padding:0 1em;font:19px/1.55 Georgia,Signs,serif}table{border-collapse:collapse}th,td{border:1px solid #999;padding:.3em}.table-wrap{overflow:auto}</style>" +
        clone.outerHTML +
        "</html>",
      "text/html",
    );
  } else {
    const references = [...clone.querySelectorAll("a")]
      .filter((a) => safeURL(a.getAttribute("href")))
      .map((a) => a.textContent + " · " + a.href);
    const text =
      [$("page").innerText, ...new Set(references)].join("\n") + "\n";
    saveFile(title + ".txt", text, "text/plain;charset=utf-8");
  }
}
function setPosition() {
  const key = "position." + routeKey(articleRoute());
  if (location.hash)
    document
      .getElementById(decodeURIComponent(location.hash.slice(1)))
      ?.scrollIntoView();
  else scrollTo(0, read(key, 0));
  window.addEventListener("pagehide", () => write(key, scrollY));
}
async function article() {
  doc = await api({ ...scope, path: params.path });
  const blocks = doc.sections.find((s) => s.k === "rich")?.blocks;
  const body = blocks ? blocks.map(rich).join("") : legacyBody(doc);
  const credit = doc.meta || {};
  citation = [
    credit.source || book.source,
    book.date,
    "Edition " + book.edition,
    credit.source_id || doc.path,
    credit.licence,
  ]
    .filter(Boolean)
    .join(" · ");
  const sourceUrl = safeURL(credit.url),
    licenseUrl = safeURL(credit.licence_url);
  const foot =
    "<footer>" +
    escape(citation) +
    (sourceUrl
      ? ' · <a href="' + escape(sourceUrl) + '">Source article</a>'
      : "") +
    (licenseUrl ? ' · <a href="' + escape(licenseUrl) + '">License</a>' : "") +
    "</footer>";
  main.innerHTML = `<div class="layout"><aside class="margin">

    <div class="toolbar"><details class="menu"><summary>Article</summary><div>
    <button id="bookmark"></button><button id="html">Export HTML</button><button id="txt">Export plain text</button>
    <button id="print">Print</button><button id="amend">Request an amendment</button></div></details></div><details class="contents"><summary>Contents</summary><div id="toc"></div></details></aside>
    <article id="page"><h1>${escape(doc.title)}</h1><div class="body">${body}</div>${credit.image_note || doc.image_dependent ? '<p class="source-note">The source discusses illustrations. This edition carries the surviving text.</p>' : ""}${foot}</article></div>`;
  document.title = doc.title + " · " + book.title + " · Codex";
  const heads = [...document.querySelectorAll("#page h2,#page h3")];
  $("toc").innerHTML = link(scope, "Book index");
  heads.forEach((el, i) => {
    el.id ||= "section-" + i;
    const a = document.createElement("a");
    a.href = "#" + encodeURIComponent(el.id);
    a.textContent = el.textContent;
    $("toc").append(a);
  });
  document.querySelector(".contents").open = innerWidth > 760;
  const markLabel = () =>
    ($("bookmark").textContent = bookmarked() ? "Remove bookmark" : "Bookmark");
  markLabel();
  $("bookmark").onclick = () => {
    const rest = bookmarks().filter(
      (b) => routeKey(b.route) !== routeKey(articleRoute()),
    );
    if (!bookmarked()) rest.push(snapshot());
    if (write("bookmarks", rest)) {
      markLabel();
      announce("Bookmarks updated.");
    }
  };
  for (const mode of ["html", "txt"])
    $(mode).onclick = () =>
      exportArticle(mode === "html").catch((e) => announce(e.message));
  $("print").onclick = () => window.print();
  let selected = "";
  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    if (
      s &&
      !s.isCollapsed &&
      $("page").contains(s.anchorNode) &&
      $("page").contains(s.focusNode)
    )
      selected = s.toString().slice(0, 10000);
  });
  document
    .querySelector("#page")
    .addEventListener("pointerdown", () => (selected = ""));
  $("amend").onclick = () => {
    $("notecontext").textContent = doc.title + " · " + book.date;
    $("quote").textContent = selected;
    $("notes").showModal();
  };
  $("cancel").onclick = () => $("notes").close();
  $("noteform").onsubmit = (e) => {
    e.preventDefault();
    const field = $("notes").querySelector("textarea");
    if (!field.value.trim()) {
      field.focus();
      return;
    }
    if (
      write("amendments", [
        ...read("amendments", []),
        {
          ...snapshot(),
          quote: selected,
          note: field.value.trim(),
          created: new Date().toISOString(),
        },
      ])
    ) {
      field.value = "";
      $("notes").close();
      announce("Amendment saved in this browser on this computer.");
    }
  };
  write("last", snapshot());
  await document.fonts.ready;
  setPosition();
}
function desk() {
  const notes = read("amendments", []);
  const locationLabel = (entry) =>
    isAvailable(entry.route)
      ? link(entry.route, entry.title)
      : escape(entry.title) + " · Edition unavailable";
  main.innerHTML =
    '<h1>Reading desk</h1><h2 id="bookmarks">Bookmarks</h2>' +
    (bookmarks()
      .map((b) => "<p>" + locationLabel(b) + "</p>")
      .join("") || "<p>No bookmarks yet.</p>") +
    '<h2>Amendment requests</h2><p class="meta">Saved in this browser on this computer.</p>' +
    (notes
      .map(
        (n) =>
          '<section class="note">' +
          locationLabel(n) +
          '<p class="meta">' +
          escape([n.source, n.source_id, n.date, n.route.edition].join(" · ")) +
          "</p><blockquote>" +
          escape(n.quote) +
          "</blockquote><p>" +
          escape(n.note) +
          "</p></section>",
      )
      .join("") || "<p>No amendment requests yet.</p>") +
    (notes.length ? '<button id="exportnotes">Export requests</button>' : "");
  if (notes.length)
    $("exportnotes").onclick = () =>
      saveFile(
        "codex-amendments.json",
        JSON.stringify(notes, null, 2),
        "application/json",
      );
}
$("search-slot").innerHTML = searchForm("Search your library", {});
document.addEventListener("keydown", (event) => {
  if (
    event.key !== "/" ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target.closest("input, textarea, [contenteditable], dialog") ||
    $("notes").open
  )
    return;
  event.preventDefault();
  $("search-slot").querySelector("input[type=search]").focus();
});

async function open() {
  packs = (await api()).cassettes;
  if (params.desk) return desk();
  if (!params.cassette) return library();
  pack = packs.find((p) => p.id === params.cassette);
  if (!pack) throw new Error("This cassette is currently unavailable.");
  $("crumb").innerHTML = link({ cassette: pack.id }, pack.title);
  if (!params.book) return cassette();
  book = pack.books.find((b) => b.id === params.book);
  if (!book || (params.edition && params.edition !== book.edition))
    throw new Error("This edition is currently unavailable.");
  scope = stamp(pack, book);
  $("search-slot").innerHTML = searchForm("Search this book", scope);
  $("crumb").innerHTML += " / " + link(scope, book.title);
  return params.path ? article() : index();
}
open().catch((e) => {
  main.innerHTML =
    "<h1>" +
    escape(e.message) +
    "</h1><p>" +
    (scope ? link(scope, "Book index") + " · " : "") +
    link({}, "Open library") +
    "</p>";
});
