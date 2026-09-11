import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

pkg = Path(__file__).resolve().parent.parent
repo = pkg
# Nested pnpm must not inherit CI=true because repository validation semantics require normal pnpm behavior.
child_env = os.environ.copy()
child_env.pop('CI', None)
# Cached discovered public surface reused by all later assurance-expansion steps.
surface = json.loads(
    subprocess.check_output(
        ["pnpm", "exec", "node", "scripts/formal-implementation-surface.cjs"],
        cwd=pkg,
        text=True,
        env=child_env,
    )
)
# Cached compiler call graph reused by later witness and traceability checks.
call_graph = json.loads(
    subprocess.check_output(
        ["pnpm", "exec", "node", "scripts/formal-implementation-callgraph.cjs"],
        cwd=pkg,
        text=True,
        env=child_env,
    )
)
# Build one assurance-family declaration with exact model, behavior, and evidence mappings.
def create_assurance_family(models,invariants,input_mapping,state_projection,result_mapping,retry_relation,rejection_relation,evidence,adapters,status='covered',gaps=()):
 return {'models':models,'invariants':invariants,'inputMapping':input_mapping,'stateProjection':state_projection,'resultMapping':result_mapping,'retryRelation':retry_relation,'rejectionRelation':rejection_relation,'executableEvidence':evidence,'adapterCoverage':adapters,'status':status,'gaps':list(gaps)}
