# Firmware behavior

## Inputs and outputs

Inputs: BQ25731 telemetry and faults; TPS25751 PD status; battery voltage/current; board thermal reading; cartridge ID ADC; cartridge 10 kΩ NTC ADC; LIS2DW12 motion interrupt; button.

Outputs: charger/OTG limits and PD source policy through I²C; five RGBW LED data chain.

## State machine

1. `BOOT_SAFE` — disable OTG and charging until I²C devices, ID, NTC, and cell voltage are valid.
2. `PROFILE_VALIDATE` — classify resistor only within tolerance; reject unknown, absent, or future-unvalidated profiles.
3. `IDLE` — deep sleep; keep charger safety functions active; motion interrupt and button wake the MCU.
4. `SINK_CHARGE` — accept PD input, set charge current to the profile limit, animate amber. At charge complete, display green.
5. `SOURCE_PD` — source only the PDOs permitted by the current profile, cell voltage, current limit, and temperature.
6. `LANTERN` — warm-white LED output, auto-off after 10 minutes; do not enable during a fault.
7. `FAULT` — disable charge/OTG as appropriate, latch a diagnostic code, and show the documented error pattern.

Every state reevaluates ID, NTC, cell voltage, power-stage temperature, and charger/PD faults. A profile swap while powered forces `BOOT_SAFE` before any new PD contract.

## LED language

| Event | LED behavior |
| --- | --- |
| Short button press | 1–5 white segments for 5 seconds, then off |
| Charging | slow amber chase; green transition near full |
| Full | gentle green breathing for 30 seconds, then off |
| Low cell | amber warning; flashing red below cutoff threshold |
| Thermal / current fault | rapid red-white alternation; power disabled |
| Invalid profile or NTC | purple double flash every 4 seconds; no PD output |
| Lantern | all five LEDs warm white, fade off at 10 minutes |

## Safety policy

- Profile-specific limits are conservative firmware limits, not a substitute for hardware protection.
- On MCU brownout, I²C timeout, inaccessible NTC, invalid ID, or accelerometer fault, revert to safe PD/charger configuration.
- No battery percentage precision claim: five segments are a voltage/telemetry-informed indication.
- Store fault cause and maximum observed temperatures in nonvolatile memory for bring-up diagnostics.
