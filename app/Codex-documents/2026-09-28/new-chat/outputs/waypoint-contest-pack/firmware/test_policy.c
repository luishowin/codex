#include "waypoint_policy.h"

#include <assert.h>
#include <stdio.h>

int main(void) {
  waypoint_policy_t p = waypoint_policy_evaluate(15000, true, 3700, 250, 300);
  assert(p.profile == WAYPOINT_PROFILE_21700_HC_P45B);
  assert(p.source_limit_mw == 30000);
  assert(p.charge_limit_ma == 3000);
  assert(p.pdo_count == 4 && p.pdo[3].voltage_mv == 20000 && p.pdo[3].current_ma == 1500);

  p = waypoint_policy_evaluate(15000, true, 3200, 250, 300);
  assert(p.source_limit_mw == 20000);

  p = waypoint_policy_evaluate(33200, true, 3700, 250, 300);
  assert(p.profile == WAYPOINT_PROFILE_4680_UNVALIDATED && !p.source_allowed &&
         p.fault == WAYPOINT_FAULT_PROFILE);

  p = waypoint_policy_evaluate(15000, false, 3700, 250, 300);
  assert(p.fault == WAYPOINT_FAULT_NTC);

  p = waypoint_policy_evaluate(15000, true, 2700, 250, 300);
  assert(p.fault == WAYPOINT_FAULT_UNDERVOLTAGE);
  puts("waypoint_policy tests passed");
  return 0;
}
