"""Verify the launcher's hotkeys can actually be claimed on this machine."""
import ctypes
import ctypes.wintypes as wt

MOD_ALT, MOD_CONTROL, MOD_NOREPEAT = 0x0001, 0x0002, 0x4000
VK_SPACE = 0x20
u = ctypes.windll.user32

for name, mods, vk, hid in (("Alt+Space", MOD_ALT, VK_SPACE, 101),
                            ("Ctrl+Alt+Space", MOD_CONTROL | MOD_ALT, VK_SPACE, 102),
                            ("Ctrl+Space", MOD_CONTROL, VK_SPACE, 103)):
    ok = u.RegisterHotKey(None, hid, mods | MOD_NOREPEAT, vk)
    err = ctypes.get_last_error() if not ok else 0
    print(f"  {name:<16} {'OK' if ok else f'FAILED (win32 err {err})'}")
    if ok:
        u.UnregisterHotKey(None, hid)
print("\n(hotkeys released again; this was only a claim test)")
