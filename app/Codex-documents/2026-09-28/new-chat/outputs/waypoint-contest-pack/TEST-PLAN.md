# Bring-up and validation plan

## Hard gates before any public performance claim

1. Review schematic against TI reference design and every device data sheet; resolve all ERC/DRC/manufacturing findings.
2. Inspect assembled board under magnification; continuity-test VBUS, battery path, ground, CC pins, and switch-node shorts before applying a cell.
3. First power only from a current-limited bench supply emulating a cell. Confirm 3V3, MCU programming, I²C, temperature inputs, and safe-default PD policy.
4. Test USB-C sink contracts at 5 V, 9 V, 15 V, and 20 V with a PD analyzer. Confirm input current and charge current limits.
5. Test source contracts into an electronic load with the 21700 profile: 15 W, 20 W, then 30 W. Record VBUS, battery voltage/current, efficiency, and every monitored temperature at 0, 10, 20, and 30 minutes.
6. Require a defined thermal limit, no connector/contact discoloration, no unexpected PD reset, and stable output before 30 W is called validated.

## Fault and UX tests

- Invalid ID, absent cartridge, NTC open, NTC short, cell undervoltage, reverse insertion attempt, USB VBUS short, output overload, charger input overvoltage, and board thermal threshold.
- Confirm OTG/charge disable behavior and LED error code for every applicable fault.
- Confirm profile swap forces safe state and reduces source PDOs correctly.
- Confirm short press SOC display, long-press lantern, motion wake, 10-minute lantern timeout, and deep-sleep idle consumption.

## Evidence for Circuit World

Publish: checked schematic/layout renders, exploded 21700 cartridge image, PD analyzer captures, 15/20/30 W load table, thermal images or temperature table, the profile-safety explanation, files and licenses. Label all untested power levels as targets, not results.
