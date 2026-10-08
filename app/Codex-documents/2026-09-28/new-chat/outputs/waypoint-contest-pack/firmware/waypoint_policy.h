#ifndef WAYPOINT_POLICY_H
#define WAYPOINT_POLICY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
  WAYPOINT_PROFILE_INVALID = 0,
  WAYPOINT_PROFILE_18650_STANDARD,
  WAYPOINT_PROFILE_18650_HIGH_CURRENT,
  WAYPOINT_PROFILE_21700_HC_P45B,
  WAYPOINT_PROFILE_4680_UNVALIDATED,
} waypoint_profile_id_t;

typedef enum {
  WAYPOINT_FAULT_NONE = 0,
  WAYPOINT_FAULT_PROFILE,
  WAYPOINT_FAULT_NTC,
  WAYPOINT_FAULT_UNDERVOLTAGE,
  WAYPOINT_FAULT_OVERTEMP,
} waypoint_fault_t;

typedef struct {
  uint16_t voltage_mv;
  uint16_t current_ma;
} waypoint_pdo_t;

typedef struct {
  waypoint_profile_id_t profile;
  uint16_t source_limit_mw;
  uint16_t charge_limit_ma;
  waypoint_fault_t fault;
  bool charge_allowed;
  bool source_allowed;
  waypoint_pdo_t pdo[4];
  size_t pdo_count;
} waypoint_policy_t;

/*
 * `id_ohms` comes from the keyed cartridge; `ntc_valid` means the ADC reading
 * is inside the documented 10 kΩ NTC range. Temperatures use deci-degrees C.
 */
waypoint_policy_t waypoint_policy_evaluate(uint32_t id_ohms, bool ntc_valid,
                                           uint16_t battery_mv,
                                           int16_t cell_temp_deci_c,
                                           int16_t board_temp_deci_c);

#endif