M='test/formal-implementation-refinement.test.ts'; S='test/formal-storage-refinement.test.ts'; C='test/formal-implementation-conformance.test.ts'; D='test/storage-conformance.test.ts'
# Registry of reusable formal-assurance families referenced by every discovered public API.
families={}
families['pure-exact-value']=create_assurance_family(['DualMeasure','PackagingIdentity'],['PrimaryQuantityConserved','SecondaryMeasureHasExplicitCause','PhysicalQuantityConserved'],'Exact decimal/unit/package inputs map directly to finite quantity or measurement tuples.',['abstractInventoryState'],'Pure output is the exact normalized value; no world changes.','No durable identity; equal input produces equal output.','Malformed decimals, unit mismatches, fractional packages, and ambiguous conversions reject before state.',[M,C],['memory'])
families['identity-normalization']=create_assurance_family(['ResourceDimensions','TraceabilityGraph','SnapshotSupersededWorkflow'],['TypeOK','ResourceAccounting','ContainmentIsAcyclic','PublishedRetainsAllDispositions','PublishedWorldMatchesSnapshot','SupersededRowsNeverResume'],'Identity and selector fields map to finite model atoms and exact set constraints.',['abstractInventoryState','abstractTraceabilityState'],'Result is a canonical collision-free identity/selector observation.','Pure helper; retry is ordinary referential equality.','Empty, duplicate, contradictory, or non-canonical identities reject.',[M,C],['memory'])
families['facade-construction']=create_assurance_family(['InventoryOperation'],['TypeOK'],'Catalogue, storage, clock, and deficit policy bind the implementation environment without publishing stock.',['abstractInventoryState'],'Constructed facade exposes checked grouped APIs and an unchanged initial world.','Construction has no durable retry identity.','Unsupported storage guarantees or invalid catalogues reject at their own validators.',[C,M],['memory'],gaps=['GAP-EXTERNAL-CLOCK','GAP-DB-IMPLEMENTATION-UNBOUNDED'])
families['catalog-definition']=create_assurance_family(['CatalogPublication','PackagingIdentity','CompositionRevision','CollectionView','FungibilityPool'],['ActiveIsRetained','PublishedMeaningsNeverChange','RegisteredCompositionVectorsAreExact','ViewMembershipNeverChangesItemIdentity','ClaimsFreezeOneExactRevision'],'Definition fields map to immutable revision IDs, exact vectors, membership sets, and active pointers.',['abstractInventoryState'],'Result is one immutable validated catalogue/revision with deterministic digest.','Pure definition helpers have no durable retry identity.','Redefinition, missing revision, duplicate identity, ambiguous package, or invalid graph rejects.',[M,'test/catalog-stock.test.ts','test/composition.test.ts','test/collections.test.ts','test/fungibility.test.ts'],['memory'],gaps=['GAP-HASH-COLLISION-ASSUMPTION'])
families['catalog-publication']=create_assurance_family(['CatalogPublication','InventoryOperation','PublishedHeadCAS','RepairLiveness'],['PublishedSnapshotsRemainRetained','PublishedMeaningsNeverChange','OnePublicationPerOperation','PartialWritesAreInvisible','ApplyingEventuallyTerminates'],'Published catalogue snapshot and operation identity map to retained meanings and one abstract publication step.',['abstractInventoryState'],'Result maps to published revision, optional catalog event, replay flag, and unchanged physical buckets.','Exact intent replays the same receipt; changed catalogue under the same operation ID rejects.','Stale base, immutable redefinition, missing retained meanings, and changed retry reject.',[M,S,'test/catalog-publication.test.ts','test/catalog-lifecycle.test.ts'],['memory','all-operation-failpoints'],gaps=['GAP-HASH-COLLISION-ASSUMPTION','GAP-DB-IMPLEMENTATION-UNBOUNDED'])
families['composition-read']=create_assurance_family(['CompositionRevision'],['RegisteredCompositionVectorsAreExact','ActivePointerNeverReinterpretsOpenedIntent'],'Revision/source package identities map to one retained composition revision.',['abstractInventoryState'],'Returned definition preserves exact source and component vector identity.','Read is side-effect-free; repeated reads of one snapshot are equal.','Unknown, inactive, or ambiguous source-package lookups reject.',[M,'test/composition.test.ts'],['memory'])
families['composition-open']=create_assurance_family(['CompositionRevision','PackagingIdentity','ReclassificationConservation','DualMeasure','TraceabilityGraph','InventoryOperation'],['SourcePackageConservationPerRevision','ExactComponentProductionFromOpenedRevisions','ComponentPotentialIsConserved','OperationIdentityContributesAtMostOneOpen','PartialWritesStayInvisible'],'Opening ID, source package revision/count, placements, and composition revision map to one atomic consume/produce transition.',['abstractInventoryState','abstractTraceabilityState'],'Result maps to one opening, exact component buckets, genealogy, revision, and replay observation.','Exact opening intent replays once; changed revision/vector/placement under the same ID rejects.','Wrong package revision, non-whole count, conflicting placement, insufficient stock, or invalid genealogy rejects atomically.',[M,'test/composition.test.ts',S],['memory','all-operation-failpoints'])
families['collection-read']=create_assurance_family(['CollectionView'],['ReportsMatchExactPhysicalIdentity','NonMembersNeverAppearInAView','ActivePointerDoesNotRewriteRetainedViews','ViewMembershipNeverChangesItemIdentity','IssuedTokensDisappearOnlyFromTheirExactItemBucket'],'Collection revision and optional scope map to frozen member identities and selector constraints.',['abstractInventoryState'],'Definition/summary preserves member identity and derives exact per-member/roll-up observations only.','Read is side-effect-free and snapshot-stable.','Unknown revisions, invalid cycles, duplicate membership, or incompatible roll-up units reject.',[M,'test/collections.test.ts'],['memory'])
families['fungibility-read']=create_assurance_family(['FungibilityPool','UseByReservation'],['PoolReportMatchesExactPhysicalTruth','ClaimsFreezeOneExactRevision','AllocatedClaimsRemainInEligibleLocations'],'Pool revision, exact basis quantity, scope, method, and eligibility flags map to revision-frozen member candidates.',['abstractInventoryState','abstractReservationState'],'Definition, summary, or plan preserves member identities, basis conversions, sources, shortfall, and expiry exclusions.','Read/plan is side-effect-free and deterministic for one snapshot.','Unknown revision/member, incompatible basis, impossible increment, expired/disallowed, or reservation-blocked input rejects or reports shortfall.',[M,'test/fungibility.test.ts','test/review-hardening.test.ts'],['memory'],gaps=['GAP-FUNGIBILITY-EXACT-SEARCH-BOUND'])
families['fungibility-movement']=create_assurance_family(['FungibilityPool','ReservationScope','ReservationSafety','UseByReservation','InventoryOperation','PublishedHeadCAS'],['PoolViewsConserveActualIssuedTokens','ActiveAllocationsRemainDisjoint','IssuedTokensCannotBackActiveClaims','AllActiveClaimsRemainFeasible','OrdinaryAllocationWasUsable','PartialWritesStayInvisible'],'Frozen pool revision/request/scope/method maps to exact member allocations and one issue/transfer/scrap event.',['abstractInventoryState','abstractReservationState'],'Result maps to exact member lines, pool contribution, event kind, published revision, and replay.','Exact intent replays once; changed pool revision/request/scope/method rejects.','Shortfall, expired stock, package increment mismatch, reservation conflict, or unknown member rejects atomically.',[M,'test/fungibility.test.ts','test/review-hardening.test.ts',S],['memory','all-operation-failpoints'],gaps=['GAP-FUNGIBILITY-EXACT-SEARCH-BOUND'])
families['stock-receipt']=create_assurance_family(['InventoryOperation','PublishedHeadCAS','PackagingIdentity','DualMeasure','ResourceDimensions'],['OnePublicationPerOperation','PartialWritesStayInvisible','PublishedWorldMatchesFrozenPlan','PhysicalQuantityConserved','PrimaryQuantityConserved','ResourceAccounting'],'Destination identity, exact amount/package, lot/container/dimensions, and command header map to additive resource effects.',['abstractInventoryState','abstractOperationResult'],'Result maps to one receipt event, exact effects, published revision, and replay flag.','Exact receipt intent replays once; changed line/order/amount/metadata under the same operation ID rejects.','Invalid amount, package identity, duplicate/conflicting destination, or stale base rejects before visible state.',[M,S,'test/policy-operations.test.ts'],['memory','all-operation-failpoints'])
families['stock-issue']=create_assurance_family(['InventoryOperation','PackagingIdentity','DualMeasure','ReservationSafety','UseByReservation'],['VisibleQuantityConserved','EveryIntact20BoxIsWhole','EveryIntact24BoxIsWhole','NoOverReservation','OrdinaryConsumptionWasUsable'],'Exact source position and amount map to subtractive effects over one immutable resource bucket.',['abstractInventoryState','abstractReservationState','abstractOperationResult'],'Result maps to one issue event, exact decrements, revision, and replay.','Exact issue intent replays once; changed source/amount/context rejects.','Deficit, package mismatch, expired/disallowed stock, or reservation infeasibility rejects atomically.',[M,'test/catalog-stock.test.ts','test/reservations-counts.test.ts',S],['memory','all-operation-failpoints'])
families['stock-policy-issue']=create_assurance_family(['InventoryOperation','ReservationScope','ReservationSafety','UseByReservation','PackagingIdentity','RecordedDeficit','FungibilityPool'],['PartialWritesStayInvisible','AllocatedClaimsRespectScope','AllActiveClaimsRemainFeasible','OrdinaryAllocationWasUsable','ConsumedClaimHasEvidence','SignedNetIsPhysicalMinusDeficit','RecordedDeficitNeverBecomesPhysical','SeenIntentAndResultAreDurable','RejectShortagePreservesTruth','ReplayPreservesTruthAndResult','ChangedIntentRejectsAndStutters'],'Selector/request groups, revision, FIFO/FEFO method, expiry, reservation flags, and configured deficit policy map to exact physical allocation plus either no shortfall or one explicit signed non-allocatable deficit.',['abstractInventoryState','abstractReservationState','abstractOperationResult'],'Result maps request/group identities to exact allocated positions/amounts, optional durable deficit evidence, one published event, and replay identity.','Exact intent replays identical allocations and deficit evidence; changed request order/content/method/deficit position rejects.','Reject mode preserves the old fail-closed shortfall stutter; Record mode records only genuine stock shortfall, while package ambiguity, expiry, allocation constraints, and reservation conflicts still reject atomically.',[M,S,'test/policy-operations.test.ts','test/allocation-results.test.ts','test/storage-conformance-suite.ts'],['memory','all-operation-failpoints'])
families['stock-transfer']=create_assurance_family(['ResourceDimensions','DurableTransferRefinement','InventoryOperation','PackagingIdentity'],['ResourceAccounting','InTransitStillExists','ActiveTokensHaveExactlyOneRealLocation','PartialWritesRefineToStuttering','PhysicalQuantityConserved'],'Exact source, destination location, and amount map to one atomic location rewrite preserving all other dimensions.',['abstractInventoryState','abstractOperationResult'],'Result maps to one transfer event and equal global quantity before/after.','Exact transfer intent replays once; changed destination/source/amount rejects.','Deficit, package mismatch, invalid destination, or stale base rejects atomically.',[M,'test/catalog-stock.test.ts',S],['memory','all-operation-failpoints'])
families['transfer-lifecycle']=create_assurance_family(['TransferLifecycle','ResourceDimensions','ReservationSafety','InventoryOperation','DurableTransferRefinement','PublishedHeadCAS','PackagingIdentity','FungibilityPool'],['TransferQuantityConserved','ReceivedNeverExceedsDispatched','TransferIsolation','PreparedIsUnavailableAtSource','DispatchedIsNotPrepared','BeforeReceiptDestinationIsEmpty','PartialReceiptLeavesTransit','CompletedReceiptLeavesNoTransit','ReleasedReturnsCommitment','IntentNeverChanges','OwnershipIsOrthogonal','TransitCustodyDoesNotChangeOwnership','PartialWritesRefineToStuttering','AllActiveClaimsRemainFeasible','PhysicalQuantityConserved'],'Transfer identity, source/transit/destination, exact lines, custody, receipt quantities, and immutable operation intent map to one time-separated physical transfer lifecycle.',['abstractInventoryState','abstractReservationState','abstractOperationResult'],'Result maps to exact prepared/dispatched/received/remainder state plus immutable stock event and replay truth.','Exact prepare/dispatch/receive/release retry stutters or replays; changed intent under one operation identity rejects.','Insufficient source, existing transfer identity, pre-dispatch receipt, post-dispatch release, over-receipt, cross-transfer receipt, package/line collapse, reservation conflict, or stale publication rejects atomically.',[M,'test/transfer-lifecycle.test.ts',S],['memory','all-operation-failpoints'])
families['stock-policy-transfer']=create_assurance_family(['ResourceDimensions','DurableTransferRefinement','ReservationScope','ReservationSafety','UseByReservation','InventoryOperation','FungibilityPool'],['ResourceAccounting','PartialWritesRefineToStuttering','AllocatedClaimsRespectScope','AllActiveClaimsRemainFeasible','OrdinaryAllocationWasUsable'],'Selector/request groups, method, and destination map to exact sources plus one atomic location rewrite.',['abstractInventoryState','abstractReservationState','abstractOperationResult'],'Result maps groups to exact sources, one transfer event, unchanged global quantity, and published revision.','Exact batch intent replays identical allocation evidence; changed request/destination/method rejects.','Shortfall, expiry, package increment, reservation conflict, or invalid destination rejects with no partial transfer.',[M,S,'test/policy-operations.test.ts','test/allocation-results.test.ts'],['memory','all-operation-failpoints'])
families['dimension-reclassification']=create_assurance_family(['ResourceDimensions','ReclassificationConservation','InventoryOperation'],['ResourceAccounting','ActiveTokensHaveExactlyOneRealLocation','ItemQuantityConserved','PackagingBucketConserved','PartialWritesStayInvisible'],'Source/destination positions and changed status/owner/custodian/authority/container/qualified dimension map to one resource-key rewrite.',['abstractInventoryState','abstractOperationResult'],'Result preserves item/package/measurement quantity and changes only declared dimensions.','Exact rewrite replays once; changed source/destination/value rejects.','Missing source, duplicate destination, implicit package conversion, or non-conservation rejects atomically.',[M,'test/reclassification.test.ts',S],['memory','all-operation-failpoints'])
families['packaging-reclassification']=create_assurance_family(['PackagingIdentity','ReclassificationConservation','DualMeasure','InventoryOperation'],['PhysicalQuantityConserved','EveryIntact20BoxIsWhole','EveryIntact24BoxIsWhole','PackagingBucketConserved','PrimaryQuantityConserved'],'Loose/package amounts and exact package revision map to a whole-unit preserving pack/unpack rewrite.',['abstractInventoryState','abstractOperationResult'],'Result changes exact package bucket while preserving resolved primary and independent measurements.','Exact conversion replays once; changed package revision/count/source rejects.','Fractional package, incompatible revision, insufficient contents, or non-conserving vector rejects.',[M,'test/reclassification.test.ts','test/catalog-stock.test.ts',S],['memory','all-operation-failpoints'])
families['transformation']=create_assurance_family(['TraceabilityGraph','ReclassificationConservation','DualMeasure','InventoryOperation'],['ConsumedIdentityIsNotStillActive','ProducedIdentityWasCreatedOnce','GenealogyOnlyPointsFromConsumedToProduced','AssociationEndpointsRemainKnown','ItemQuantityConserved','SecondaryMeasureHasExplicitCause'],'Consume/produce lines and genealogy nodes map to an explicit atomic transformation relation; no generic conservation is inferred across different items unless declared by exact vectors.',['abstractInventoryState','abstractTraceabilityState','abstractOperationResult'],'Result maps to exact consumed/produced buckets and genealogy edges.','Exact transform intent replays once; changed line/vector/genealogy rejects.','Duplicate identity, impossible source, invalid graph, or malformed exact measurements rejects atomically.',[M,'test/reclassification.test.ts','test/traceability-corrections.test.ts','test/projection-index-scale.test.ts',S],['memory','all-operation-failpoints'],gaps=['GAP-TRACEABILITY-ADVERSARIAL-GRAPH-SEARCH'])
families['transformation-read']=create_assurance_family(['CatalogPublication','PublishedHeadCAS','ReclassificationConservation','DualMeasure'],['ActiveIsRetained','PublishedSnapshotsRemainRetained','PublishedMeaningsNeverChange','HeadReferencesCompleteWorld','PublishedFencePointsAtExactTarget','ItemQuantityConserved','PrimaryQuantityConserved','SecondaryMeasureHasExplicitCause'],'Exact transformation identity or revision plus one published world maps to retained definitions and current exact input stock.',['abstractInventoryState'],'Definition reads retain immutable revision meaning; planning reports one published world revision, exact required/current vectors, and no stock write.','Repeated reads and plans over one published world return the same retained definitions and physical inputs.','Unknown revisions, item/form mismatches, invalid selectors, and insufficient input stock reject or report not applicable without writing.',[M,'test/transformations.test.ts'],['memory'])
families['scrap']=create_assurance_family(['InventoryOperation','PackagingIdentity','DualMeasure','ReservationSafety','UseByReservation'],['VisibleQuantityConserved','PhysicalQuantityConserved','NoOverReservation','OrdinaryConsumptionWasUsable'],'Exact or policy-selected source amounts map to explicit destructive resource effects with reason/evidence.',['abstractInventoryState','abstractReservationState','abstractOperationResult'],'Result maps to one scrap event and exact decrements; nothing disappears without the event.','Exact scrap intent replays once; changed source/amount/method rejects.','Deficit, package mismatch, reservation conflict, or disallowed source rejects atomically.',[M,'test/catalog-stock.test.ts','test/policy-operations.test.ts',S],['memory','all-operation-failpoints'])
families['correction']=create_assurance_family(['CorrectionHistory','InventoryOperation','PublishedHeadCAS'],['OriginalHistoryIsNeverErased','PartialCorrectionDoesNotRewriteCurrentTruth','CorrectedVisibilityRequiresBothNewFacts','VisibleProjectionMatchesLogicalRecordVersion','PartialWritesStayInvisible'],'Corrected root/event reference and replacement plans map to append-only compensating facts, never deletion or mutation of retained history.',['abstractInventoryState','abstractTraceabilityState','abstractOperationResult'],'Result exposes the correction event, retained root chain, revised projection, revision, and replay.','Exact correction intent replays once; changed replacement/supersession under one ID rejects.','Unknown root, correction cycles, over-correction, invalid replacement, or stale base rejects atomically.',[M,'test/traceability-corrections.test.ts','test/projection-index-scale.test.ts',S],['memory','all-operation-failpoints'],gaps=['GAP-COUNT-CORRECTION-HISTORY-REPLAY'])
families['container-command']=create_assurance_family(['ResourceDimensions','TraceabilityGraph','UseByReservation','CorrectionHistory','InventoryOperation'],['ResourceAccounting','ContainmentIsAcyclic','AggregationNeverConsumesIdentity','ReportMatchesCurrentTruth','OriginalHistoryIsNeverErased'],'Container identity/metadata or whole-container action maps to one handling-unit master/containment/resource transition.',['abstractInventoryState','abstractTraceabilityState','abstractOperationResult'],'Result preserves exact contained stock identities, effective use-by, metadata correction history, event, revision, and replay.','Exact container command replays once; changed metadata/action/destination rejects.','Unknown container, cycle, mixed illegal source, reservation conflict, or invalid correction rejects atomically.',[M,'test/containers.test.ts','test/traceability-corrections.test.ts','test/projection-index-scale.test.ts',S],['memory','all-operation-failpoints'],gaps=['GAP-TRACEABILITY-ADVERSARIAL-GRAPH-SEARCH'])
families['lot-command']=create_assurance_family(['UseByReservation','CorrectionHistory','InventoryOperation'],['ReportMatchesCurrentTruth','OrdinaryAllocationWasUsable','OriginalHistoryIsNeverErased','VisibleProjectionMatchesLogicalRecordVersion'],'Item/lot identity and asserted/corrected metadata map to one immutable lot master chain.',['abstractInventoryState','abstractOperationResult'],'Result exposes effective lot metadata, retained correction provenance, event, revision, and replay without changing quantity.','Exact lot command replays once; changed metadata under one operation identity rejects.','Cross-item lot identity, invalid time, correction cycle, or stale root rejects.',[M,'test/lots.test.ts','test/traceability-corrections.test.ts',S],['memory','all-operation-failpoints'])
families['reservation']=create_assurance_family(['ReservationSafety','ReservationScope','UseByReservation','InventoryOperation'],['NoOverReservation','NoDoubleConsume','AllocatedClaimsRespectScope','ShortageRequiresExplicitPhysicalLoss','ConsumedClaimHasEvidence','ReleasedOrExpiredWasNeverConsumed'],'Reservation identity, revision, broad selector, requested quantity, lifecycle time, allocations, and fulfillment map to one claim lifecycle transition.',['abstractInventoryState','abstractReservationState','abstractOperationResult'],'Result maps to exact reservation state/allocations, optional issue event, revision, and replay.','Exact lifecycle intent replays once; changed claim/request/allocation/fulfillment under the same operation ID rejects.','Infeasible allocation, out-of-scope source, double consume, invalid lifecycle time, or terminal transition rejects.',[M,'test/reservations-counts.test.ts','test/review-hardening.test.ts',S],['memory','all-operation-failpoints'])
families['count']=create_assurance_family(['PhysicalCount','InventoryOperation','PublishedHeadCAS'],['RecordedMovementAccounting','CompletedCountMatchesPhysicalReality','PartialWritesStayInvisible','OnePublicationPerOperation'],'Count identity, frozen selector/revision, snapshot sequence, observations, position-when-empty, and lifecycle times map to snapshot/observe/discrepancy/reconcile states.',['abstractInventoryState','abstractCountState','abstractOperationResult'],'Result maps to count lifecycle, discrepancy event if any, retained later movement, revision, and replay.','Each stage and replaceAbsolute resume/replay exact intent; changed observation/selector/reason rejects.','Ambiguous bucket, invalid observation, stale/missing stage, later-invalid lifecycle, or reservation conflict rejects safely.',[M,S,'test/reservations-counts.test.ts','test/projection-index-scale.test.ts'],['memory','all-operation-failpoints'],gaps=['GAP-COUNT-CORRECTION-HISTORY-REPLAY'])
families['traceability']=create_assurance_family(['TraceabilityGraph','InventoryOperation'],['ContainmentIsAcyclic','ConsumedIdentityIsNotStillActive','ProducedIdentityWasCreatedOnce','GenealogyOnlyPointsFromConsumedToProduced','AssociationEndpointsRemainKnown','AggregationNeverConsumesIdentity'],'Node identities, relation kind/action, source provenance, and command header map to one graph edge transition.',['abstractTraceabilityState','abstractInventoryState','abstractOperationResult'],'Result exposes exact relation change, graph state, event, revision, and replay without inventing stock effects.','Exact relation intent replays once; changed kind/action/endpoints rejects.','Cycle, self-edge, invalid node kind, duplicate/inconsistent relation, or genealogy without transformation rejects.',[M,'test/traceability-corrections.test.ts','test/projection-index-scale.test.ts',S],['memory','all-operation-failpoints'],gaps=['GAP-TRACEABILITY-ADVERSARIAL-GRAPH-SEARCH'])
families['read-current']=create_assurance_family(['PublishedHeadCAS','ResourceDimensions','UseByReservation','ReservationScope','CollectionView','FungibilityPool'],['HeadReferencesCompleteWorld','ReportMatchesCurrentTruth','ReportsMatchExactPhysicalIdentity','PoolReportMatchesExactPhysicalTruth','ReportMatchesCurrentPhysicalTruth'],'Selector/identity/scope/time fields map to a query over one fully published abstract world.',['abstractInventoryState','abstractReservationState','abstractCountState','abstractTraceabilityState'],'Read result maps to exact current positions, summaries, availability, plans, metadata, claims, counts, or events from one world revision.','Reads are side-effect-free; repeated reads without publication are equal.','Unknown identity or invalid selector/time rejects; reads never fall back to staged or compatibility truth.',[M,'test/read-model.test.ts','test/read-snapshot.test.ts','test/availability.test.ts'],['memory'])
families['read-snapshot']=create_assurance_family(['PublishedHeadCAS'],['HeadReferencesCompleteWorld','PartialWritesAreInvisible','PublishedFencePointsAtExactTarget'],'One public snapshot freezes one published world revision and its catalogue/projection/books.',['abstractInventoryState','abstractReservationState','abstractCountState','abstractTraceabilityState'],'Every snapshot method reports observations from the same worldRevision even if later publications occur.','Snapshot methods are synchronous and repeatable over frozen state.','No staged component may appear; corrupt/missing published roots fail closed.',[M,'test/read-snapshot.test.ts',S],['memory','all-operation-failpoints'],gaps=['GAP-DB-IMPLEMENTATION-UNBOUNDED'])
families['allocation-helper']=create_assurance_family(['ReservationScope','ReservationSafety','UseByReservation','PackagingIdentity','FungibilityPool'],['AllocatedClaimsRespectScope','AllActiveClaimsRemainFeasible','OrdinaryAllocationWasUsable','PhysicalQuantityConserved'],'Candidates, selector, amount, method, expiry, package increment, and reservation context map to exact finite allocation choices.',['abstractInventoryState','abstractReservationState'],'Plan/result reports exact lines, allocated total, shortfall, and blocked/excluded evidence without mutating state.','Pure planning is deterministic for one frozen world.','Invalid increment, incompatible revision/unit, shortfall where full allocation is required, or reservation violation rejects/reports explicitly.',[M,'test/allocation.test.ts','test/allocation-results.test.ts','test/policy-operations.test.ts'],['memory'])
families['operation-result-helper']=create_assurance_family(['InventoryOperation','PublishedHeadCAS'],['FrozenIntentNeverChanges','RetryOutcomeMatchesFrozenIntent','OnePublicationPerOperation'],'Operation/request/group references map to deterministic result partitioning and retained event identity.',['abstractOperationResult'],'Result preserves operation/group/request identities, exact allocations, event, receipt, and replay observation.','Equal frozen references regroup equal evidence; unknown or duplicate references reject.','Missing/duplicate/foreign request evidence rejects before application consumption.',[M,'test/allocation-results.test.ts',C],['memory'])
families['authority-control']=create_assurance_family(['AuthorityWriterFence'],['ModeMatchesMonotonicPhase','CertificationPrecedesCutover','AdmissionOwnership','FenceExcludesLegacyWriters','NoLegacyPhysicalWriteAfterFence','MismatchCannotBeBypassed','AuthorityRequiresAllEvidence','ActivationProvenanceIsExact','GreenfieldCannotFabricateLegacyEvidence','AuthorityIsIrreversible','ProjectionCannotMutateAuthoritativeTruth'],'Authority mode, activation provenance, certification, mutually exclusive deployment authorization, writer/fence tokens, source/target roots, mismatch, and projection evidence map directly to the writer-fence state machine.',['abstractAuthorityState'],'Result maps to one monotonic authority document revision and exact retained legacy-cutover or greenfield evidence.','Exact CAS intent is idempotent; conflicting token/evidence/authorization or stale document rejects.','Missing prerequisites, active writers, mixed authorization modes, nonempty greenfield target, mismatch, source drift, downgrade, or competing CAS rejects.',[M,'test/authority.test.ts'],['memory','authority-race-tests','greenfield-empty-world-tests'])
families['authority-cutover']=create_assurance_family(['AuthorityWriterFence','CatalogPublication','PublishedHeadCAS','RepairLiveness','SnapshotSupersededWorkflow'],['FencedReadsAreStable','PublishedTargetMatchesStableSource','AuthorityRequiresAllEvidence','ActivationProvenanceIsExact','GreenfieldCannotFabricateLegacyEvidence','CrashBeforePublicationIsInvisible','CrashStateIsExplicitlyRepairable','PublishedActivationLiveness','GreenfieldActivationRaceResolution','DispositionRequiresFencedSnapshot','SupersededRowsNeverResume','UnknownOutcomeNeverGuessed','PublishedRetainsAllDispositions','FencedSnapshotEventuallyPublishes'],'Certification plus exactly one explicit authorization mode maps either to stable-source fence/migration activation or to certified canonical revision-zero greenfield activation.',['abstractAuthorityState','abstractInventoryState','abstractMigrationState'],'Result maps to authoritative state with disjoint legacy-cutover or greenfield provenance and exact target revision/root.','Exact activation retry resumes retained evidence; changed source/fence/migration/greenfield authorization or target evidence rejects.','Source drift, active writer, blocked migration, nonempty greenfield target, mixed authorization modes, adapter uncertified, mismatch, or failed publication blocks activation.',[M,'test/authority.test.ts','test/migrations.test.ts'],['memory','migration-failpoints','authority-race-tests','greenfield-empty-world-tests'],gaps=['GAP-LEGACY-SOURCE-INTERPRETATION'])
families['durable-protocol']=create_assurance_family(['InventoryOperation','PublishedHeadCAS','RepairLiveness','DurableTransferRefinement','SnapshotSupersededWorkflow'],['FrozenIntentNeverChanges','ApplyingHasCompletePlan','PartialWritesStayInvisible','PublishedWorldMatchesFrozenPlan','PlanRetainedOnlyWhileApplying','PublishedWorldCannotAbort','ApplyingEventuallyTerminates','PartialWritesRefineToStuttering','PublishedRetainsAllDispositions','DispositionGeneratesNoPhysicalEvent'],'Base revision/root, intent fingerprint, complete next-world plan, component roots, operation ID, and failpoint stage map to applying/published/completed/aborted protocol state.',['abstractInventoryState','abstractReservationState','abstractCountState','abstractOperationResult'],'Storage observations map to invisible staged state, exact published world, compact replay receipt, terminal abort, or repair outcome.','Exact begin/complete retry returns frozen plan/receipt; changed fingerprint or stale base rejects.','Concurrent applying owner, root mismatch, missing/corrupt component, publish-after-abort, or abort-after-publication rejects.',[S,D],['memory','generic-all-operation-failpoints','generic-all-migration-failpoints'],gaps=['GAP-DB-IMPLEMENTATION-UNBOUNDED','GAP-PRODUCTION-STORAGE-SCALE-GC','GAP-HASH-COLLISION-ASSUMPTION'])
families['storage-integrity']=create_assurance_family(['InventoryOperation','PublishedHeadCAS'],['HeadReferencesCompleteWorld','FenceRetainsExactPreparedPlan','PublishedFencePointsAtExactTarget','OnePublicationPerOperation'],'World/catalog/projection/reservation/count roots and deltas map to canonical abstract component identities.',['abstractInventoryState','abstractReservationState','abstractCountState'],'Result is deterministic digest/delta/materialized world matching the frozen plan.','Pure integrity helpers are deterministic; durable exact retries compare the same roots.','Malformed deltas, missing rows, root mismatch, or invalid begin input rejects.',[C,D],['memory'],gaps=['GAP-HASH-COLLISION-ASSUMPTION'])
families['migration-definition']=create_assurance_family(['CatalogPublication','TraceabilityGraph','ReclassificationConservation','SnapshotSupersededWorkflow','CompositionRevision'],['ActiveIsRetained','RegisteredCompositionVectorsAreExact','ContainmentIsAcyclic','ItemQuantityConserved','UnknownOutcomeNeverGuessed','DispositionGeneratesNoPhysicalEvent'],'Typed query/plugin declarations and opening/traceability facts map to a deterministic finite migration declaration and diagnostics.',['abstractMigrationState'],'Result is a frozen declaration/plan/source bundle or explicit blockers; no target world changes.','Equal bounded source rows produce the same digests and declaration.','Unknown query, duplicate source identity, ambiguity, invalid unit/graph/vector, or paging limit rejects/blocks.',[M,'test/migrations.test.ts'],['memory'],gaps=['GAP-LEGACY-SOURCE-INTERPRETATION','GAP-EXTERNAL-MIGRATION-CALLBACKS'])
families['migration-publication']=create_assurance_family(['CatalogPublication','InventoryOperation','PublishedHeadCAS','RepairLiveness','TraceabilityGraph','SnapshotSupersededWorkflow'],['PublishedSnapshotsRemainRetained','PartialWritesStayInvisible','PublishedWorldMatchesFrozenPlan','ApplyingEventuallyTerminates','ContainmentIsAcyclic'],'Migration ID, source/plan/catalog digests, ordered operations, dry-run roots, and complete target world map to one atomic migration manifest.',['abstractMigrationState','abstractInventoryState','abstractTraceabilityState'],'Result maps to dry-run comparison, one published target revision/root, compact manifest, replay, repair, or safe abort.','Exact manifest retry resumes/publishes the same batch; changed plan/catalog/source under one migration ID rejects.','Blocked diagnostics, dry-run mismatch, source drift, stale/nonempty target, corrupt staged world, or aborted identity rejects.',[M,D,'test/migrations.test.ts'],['memory','generic-all-migration-failpoints'],gaps=['GAP-LEGACY-SOURCE-INTERPRETATION','GAP-DB-IMPLEMENTATION-UNBOUNDED'])
families['external-plugin-boundary']=create_assurance_family(['CatalogPublication'],['ActiveIsRetained'],'Application callback identity/provenance is retained, while callback execution itself is outside the model.',['abstractMigrationState'],'Only validated deterministic callback output enters the migration abstraction.','Repeated callback execution must be deterministic under bounded source snapshots.','Unbounded/nondeterministic/external effects are unsupported and must be caught by application plugin tests.',['test/migrations.test.ts'],['memory'],'explicit-gap',['GAP-EXTERNAL-MIGRATION-CALLBACKS','GAP-LEGACY-SOURCE-INTERPRETATION'])

