# Electrical specification

## Functional boundary

WAYPOINT is a **1S Li-ion** USB-C PD dual-role power converter. One USB-C port serves one attached partner at a time: it either receives PD input to charge the cell or sources PD output to a device. It is not a two-port UPS.

The first electrical approval applies only to this cartridge:

| Field | Prototype profile |
| --- | --- |
| Profile ID | `21700-HC-P45B` |
| Cell | Molicel INR21700-P45B, one new matched unprotected cell |
| Nominal / full cell voltage | 3.6 V / 4.2 V |
| Charge limit | 3.0 A pending cell-data-sheet and thermal confirmation |
| Converter current design | 12 A continuous, 15 A peak battery-side |
| Initial PD ceiling | 30 W target; publish only after test approval |
| Low-voltage cutout / recovery | 2.8 V / 3.1 V |

No other cell is automatically approved merely because it has an 18650, 21700, or 4680 diameter.

## Architecture

```text
USB-C receptacle → CC / ESD / VBUS TVS → TPS25751 ↔ I²C ↔ STM32C0 MCU
                                 │                    │
                                 └─────────────→ BQ25731 buck-boost charger / OTG
                                                       │
                      BATT+ ×2, BATT− ×2, NTC, ID ← keyed cartridge interface
                                                       │
                            LIS2DW12 interrupt, button, 5 × RGBW LEDs
```

The TPS25751 and BQ25731 are the selected controller pair. Their recommended external power circuit, configuration, compensation, and layout constraints take precedence over this document when the CAD implementation is generated.

## PD policy

- Start in a safe 5 V-only state until cartridge ID, NTC, battery voltage, and board temperature are valid.
- As a source, advertise only fixed PDOs whose output does not exceed the profile and thermal limit: 5 V / 3 A, 9 V / 3 A, 15 V / 2 A, and 20 V / 1.5 A. Remove any PDO that exceeds a reduced live limit.
- As a sink, request only a source capability that respects the current charge limit. Default safely to 5 V if a higher contract is unavailable.
- Do not write “30 W from any 18650/21700/4680” in public materials. Use “up to 30 W with approved high-current cartridges.”

## Cartridge interface

Seven contacts: `BATT+_A`, `BATT+_B`, `BATT-_A`, `BATT-_B`, `NTC`, `ID`, and `PRESENT` (optional but preferred). Power contacts must be rated above the 12 A continuous design target when paralleled and must wipe before signal contacts on insertion. Provide physical polarization and recessed contacts.

The cartridge ID uses a resistor measured by the MCU ADC through a protected divider. Initial accepted values:

| Resistance | Profile | PD ceiling |
| ---: | --- | ---: |
| 2.20 kΩ | 18650-standard, future validation | 15 W |
| 6.81 kΩ | 18650-high-current, future validation | 20 W |
| 15.0 kΩ | 21700-HC-P45B prototype | 30 W target |
| 33.2 kΩ | 4680-high-current, future validation | disabled until validated |

Use a 10 kΩ NTC with the beta value and placement documented in the cartridge drawing. Treat open, short, or out-of-range NTC as a fault.

## Layout and assembly

- 4 layers: outer layers 1 oz copper minimum, solid L2 ground plane, L3 power distribution/return where useful. Board house stack-up must be confirmed before routing.
- Keep the BQ25731 switching loop, MOSFETs, inductor, shunt, and ceramic capacitors compact. Place switching components on one side and honor the TI layout guide.
- Isolate the USB-C/CC region from switch nodes. Keep high-impedance NTC/ID/ADC traces away from the inductor and switching node.
- Place thermal vias under the charger, power MOSFETs, and any TVS with the fab-approved paste-mask strategy.
- Use a connector mechanically anchored to the board edge. Add tooling holes, fiducials, polarity, revision, and panelization rails only as needed by the chosen assembler.
- A 30 W board needs DRC, manufacturer rule check, and review of copper temperature rise before it is called fabrication-ready.
