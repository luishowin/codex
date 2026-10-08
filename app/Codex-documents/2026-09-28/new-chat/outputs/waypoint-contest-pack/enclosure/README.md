# Cartridge source

`waypoint_cartridge.scad` is a configurable first-pass enclosure shell for 18650, 21700, and 4680 form factors. It deliberately omits the high-current contact carrier and latch detail because those must be modelled from the actual contact part and PCB STEP export.

Use `profile = "21700"` for the first build. Print a fit-check with no cell installed before selecting an engineering polymer and adding the contact assembly. Do not treat the generated STL as production-ready or use it with a live cell until the validation checklist is complete.
