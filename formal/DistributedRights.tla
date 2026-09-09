-------------------------- MODULE DistributedRights --------------------------
EXTENDS Integers

\* Rights held/free at sites A/B plus physical stock and cumulative consumption.
VARIABLES freeA, heldA, freeB, heldB, stock, consumed

\* Complete state tuple advanced by the temporal specification.
vars == <<freeA, heldA, freeB, heldB, stock, consumed>>

\* Start with four free rights backed by four physical units and no consumption.
Init ==
  /\ freeA = 2
  /\ heldA = 0
  /\ freeB = 2
  /\ heldB = 0
  /\ stock = 4
  /\ consumed = 0

\* Move one free A right into A-held escrow without changing physical stock.
ReserveA ==
  /\ freeA > 0
  /\ freeA' = freeA - 1
  /\ heldA' = heldA + 1
  /\ UNCHANGED <<freeB, heldB, stock, consumed>>

\* Move one free B right into B-held escrow without changing physical stock.
ReserveB ==
  /\ freeB > 0
  /\ freeB' = freeB - 1
  /\ heldB' = heldB + 1
  /\ UNCHANGED <<freeA, heldA, stock, consumed>>

\* Return one A-held right to A free capacity.
ReleaseA ==
  /\ heldA > 0
  /\ heldA' = heldA - 1
  /\ freeA' = freeA + 1
  /\ UNCHANGED <<freeB, heldB, stock, consumed>>

\* Return one B-held right to B free capacity.
ReleaseB ==
  /\ heldB > 0
  /\ heldB' = heldB - 1
  /\ freeB' = freeB + 1
  /\ UNCHANGED <<freeA, heldA, stock, consumed>>

\* Consume one physical unit through an A-held reservation right.
ConsumeReservedA ==
  /\ heldA > 0
  /\ stock > 0
  /\ heldA' = heldA - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<freeA, freeB, heldB>>

\* Consume one physical unit through a B-held reservation right.
ConsumeReservedB ==
  /\ heldB > 0
  /\ stock > 0
  /\ heldB' = heldB - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<freeA, heldA, freeB>>

\* Consume one physical unit using one free A right.
ConsumeUnreservedA ==
  /\ freeA > 0
  /\ stock > 0
  /\ freeA' = freeA - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<heldA, freeB, heldB>>

\* Consume one physical unit using one free B right.
ConsumeUnreservedB ==
  /\ freeB > 0
  /\ stock > 0
  /\ freeB' = freeB - 1
  /\ stock' = stock - 1
  /\ consumed' = consumed + 1
  /\ UNCHANGED <<freeA, heldA, heldB>>

\* Transfer one unheld right from site A to site B.
TransferFreeAToB ==
  /\ freeA > 0
  /\ freeA' = freeA - 1
  /\ freeB' = freeB + 1
  /\ UNCHANGED <<heldA, heldB, stock, consumed>>

\* Transfer one unheld right from site B to site A.
TransferFreeBToA ==
  /\ freeB > 0
  /\ freeB' = freeB - 1
  /\ freeA' = freeA + 1
  /\ UNCHANGED <<heldA, heldB, stock, consumed>>

\* Admit exactly the reserve, release, consume, and free-right transfer actions.
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

\* Allow stuttering around the complete rights-transition relation.
Spec == Init /\ [][Next]_vars

\* Keep every bounded counter inside the finite four-unit model domain.
TypeOK ==
  /\ freeA \in 0..4
  /\ heldA \in 0..4
  /\ freeB \in 0..4
  /\ heldB \in 0..4
  /\ stock \in 0..4
  /\ consumed \in 0..4

\* Require all free and held rights together to equal remaining physical stock.
RightsExactlyBackRemainingStock ==
  freeA + heldA + freeB + heldB = stock

\* Require remaining stock plus cumulative consumption to preserve the initial four units.
PhysicalQuantityAccounting == stock + consumed = 4

\* PhysicalQuantityAccounting plus nonnegative stock already forbids oversell; do not duplicate it as separate evidence.

\* Require held reservation rights never to exceed the remaining physical stock.
HeldRightsRemainPhysicallyBacked ==
  heldA + heldB <= stock

=============================================================================
