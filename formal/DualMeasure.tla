---------------------------- MODULE DualMeasure ----------------------------
EXTENDS Integers

\* Finite admissible catch-weight interval for each handled piece.
AllowedWeightPerPiece == 8..12
\* Derive the minimum admissible weight from the finite per-piece interval.
MinAllowedWeightPerPiece == CHOOSE weight \in AllowedWeightPerPiece:
  \A candidate \in AllowedWeightPerPiece: weight <= candidate
\* Derive the maximum admissible weight from the finite per-piece interval.
MaxAllowedWeightPerPiece == CHOOSE weight \in AllowedWeightPerPiece:
  \A candidate \in AllowedWeightPerPiece: weight >= candidate

\* Piece counts at A/B, measured weights at A/B, and explicit cumulative weight adjustment.
VARIABLES piecesA, piecesB, weightA, weightB, weightAdjustment

\* Complete state tuple advanced by the dual-measure temporal specification.
vars == <<piecesA, piecesB, weightA, weightB, weightAdjustment>>

\* Accept empty positions only at zero weight and nonempty positions only inside the per-piece weight bounds.
ValidPosition(pieces, weight) ==
  \/ pieces = 0 /\ weight = 0
  \/ pieces > 0
      /\ weight >= MinAllowedWeightPerPiece * pieces
      /\ weight <= MaxAllowedWeightPerPiece * pieces

\* Start with two pieces and twenty weight units at A, with B empty and no adjustment.
Init ==
  /\ piecesA = 2
  /\ piecesB = 0
  /\ weightA = 20
  /\ weightB = 0
  /\ weightAdjustment = 0

\* Move one piece plus an admissible exact weight from A to B while preserving valid positions.
MoveAToB(movedWeight) ==
  /\ piecesA > 0
  /\ movedWeight \in AllowedWeightPerPiece
  /\ movedWeight <= weightA
  /\ ValidPosition(piecesA - 1, weightA - movedWeight)
  /\ ValidPosition(piecesB + 1, weightB + movedWeight)
  /\ piecesA' = piecesA - 1
  /\ piecesB' = piecesB + 1
  /\ weightA' = weightA - movedWeight
  /\ weightB' = weightB + movedWeight
  /\ UNCHANGED weightAdjustment

\* Move one piece plus an admissible exact weight from B to A while preserving valid positions.
MoveBToA(movedWeight) ==
  /\ piecesB > 0
  /\ movedWeight \in AllowedWeightPerPiece
  /\ movedWeight <= weightB
  /\ ValidPosition(piecesB - 1, weightB - movedWeight)
  /\ ValidPosition(piecesA + 1, weightA + movedWeight)
  /\ piecesB' = piecesB - 1
  /\ piecesA' = piecesA + 1
  /\ weightB' = weightB - movedWeight
  /\ weightA' = weightA + movedWeight
  /\ UNCHANGED weightAdjustment

\* Record a one-unit measurement correction at A while retaining a valid A position.
AdjustWeightA(delta) ==
  /\ delta \in {-1, 1}
  /\ weightAdjustment + delta \in -4..4
  /\ ValidPosition(piecesA, weightA + delta)
  /\ weightA' = weightA + delta
  /\ weightAdjustment' = weightAdjustment + delta
  /\ UNCHANGED <<piecesA, piecesB, weightB>>

\* Record a one-unit measurement correction at B while retaining a valid B position.
AdjustWeightB(delta) ==
  /\ delta \in {-1, 1}
  /\ weightAdjustment + delta \in -4..4
  /\ ValidPosition(piecesB, weightB + delta)
  /\ weightB' = weightB + delta
  /\ weightAdjustment' = weightAdjustment + delta
  /\ UNCHANGED <<piecesA, piecesB, weightA>>

\* Admit only one-piece moves and bounded explicit weight adjustments.
Next ==
  \/ \E w \in AllowedWeightPerPiece: MoveAToB(w)
  \/ \E w \in AllowedWeightPerPiece: MoveBToA(w)
  \/ \E d \in {-1, 1}: AdjustWeightA(d)
  \/ \E d \in {-1, 1}: AdjustWeightB(d)

\* Allow stuttering around the complete dual-measure transition relation.
Spec == Init /\ [][Next]_vars

\* Keep piece counts, weights, and the cumulative adjustment inside the finite exploration bounds.
TypeOK ==
  /\ piecesA \in 0..2
  /\ piecesB \in 0..2
  /\ weightA \in 0..24
  /\ weightB \in 0..24
  /\ weightAdjustment \in -4..4

\* Preserve the two-piece primary handling quantity across every transition.
PrimaryQuantityConserved == piecesA + piecesB = 2

\* Require total measured weight to differ from the initial twenty only by the recorded adjustment.
SecondaryMeasureHasExplicitCause ==
  weightA + weightB = 20 + weightAdjustment

\* Guard-enforced regression check: every writing action applies ValidPosition; this is not independent evidence.
\* Require both current positions to remain inside the configured catch-weight tolerance.
CatchWeightToleranceHeld ==
  /\ ValidPosition(piecesA, weightA)
  /\ ValidPosition(piecesB, weightB)

=============================================================================
