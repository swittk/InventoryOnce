-------------------------- MODULE HistoricalRepair ---------------------------
EXTENDS Integers

AssertionCounts == 1..2
DeficitValues == 0..2
Policies == {"record", "reject"}
BundleOrders == {"none", "caller", "reversed"}
Phases == {"idle", "planning", "published", "rejected"}

VARIABLES phase, originalHistoryRetained, assertionCount,
          publishedAssertionCount, worldRevision, physicalDeficit,
          beforePublishedAssertionCount, beforeWorldRevision,
          beforePhysicalDeficit, serializedConflict, deficitPolicy,
          requestedDeficit, requestedBundleOrder, publishedBundleOrder,
          beforePublishedBundleOrder

vars == <<phase, originalHistoryRetained, assertionCount,
          publishedAssertionCount, worldRevision, physicalDeficit,
          beforePublishedAssertionCount, beforeWorldRevision,
          beforePhysicalDeficit, serializedConflict, deficitPolicy,
          requestedDeficit, requestedBundleOrder, publishedBundleOrder,
          beforePublishedBundleOrder>>

Init ==
  /\ phase = "idle"
  /\ originalHistoryRetained = TRUE
  /\ assertionCount = 0
  /\ publishedAssertionCount = 0
  /\ worldRevision = 0
  /\ physicalDeficit = 0
  /\ beforePublishedAssertionCount = 0
  /\ beforeWorldRevision = 0
  /\ beforePhysicalDeficit = 0
  /\ serializedConflict = FALSE
  /\ deficitPolicy = "reject"
  /\ requestedDeficit = 0
  /\ requestedBundleOrder = "none"
  /\ publishedBundleOrder = "none"
  /\ beforePublishedBundleOrder = "none"

StartRepair(count, conflict, policy, deficit) ==
  /\ phase \in {"idle", "published", "rejected"}
  /\ worldRevision < 4
  /\ count \in AssertionCounts
  /\ conflict \in BOOLEAN
  /\ policy \in Policies
  /\ deficit \in DeficitValues
  /\ phase' = "planning"
  /\ assertionCount' = count
  /\ serializedConflict' = conflict
  /\ deficitPolicy' = policy
  /\ requestedDeficit' = deficit
  /\ requestedBundleOrder' = "caller"
  /\ beforePublishedAssertionCount' = publishedAssertionCount
  /\ beforePublishedBundleOrder' = publishedBundleOrder
  /\ beforeWorldRevision' = worldRevision
  /\ beforePhysicalDeficit' = physicalDeficit
  /\ UNCHANGED <<originalHistoryRetained, publishedAssertionCount,
                  worldRevision, physicalDeficit, publishedBundleOrder>>

PublishRepair ==
  /\ phase = "planning"
  /\ ~serializedConflict
  /\ deficitPolicy = "record" \/ requestedDeficit = 0
  /\ phase' = "published"
  /\ publishedAssertionCount' = assertionCount
  /\ worldRevision' = beforeWorldRevision + 1
  /\ physicalDeficit' = requestedDeficit
  /\ publishedBundleOrder' = requestedBundleOrder
  /\ originalHistoryRetained' = TRUE
  /\ UNCHANGED <<assertionCount, beforePublishedAssertionCount,
                  beforeWorldRevision, beforePhysicalDeficit,
                  serializedConflict, deficitPolicy, requestedDeficit,
                  requestedBundleOrder, beforePublishedBundleOrder>>

RejectRepair ==
  /\ phase = "planning"
  /\ serializedConflict \/
       (deficitPolicy = "reject" /\ requestedDeficit > 0)
  /\ phase' = "rejected"
  /\ publishedAssertionCount' = beforePublishedAssertionCount
  /\ worldRevision' = beforeWorldRevision
  /\ physicalDeficit' = beforePhysicalDeficit
  /\ publishedBundleOrder' = beforePublishedBundleOrder
  /\ originalHistoryRetained' = TRUE
  /\ UNCHANGED <<assertionCount, beforePublishedAssertionCount,
                  beforeWorldRevision, beforePhysicalDeficit,
                  serializedConflict, deficitPolicy, requestedDeficit,
                  requestedBundleOrder, beforePublishedBundleOrder>>