# Map one facade API key to its formal assurance family.
def facade_family(key):
 group,method=key.split('.',1)
 if group=='catalog': return 'catalog-publication'
 if group=='compositions': return 'composition-open' if method=='open' else 'composition-read'
 if group=='transformations': return 'transformation-read'
 if group=='collections': return 'collection-read'
 if group=='fungibility': return 'fungibility-movement' if method in {'issue','transfer','scrap'} else 'fungibility-read'
 if group=='containers': return 'container-command'
 if group=='lots': return 'lot-command'
 if group=='transfers': return 'transfer-lifecycle'
 if group=='reservations': return 'reservation'
 if group=='counts': return 'count'
 if group=='traceability': return 'traceability'
 if group=='snapshot': return 'read-snapshot'
 if group=='read': return 'read-snapshot' if method=='snapshot' else 'read-current'
 if group=='stock':
  if method.startswith('receive'): return 'stock-receipt'
  if method in {'issueByPolicy','issueManyByPolicy'}: return 'stock-policy-issue'
  if method in {'issue','issueMany'}: return 'stock-issue'
  if method in {'transferByPolicy','transferManyByPolicy'}: return 'stock-policy-transfer'
  if method in {'transfer','transferMany'}: return 'stock-transfer'
  if method in {'pack','unpack'}: return 'packaging-reclassification'
  if method=='transform': return 'transformation'
  if method.startswith('scrap'): return 'scrap'
  if method=='correct': return 'correction'
  if method in {
   'changeCustodian','changeDispositionAuthority','changeOwner',
   'changeQualifiedDimension','changeStatus','clearCustodian',
   'clearDispositionAuthority','clearOwner','clearQualifiedDimension',
   'clearStatus','placeInContainer','reclassifyMany','removeFromContainer'
  }: return 'dimension-reclassification'
 raise KeyError(key)

