---------------------------- MODULE DualMeasure ----------------------------
EXTENDS Integers

AllowedWeightPerPiece == 8..12
MinAllowedWeightPerPiece == CHOOSE weight \in AllowedWeightPerPiece:
  \A candidate \in AllowedWeightPerPiece: weight <= candidate
MaxAllowedWeightPerPiece == CHOOSE weight \in AllowedWeightPerPiece:
  \A candidate \in AllowedWeightPerPiece: weight >= candidate

VARIABLES piecesA, piecesB, weightA, weightB, weightAdjustment

vars == <<piecesA, piecesB, weightA, weightB, weightAdjustment>>

ValidPosition(pieces, weight) ==
  \/ pieces = 0 /\ weight = 0
  \/ pieces > 0
      /\ weight >= MinAllowedWeightPerPiece * pieces
      /\ weight <= MaxAllowedWeightPerPiece * pieces

Init ==
  /\ piecesA = 2
  /\ piecesB = 0
  /\ weightA = 20
  /\ weightB = 0
  /\ weightAdjustment = 0

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

AdjustWeightA(delta) ==
  /\ delta \in {-1, 1}
  /\ weightAdjustment + delta \in -4..4
  /\ ValidPosition(piecesA, weightA + delta)
  /\ weightA' = weightA + delta
  /\ weightAdjustment' = weightAdjustment + delta
  /\ UNCHANGED <<piecesA, piecesB, weightB>>

AdjustWeightB(delta) ==
  /\ delta \in {-1, 1}
  /\ weightAdjustment + delta \in -4..4
  /\ ValidPosition(piecesB, weightB + delta)
  /\ weightB' = weightB + delta
  /\ weightAdjustment' = weightAdjustment + delta
  /\ UNCHANGED <<piecesA, piecesB, weightA>>

Next ==
  \/ \E w \in AllowedWeightPerPiece: MoveAToB(w)
  \/ \E w \in AllowedWeightPerPiece: MoveBToA(w)
  \/ \E d \in {-1, 1}: AdjustWeightA(d)
  \/ \E d \in {-1, 1}: AdjustWeightB(d)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ piecesA \in 0..2
  /\ piecesB \in 0..2
  /\ weightA \in 0..24
  /\ weightB \in 0..24
  /\ weightAdjustment \in -4..4

PrimaryQuantityConserved == piecesA + piecesB = 2

SecondaryMeasureHasExplicitCause ==
  weightA + weightB = 20 + weightAdjustment

\* Guard-enforced regression check: every writing action applies ValidPosition; this is not independent evidence.
CatchWeightToleranceHeld ==
  /\ ValidPosition(piecesA, weightA)
  /\ ValidPosition(piecesB, weightB)

=============================================================================
