# InventoryOnce final convergence authority

This directory is the single integrated assurance authority for PR head `0c94ee9925a0785a883241b2e6ed843e50aeb5ac`.

There are no remaining per-family completion lanes. The final strict public surface is represented by exactly two families:

- `final-v309.json`: all 309 honest strict V rows.
- `final-a121-b58.json`: all 121 A plus 58 B rows.

`final-surface-bindings.json` preserves the 47 genuine external `HARD_RED` rows and their honest-488 reasons. `final-binder-report.json` records the unchanged central binder result: 535 callables, exactly 47 `EXPLICIT_HARD_RED`, zero unexpected diagnostics.

`final-head-transport.json` is the single product moving-target bridge from the last broad currentization source to the current PR product source. `r165-assurance-transport.json` covers the later assurance-only formal-registry maintenance commit and affects exactly one A row (`reclassifyMany`) without changing product source, V membership, formal model membership, mutation tuples, or cfg semantics.

`product-assurance-receipt.json` binds the isolated exact-head package gate: 44/44 Vitest files, 532/532 tests, 10 node selftests, production build, all 27 TLC models, all 11 registered mutation rejections, final conformance report, and `pnpm check`.

`authority-reference-manifest.json` lists only the live top-level inputs that the two final builders re-read and hash. Historical nested references remain embedded provenance and are bridged by the recorded currentization/transport theorems; they are not mistaken for live source inputs.
