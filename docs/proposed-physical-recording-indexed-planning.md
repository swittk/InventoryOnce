# Proposed physical recording and scoped planning changes

2026-11-25 — PROPOSAL ONLY. Review the scope before implementation.

- The approved release remains private npm `@inventoryonce/core@0.1.2`, source `9b379a934366d9de3c2cfdd08486329f6f15ebc7`.
- The rejected 0.1.3 source stays on `TRASH/0.1.3`. Do not merge it, transplant its implementation, or consume it. This branch starts from the approved release.
- No source/API/model/version change is approved by opening this draft. Each item below has a distinct decision. No new release without the owner's approval, full TLA+ and executable conformance, independent source review, tests/build and applicable performance checks.

## Why change the core at all?

The released API works for InventoryStory and supports native indexed position, placement and journal readers. It can already publish eligible exact stock events and standalone parent-edge moves. Use those contracts as they are. The app/adapter owns database indexes, projection, cost evidence, publication fences and deployed clinic-data migration. Core owns stock semantics.

Two independent probes against the installed 0.1.2 release demonstrated real limitations, not malformed-input handling. The package's 56 source files matched the sanctioned source byte for byte. A readWorld sentinel was attached after valid fixture setup, so a failure demonstrates dependence on that call rather than a measured latency. The ordinary ShineBright application calls the affected existing operations; these are not invented features.

## P1 — Do not veto physical truth because claims are short

**Correctness; recommend first.** In `src/coordinator.ts` ordinary plans default to ProtectClaims and run assertInventoryReservationsFeasible. The exact and policy facade paths in `src/facade.ts` do not consistently opt into the existing RecordPhysicalTruth policy. The segmented path has additional eligibility/protection checks.

Actual released behavior: a backed transfer with a live claim rejects under Reject and Record; scrap can make a claim short, and a later valid receipt in another room then rejects. The public coordinator with RecordPhysicalTruth commits the latter receipt and retains the shortage. Setting the stock deficit policy to Record alone does not solve this.

Proposal: make the existing ordinary recording operations independent of claim feasibility, at the common recording boundary and the native path. Retain claims and expose their derived shortage. Explicit reserve/allocate/consume/release/expiry keep their own rules. Do not introduce a second claim state machine, a new shortage table, or cancel/reassign claims to make a write succeed. Do not remove unit, identity, physical quantity, exact consumption, authorization, idempotency or atomicity checks. Preserve existing lot-choice ordering where possible; no mandatory preference for held stock just because it is selectable.

Example: stock physically falls from ten to seven while ten units are reserved. Publish seven, keep the reservation at ten, report three short; unrelated receipts continue. A physical negative stock deficit and a reservation shortfall are different facts.

Proof: update ReservationScope and FungibilityPool and every affected modeled transition/invariant. Keep explicit allocation rules and exact reservation consumption protected. Test ordinary exact and policy receipt/issue/transfer/scrap/count/cart operations against affected and unrelated claims, including restart and replay. No global claim scan for a physical-only write.

## P2 — Use the existing FIFO/FEFO planner on affected indexed facts

**Performance; recommend first with P1.** The ordinary issueManyByPolicy/transferManyByPolicy and policy scrap paths enter the whole-world coordinator before a native commit. ShineBright also copies a world into a trial facade to discover clinical allocations. The core's single-request planner takes InventoryWorldState.

Actual release probe: deny readWorld after valid setup. Exact native transfer, segmented positions and indexed journal queries work; policy issue/transfer/scrap fail. Two independent previews against three units each offered two, whereas an atomic batch chooses two for request one and accounts for the remaining one-unit shortfall on request two.

Proposal: reuse the existing core allocation and event-building logic over the complete affected positions/deficit pools, retained item/package definitions, lot and placement facts and only relevant claim inputs, all from one published revision. Plan ordered requests together so successive requests share the effects of earlier picks. Return the existing exact allocation evidence with the one intended event, including stable replay of the original picks. Use existing segmented position/placement/journal reads and publication capabilities first. If a seam is missing, propose one narrow adapter-facing extension to the existing storage contract; do not add another facade, another authority, a collection of root exports, or a generic full-world-shaped trial with omitted facts. No reimplementation of FIFO/FEFO in the application. Intent must remain frozen across asynchronous reads. Publish one atomic event/receipt against the revision and journal fence; stale plans replan, exact retries replay, interrupted publication recovers the frozen plan.

Selection needs current candidate quantities and retained age/expiry, not the history of unrelated products or rooms. Correctness may require the complete affected deficit pool and relevant holds; an arbitrary partial world is not acceptable.

Proof: verify single and batch planner/event/result parity against the reference core, same-pool competition, exact units/packages/lot identities, signed deficits, expiry, same-intent retry, conflicting retry, stale revision, crash and independent-process recovery. Demonstrate actual normal facade/clinical calls with no readWorld, no whole-world clone or hash, and work independent of unrelated 1k/10k/100k rows. Bound reads, writes, bytes, CPU, memory and latency on both MongoDB and SQLite in the real adapter. Do not mistake a pure preview benchmark for production-path verification.

## P3 — Reuse availability logic for the selected physical scope

**Performance; only as needed for P2 and existing stock/lot picker reads.** A released fixture with three physical units and two exact holds must report one unallocated unit. The complete availability report enumerates the claim book and evaluates global feasibility even for a narrow selector. A raw position total does not supply the existing availability information.

Proposal: share the existing physical/expiry/deficit reducer for a selected scope using actual indexed exact holds and the complete applicable deficit pool. Preserve broad and unbacked claims and full feasibility for consumers that explicitly request them. No second allocation model, no invented claims, no copying incomplete data into a complete-world/report type. Prefer an internal or existing adapter-read seam rather than another public top-level API.

