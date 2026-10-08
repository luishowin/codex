/*
 * WAYPOINT cartridge concept — CC-BY-SA-4.0
 *
 * Select one profile, render, then export an STL. This is a mechanical
 * concept drawing, not a validated safety enclosure. Verify the actual
 * cell, contact carrier, core STEP model, print process, and ventilation
 * before fabrication or inserting a cell.
 */

profile = "21700";  // "18650", "21700", or "4680"
wall = 2.2;
floor = 3.0;
core_x = 38;
core_y = 30;
core_z = 9;
clearance = 0.7;
$fn = 64;

function cell_diameter(p) = p == "18650" ? 18.6 : p == "21700" ? 21.4 : 46.8;
function cell_length(p) = p == "18650" ? 65.4 : p == "21700" ? 70.8 : 80.6;

cell_d = cell_diameter(profile);
cell_l = cell_length(profile);
outer_d = cell_d + 2 * wall;
body_h = cell_l + floor + core_z;

module rounded_block(x, y, z, r) {
  hull() {
    for (ix = [-1, 1]) for (iy = [-1, 1])
      translate([ix * (x / 2 - r), iy * (y / 2 - r), 0]) cylinder(r = r, h = z);
  }
}

module lanyard_loop() {
  difference() {
    translate([0, -(outer_d / 2 + 5), 7]) rotate([90, 0, 0]) cylinder(r = 7, h = 5, center = true);
    translate([0, -(outer_d / 2 + 5), 7]) rotate([90, 0, 0]) cylinder(r = 3, h = 8, center = true);
  }
}

module cartridge_shell() {
  difference() {
    union() {
      cylinder(d = outer_d, h = body_h - core_z);
      translate([-core_x / 2, -core_y / 2, body_h - core_z])
        rounded_block(core_x, core_y, core_z, 3);
      lanyard_loop();
    }
    /* Cell cavity is intentionally open at the core end for a removable carrier. */
    translate([0, 0, floor]) cylinder(d = cell_d + clearance, h = cell_l + core_z + 1);
    /* Core docking keep-out: refine from the actual exported PCB STEP model. */
    translate([-(core_x - 2 * wall) / 2, -(core_y - 2 * wall) / 2, body_h - core_z - 0.1])
      rounded_block(core_x - 2 * wall, core_y - 2 * wall, core_z + 1, 2);
    /* NTC wire/channel relief; locate after contact-carrier detail exists. */
    translate([cell_d / 2, -2, floor + 8]) rotate([0, 90, 0]) cylinder(d = 2.4, h = wall + 1);
  }
}

cartridge_shell();
