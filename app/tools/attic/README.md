# attic

One-off scripts, each written to answer a single question during the V0.1/V0.2
work. They are kept rather than deleted because they are the evidence behind the
*Design decisions* section of the main README — every number quoted there came
out of one of these, and a claim you cannot re-derive is a claim you will
eventually undo by accident.

None of them are maintained. Several target subsystems that no longer exist
(`probe_images.py` and `verify_v01.py` predate the removal of the image
pipeline). Expect them to need edits before they run again.

`test_hotkey.py` lives here for a different reason: it is not a test. It
registers real Win32 hotkeys as a side effect, and its `test_` prefix invited
pytest to collect it.

Anything still in active use stays in `tools/` proper — currently
`calibrate.py`, `gaps.py`, `try_hygiene.py`, `rebuild_deep.py` and `stats.py`.