# Map one root export to the formal assurance family that owns its behavior.
def root_family(name,decl):
 if name in {'InventoryOnce','createInventoryOnce'}: return 'facade-construction'
 if decl == 'src/authority-cutover.ts': return 'authority-cutover'
 if 'Authority' in name or 'authority' in name: return 'authority-control'
 if name == 'readPublishedInventorySnapshot': return 'read-snapshot'
 if name in {'readPublishedInventoryCatalog','findInventoryEventByOperationId'}: return 'read-current'
 if name.startswith(('publishInventoryCatalog','ensureInventoryScalarCatalogRevision')): return 'catalog-publication'
 if decl in {'src/amounts.ts','src/measurements.ts','src/quantity.ts'}: return 'pure-exact-value'
 if decl in {'src/selectors.ts','src/model.ts','src/canonical.ts'}: return 'identity-normalization'
 if decl in {'src/catalog.ts','src/catalog-lifecycle.ts','src/composition.ts','src/collections.ts'}: return 'catalog-definition'
 if decl == 'src/fungibility.ts': return 'fungibility-read'
 if decl == 'src/transfers.ts': return 'transfer-lifecycle'
 if decl in {'src/read-model.ts','src/availability.ts','src/usability.ts'}: return 'read-current'
 if decl in {'src/picking.ts','src/allocation.ts'}: return 'allocation-helper'
 if name in {'assertInventoryAmountSum','defineInventoryAmountLineGroup','combineInventoryAmountLineGroups','defineInventoryPolicyBatchRequestGroup','combineInventoryPolicyBatchRequestGroups','inventoryPolicyBatchAllocationLinesByReference'}: return 'operation-result-helper'
 if name in {'everythingInInventoryStockSelector','inventoryContainerIdentity','inventoryLotIdentity','inventoryStockSelector'}: return 'identity-normalization'
 raise KeyError(f'unmapped root public API {name} from {decl}')

