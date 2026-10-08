# WAYPOINT — contest build pack

**One core. Any approved cell.**

This package is the build specification for the WAYPOINT modular, single-cell USB-C PD power core. It is intentionally clear about the boundary between a designed capability and a proven claim:

- The electrical prototype is a **21700 high-current cartridge** using a specified Molicel INR21700-P45B cell.
- 30 W is an *engineering target*, not a published measured result until the validation plan passes.
- 18650 and 4680 files are mechanical cartridge designs until an exact approved cell, current limit, and thermal result are added.
- `HEYPcb-PROMPT.md` is the text to paste into heypcb; it must still be checked against the actual generated schematic and layout before fabrication.

## Contents

- `HEYPcb-PROMPT.md` — build prompt for heypcb.
- `HARDWARE-SPEC.md` — electrical and layout requirements.
- `FIRMWARE-SPEC.md` — behavior, state machine, and profile data.
- `ENCLOSURE-SPEC.md` — cartridge and case requirements.
- `BOM.md` — initial part selections and sourcing checkpoints.
- `TEST-PLAN.md` — bring-up gates and publishable measurements.
- `assets/` — editable diagrams for the Circuit World card and documentation.

## Licenses

Hardware design files: CERN-OHL-S-2.0. Firmware: MIT. Enclosure files and documentation graphics: CC-BY-SA-4.0.

## Safety boundary

This is a high-current lithium-ion design. Never connect an unknown, damaged, mixed, or loose cell. The keyed cartridge is part of the safety system, not a cosmetic accessory. Do not fabricate, assemble, or present the board as safe until the electrical and thermal validation gates in `TEST-PLAN.md` are passed.
