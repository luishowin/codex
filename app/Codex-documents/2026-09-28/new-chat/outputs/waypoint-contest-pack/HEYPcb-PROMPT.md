# Paste into heypcb

Design a compact 4-layer open-hardware PCB named **WAYPOINT**, a modular 1S Li-ion USB-C PD power core for an approved removable 21700 cartridge. The product tagline is: **One core. Any approved cell.**

The first build is a functional 21700 high-current prototype using an approved Molicel INR21700-P45B cell in a keyed 3D-printed cartridge. The architecture must remain electrically compatible with future 18650 and 4680 cartridges through an ID resistor and NTC input, but do not claim that arbitrary cells or all form factors can deliver 30 W.

Use a single USB-C receptacle in dual-role USB-PD mode: it must act as either a sink for charging or a source for powering a device. Do not add a second USB-C port, USB data, Bluetooth, Wi-Fi, wireless charging, display, solar input, or pass-through/UPS mode.

Use a TI TPS25751 USB-C PD controller connected over I2C to a TI BQ25731 1S bidirectional buck-boost charger/OTG controller. Configure the BQ25731 for a 1S Li-ion cell and 3 V to 24 V OTG. Include the required external synchronous MOSFETs, inductor, current-sense resistor(s), input/output capacitors, bootstrap parts, compensation parts, and I2C pull-ups from TI's recommended reference layout. Use the TPS25751 integrated power-path switches and follow TI's USB-C PD reference-design requirements.

Design targets:
- USB-C PD DRP, input or output only; 5 V, 9 V, 15 V, and 20 V fixed PDOs subject to live profile limits.
- Maximum validated target: 30 W output from the 21700 high-current cartridge. Firmware must only advertise PDOs allowed by the installed profile and thermal state.
- Battery-side design current: 15 A peak, 12 A continuous design target. Use duplicated BATT+ and BATT− contacts and wide copper; do not route this current through thin spring contacts.
- 4-layer board, approximately 38 mm × 30 mm maximum. Use 1 oz outer copper, solid internal ground plane, power plane where useful, via stitching, and thermal vias under power components.
- USB-C connector: USB 2.0 pins unconnected; connect CC1/CC2 and all required VBUS/GND pins only. Include a 24 V-rated VBUS TVS, low-capacitance CC ESD protection, VBUS discharge, and moisture-aware/PD protection required by the selected controller.
- Power protections: input OVP, VBUS ESD/TVS, charger input current limiting, OTG current limiting, short-circuit response, battery reverse-insertion prevention, cell undervoltage shutdown at 2.8 V nominal with 3.1 V recovery, NTC charge/discharge inhibition, board thermal shutdown, and a hardware-safe default state on MCU reset.

Add a low-power STM32C0-class MCU on the I2C bus. Connect it to a LIS2DW12-class low-power accelerometer with wake-on-motion interrupt, one tactile button, and five daisy-chained 2020/3535 RGBW addressable LEDs behind a diffuser. Add SWD programming pads and accessible test pads for VBUS, SYS, BATT+, BATT−, 3V3, GND, CC1, CC2, I2C, NTC, ID, and the LED data line.

Cartridge connector/pads must include: BATT+ A, BATT+ B, BATT− A, BATT− B, NTC, ID, and optional cartridge-present contact. Make it mechanically keyed so a cell cannot be reverse inserted. The core reads a passive ID resistor and a 10 kΩ NTC pressed against the cell. Do not claim automatic chemistry recognition.

Use clear reference designators, net labels, and silkscreen: WAYPOINT, USB-C PD, 1S LI-ION ONLY, cartridge polarity, SWD, test point labels, and a high-current warning. Keep the USB-C/PD area, power stage, MCU/LED area, and cartridge interface physically separated. Return a schematic, board layout, DRC report, fabrication files, a BOM with manufacturer part numbers, and a STEP model.

Before treating the output as fabrication-ready, explicitly flag any missing TI-recommended component values, thermal concerns, connector current-rating issues, USB-PD policy configuration gaps, creepage/clearance failures, or unavailable parts.
