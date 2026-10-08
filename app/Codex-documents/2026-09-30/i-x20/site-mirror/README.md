# Space Bunny local mirror

The asset mirror is self-contained: the page, stylesheets, and JavaScript ES modules use relative paths and have been preserved in their original directory layout.

Run it through a local HTTP server (opening `index.html` directly will block module imports in most browsers):

```bash
cd /home/luishowin/Documents/Codex/2026-09-30/i-x20/site-mirror
node server.mjs
```

Then open `http://127.0.0.1:4173`.

Optional external features, such as live weather, map embeds, and Safari browsing, still make requests to their public providers when you use those features.
