# Initial BOM and sourcing gates

| Block | Candidate | Requirement before order |
| --- | --- | --- |
| USB-PD controller | TI TPS25751 | Confirm DRP firmware image, configuration method, and QFN footprint from TI resources. |
| Buck-boost charger / OTG | TI BQ25731 | Populate only TI-recommended 1S external FET, inductor, shunt, compensation, and capacitor network. |
| MCU | STM32C031C6-class | Confirm flash/RAM, I²C address plan, SWD footprint, and low-power wake support. |
| Accelerometer | ST LIS2DW12 | Confirm wake-on-motion register setup and package availability. |
| LED ring | 5 × 2020/3535 RGBW addressable LEDs | Verify true RGBW capability, quiescent current, package, logic voltage, and thermal derating. |
| USB-C receptacle | 16-pin power-only, board-edge, mechanically anchored receptacle | Verify 3 A rating, VBUS pin parallel path, and exact STEP model. |
| VBUS protection | 24 V standoff TVS + low-capacitance CC ESD array | Confirm clamping voltage, capacitance, and layout parasitics at PD voltages. |
| Cell thermistor | 10 kΩ NTC | Document beta, tolerance, and contact method. |
| Cartridge contacts | Keyed, recessed, parallel high-current contacts | Verify continuous-current derating and insertion-cycle life. |
| Prototype cell | Molicel INR21700-P45B | Source from an authorized seller; inspect date code, insulation ring, and data sheet. |

Do not substitute parts based solely on package compatibility. The selected PD controller, charger, inductor, MOSFETs, shunt, and USB-C protection form a coupled high-power design and need a design review after availability is known.
