--------------------------- MODULE PhysicalCount ---------------------------
EXTENDS Integers

CountStates == {"none", "started", "observed", "completed"}

VARIABLES actual, book, countState, snapshotBook, movementSinceStart,
          movementAtObservation, observed

vars == <<actual, book, countState, snapshotBook, movementSinceStart,
          movementAtObservation, observed>>

Tracking == countState \in {"started", "observed"}

Init ==
  /\ actual = 2
  /\ book = 2
  /\ countState = "none"
  /\ snapshotBook = 0
  /\ movementSinceStart = 0
  /\ movementAtObservation = 0
  /\ observed = 0

\* After Observe, only recorded movement may change actual and book together so Complete keeps its frozen discrepancy.
UnrecordedLoss ==
  /\ countState \in {"none", "started"}
  /\ actual > 0
  /\ actual' = actual - 1
  /\ UNCHANGED <<book, countState, snapshotBook, movementSinceStart,
                 movementAtObservation, observed>>

\* Unrecorded physical gain before observation models count overage symmetrically with loss.
UnrecordedGain ==
  /\ countState \in {"none", "started"}
  /\ actual < 4
  /\ actual' = actual + 1
  /\ UNCHANGED <<book, countState, snapshotBook, movementSinceStart,
                 movementAtObservation, observed>>

RecordedOut ==
  /\ actual > 0
  /\ book > 0
  /\ (~Tracking \/ movementSinceStart > -2)
  /\ actual' = actual - 1
  /\ book' = book - 1
  /\ movementSinceStart' = IF Tracking THEN movementSinceStart - 1 ELSE movementSinceStart
  /\ UNCHANGED <<countState, snapshotBook, movementAtObservation, observed>>

RecordedIn ==
  /\ actual < 4
  /\ book < 4
  /\ (~Tracking \/ movementSinceStart < 2)
  /\ actual' = actual + 1
  /\ book' = book + 1
  /\ movementSinceStart' = IF Tracking THEN movementSinceStart + 1 ELSE movementSinceStart
  /\ UNCHANGED <<countState, snapshotBook, movementAtObservation, observed>>

StartCount ==
  /\ countState = "none"
  /\ countState' = "started"
  /\ snapshotBook' = book
  /\ movementSinceStart' = 0
  /\ movementAtObservation' = 0
  /\ observed' = 0
  /\ UNCHANGED <<actual, book>>

Observe ==
  /\ countState = "started"
  /\ countState' = "observed"
  /\ observed' = actual
  /\ movementAtObservation' = movementSinceStart
  /\ UNCHANGED <<actual, book, snapshotBook, movementSinceStart>>

Complete ==
  /\ countState = "observed"
  /\ LET expectedAtObservation == snapshotBook + movementAtObservation
         discrepancy == observed - expectedAtObservation
       IN book' = book + discrepancy
  /\ countState' = "completed"
  /\ UNCHANGED <<actual, snapshotBook, movementSinceStart,
                 movementAtObservation, observed>>

Next ==
  \/ UnrecordedLoss
  \/ UnrecordedGain
  \/ RecordedOut
  \/ RecordedIn
  \/ StartCount
  \/ Observe
  \/ Complete

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ actual \in 0..4
  /\ book \in 0..4
  /\ countState \in CountStates
  /\ snapshotBook \in 0..4
  /\ movementSinceStart \in -2..2
  /\ movementAtObservation \in -2..2
  /\ observed \in 0..4

RecordedMovementAccounting ==
  countState \in {"started", "observed"} =>
    book = snapshotBook + movementSinceStart

\* Scope: unrecorded drift exists only before Observe. From observed onward,
\* including completed states, only recorded movement changes actual; this checks
\* reconciliation exactness under that modeled restriction, not perpetual accuracy.
CompletedCountMatchesPhysicalReality ==
  countState # "completed" \/ book = actual

=============================================================================
