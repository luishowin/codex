# Enclosure and cartridge specification

## Core and cartridge system

The PCB core fits the top of every cartridge and exposes USB-C, a flush button, and a continuous diffuser window for the five-LED ring. The cartridge owns the cell holder, contact stack, NTC pocket, passive ID resistor, latch, and lanyard loop.

The core should target a 38 mm × 30 mm board envelope. Do not finalise outer dimensions until the selected USB-C connector, cartridge contact system, and board keep-outs are present in the STEP export.

## First printable cartridge: 21700-HC-P45B

- Cell cavity: 21.3 mm diameter clearance by 70.6 mm internal length minimum, with appropriate terminal/insulator allowances.
- Key the cavity and contact carrier to prevent reverse insertion; the cell must not be able to bridge exposed contacts while being installed.
- Use a captive contact carrier with two parallel positive and two parallel negative current paths. Contacts must meet the electrical design current after derating.
- Hold the NTC against the cell’s sidewall with compliant thermal pad or spring pressure; do not use adhesive directly on the cell can.
- Add ventilation features that do not aim a possible vent path toward the user or USB-C port.
- Integrate a 4 mm minimum lanyard hole with a generous fillet and a printed or metal reinforcement option.

## Future shells

Create 18650 and 4680 shells with the same core docking geometry, signal-pin order, diffuser alignment, and latch. Label them mechanically compatible only until an exact cell profile is approved. The 4680 shell is a backpack-loop form factor, not a promise of any particular 4680 cell capability.

## Materials and finish

Prototype in PETG, PA12, or another temperature-tolerant engineering polymer; do not use PLA near the power stage. Use a translucent, heat-tolerant diffuser insert over the LEDs. Keep the external geometry simple: matte black shell, large chamfers, no exposed fasteners on the hero face, clear polarity and cell-safety markings.
