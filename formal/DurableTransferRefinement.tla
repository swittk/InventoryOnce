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

WriteSourceProjection ==
  /\ phase = "pending"
  /\ ~sourceProjectionWritten
  /\ sourceProjectionWritten' = TRUE
  /\ UNCHANGED <<phase, transactionWritten, destinationProjectionWritten,
                 visibleSource, visibleDestination>>

WriteDestinationProjection ==
  /\ phase = "pending"
  /\ ~destinationProjectionWritten
  /\ destinationProjectionWritten' = TRUE
  /\ UNCHANGED <<phase, transactionWritten, sourceProjectionWritten,
                 visibleSource, visibleDestination>>

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
  \/ WriteSourceProjection
  \/ WriteDestinationProjection
  \/ Complete

Spec == Init /\ [][Next]_vars

AbstractStatus == IF phase = "done" THEN "done" ELSE "ready"

HL == INSTANCE AbstractTransfer
  WITH source <- visibleSource,
       destination <- visibleDestination,
       status <- AbstractStatus

RefinesAbstractTransfer == HL!Spec

TypeOK ==
  /\ phase \in {"ready", "pending", "done"}
  /\ transactionWritten \in BOOLEAN
  /\ sourceProjectionWritten \in BOOLEAN
  /\ destinationProjectionWritten \in BOOLEAN
  /\ visibleSource \in 0..2
  /\ visibleDestination \in 0..2

PartialWritesRefineToStuttering ==
  phase # "done" => /\ visibleSource = 2 /\ visibleDestination = 0

=============================================================================