Proof: compare exact physical/usable/expired/held/unallocated values to the current reducer, including negative positions and related placement expiry. The indexed selected path must not enumerate unrelated claims or journal history.

## P4 — Store a fixed-size migration commitment

**Performance; recommend as a separate small internal change.** The existing migration planDigest is the serialized normalized fingerprint, not a fixed-size digest. The independent fixture produced 781 bytes for one opening row and 115,357 bytes for 160; the authority row stores it in both sourcePlanDigest and sourceRoot. Ordinary stock authorization reads that row.

Proposal: hash the existing exact normalized binding using the existing SHA-256 machinery. Keep the plan/source provenance and all matching/immutability checks. No changed migration API, authority schema, second target or opening protocol. This is an undeployed core contract; do not add speculative old-digest compatibility. Verify the actual existing external clinic-data migration rather than fabricate production consumers.

Proof: identical normalized source yields identical commitment; all meaningful changed source facts change the commitment; dry-run/apply/retry/fenced adoption retain exact provenance and publication. Demonstrate bounded authority-row payload as opening rows grow. Compile/verify of the explicitly requested migration can still be proportional to the source.

## P5 — Record real transfer/scrap shortfalls without inventing identity

**Correctness; separately approve the semantics before implementing.** Record mode already supports signed unknown issue deficits and exact observed scrap. Released selector-based policy scrap and transfer reject an unwitnessed shortage. Exact Record transfer of four from a known lot with only two recorded assigns all four to that lot and its old FIFO age; an empty exact source fails FIFO preconditions.

Proposal: reuse the existing deficit semantics and event verbs when the user reports an actual movement whose exact source is not fully witnessed. Preserve the two known units with their real lot, units, age and application cost evidence. Record the two unwitnessed units as signed unknown source and unlabelled destination with unknown cost/provenance, within ONE conserved transfer event. For unknown scrap retain the reason and signed deficit, not an invented lot. Do not guess serial IDs, rewrite existing lots, generate fake receipts or split the transfer into independent issue and receipt. Keep exact witnessed operations on their existing paths. If the existing representation is sufficient, use it; propose the smallest extension only for the proven missing case. Do not adopt the rejected transfer metadata encoding or allow unrelated FIFO validation changes.

Proof: agree the exact unknown-identity representation before editing. Update the affected transfer and RecordedDeficit models/refinement, check signed conservation, intact package/vector rules, no fabricated lot/serial/age/cost, replay/correction and atomic crash recovery. Reservation shortfall alone needs no new physical event representation.

## P6 — Make the existing direct contents move use native scoped planning

**Performance; only for the actual existing moveContents operation.** A loaded cart's ordinary parent-edge move is already a native capability and should not change. The separate operation of moving direct stock and immediate children from one location into another enters readWorld; separate stock and child moves lose the atomic operation.

Proposal: share the existing composite planner with the native adapter using the exact direct source rows, immediate child edges, retained definitions, live embodied-child/serial facts and destination ancestry at one revision. Child contents keep their own anchors. No descendant rewrite, new cart model, separate topology authority, or additional root API. Prefer the existing publication boundary.

Proof: compare canonical and native composite effects, exact amounts/package/serial behavior, topology and cycle checks, one atomic event and replay, contention and interrupted publication. Work must scale with actual direct contents/edges rather than unrelated stock or descendants.

## Explicitly not proposed

- Do not add indexed opening/vacancy/authority target interfaces. Use the existing fenced external migration/adoption contracts; explicit migration/proof/rebuild may materialize what that requested operation needs.
- Do not add a trusted exact-count vector API. The released count planner can use complete relevant indexed history, including late events and correction predecessors. The audit's scoped and complete-history controls matched.
- Do not export another correction walker by default. Use the released dependency keys, journal queries and correction planner with complete coherent component evidence. The audit's scoped and complete-history controls matched. If a demonstrated remaining limitation cannot be handled, propose it separately.
- Do not revive 0.1.3, broaden the root API, add new persistence authorities, copy core code into ShineBright, retain undeployed compatibility, or perform unrelated performance fishing.

## Decision and gates

P1 and P2 are the immediate correctness/performance proposals. P3 is their narrow read companion, P4 is independently valuable, P5 needs agreement on the exact unknown-source representation, and P6 is confined to the already supported composite command. Owner may accept/reject each independently. Implementation should use the smallest coherent set; no new core dependency is permitted in ShineBright until a separately approved release.

For any approved change: implement on a fresh sanctioned-source branch, review the full actual delta independently, update all affected TLA+ transition relations and executable refinement rather than merely regenerating assurance inventories, run the complete exact-source conformance suite (`pnpm conformance:full` / `pnpm assurance:implementation:full`), all tests/check/build, documentation checks and applicable representative performance gates. Run fresh full formal verification, not only inherited cache receipts. Record actual logs outside product Git. No version bump, merge or package publication until explicit owner approval of that final verified source and release.

The historical rejected work reported 824 tests and 29 cached TLC results, but lacked a matching complete executable-conformance execution receipt. Its reservation models still excluded newly admitted behavior. It is not release evidence for any proposal above.

## Evidence

Independent necessity audit AgentBoard #1818; released-contract reproductions #1814/#1816; physical truth owner decision #596. Source baseline `9b379a9`, actual pre-expansion consumer `4ebb33302`. The external evidence and executable probes are retained on HPSERVER in AgentDeputy runtime/workers/inventory-013-necessity-audit/runs/01-inventory-013-necessity-audit/ and the two released-package review handoffs. They are diagnostic baseline evidence, not a validation receipt for a new candidate. No runtime code or formal model is changed in this proposal.