# Map one storage export to durable-protocol or storage-integrity assurance.
def storage_export_family(name):
 if any(k in name for k in ('Digest','ContentRoots','Delta','materialize','emptyInventoryWorldState')): return 'storage-integrity'
 if name in {'InMemoryInventoryDurableStorage','InventoryApplyingOperationConflictError','InventoryWorldRevisionConflictError','commitInventoryOperation','createInMemoryInventoryDurableStorage','repairInventoryDurableOperations','resumeInventoryDurableOperation','validateInventoryDurableOperationBeginInput','validateInventoryMigrationManifestBeginInput'}: return 'durable-protocol'
 raise KeyError(f'unmapped storage public API {name}')

# Map one migration export to definition, publication, or external-plugin assurance.
def migration_family(name):
 if name in {'applyInventoryMigrationPlan','repairInventoryMigrationManifests','resumeInventoryMigrationManifest'}: return 'migration-publication'
 if name in {'createInventoryLegacyQueryReader','createInventoryMigrationPlanFromPlugin','createInventoryMigrationPlanFromSourcePlugin','readAllInventoryLegacyQuery'}: return 'external-plugin-boundary'
 if name in {'defineInventoryLegacyQuery','defineInventoryMigration','defineInventoryMigrationPlugin','defineInventoryMigrationSourcePlugin','dryRunInventoryMigration','inventoryMigrationPositionsMatch','inventoryMigrationProblem','inventoryMigrationSnapshotSupersededDisposition'}: return 'migration-definition'
 raise KeyError(f'unmapped migration public API {name}')

