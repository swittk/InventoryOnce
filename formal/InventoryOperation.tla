-------------------------- MODULE InventoryOperation --------------------------
EXTENDS Integers

Intents == {"stock-a", "reservation-a", "count-a", "catalog-a", "lot-a",
            "placement-node-a", "traceability-a", "changed-b"}
NoIntent == "none"
RetryOutcomes == {"none", "exact", "changed"}

IntentHasEvent(intent) == ~(intent \in {"reservation-a", "count-a"})
PlanSource(intent) == IF intent = "changed-b" THEN 0 ELSE IF intent = "stock-a" THEN 1 ELSE 2
PlanDestination(intent) == IF intent = "changed-b" THEN 2 ELSE IF intent = "stock-a" THEN 1 ELSE 0
PlanCatalog(intent) == IF intent = "catalog-a" THEN 1 ELSE IF intent = "changed-b" THEN 2 ELSE 0
PlanLots(intent) == IF intent = "lot-a" THEN 1 ELSE IF intent = "changed-b" THEN 2 ELSE 0
PlanPlacementNodes(intent) == IF intent = "placement-node-a" THEN 1 ELSE IF intent = "changed-b" THEN 2 ELSE 0
PlanTraceability(intent) == IF intent = "traceability-a" THEN 1 ELSE IF intent = "changed-b" THEN 2 ELSE 0
PlanReservations(intent) == IF intent = "reservation-a" THEN 1 ELSE IF intent = "changed-b" THEN 2 ELSE 0
PlanCounts(intent) == IF intent = "count-a" THEN 1 ELSE IF intent = "changed-b" THEN 2 ELSE 0

VARIABLES state, frozenIntent, firstIntent, retryIntent, retryOutcome,
          planFrozen, planRetained, worldPublished, hasEvent,
          plannedSource, plannedDestination, plannedCatalog, plannedLots,
          plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
          eventWritten, projectionWritten, reservationsWritten, countsWritten, receiptWritten,
          visibleSource, visibleDestination, visibleCatalog, visibleLots,
          visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts

vars == <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
          planFrozen, planRetained, worldPublished, hasEvent,
          plannedSource, plannedDestination, plannedCatalog, plannedLots,
          plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
          eventWritten, projectionWritten, reservationsWritten, countsWritten, receiptWritten,
          visibleSource, visibleDestination, visibleCatalog, visibleLots,
          visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

Init ==
  /\ state = "none" /\ frozenIntent = NoIntent /\ firstIntent = NoIntent
  /\ retryIntent = NoIntent /\ retryOutcome = "none"
  /\ planFrozen = FALSE /\ planRetained = FALSE /\ worldPublished = FALSE
  /\ hasEvent = FALSE
  /\ plannedSource = 2 /\ plannedDestination = 0
  /\ plannedCatalog = 0 /\ plannedLots = 0 /\ plannedPlacementNodes = 0
  /\ plannedTraceability = 0 /\ plannedReservations = 0 /\ plannedCounts = 0
  /\ eventWritten = FALSE /\ projectionWritten = FALSE
  /\ reservationsWritten = FALSE /\ countsWritten = FALSE /\ receiptWritten = FALSE
  /\ visibleSource = 2 /\ visibleDestination = 0
  /\ visibleCatalog = 0 /\ visibleLots = 0 /\ visiblePlacementNodes = 0
  /\ visibleTraceability = 0 /\ visibleReservations = 0 /\ visibleCounts = 0

\* Begin freezes stock plus every separately hashed next-world component.
Begin(intent) ==
  /\ state = "none" /\ intent \in Intents
  /\ state' = "applying" /\ frozenIntent' = intent /\ firstIntent' = intent
  /\ retryIntent' = NoIntent /\ retryOutcome' = "none"
  /\ planFrozen' = TRUE /\ planRetained' = TRUE /\ worldPublished' = FALSE
  /\ hasEvent' = IntentHasEvent(intent)
  /\ plannedSource' = PlanSource(intent) /\ plannedDestination' = PlanDestination(intent)
  /\ plannedCatalog' = PlanCatalog(intent) /\ plannedLots' = PlanLots(intent)
  /\ plannedPlacementNodes' = PlanPlacementNodes(intent)
  /\ plannedTraceability' = PlanTraceability(intent)
  /\ plannedReservations' = PlanReservations(intent) /\ plannedCounts' = PlanCounts(intent)
  /\ eventWritten' = ~IntentHasEvent(intent) /\ projectionWritten' = ~IntentHasEvent(intent)
  /\ UNCHANGED <<reservationsWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

