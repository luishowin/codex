#include "waypoint_policy.h"

#define WAYPOINT_CUTOFF_MV 2800u
#define WAYPOINT_CHARGE_LOW_TEMP_DECI_C 0
#define WAYPOINT_CHARGE_HIGH_TEMP_DECI_C 450
#define WAYPOINT_DISCHARGE_HIGH_TEMP_DECI_C 600
#define WAYPOINT_BOARD_DERATE_DECI_C 650
#define WAYPOINT_BOARD_SHUTDOWN_DECI_C 750

typedef struct {
  waypoint_profile_id_t id;
  uint32_t nominal_id_ohms;
  uint16_t max_source_mw;
  uint16_t charge_ma;
} profile_definition_t;

static const profile_definition_t k_profiles[] = {
    {WAYPOINT_PROFILE_18650_STANDARD, 2200u, 15000u, 1500u},
    {WAYPOINT_PROFILE_18650_HIGH_CURRENT, 6810u, 20000u, 2000u},
    {WAYPOINT_PROFILE_21700_HC_P45B, 15000u, 30000u, 3000u},
    /* 4680 is mechanically supported, electrically disabled until verified. */
    {WAYPOINT_PROFILE_4680_UNVALIDATED, 33200u, 0u, 0u},
};

static bool id_matches(uint32_t actual, uint32_t nominal) {
  /* 2% resistor plus ADC and connector tolerance. */
  const uint32_t tolerance = nominal / 10u;
  return actual >= nominal - tolerance && actual <= nominal + tolerance;
}

static const profile_definition_t *find_profile(uint32_t id_ohms) {
  for (size_t i = 0; i < sizeof(k_profiles) / sizeof(k_profiles[0]); ++i) {
    if (id_matches(id_ohms, k_profiles[i].nominal_id_ohms)) return &k_profiles[i];
  }
  return NULL;
}

static void add_pdo(waypoint_policy_t *policy, uint16_t mv) {
  if (policy->pdo_count >= sizeof(policy->pdo) / sizeof(policy->pdo[0])) return;
  uint32_t ma = ((uint32_t)policy->source_limit_mw * 1000u) / mv;
  ma = (ma / 100u) * 100u;  /* conservative 100 mA resolution */
  if (ma < 500u) return;
  if (ma > 3000u) ma = 3000u;
  policy->pdo[policy->pdo_count++] = (waypoint_pdo_t){mv, (uint16_t)ma};
}

waypoint_policy_t waypoint_policy_evaluate(uint32_t id_ohms, bool ntc_valid,
                                           uint16_t battery_mv,
                                           int16_t cell_temp_deci_c,
                                           int16_t board_temp_deci_c) {
  waypoint_policy_t policy = {0};
  const profile_definition_t *profile = find_profile(id_ohms);
  if (!profile) {
    policy.fault = WAYPOINT_FAULT_PROFILE;
    return policy;
  }
  policy.profile = profile->id;
  if (profile->max_source_mw == 0u) {
    /* Recognised mechanical format, but no electrical approval exists yet. */
    policy.fault = WAYPOINT_FAULT_PROFILE;
    return policy;
  }
  if (!ntc_valid) {
    policy.fault = WAYPOINT_FAULT_NTC;
    return policy;
  }
  if (battery_mv < WAYPOINT_CUTOFF_MV) {
    policy.fault = WAYPOINT_FAULT_UNDERVOLTAGE;
    return policy;
  }
  if (cell_temp_deci_c > WAYPOINT_DISCHARGE_HIGH_TEMP_DECI_C ||
      board_temp_deci_c >= WAYPOINT_BOARD_SHUTDOWN_DECI_C) {
    policy.fault = WAYPOINT_FAULT_OVERTEMP;
    return policy;
  }

  policy.source_limit_mw = profile->max_source_mw;
  /* Avoid sustaining 30 W near the low end of a 1S discharge curve. */
  if (battery_mv < 3300u && policy.source_limit_mw > 20000u) policy.source_limit_mw = 20000u;
  if (battery_mv < 3100u && policy.source_limit_mw > 15000u) policy.source_limit_mw = 15000u;
  if (board_temp_deci_c >= WAYPOINT_BOARD_DERATE_DECI_C && policy.source_limit_mw > 15000u)
    policy.source_limit_mw = 15000u;

  policy.charge_allowed = cell_temp_deci_c >= WAYPOINT_CHARGE_LOW_TEMP_DECI_C &&
                          cell_temp_deci_c <= WAYPOINT_CHARGE_HIGH_TEMP_DECI_C &&
                          board_temp_deci_c < WAYPOINT_BOARD_DERATE_DECI_C &&
                          profile->charge_ma > 0u;
  policy.charge_limit_ma = policy.charge_allowed ? profile->charge_ma : 0u;
  policy.source_allowed = policy.source_limit_mw > 0u;
  if (policy.source_allowed) {
    add_pdo(&policy, 5000u);
    add_pdo(&policy, 9000u);
    add_pdo(&policy, 15000u);
    add_pdo(&policy, 20000u);
  }
  return policy;
}