Next ==
  \/ \E count \in AssertionCounts,
        conflict \in BOOLEAN,
        policy \in Policies,
        deficit \in DeficitValues:
       StartRepair(count, conflict, policy, deficit)
  \/ PublishRepair
  \/ RejectRepair

Spec == Init /\ [][Next]_vars

\* Deliberate forbidden transition used only by the mutation gate.
PartialPublishMutation ==
  /\ phase = "planning"
  /\ assertionCount = 2
  /\ ~serializedConflict
  /\ deficitPolicy = "record" \/ requestedDeficit = 0
  /\ phase' = "published"
  /\ publishedAssertionCount' = 1
  /\ worldRevision' = beforeWorldRevision + 1
  /\ physicalDeficit' = requestedDeficit
  /\ publishedBundleOrder' = requestedBundleOrder
  /\ originalHistoryRetained' = TRUE
  /\ UNCHANGED <<assertionCount, beforePublishedAssertionCount,
                  beforeWorldRevision, beforePhysicalDeficit,
                  serializedConflict, deficitPolicy, requestedDeficit,
                  requestedBundleOrder, beforePublishedBundleOrder>>

PartialPublishMutationNext == Next \/ PartialPublishMutation
PartialPublishMutationSpec == Init /\ [][PartialPublishMutationNext]_vars

\* Deliberate forbidden transition: publish a same-time bundle in reverse caller order.
ReverseBundleOrderMutation ==
  /\ phase = "planning"
  /\ assertionCount = 2
  /\ ~serializedConflict
  /\ deficitPolicy = "record" \/ requestedDeficit = 0
  /\ phase' = "published"
  /\ publishedAssertionCount' = assertionCount
  /\ worldRevision' = beforeWorldRevision + 1
  /\ physicalDeficit' = requestedDeficit
  /\ publishedBundleOrder' = "reversed"
  /\ originalHistoryRetained' = TRUE
  /\ UNCHANGED <<assertionCount, beforePublishedAssertionCount,
                  beforeWorldRevision, beforePhysicalDeficit,
                  serializedConflict, deficitPolicy, requestedDeficit,
                  requestedBundleOrder, beforePublishedBundleOrder>>

ReverseBundleOrderMutationNext == Next \/ ReverseBundleOrderMutation
ReverseBundleOrderMutationSpec == Init /\ [][ReverseBundleOrderMutationNext]_vars

TypeOK ==
  /\ phase \in Phases
  /\ originalHistoryRetained \in BOOLEAN
  /\ assertionCount \in 0..2
  /\ publishedAssertionCount \in 0..2
  /\ worldRevision \in 0..4
  /\ physicalDeficit \in DeficitValues
  /\ beforePublishedAssertionCount \in 0..2
  /\ beforeWorldRevision \in 0..4
  /\ beforePhysicalDeficit \in DeficitValues
  /\ serializedConflict \in BOOLEAN
  /\ deficitPolicy \in Policies
  /\ requestedDeficit \in DeficitValues
  /\ requestedBundleOrder \in BundleOrders
  /\ publishedBundleOrder \in BundleOrders
  /\ beforePublishedBundleOrder \in BundleOrders

OriginalHistoryIsNeverErased == originalHistoryRetained

HistoricalRepairIsAtomic ==
  phase # "published" \/ publishedAssertionCount = assertionCount

SameTimeBundleOrderIsPreserved ==
  phase # "published" \/ publishedBundleOrder = requestedBundleOrder

RejectedRepairPreservesCurrentTruth ==
  phase # "rejected" \/
    /\ publishedAssertionCount = beforePublishedAssertionCount
    /\ worldRevision = beforeWorldRevision
    /\ physicalDeficit = beforePhysicalDeficit

SerializedConflictNeverPublishes ==
  phase # "published" \/ ~serializedConflict

RejectPolicyNeverPublishesDeficit ==
  phase # "published" \/
    deficitPolicy # "reject" \/ physicalDeficit = 0

RecordedDeficitRemainsExplicit ==
  phase # "published" \/
    deficitPolicy # "record" \/ physicalDeficit = requestedDeficit

PublishedRepairAdvancesOneRevision ==
  phase # "published" \/ worldRevision = beforeWorldRevision + 1

=============================================================================
