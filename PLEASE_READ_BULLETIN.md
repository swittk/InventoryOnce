# PLEASE READ: InventoryOnce coordination bulletin

Before continuing the placement-graph-v2 overhaul, read **BULLETIN.md** and the latest **AGENT_DIARY.md** entry.

There is a new blocking physical invariant in BULLETIN.md: **partial stock may be intentionally taken out of its current placement with no next placement known yet, while remaining conserved inventory**. Current node-level `placement.unplace()` does not cover that case.

Do not finalize the mandatory-placement model, formal model, or public API until this is addressed. Current owner direction: do this work directly; do not delegate to Codex or subagents.

During substantial work:
- check BULLETIN.md when resuming,
- append decisions/progress/new owner direction to BULLETIN.md,
- check it again before commit/finalization.
