# Change — T069 AUDIT-FIX lane B

Close the red repo-wide feature-policy gate, the flow-gate fail-closed parity hole and eight
smaller publication / test / merge-hygiene findings on the lane-B F3+F4 surface.

Scope: `packages/core/src/modules/delivery_os/{commands,lib,api,__integration__}` only. No migration,
no shared-registry reorder, no change to the frozen v1 refusal bodies.