# Map one expert-kernel export to the formal family matching its source semantics.
def kernel_family(name,decl):
 low=name.lower()
 if name.startswith('createInventoryTransfer') and name.endswith('Event'): return 'transfer-lifecycle'
 if decl in {'src/quantity.ts','src/measurements.ts','src/amounts.ts'}: return 'pure-exact-value'
 if decl in {'src/canonical.ts','src/model.ts','src/selectors.ts'}: return 'identity-normalization'
 if decl == 'src/catalog.ts': return 'catalog-definition'
 if decl in {'src/allocation.ts','src/picking.ts'}: return 'allocation-helper'
 if decl == 'src/counts.ts': return 'count'
 if decl == 'src/corrections.ts': return 'correction'
 if decl == 'src/reservations.ts': return 'reservation'
 if decl == 'src/traceability.ts': return 'traceability'
 if decl == 'src/composition.ts': return 'composition-open' if 'open' in low else 'catalog-definition'
 if decl == 'src/collections.ts': return 'collection-read'
 if decl == 'src/fungibility.ts': return 'fungibility-movement' if any(x in low for x in ('issue','transfer','scrap','event')) else 'fungibility-read'
 if decl == 'src/transfers.ts': return 'transfer-lifecycle'
 if decl in {'src/read-model.ts','src/availability.ts','src/usability.ts'}: return 'read-current'
 if decl == 'src/projection.ts': return 'dimension-reclassification'
 if decl in {'src/events.ts','src/commands.ts'}:
  if 'receipt' in low or 'opening' in low: return 'stock-receipt'
  if 'issue' in low: return 'stock-issue'
  if 'transfer' in low: return 'stock-transfer'
  if 'scrap' in low: return 'scrap'
  if 'pack' in low or 'unpack' in low: return 'packaging-reclassification'
  if 'transformation' in low: return 'transformation'
  if 'reclassification' in low: return 'dimension-reclassification'
  if 'correction' in low: return 'correction'
  if 'container' in low: return 'container-command'
  if 'lot' in low: return 'lot-command'
  if 'traceability' in low: return 'traceability'
  if name in {'assertInventoryEpochMilliseconds','commitInventoryEvent','createInventoryCatalogPublicationEvent','defineInventoryEvent','inventoryEventIdForOperation','inventoryEventIntentFingerprint'}: return 'operation-result-helper'
  raise KeyError(f'unmapped event/command public API {name} from {decl}')
 raise KeyError(f'unmapped kernel public API {name} from {decl}')

# Expand one discovered public signature with its complete family assurance declaration.
def expanded_entry(family_id,signature):
 if family_id not in families: raise KeyError(family_id)
 return {'family':family_id,'signature':signature,**families[family_id]}


# Return the callable/public symbol name encoded by one discovered signature row.
def public_symbol(signature):
 return signature.get('method') or signature.get('name')



# Cached production source inventory reused by diagnostic symbol-reference scans.
ALL_PRODUCTION_SOURCES = sorted((pkg / 'src').rglob('*.ts'))
# Cached production source text avoids rereading files for every public symbol.
PRODUCTION_SOURCE_TEXTS = [
 (path, path.read_text(errors='ignore')) for path in ALL_PRODUCTION_SOURCES
]

# Find diagnostic production-source references for one public symbol without granting coverage.
def internal_source_references(signature):
 symbol = public_symbol(signature)
 if symbol is None: return []
 declaration = signature.get('declaration')
 references = []
 for path, text in PRODUCTION_SOURCE_TEXTS:
  count = len(re.findall(r'\b' + re.escape(symbol) + r'\b', text))
  relative = str(path.relative_to(pkg)).replace('\\', '/')
  if count == 0: continue
  if declaration is not None and relative == declaration and count <= 1: continue
  references.append({'path': str(path.relative_to(repo)).replace('\\', '/'), 'occurrences': count})
 return references


# Convert one package-relative test path to the repository-relative evidence path.
def repository_test_path(package_relative):
 return str((pkg / package_relative).relative_to(repo)).replace('\\', '/')


# Require the compiler call-graph entry corresponding to one public API key.
def call_chain_entry(key):
 try:
  return call_graph['entries'][key]
 except KeyError as error:
  raise RuntimeError(f'public API {key} is missing from compiler call graph') from error


# Return compiler-resolved test call sites that directly invoke one public target.
def direct_executable_witnesses(key):
 sources = set()
 entrypoints = set()
 for row in call_chain_entry(key)['witnesses']:
  witness = row['witness']
  chain = witness['chain']
  if len(chain) < 2:
   continue
  caller_file = chain[-2].get('file')
  if not isinstance(caller_file, str) or not caller_file.startswith('test/'):
   continue
  sources.add(repository_test_path(caller_file))
  entrypoints.add(repository_test_path(witness['test']))
 return sorted(sources), sorted(entrypoints)


