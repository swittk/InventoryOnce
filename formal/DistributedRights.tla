-------------------------- MODULE DistributedRights --------------------------
EXTENDS Integers

VARIABLES freeA, heldA, freeB, heldB, stock, consumed

vars == <<freeA, heldA, freeB, heldB, stock, consumed>>

Init ==
  /\ freeA = 2
  /\ heldA = 0
  /\ freeB = 2
  /\ heldB = 0
  /\ stock = 4
  /\ consumed = 0

ReserveA ==
  /\ freeA > 0
  /\ freeA' = freeA - 1
  /\ heldA' = heldA + 1
  /\ UNCHANGED <<freeB, heldB, stock, consumed>>

ReserveB ==
  /\ freeB > 0
  /\ freeB' = freeB - 1
  /\ heldB' = heldB + 1
  /\ UNCHANGED <<freeA, heldA, stock, consumed>>

ReleaseA ==
  /\ heldA > 0
  /\ heldA' = heldA - 1
  /\ freeA' = freeA + 1
  /\ UNCHANGED <<freeB, heldB, stock, consumed>>

ReleaseB ==
  /\ heldB > 0
  /\ heldB' = heldB - 1
  /\ freeB' = freeB + 1
  /\ UNCHANGED <<freeA, heldA, stock, consumed>>

ConsumeReservedA ==
  /\ heldA > 0
  /\ stock > 0
  /\ heldA' = heldA - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<freeA, freeB, heldB>>

ConsumeReservedB ==
  /\ heldB > 0
  /\ stock > 0
  /\ heldB' = heldB - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<freeA, heldA, freeB>>

ConsumeUnreservedA ==
  /\ freeA > 0
  /\ stock > 0
  /\ freeA' = freeA - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<heldA, freeB, heldB>>

ConsumeUnreservedB ==
  /\ freeB > 0
  /\ stock > 0
  /\ freeB' = freeB - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<freeA, heldA, heldB>>

TransferFreeAToB ==
  /\ freeA > 0
  /\ freeA' = freeA - 1
  /\ freeB' = freeB + 1
  /\ UNCHANGED <<heldA, heldB, stock, consumed>>

TransferFreeBToA ==
  /\ freeB > 0
  /\ freeB' = freeB - 1
  /\ freeA' = freeA + 1
  /\ UNCHANGED <<heldA, heldB, stock, consumed>>

Next ==
  \/ ReserveA
  \/ ReserveB
  \/ ReleaseA
  \/ ReleaseB
  \/ ConsumeReservedA
  \/ ConsumeReservedB
  \/ ConsumeUnreservedA
  \/ ConsumeUnreservedB
  \/ TransferFreeAToB
  \/ TransferFreeBToA

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ freeA \in 0..4
  /\ heldA \in 0..4
  /\ freeB \in 0..4
  /\ heldB \in 0..4
  /\ stock \in 0..4
  /\ consumed \in 0..4

RightsExactlyBackRemainingStock ==
  freeA + heldA + freeB + heldB = stock

PhysicalQuantityAccounting == stock + consumed = 4

NoOversell == consumed <= 4

HeldRightsRemainPhysicallyBacked ==
  heldA + heldB <= stock

=============================================================================