Retry(intent) ==
  /\ state \in {"applying", "completed"} /\ intent \in Intents
  /\ retryIntent' = intent
  /\ retryOutcome' = IF intent = frozenIntent THEN "exact" ELSE "changed"
  /\ UNCHANGED <<state, frozenIntent, firstIntent, planFrozen, planRetained,
                 worldPublished, hasEvent, plannedSource, plannedDestination,
                 plannedCatalog, plannedLots, plannedPlacementNodes, plannedTraceability,
                 plannedReservations, plannedCounts, eventWritten, projectionWritten,
                 reservationsWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

\* These five writes stage only plan pieces; no visible root changes here.
WriteEvent ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ hasEvent /\ ~eventWritten
  /\ eventWritten' = TRUE
  /\ UNCHANGED <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, planRetained, worldPublished, hasEvent,
                 plannedSource, plannedDestination, plannedCatalog, plannedLots,
                 plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
                 projectionWritten, reservationsWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

WriteProjection ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ hasEvent /\ ~projectionWritten
  /\ projectionWritten' = TRUE
  /\ UNCHANGED <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, planRetained, worldPublished, hasEvent,
                 plannedSource, plannedDestination, plannedCatalog, plannedLots,
                 plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
                 eventWritten, reservationsWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

WriteReservations ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ ~reservationsWritten
  /\ reservationsWritten' = TRUE
  /\ UNCHANGED <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, planRetained, worldPublished, hasEvent,
                 plannedSource, plannedDestination, plannedCatalog, plannedLots,
                 plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
                 eventWritten, projectionWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

WriteCounts ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ ~countsWritten
  /\ countsWritten' = TRUE
  /\ UNCHANGED <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, planRetained, worldPublished, hasEvent,
                 plannedSource, plannedDestination, plannedCatalog, plannedLots,
                 plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
                 eventWritten, projectionWritten, reservationsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

WriteReceipt ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ ~receiptWritten
  /\ receiptWritten' = TRUE
  /\ UNCHANGED <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, planRetained, worldPublished, hasEvent,
                 plannedSource, plannedDestination, plannedCatalog, plannedLots,
                 plannedPlacementNodes, plannedTraceability, plannedReservations, plannedCounts,
                 eventWritten, projectionWritten, reservationsWritten, countsWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

\* Publication changes stock, catalogue, lot, placement-node, traceability, claim, and count roots together.
PublishWorld ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ ~worldPublished
  /\ eventWritten /\ projectionWritten /\ reservationsWritten /\ countsWritten /\ receiptWritten
  /\ worldPublished' = TRUE
  /\ visibleSource' = plannedSource /\ visibleDestination' = plannedDestination
  /\ visibleCatalog' = plannedCatalog /\ visibleLots' = plannedLots
  /\ visiblePlacementNodes' = plannedPlacementNodes /\ visibleTraceability' = plannedTraceability
  /\ visibleReservations' = plannedReservations /\ visibleCounts' = plannedCounts
  /\ UNCHANGED <<state, frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, planRetained, hasEvent, plannedSource, plannedDestination,
                 plannedCatalog, plannedLots, plannedPlacementNodes, plannedTraceability,
                 plannedReservations, plannedCounts, eventWritten, projectionWritten,
                 reservationsWritten, countsWritten, receiptWritten>>

\* A crash after publication keeps the plan; this separate write only compacts it.
CompactOperation ==
  /\ state = "applying" /\ planFrozen /\ planRetained /\ worldPublished
  /\ state' = "completed" /\ planRetained' = FALSE
  /\ UNCHANGED <<frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, worldPublished, hasEvent, plannedSource, plannedDestination,
                 plannedCatalog, plannedLots, plannedPlacementNodes, plannedTraceability,
                 plannedReservations, plannedCounts, eventWritten, projectionWritten,
                 reservationsWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

Abort ==
  /\ state = "applying" /\ ~worldPublished
  /\ state' = "aborted" /\ planRetained' = FALSE
  /\ UNCHANGED <<frozenIntent, firstIntent, retryIntent, retryOutcome,
                 planFrozen, worldPublished, hasEvent, plannedSource, plannedDestination,
                 plannedCatalog, plannedLots, plannedPlacementNodes, plannedTraceability,
                 plannedReservations, plannedCounts, eventWritten, projectionWritten,
                 reservationsWritten, countsWritten, receiptWritten,
                 visibleSource, visibleDestination, visibleCatalog, visibleLots,
                 visiblePlacementNodes, visibleTraceability, visibleReservations, visibleCounts>>

