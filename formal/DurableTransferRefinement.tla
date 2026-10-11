--------------------- MODULE DurableTransferRefinement ---------------------
EXTENDS Integers

VARIABLES phase, transactionWritten, sourceProjectionWritten,
          destinationProjectionWritten, visibleSource, visibleDestination

vars == <<phase, transactionWritten, sourceProjectionWritten,
          destinationProjectionWritten, visibleSource, visibleDestination>>

Init ==
  /\ phase = "ready"
  /\ transactionWritten = FALSE
  /\ sourceProjectionWritten = FALSE
  /\ destinationProjectionWritten = FALSE
  /\ visibleSource = 2
  /\ visibleDestination = 0

Start ==
  /\ phase = "ready"
  /\ phase' = "pending"
  /\ UNCHANGED <<transactionWritten, sourceProjectionWritten,
                 destinationProjectionWritten, visibleSource, visibleDestination>>

WriteTransaction ==
  /\ phase = "pending"
  /\ ~transactionWritten
  /\ transactionWritten' = TRUE
  /\ UNCHANGED <<phase, sourceProjectionWritten, destinationProjectionWritten,
                 visibleSource, visibleDestination>>

\* The durable adapter stages the complete event-derived projection in one physical write.
\* Source and destination facts therefore become durable at the same boundary.
WriteProjection ==
  /\ phase = "pending"
  /\ ~sourceProjectionWritten
  /\ ~destinationProjectionWritten
  /\ sourceProjectionWritten' = TRUE
  /\ destinationProjectionWritten' = TRUE
  /\ UNCHANGED <<phase, transactionWritten, visibleSource, visibleDestination>>

Complete ==
  /\ phase = "pending"
  /\ transactionWritten
  /\ sourceProjectionWritten
  /\ destinationProjectionWritten
  /\ phase' = "done"
  /\ visibleSource' = visibleSource - 1
  /\ visibleDestination' = visibleDestination + 1
  /\ UNCHANGED <<transactionWritten, sourceProjectionWritten,
                 destinationProjectionWritten>>

Next ==
  \/ Start
  \/ WriteTransaction
  \/ WriteProjection
  \/ Complete

\* Deliberate forbidden transition used only by the mutation gate: stage one side alone.
SplitSourceProjectionMutation ==
  /\ phase = "pending"
  /\ ~sourceProjectionWritten
  /\ sourceProjectionWritten' = TRUE
  /\ UNCHANGED <<phase, transactionWritten, destinationProjectionWritten,
                 visibleSource, visibleDestination>>

SplitProjectionMutationNext == Next \/ SplitSourceProjectionMutation

Spec == Init /\ [][Next]_vars
SplitProjectionMutationSpec == Init /\ [][SplitProjectionMutationNext]_vars

AbstractStatus == IF phase = "done" THEN "done" ELSE "ready"

HL == INSTANCE AbstractTransfer
  WITH source <- visibleSource,
       destination <- visibleDestination,
       status <- AbstractStatus

RefinesAbstractTransfer == HL!Spec
AbstractTypeOK == HL!TypeOK
AbstractConserved == HL!Conserved

TypeOK ==
  /\ phase \in {"ready", "pending", "done"}
  /\ transactionWritten \in BOOLEAN
  /\ sourceProjectionWritten \in BOOLEAN
  /\ destinationProjectionWritten \in BOOLEAN
  /\ visibleSource \in 0..2
  /\ visibleDestination \in 0..2

PartialWritesRefineToStuttering ==
  phase # "done" => /\ visibleSource = 2 /\ visibleDestination = 0

\* Both direct-placement facts belong to the same staged projection image.
ProjectionWriteIsAtomic ==
  sourceProjectionWritten = destinationProjectionWritten

=============================================================================
