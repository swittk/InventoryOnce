-------------------------- MODULE ReservationSafety ---------------------------
EXTENDS Integers

Statuses == {"none", "active", "released", "consumed", "expired"}

VARIABLES onHand, r1, r2, consumeCount1, consumeCount2

vars == <<onHand, r1, r2, consumeCount1, consumeCount2>>

ActiveCount == (IF r1 = "active" THEN 1 ELSE 0)
             + (IF r2 = "active" THEN 1 ELSE 0)

Available == onHand - ActiveCount

Init ==
  /\ onHand = 2
  /\ r1 = "none"
  /\ r2 = "none"
  /\ consumeCount1 = 0
  /\ consumeCount2 = 0

Reserve1 ==
  /\ r1 = "none"
  /\ Available >= 1
  /\ r1' = "active"
  /\ UNCHANGED <<onHand, r2, consumeCount1, consumeCount2>>

Reserve2 ==
  /\ r2 = "none"
  /\ Available >= 1
  /\ r2' = "active"
  /\ UNCHANGED <<onHand, r1, consumeCount1, consumeCount2>>

Consume1 ==
  /\ r1 = "active"
  /\ onHand >= 1
  /\ r1' = "consumed"
  /\ onHand' = onHand - 1
  /\ consumeCount1' = consumeCount1 + 1
  /\ UNCHANGED <<r2, consumeCount2>>

Consume2 ==
  /\ r2 = "active"
  /\ onHand >= 1
  /\ r2' = "consumed"
  /\ onHand' = onHand - 1
  /\ consumeCount2' = consumeCount2 + 1
  /\ UNCHANGED <<r1, consumeCount1>>

Release1 ==
  /\ r1 = "active"
  /\ r1' = "released"
  /\ UNCHANGED <<onHand, r2, consumeCount1, consumeCount2>>

Release2 ==
  /\ r2 = "active"
  /\ r2' = "released"
  /\ UNCHANGED <<onHand, r1, consumeCount1, consumeCount2>>

Expire1 ==
  /\ r1 = "active"
  /\ r1' = "expired"
  /\ UNCHANGED <<onHand, r2, consumeCount1, consumeCount2>>

Expire2 ==
  /\ r2 = "active"
  /\ r2' = "expired"
  /\ UNCHANGED <<onHand, r1, consumeCount1, consumeCount2>>

Next ==
  \/ Reserve1
  \/ Reserve2
  \/ Consume1
  \/ Consume2
  \/ Release1
  \/ Release2
  \/ Expire1
  \/ Expire2

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ onHand \in 0..2
  /\ r1 \in Statuses
  /\ r2 \in Statuses
  /\ consumeCount1 \in 0..1
  /\ consumeCount2 \in 0..1

NoOverReservation == Available >= 0

\* Scope note: TypeOK deliberately bounds each consume counter to 0..1, so
\* NoDoubleConsume names the lifecycle obligation but is not an independent
\* counterexample source in this finite domain. Reservation executable tests
\* exercise the same single-consume and terminal-lifecycle contract.
NoDoubleConsume ==
  /\ consumeCount1 <= 1
  /\ consumeCount2 <= 1

ConsumedCountMatchesStock ==
  onHand = 2 - consumeCount1 - consumeCount2

ConsumedLifecycleMatchesCount ==
  /\ (r1 = "consumed" <=> consumeCount1 = 1)
  /\ (r2 = "consumed" <=> consumeCount2 = 1)

ReleasedOrExpiredWasNeverConsumed ==
  /\ (r1 \in {"released", "expired"} => consumeCount1 = 0)
  /\ (r2 \in {"released", "expired"} => consumeCount2 = 0)

=============================================================================