Next ==
  \/ \E intent \in Intents: Begin(intent)
  \/ \E intent \in Intents: Retry(intent)
  \/ WriteEvent \/ WriteProjection \/ WriteReservations \/ WriteCounts \/ WriteReceipt
  \/ PublishWorld \/ CompactOperation \/ Abort

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ state \in {"none", "applying", "completed", "aborted"}
  /\ frozenIntent \in Intents \cup {NoIntent} /\ firstIntent \in Intents \cup {NoIntent}
  /\ retryIntent \in Intents \cup {NoIntent} /\ retryOutcome \in RetryOutcomes
  /\ planFrozen \in BOOLEAN /\ planRetained \in BOOLEAN /\ worldPublished \in BOOLEAN
  /\ hasEvent \in BOOLEAN /\ eventWritten \in BOOLEAN /\ projectionWritten \in BOOLEAN
  /\ reservationsWritten \in BOOLEAN /\ countsWritten \in BOOLEAN /\ receiptWritten \in BOOLEAN
  /\ plannedSource \in 0..2 /\ plannedDestination \in 0..2
  /\ plannedCatalog \in 0..2 /\ plannedLots \in 0..2 /\ plannedPlacementNodes \in 0..2
  /\ plannedTraceability \in 0..2 /\ plannedReservations \in 0..2 /\ plannedCounts \in 0..2
  /\ visibleSource \in 0..2 /\ visibleDestination \in 0..2
  /\ visibleCatalog \in 0..2 /\ visibleLots \in 0..2 /\ visiblePlacementNodes \in 0..2
  /\ visibleTraceability \in 0..2 /\ visibleReservations \in 0..2 /\ visibleCounts \in 0..2

FrozenIntentNeverChanges == state = "none" \/ frozenIntent = firstIntent

RetryOutcomeMatchesFrozenIntent ==
  \/ retryOutcome = "none" /\ retryIntent = NoIntent
  \/ retryOutcome = "exact" /\ retryIntent = frozenIntent
  \/ retryOutcome = "changed" /\ retryIntent # frozenIntent

ApplyingHasCompletePlan ==
  state # "applying" \/
    /\ planFrozen /\ planRetained /\ hasEvent = IntentHasEvent(frozenIntent)
    /\ plannedSource = PlanSource(frozenIntent) /\ plannedDestination = PlanDestination(frozenIntent)
    /\ plannedCatalog = PlanCatalog(frozenIntent) /\ plannedLots = PlanLots(frozenIntent)
    /\ plannedPlacementNodes = PlanPlacementNodes(frozenIntent)
    /\ plannedTraceability = PlanTraceability(frozenIntent)
    /\ plannedReservations = PlanReservations(frozenIntent) /\ plannedCounts = PlanCounts(frozenIntent)

EventlessPlansSkipMissingWrites == state = "none" \/ hasEvent \/ (eventWritten /\ projectionWritten)

PartialWritesStayInvisible ==
  worldPublished \/
    /\ visibleSource = 2 /\ visibleDestination = 0 /\ visibleCatalog = 0 /\ visibleLots = 0
    /\ visiblePlacementNodes = 0 /\ visibleTraceability = 0
    /\ visibleReservations = 0 /\ visibleCounts = 0

PublishedMeansEveryWriteExists ==
  ~worldPublished \/
    /\ eventWritten /\ projectionWritten /\ reservationsWritten /\ countsWritten /\ receiptWritten

CompletedMeansPublished == state # "completed" \/ worldPublished
VisibleQuantityConserved == visibleSource + visibleDestination = 2

PublishedWorldMatchesFrozenPlan ==
  ~worldPublished \/
    /\ visibleSource = plannedSource /\ visibleDestination = plannedDestination
    /\ visibleCatalog = plannedCatalog /\ visibleLots = plannedLots
    /\ visiblePlacementNodes = plannedPlacementNodes /\ visibleTraceability = plannedTraceability
    /\ visibleReservations = plannedReservations /\ visibleCounts = plannedCounts

PlanRetainedOnlyWhileApplying == planRetained = (state = "applying")
PublishedWorldCannotAbort == state # "aborted" \/ ~worldPublished

=============================================================================
