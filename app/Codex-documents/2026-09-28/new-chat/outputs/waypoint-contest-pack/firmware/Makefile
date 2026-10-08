CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -pedantic

test:
	$(CC) $(CFLAGS) waypoint_policy.c test_policy.c -o /tmp/waypoint_policy_test
	/tmp/waypoint_policy_test