# Normalize compiler call-chain witnesses into deterministic checked JSON evidence.
def normalized_call_chain_witnesses(key):
 rows=[]
 for row in call_chain_entry(key)['witnesses']:
  witness=row['witness']
  rows.append({
   'target':row['target'],
   'test':repository_test_path(witness['test']),
   'chain':witness['chain'],
  })
 return rows


# Attach compiler-resolved execution witnesses and diagnostic source references to one API entry.
def enrich_evidence(key, entry):
 call_entry=call_chain_entry(key)
 witnesses=normalized_call_chain_witnesses(key)
 direct,entrypoints=direct_executable_witnesses(key)
 internal=internal_source_references(entry['signature'])
 if entry['status'] == 'explicit-gap': mode = 'explicit-gap'
 elif not witnesses: mode = 'unreferenced-public-gap'
 elif direct: mode = 'direct-executable'
 else: mode = 'indirect-call-chain'
 return {
  **entry,
  'evidenceMode': mode,
  'directExecutableEvidence': direct,
  'directExecutableEntrypoints': entrypoints,
  'internalReferences': internal,
  'implementationTargets':call_entry['targets'],
  'callChainWitnesses':witnesses,
 }

# Public API assurance entries keyed by their stable discovered surface identity.
entries={}
for row in surface['facade']:
 key='facade.'+row['key']; entries[key]=expanded_entry(facade_family(row['key']),row)
for row in surface['authority']:
 key='authority-port.'+row['method']; entries[key]=expanded_entry('authority-control',row)
for row in surface['storage']:
 key='storage-port.'+row['method']; entries[key]=expanded_entry('durable-protocol',row)
for ep,rows in surface['entrypoints'].items():
 for row in rows:
  name=row['name']; decl=row['declaration']; key=f'entrypoint.{ep}.{name}'
  fam=root_family(name,decl) if ep=='root' else storage_export_family(name) if ep=='storage' else migration_family(name) if ep=='migrations' else kernel_family(name,decl)
  entries[key]=expanded_entry(fam,row)
for row in surface['classes']:
 key='class.'+row['key']
 if row['className']=='InventoryCatalog': fam='catalog-definition'
 elif row['className']=='InventoryAuthorityControl': fam='authority-control'
 elif row['className']=='InMemoryInventoryDurableStorage': fam='durable-protocol'
 else: raise KeyError('unmapped class '+row['className'])
 entries[key]=expanded_entry(fam,row)

entries = {key: enrich_evidence(key, entry) for key, entry in entries.items()}

# Fail before rewriting any generated artifact when public type discovery is incomplete.
surface_diagnostics = surface.get('diagnostics', {})
if surface_diagnostics.get('truncatedTypes', []) != []:
 raise RuntimeError('public type discovery silently truncated types')

# Bind every checked bounded trace to the exact current public APIs whose assurance
# family it exercises. This is generated from the live surface, not hand-copied.
trace_path = pkg / 'formal/implementation-conformance/TRACE_REPLAY_ASSURANCE.json'
trace_manifest = json.loads(trace_path.read_text())
for trace_id, trace in trace_manifest['entries'].items():
 trace_families = set(trace['operationFamilies'])
 trace['apiEntries'] = sorted(
  key
  for key, entry in entries.items()
  if entry['status'] != 'explicit-gap' and entry['family'] in trace_families
 )
 if not trace['apiEntries']:
  raise RuntimeError(f'bounded trace {trace_id} maps to no current public API')
trace_path.write_text(json.dumps(trace_manifest, indent=2, sort_keys=True) + '\n')


# Count complete call/construct signatures represented by one discovered public row.
def signature_count(row):
 if 'signatures' in row: return len(row['signatures'])
 return len(row.get('callSignatures', [])) + len(row.get('constructSignatures', []))

all_method_rows = [*surface['facade'], *surface['authority'], *surface['storage'], *surface['classes']]
all_export_rows = [row for rows in surface['entrypoints'].values() for row in rows]
# Aggregate discovered-surface and executable-callgraph counts emitted into the API manifest.
surface_counts={
 'facadeMethods':len(surface['facade']),
 'authorityMethods':len(surface['authority']),
 'storageMethods':len(surface['storage']),
 'classMethods':len(surface['classes']),
 'rootCallables':len(surface['entrypoints']['root']),
 'storageCallables':len(surface['entrypoints']['storage']),
 'migrationCallables':len(surface['entrypoints']['migrations']),
 'kernelCallables':len(surface['entrypoints']['kernel']),
 'callAndConstructSignatures':sum(signature_count(row) for row in [*all_method_rows,*all_export_rows]),
 'directExecutableApis':sum(entry['evidenceMode']=='direct-executable' for entry in entries.values()),
 'indirectCallChainApis':sum(entry['evidenceMode']=='indirect-call-chain' for entry in entries.values()),
 'explicitGapApis':sum(entry['evidenceMode']=='explicit-gap' for entry in entries.values()),
 'unreferencedPublicApis':sum(entry['evidenceMode']=='unreferenced-public-gap' for entry in entries.values()),
 'compilerCallGraphCallables':call_graph['counts']['callables'],
 'compilerCallGraphEdges':call_graph['counts']['edges'],
 'compilerCallGraphTestRoots':call_graph['counts']['testRoots'],
 'compilerCallGraphWitnessedApis':call_graph['counts']['publicEntriesWithWitnesses'],
 'compilerCallGraphUnresolvedApis':call_graph['counts']['unresolvedPublicEntries'],
 'reachableTypes':len(surface['types']),
 'reachableFields':sum(len(t['fields']) for t in surface['types']),
 'recursiveTypeReferences':len(surface_diagnostics.get('recursiveTypeReferences', [])),
 'maximumTypeDepth':surface_diagnostics.get('maximumTypeDepth', 0),
 'truncatedTypes':len(surface_diagnostics.get('truncatedTypes', [])),
}
surface_hash=hashlib.sha256(json.dumps(surface,sort_keys=True,separators=(',',':')).encode()).hexdigest()
api_manifest={'schemaVersion':2,'surfaceSha256':surface_hash,'surfaceDiagnostics':surface_diagnostics,'counts':surface_counts,'families':families,'entries':dict(sorted(entries.items()))}

# Fields retained as audit/provenance evidence rather than conserved physical semantics.
AUDIT={'metadata','actorId','sourcePartyId','destinationPartyId','sourceReference','reason','note','compatibilityProjectionError'}
# Human-facing decoration fields intentionally outside conserved inventory semantics.
DECOR={'description','message','code'}
# External callback fields mapped to their explicit formal-coverage gaps.
CALLBACK_GAPS={'failpoint':'GAP-TEST-FAILPOINT-HOOK','now':'GAP-EXTERNAL-CLOCK','readPage':'GAP-EXTERNAL-MIGRATION-CALLBACKS','createBundle':'GAP-EXTERNAL-MIGRATION-CALLBACKS','createDeclaration':'GAP-EXTERNAL-MIGRATION-CALLBACKS','compileSource':'GAP-EXTERNAL-MIGRATION-CALLBACKS','drainLegacyWriters':'GAP-EXTERNAL-MIGRATION-CALLBACKS','defineRevision':'GAP-EXTERNAL-POLICY-CALLBACKS','acceptAllocations':'GAP-EXTERNAL-POLICY-CALLBACKS'}
# Exact identity/retry fields whose values select or fence modeled facts.
IDENTITY_EXACT={'operationId','migrationId','eventId','countId','reservationId','requestId','groupId','commandId','changeId','openingId','queryId','pluginId','namespaceId','writerToken','attemptToken','fenceToken','replayed','created'}

