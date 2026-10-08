#!/usr/bin/env python3
"""Codex launcher - global hotkey overlay for Windows.

    Alt+Space        quick search (title + lead)
    Ctrl+Shift+Space deep search (full body)
    Esc              hide

Those are what this machine actually gets, not what is hardcoded: the
combinations are negotiated at startup from the candidate lists below, because
which ones Windows will hand out varies by machine. Ctrl+Alt+Space is the first
choice for deep search and is already taken here. The launcher prints what it
claimed -- trust that over this docstring.

Hotkeys go through the Win32 RegisterHotKey API via ctypes rather than a
low-level keyboard hook: no administrator rights, no global input interception,
and nothing for antivirus to object to.

RegisterHotKey delivers WM_HOTKEY to the thread that registered it, so the
message pump runs on its own thread and pywebview keeps the main thread, which
it requires on Windows.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from codex.paths import codex_globs as default_codex_globs

MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN = 0x0001, 0x0002, 0x0004, 0x0008
MOD_NOREPEAT = 0x4000
VK_SPACE = 0x20
WM_HOTKEY = 0x0312

HOTKEY_QUICK, HOTKEY_DEEP = 1, 2

user32 = ctypes.WinDLL("user32", use_last_error=True)

# Candidates in preference order. Which combinations are free varies by machine
# -- Ctrl+Alt+Space is taken by an IME or a vendor utility on many Windows
# installs -- so claim the first that registers instead of assuming.
QUICK_CANDIDATES = [
    ("Alt+Space", MOD_ALT, VK_SPACE),
    ("Ctrl+Space", MOD_CONTROL, VK_SPACE),
    ("Ctrl+Shift+Space", MOD_CONTROL | MOD_SHIFT, VK_SPACE),
    ("Win+Space", MOD_WIN, VK_SPACE),
]
DEEP_CANDIDATES = [
    ("Ctrl+Alt+Space", MOD_CONTROL | MOD_ALT, VK_SPACE),
    ("Ctrl+Shift+Space", MOD_CONTROL | MOD_SHIFT, VK_SPACE),
    ("Alt+Shift+Space", MOD_ALT | MOD_SHIFT, VK_SPACE),
    ("Ctrl+Space", MOD_CONTROL, VK_SPACE),
]


def claim(hotkey_id: int, candidates, taken: set[str]) -> str | None:
    """Register the first candidate combination that Windows will give us."""
    for label, mods, vk in candidates:
        if label in taken:
            continue
        if user32.RegisterHotKey(None, hotkey_id, mods | MOD_NOREPEAT, vk):
            taken.add(label)
            return label
    return None


class Api:
    """Exposed to the page as window.pywebview.api."""

    def __init__(self, launcher):
        self._l = launcher

    def hide(self):
        self._l.hide()
        return True


class Launcher:
    def __init__(self, url: str):
        self.url = url
        self.window = None
        self.visible = False

    # -- window ---------------------------------------------------------
    def build(self):
        import webview
        self.window = webview.create_window(
            "Codex", f"{self.url}/?launcher",
            width=880, height=560,
            frameless=True, easy_drag=False,
            on_top=True, hidden=True,
            background_color="#0e1116",
            js_api=Api(self),
        )
        return self.window

    def show(self, deep: bool = False):
        if self.window is None:
            return
        try:
            self.window.show()
            self.visible = True
            # Clear the previous query and focus the box.
            self.window.evaluate_js(
                "(function(){var q=document.getElementById('q');"
                "if(q){q.value='';q.focus();}"
                f"if({str(deep).lower()} !== (document.getElementById('mode')"
                ".textContent==='deep')){{document.getElementById('mode').click();}}"
                "})()")
        except Exception as exc:
            print(f"show failed: {exc}", file=sys.stderr)

    def hide(self):
        if self.window is None:
            return
        try:
            self.window.hide()
            self.visible = False
        except Exception:
            pass

    def toggle(self, deep: bool = False):
        if self.visible:
            self.hide()
        else:
            self.show(deep)

    # -- hotkeys --------------------------------------------------------
    def hotkey_loop(self):
        """Own thread: register the hotkeys and pump messages for them.

        RegisterHotKey delivers WM_HOTKEY to the registering thread's queue, so
        the pump has to live here rather than on the pywebview main thread.
        """
        taken: set[str] = set()
        quick = claim(HOTKEY_QUICK, QUICK_CANDIDATES, taken)
        deep = claim(HOTKEY_DEEP, DEEP_CANDIDATES, taken)

        if quick:
            print(f"hotkey: {quick:<18} quick search")
        else:
            print("!! no quick-search hotkey available", file=sys.stderr)
        if deep:
            print(f"hotkey: {deep:<18} deep search")
        else:
            print("!! no deep-search hotkey available (all candidates taken)",
                  file=sys.stderr)
        if not (quick or deep):
            return

        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            if msg.message == WM_HOTKEY:
                self.toggle(deep=(msg.wParam == HOTKEY_DEEP))
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))


def daemon_alive(url: str, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as r:
            return json.loads(r.read()).get("ok") is True
    except Exception:
        return False


def start_daemon(port: int, codex_globs: list[str]) -> subprocess.Popen | None:
    cmd = [sys.executable, str(HERE / "codexd.py"), "--port", str(port)]
    for g in codex_globs:
        cmd += ["--codex", g]
    print(f"starting daemon: {' '.join(cmd)}")
    return subprocess.Popen(cmd, cwd=str(HERE),
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def main() -> int:
    p = argparse.ArgumentParser(prog="launcher")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--codex", action="append", default=[])
    p.add_argument("--no-spawn", action="store_true",
                   help="fail instead of starting codexd when it is not running")
    args = p.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    proc = None
    if not daemon_alive(url):
        if args.no_spawn:
            print(f"no daemon at {url}", file=sys.stderr)
            return 1
        proc = start_daemon(args.port, args.codex or default_codex_globs())
        for _ in range(60):
            if daemon_alive(url):
                break
            time.sleep(0.25)
        else:
            print("daemon did not come up", file=sys.stderr)
            if proc:
                proc.terminate()
            return 1
    print(f"daemon ready at {url}")

    import webview
    launcher = Launcher(url)
    launcher.build()
    threading.Thread(target=launcher.hotkey_loop, daemon=True).start()
    try:
        webview.start()
    finally:
        if proc:
            proc.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
