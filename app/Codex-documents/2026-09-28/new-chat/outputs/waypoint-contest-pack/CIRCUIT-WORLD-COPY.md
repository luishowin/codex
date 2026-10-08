# Circuit World entry copy

## Title

**WAYPOINT — One Core, Any Approved Cell**

## Short description

WAYPOINT is a compact USB-C PD power core that turns an approved single Li-ion cell into a modular field power tool. Slide the same core into a 18650, 21700, or 4680 cartridge—the cartridge provides the keyed contacts, cell NTC, and an honest power profile. The first prototype is a 21700 high-current build targeting up to 30 W USB-C PD.

## Full description

Most power banks permanently marry the electronics to one battery size. WAYPOINT does the opposite: the power electronics are a reusable core, while the battery holder is a printable, remixed cartridge.

The core has one USB-C PD port that acts as either charging input or device output. It negotiates only the power that the installed cartridge is explicitly approved to provide. That matters because 18650, 21700, and 4680 are form factors—not guarantees about chemistry, capacity, or safe current.

Every cartridge carries an ID resistor and a cell-contact NTC. The core therefore knows whether it is connected to a validated profile, a cold/hot cell, or an unknown cartridge. Five diffused RGBW LEDs show charge, charging, full, low-cell, and fault states; a small motion sensor hides a warm-white lantern mode for the moment you shake it.

The initial build is a 21700 high-current cartridge. Its 30 W ceiling is an engineering target pending load, thermal, and USB-PD validation. 18650 and 4680 cartridges are deliberately presented as mechanical compatibility designs until their specific cell profiles are validated. No mystery-cell claims; no app; no second port; no disposable power-bank shell.

**One core. Any approved cell.**

## Evidence checklist before publishing

- [ ] Checked board render and DRC status
- [ ] Component/BOM availability reviewed
- [ ] 21700 cartridge STEP/render
- [ ] USB-PD analyzer capture
- [ ] 15 W / 20 W / 30 W load and temperature table
- [ ] Complete source files and stated licenses

## Suggested tags

`power` `usb-c` `usb-pd` `battery` `open-hardware` `3d-printing` `portable` `tools`
