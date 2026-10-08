/* Codex site: behavior. All data comes from corpora.js (generated from the
   real DBs). Everything works from file:// except live search, which needs
   serve.py (and says so). */
(function () {
  "use strict";
  var D = window.CODEX_DATA || null;

  /* ---------- helpers ---------- */
  function fmtInt(n) { return n.toLocaleString("en-US"); }
  function fmtBytes(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
    if (b >= 1e6) return (b / 1e6).toFixed(0) + " MB";
    return (b / 1e3).toFixed(0) + " KB";
  }
  function fmtWords(w) {
    if (w >= 1e9) return (w / 1e9).toFixed(2) + " B words";
    if (w >= 1e6) return (w / 1e6).toFixed(1) + " M words";
    return (w / 1e3).toFixed(0) + " k words";
  }

  /* ---------- header scroll state ---------- */
  var header = document.getElementById("site-header");
  window.addEventListener("scroll", function () {
    header.classList.toggle("scrolled", window.scrollY > 24);
  }, { passive: true });

  /* ---------- badge + footer data ---------- */
  if (D) {
    var gb = (D.totals.bytes / 1e9).toFixed(1);
    document.getElementById("badge-label").textContent =
      D.corpora.length + " corpora · " + fmtInt(D.totals.docs) +
      " documents · " + gb + " GB";
    document.getElementById("gen-date").textContent = D.generated;
  }

  /* ---------- hero entrance (3D stagger) ---------- */
  var title = document.getElementById("hero-title");
  var words = title.querySelectorAll(".w");
  words.forEach(function (w, i) {
    w.style.transitionDelay = (i * 45) + "ms";
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { title.classList.add("entered"); });
  });

  /* ---------- rotating word ---------- */
  var WORD_LIST = ["study", "build", "repair", "treat", "prepare",
                   "research", "learn", "explore", "write", "teach"];
  var wordEl = title.querySelector(".word");
  var wi = 0;
  setInterval(function () {
    wordEl.style.opacity = "0";
    wordEl.style.transform = "translateY(6px)";
    setTimeout(function () {
      wi = (wi + 1) % WORD_LIST.length;
      wordEl.textContent = WORD_LIST[wi];
      wordEl.style.transform = "none";
      wordEl.style.opacity = "1";
    }, 150);
  }, 1800);

  /* ---------- stat counters ---------- */
  function animateCount(el) {
    var target = parseFloat(el.dataset.count);
    var fmt = el.dataset.format;
    var start = null;
    function tick(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / 1100, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = target * eased;
      el.textContent = fmt === "dec" ? String(parseFloat(v.toFixed(2))) : fmtInt(Math.round(v));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = fmt === "dec" ? String(target) : fmtInt(target);
    }
    requestAnimationFrame(tick);
  }
  var countersDone = false;
  var statObserver = new IntersectionObserver(function (entries) {
    if (countersDone) return;
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        countersDone = true;
        document.querySelectorAll(".stat-num").forEach(animateCount);
        statObserver.disconnect();
      }
    });
  }, { threshold: 0.4 });
  var statsEl = document.querySelector(".stats");
  if (statsEl) statObserver.observe(statsEl);

  /* ---------- scroll reveal ---------- */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll("[data-reveal]").forEach(function (el) {
    revealObserver.observe(el);
  });

  /* ---------- bento: corpora cards ---------- */
  var DESCS = {
    "wikipedia": "The full English Wikipedia: every article, one file.",
    "wikipedia-medicine": "Medical and health articles, curated subset.",
    "wikiversity": "Courses, lessons and learning resources.",
    "ifixit": "Step-by-step repair guides for tens of thousands of devices.",
    "libretexts-med": "Nursing, anatomy and pharmacology textbooks.",
    "medlineplus": "Consumer health encyclopedia from the U.S. NLM.",
    "wikivoyage-europe": "Travel guides for Europe, in English.",
    "wikipedia-climate": "Climate and Earth-science articles.",
    "ready-gov": "Emergency preparedness guidance.",
    "nhs-medicines": "Medicines A-Z: uses, doses, side effects.",
    "mdn": "Web platform documentation: HTML, CSS, JavaScript.",
    "military-medicine": "Field-medicine manuals, OCR'd from PDF page scans.",
    "wikipedia-100": "The essential 100 articles.",
    "art": "Curated Wikimedia imagery, hand-annotated."
  };
  var bento = document.getElementById("bento");
  if (bento && D) {
    var cards = D.corpora.slice();
    cards.push({ name: "art", title: "Art", docs: D.art.docs, bytes: D.art.bytes, adapter: "art" });
    cards.forEach(function (c) {
      var cell = document.createElement("div");
      cell.className = "cell" + (c.name === "wikipedia" || c.name === "art" ? " w6" : "");
      cell.innerHTML =
        '<div class="cell-top">' +
          '<span class="cell-name">' + c.title + "</span>" +
          '<span class="cell-arrow"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        "</div>" +
        '<div class="cell-num">' + fmtInt(c.docs) + "<em>documents</em></div>" +
        '<div class="cell-meta">' + fmtBytes(c.bytes) + " · " +
          (c.words ? fmtWords(c.words) : "curated imagery") + "</div>" +
        '<p class="cell-desc">' + (DESCS[c.name] || "") + "</p>" +
        '<span class="cell-chip">' + c.adapter + "</span>";
      cell.setAttribute("data-reveal", "");
      revealObserver.observe(cell);
      bento.appendChild(cell);
    });
  }

  /* ---------- terminal tabs ---------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function demo(q) {
    var d = D && D.demos ? D.demos[q] : null;
    return d || { codex: "?", ms: 0, rows: [] };
  }

  var TERM_TABS = {
    daemon: function () {
      var d = demo("soldering");
      var rows = d.rows.map(function (r) {
        return '    { "title": "' + esc(r.title).slice(0, 60) + '",\n      "lead": "' + esc(r.lead).slice(0, 60) + '..." }';
      }).join(",\n");
      return [
        '<span class="p">$</span> curl -s 127.0.0.1:8765/api/search?q=soldering&codex=ifixit',
        '{ "query": "soldering", "codex": "ifixit", "ms": ' + d.ms + ',',
        '  "results": [',
        rows,
        '  ] }',
        '<span class="m"># one daemon, every codex. Answers without leaving the machine</span>'
      ].join("\n");
    },
    cli: function () {
      var d = demo("ibuprofen");
      var rows = d.rows.map(function (r, i) {
        return " <span class=\"h\">" + (i + 1) + ". " + esc(r.title) + "</span>\n   " + esc(r.lead).slice(0, 90) + "…";
      }).join("\n");
      return [
        '<span class="p">$</span> python codexctl.py search "ibuprofen" --codex nhs-medicines',
        '<span class="g">matched ' + d.rows.length + " documents in " + d.ms + " ms</span>",
        rows,
        '<span class="m"># prefix the last term: "ibup*". Full-body matches go through the deep tier</span>'
      ].join("\n");
    },
    sql: function () {
      return [
        '<span class="p">$</span> sqlite3 nhs-medicines.codex.db \\',
        '>   "SELECT title, substr(lead,1,110) FROM fts_quick',
        '>    WHERE fts_quick MATCH \'ibuprofen\' ORDER BY rank LIMIT 3;"',
        '<span class="h">Ibuprofen for children</span>-Brand names: Nurofen for Children, Calprofen, Brufen',
        '  | Find out how ibuprofen for children treats pain and inflammation (swelling)',
        '<span class="h">Common questions about ibuprofen for children</span>-Brand names: Nurofen for Children,',
        '  | How does ibuprofen work?',
        '<span class="h">About ibuprofen and codeine</span>-Brand name: Nurofen Plus',
        '  | You can buy ibuprofen and codeine combined as a single medicine from pharmacies.',
        '<span class="m"># FTS5, porter stemming, rank-ordered. The corpus is just SQLite</span>'
      ].join("\n");
    }
  };
  var termBody = document.getElementById("term-body");
  function showTab(name) {
    termBody.innerHTML = TERM_TABS[name]();
    document.querySelectorAll(".term-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === name);
    });
  }
  document.querySelectorAll(".term-tab").forEach(function (t) {
    t.addEventListener("click", function () { showTab(t.dataset.tab); });
  });
  showTab("daemon");

  /* ---------- live search ---------- */
  var form = document.getElementById("search-form");
  var input = document.getElementById("search-input");
  var results = document.getElementById("results");
  var hint = document.getElementById("search-hint");

  function renderResults(data) {
    results.innerHTML = "";
    if (!data.results || !data.results.length) {
      results.innerHTML = '<div class="result"><div class="result-title">No matches in this corpus.</div>' +
        '<div class="result-lead">Try a different term, or drop the corpus filter.</div></div>';
      return;
    }
    var q = document.createElement("p");
    q.className = "result-ms";
    q.style.marginTop = "0";
    q.textContent = data.results.length + " results across " + data.codexes +
      " codex(es) in " + data.ms.toFixed(1) + " ms";
    results.appendChild(q);
    data.results.forEach(function (r) {
      var el = document.createElement("div");
      el.className = "result";
      el.innerHTML =
        '<div class="result-head">' +
          '<span class="result-title">' + esc(r.title) + "</span>" +
          '<span class="result-codex">' + esc(r.codex) + "</span>" +
        "</div>" +
        '<div class="result-lead">' + esc(r.lead || "") + "</div>";
      results.appendChild(el);
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      hint.classList.remove("on");
      hint.textContent = "Searching the corpus…";
      fetch("/api/search?q=" + encodeURIComponent(q))
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        })
        .then(function (data) {
          hint.textContent = "Live: served by serve.py on this machine";
          hint.classList.add("on");
          renderResults(data);
        })
        .catch(function () {
          results.innerHTML = "";
          hint.textContent =
            "Live search needs the tiny local server: python3 serve.py. Everything stays on this machine.";
        });
    });
  }
})();