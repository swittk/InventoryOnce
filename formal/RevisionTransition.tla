------------------------- MODULE RevisionTransition -------------------------
EXTENDS Integers

\* Bounded witness for an approved 10-piece -> 1-box definition change.
\* Quantities are in physical pieces for conserved accounting.
VARIABLES oldPieces, newBoxes, receivedPieces, activeRevision,
          worldRevision, previewRevision, reserved, transferOpen,
          committed, oldReceiptTruth

vars == <<oldPieces, newBoxes, receivedPieces, activeRevision,
          worldRevision, previewRevision, reserved, transferOpen,
          committed, oldReceiptTruth>>

\* Keep bounded model checking finite while representing several competing publications.
WorldCanAdvance == worldRevision < 8

\* One immutable old receipt exists before the active definition advances.
Init ==
  /\ oldPieces = 20
  /\ newBoxes = 0
  /\ receivedPieces = 0
  /\ activeRevision = 1
  /\ worldRevision = 0
  /\ previewRevision = -1
  /\ reserved = FALSE
  /\ transferOpen = FALSE
  /\ committed = 0
  /\ oldReceiptTruth = 20

\* Publishing a new meaning does not rewrite a single old stock position.
PublishRevision ==
  /\ WorldCanAdvance
  /\ activeRevision = 1
  /\ activeRevision' = 2
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<oldPieces, newBoxes, receivedPieces, previewRevision,
                 reserved, transferOpen, committed, oldReceiptTruth>>

\* Preview is a read, not an inventory write.
Preview ==
  /\ activeRevision = 2
  /\ previewRevision' = worldRevision
  /\ UNCHANGED <<oldPieces, newBoxes, receivedPieces, activeRevision,
                 worldRevision, reserved, transferOpen, committed, oldReceiptTruth>>

\* Real subsequent receipts advance the world and invalidate stale previews.
ReceiveOld ==
  /\ WorldCanAdvance
  /\ oldPieces <= 20
  /\ committed = 0
  /\ oldPieces' = oldPieces + 10
  /\ receivedPieces' = receivedPieces + 10
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<newBoxes, activeRevision, previewRevision,
                 reserved, transferOpen, committed, oldReceiptTruth>>

\* Reservation and transfer lifecycle changes are independent blockers.
Reserve ==
  /\ WorldCanAdvance
  /\ ~reserved
  /\ committed = 0
  /\ reserved' = TRUE
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<oldPieces, newBoxes, receivedPieces, activeRevision,
                 previewRevision, transferOpen, committed, oldReceiptTruth>>

ReleaseReservation ==
  /\ WorldCanAdvance
  /\ reserved
  /\ reserved' = FALSE
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<oldPieces, newBoxes, receivedPieces, activeRevision,
                 previewRevision, transferOpen, committed, oldReceiptTruth>>

StartTransfer ==
  /\ WorldCanAdvance
  /\ ~transferOpen
  /\ committed = 0
  /\ transferOpen' = TRUE
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<oldPieces, newBoxes, receivedPieces, activeRevision,
                 previewRevision, reserved, committed, oldReceiptTruth>>

FinishTransfer ==
  /\ WorldCanAdvance
  /\ transferOpen
  /\ transferOpen' = FALSE
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<oldPieces, newBoxes, receivedPieces, activeRevision,
                 previewRevision, reserved, committed, oldReceiptTruth>>

\* A single atomic revision transition consumes all reviewed old stock and
\* publishes the exactly equivalent new unit quantity, never both half states.
Transition ==
  /\ WorldCanAdvance
  /\ activeRevision = 2
  /\ committed = 0
  /\ previewRevision = worldRevision
  /\ ~reserved
  /\ ~transferOpen
  /\ oldPieces > 0
  /\ oldPieces % 10 = 0
  /\ oldPieces' = 0
  /\ newBoxes' = oldPieces \div 10
  /\ committed' = 1
  /\ worldRevision' = worldRevision + 1
  /\ UNCHANGED <<receivedPieces, activeRevision, previewRevision,
                 reserved, transferOpen, oldReceiptTruth>>

\* Exact idempotent retry is a stutter; no second stock conversion is created.
Retry ==
  /\ committed = 1
  /\ UNCHANGED vars

Next ==
  \/ PublishRevision
  \/ Preview
  \/ ReceiveOld
  \/ Reserve
  \/ ReleaseReservation
  \/ StartTransfer
  \/ FinishTransfer
  \/ Transition
  \/ Retry

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ oldPieces \in 0..30
  /\ newBoxes \in 0..3
  /\ receivedPieces \in {0, 10}
  /\ activeRevision \in {1, 2}
  /\ worldRevision \in 0..8
  /\ previewRevision \in {-1} \cup (0..8)
  /\ reserved \in BOOLEAN
  /\ transferOpen \in BOOLEAN
  /\ committed \in {0, 1}
  /\ oldReceiptTruth \in {20}

\* The old ledger meaning survives a later prospective transition.
OriginalReceiptNeverRewritten == oldReceiptTruth = 20

\* Accounting uses one common, explicitly proven ten-piece physical basis.
ExactPhysicalQuantityConserved ==
  oldPieces + 10 * newBoxes = oldReceiptTruth + receivedPieces

\* A published v2 is required before any new-revision stock may exist.
TargetDefinitionMustBePublished ==
  committed = 1 => activeRevision = 2

\* No double conversion and no negative old-balance artifacts.
TransitionOccursAtMostOnce ==
  /\ committed \in {0, 1}
  /\ committed = 1 => oldPieces = 0

=============================================================================
