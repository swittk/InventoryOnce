--------------------------- MODULE PackagingIdentity --------------------------
EXTENDS Integers

\* Location-specific intact 20/24-pack quantities plus loose stock at locations A and B.
VARIABLES a20, b20, a24, b24, looseA, looseB

vars == <<a20, b20, a24, b24, looseA, looseB>>

Init ==
  /\ a20 = 40
  /\ b20 = 0
  /\ a24 = 48
  /\ b24 = 0
  /\ looseA = 0
  /\ looseB = 0

Move20AToB ==
  /\ a20 >= 20
  /\ a20' = a20 - 20
  /\ b20' = b20 + 20
  /\ UNCHANGED <<a24, b24, looseA, looseB>>

Move20BToA ==
  /\ b20 >= 20
  /\ b20' = b20 - 20
  /\ a20' = a20 + 20
  /\ UNCHANGED <<a24, b24, looseA, looseB>>

Move24AToB ==
  /\ a24 >= 24
  /\ a24' = a24 - 24
  /\ b24' = b24 + 24
  /\ UNCHANGED <<a20, b20, looseA, looseB>>

Move24BToA ==
  /\ b24 >= 24
  /\ b24' = b24 - 24
  /\ a24' = a24 + 24
  /\ UNCHANGED <<a20, b20, looseA, looseB>>

Unpack20A ==
  /\ a20 >= 20
  /\ a20' = a20 - 20
  /\ looseA' = looseA + 20
  /\ UNCHANGED <<b20, a24, b24, looseB>>

Unpack20B ==
  /\ b20 >= 20
  /\ b20' = b20 - 20
  /\ looseB' = looseB + 20
  /\ UNCHANGED <<a20, a24, b24, looseA>>

Unpack24A ==
  /\ a24 >= 24
  /\ a24' = a24 - 24
  /\ looseA' = looseA + 24
  /\ UNCHANGED <<a20, b20, b24, looseB>>

Unpack24B ==
  /\ b24 >= 24
  /\ b24' = b24 - 24
  /\ looseB' = looseB + 24
  /\ UNCHANGED <<a20, b20, a24, looseA>>

Pack20A ==
  /\ looseA >= 20
  /\ looseA' = looseA - 20
  /\ a20' = a20 + 20
  /\ UNCHANGED <<b20, a24, b24, looseB>>

Pack20B ==
  /\ looseB >= 20
  /\ looseB' = looseB - 20
  /\ b20' = b20 + 20
  /\ UNCHANGED <<a20, a24, b24, looseA>>

Pack24A ==
  /\ looseA >= 24
  /\ looseA' = looseA - 24
  /\ a24' = a24 + 24
  /\ UNCHANGED <<a20, b20, b24, looseB>>

Pack24B ==
  /\ looseB >= 24
  /\ looseB' = looseB - 24
  /\ b24' = b24 + 24
  /\ UNCHANGED <<a20, b20, a24, looseA>>

Next ==
  \/ Move20AToB
  \/ Move20BToA
  \/ Move24AToB
  \/ Move24BToA
  \/ Unpack20A
  \/ Unpack20B
  \/ Unpack24A
  \/ Unpack24B
  \/ Pack20A
  \/ Pack20B
  \/ Pack24A
  \/ Pack24B

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ a20 \in 0..88
  /\ b20 \in 0..88
  /\ a24 \in 0..88
  /\ b24 \in 0..88
  /\ looseA \in 0..88
  /\ looseB \in 0..88

PhysicalQuantityConserved ==
  a20 + b20 + a24 + b24 + looseA + looseB = 88

EveryIntact20BoxIsWhole ==
  /\ a20 % 20 = 0
  /\ b20 % 20 = 0

EveryIntact24BoxIsWhole ==
  /\ a24 % 24 = 0
  /\ b24 % 24 = 0

=============================================================================