# Choose formal model correspondence for one reachable public field from its source and owner.
def models_for(source,owner,field):
 if (
  'MigrationSourceDisposition' in owner
  or field in {'sourceDispositions', 'dispositionId', 'snapshotAtEpochMs'}
 ):
  return ['SnapshotSupersededWorkflow','PublishedHeadCAS','AuthorityWriterFence']
 if (
  'Deficit' in owner
  or field in {'deficit', 'deficitPosition'}
 ):
  return ['RecordedDeficit','InventoryOperation','PublishedHeadCAS']
 if 'authority' in source: return ['AuthorityWriterFence']
 if any(x in source for x in ('storage.ts','coordinator.ts','integrity.ts','world.ts')): return ['InventoryOperation','PublishedHeadCAS','RepairLiveness']
 if 'migration' in source: return ['CatalogPublication','InventoryOperation','PublishedHeadCAS','TraceabilityGraph']
 if any(x in source for x in ('quantity.ts','measurements.ts')): return ['DualMeasure']
 if 'amounts.ts' in source or 'catalog.ts' in source: return ['PackagingIdentity','CatalogPublication']
 if 'composition.ts' in source: return ['CompositionRevision','PackagingIdentity']
 if 'collections.ts' in source: return ['CollectionView']
 if 'fungibility.ts' in source: return ['FungibilityPool','ReservationSafety']
 if 'transfers.ts' in source: return ['TransferLifecycle','ResourceDimensions','ReservationSafety','InventoryOperation']
 if 'reservations.ts' in source: return ['ReservationSafety','ReservationScope','UseByReservation']
 if 'counts.ts' in source: return ['PhysicalCount']
 if 'traceability.ts' in source: return ['TraceabilityGraph']
 if 'corrections.ts' in source: return ['CorrectionHistory']
 if any(x in source for x in ('availability.ts','picking.ts','allocation.ts','read-model.ts','usability.ts')): return ['UseByReservation','ReservationScope','PackagingIdentity']
 if any(x in source for x in ('projection.ts','model.ts','selectors.ts')): return ['ResourceDimensions','InventoryOperation']
 return ['InventoryOperation','PublishedHeadCAS']
# Classify one reachable field and attach its formal/evidence/gap correspondence.
def classify_field(owner,row):
 field=row['name']; source=row['source']; callable_=row.get('callable',False)
 models=models_for(source,owner,field); gaps=[]
 if callable_ and field in CALLBACK_GAPS:
  category='unsupported/unmodelled'; gaps=[CALLBACK_GAPS[field]]
  rationale='Executable callback behavior is supplied by an external/test boundary and is not itself a finite InventoryOnce state field.'
 elif field in AUDIT or field in {'recordedAtEpochMs'}:
  category='observational/audit-only'; gaps=['GAP-ARBITRARY-AUDIT-METADATA'] if field=='metadata' else []
  rationale='Retained for audit, provenance, or explanation; it may participate in retry identity but does not alter conserved physical resources.'
 elif field in DECOR:
  category='application decoration'; gaps=['GAP-APPLICATION-DECORATION']
  rationale='Human/application decoration is intentionally outside conserved physical semantics.'
 elif field in IDENTITY_EXACT or field.endswith(('Id','Ids','Digest','Root','Fingerprint','Sequence','Revision')) or 'Token' in field:
  category='identity/retry-semantic'
  rationale='Exact identity, revision, token, sequence, digest, or replay field selects/fences a modeled fact and prevents changed-intent aliasing.'
 else:
  category='abstract-semantic'
  rationale='This field changes or observes the abstract catalogue, resource, reservation, count, traceability, migration, authority, or publication state.'
 if field in {'clock'}:
  category='unsupported/unmodelled'; gaps=['GAP-EXTERNAL-CLOCK']; rationale='Injected clock implementation is an environment assumption; canonical emitted times remain modeled inputs.'
 if field in {'plugin'}:
  category='unsupported/unmodelled'; gaps=['GAP-EXTERNAL-MIGRATION-CALLBACKS']; rationale='Application plugin execution is outside the kernel model; only its validated deterministic output enters the abstraction.'
 if field in {'storage','store'}:
  category='abstract-semantic'; gaps=[]; rationale='Injected protocol implementation must refine the modeled durable/authority port and pass the shared conformance suite.'
 if callable_ and field in {'plan','replaceWith'}:
  category='abstract-semantic'; gaps=[]; rationale='The callback produces a frozen validated plan whose result, not arbitrary code execution, is checked against the abstract transition.'
 evidence=[M,C]
 if 'storage' in source or 'coordinator' in source or 'integrity' in source: evidence=[S,D]
 elif 'migration' in source: evidence=[M,'test/migrations.test.ts']
 elif 'authority' in source: evidence=[M,'test/authority.test.ts']
 return {
  'classification':category,
  'discoveredType':row['type'],
  'declaration':source,
  'directions':sorted(row.get('directions', [])),
  'optional':bool(row.get('optional', False)),
  'allowsUndefined':bool(row.get('allowsUndefined', False)),
  'allowsNull':bool(row.get('allowsNull', False)),
  'callable':bool(row.get('callable', False)),
  'callSignatures':row.get('callSignatures', []),
  'rationale':rationale,
  'formalModels':models,
  'executableEvidence':evidence,
  'gaps':gaps,
 }

# Reachable public fields keyed by owner/name with their classification and evidence mapping.
field_entries={}
for type_row in surface['types']:
 for row in type_row['fields']:
  key=f"{type_row['name']}.{row['name']}"
  if key in field_entries: raise RuntimeError('duplicate field '+key)
  field_entries[key]=classify_field(type_row['name'],row)
field_manifest={
 'schemaVersion':2,
 'surfaceSha256':surface_hash,
 'surfaceDiagnostics':surface_diagnostics,
 'counts':{
  'types':len(surface['types']),
  'fields':len(field_entries),
  'inputFields':sum('input' in entry['directions'] for entry in field_entries.values()),
  'outputFields':sum('output' in entry['directions'] for entry in field_entries.values()),
  'optionalFields':sum(entry['optional'] for entry in field_entries.values()),
  'undefinedFields':sum(entry['allowsUndefined'] for entry in field_entries.values()),
  'nullableFields':sum(entry['allowsNull'] for entry in field_entries.values()),
  'callableFields':sum(entry['callable'] for entry in field_entries.values()),
  'callableFieldSignatures':sum(len(entry['callSignatures']) for entry in field_entries.values()),
  'callbackArgumentFields':sum('callback-argument' in entry['directions'] for entry in field_entries.values()),
  'callbackResultFields':sum('callback-result' in entry['directions'] for entry in field_entries.values()),
  'recursiveTypeReferences':len(surface_diagnostics.get('recursiveTypeReferences', [])),
  'truncatedTypes':len(surface_diagnostics.get('truncatedTypes', [])),
 },
 'entries':dict(sorted(field_entries.items())),
}

out=pkg/'formal/implementation-conformance'
out.mkdir(parents=True,exist_ok=True)
(out/'API_ASSURANCE.json').write_text(json.dumps(api_manifest,indent=2,sort_keys=True)+'\n')
(out/'FIELD_CLASSIFICATION.json').write_text(json.dumps(field_manifest,indent=2,sort_keys=True)+'\n')
(out/'CALL_CHAIN_ASSURANCE.json').write_text(json.dumps({
 'schemaVersion':1,
 'surfaceSha256':surface_hash,
 'counts':call_graph['counts'],
 'entries':dict(sorted(call_graph['entries'].items())),
},indent=2,sort_keys=True)+'\n')
print(json.dumps({'surfaceSha256':surface_hash,'methodEntries':len(entries),'fieldEntries':len(field_entries),'families':len(families),'fieldClasses':{c:sum(1 for e in field_entries.values() if e['classification']==c) for c in sorted({e['classification'] for e in field_entries.values()})}},indent=2))
