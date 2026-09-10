--------------------------- MODULE PackagingIdentity --------------------------
EXTENDS Integers

\* Location-specific intact package-revision quantities plus loose stock at locations A and B.
\* Two distinct 20-unit revisions deliberately share the same quantity so revision identity
\* cannot be represented or preserved merely by package size.
VARIABLES a20v1, b20v1, a20v2, b20v2, a24, b24, looseA, looseB

vars == <<a20v1, b20v1, a20v2, b20v2, a24, b24, looseA, looseB>>

Init ==
  /\ a20v1 = 20
  /\ b20v1 = 0
  /\ a20v2 = 20
  /\ b20v2 = 0
  /\ a24 = 48
  /\ b24 = 0
  /\ looseA = 0
  /\ looseB = 0

Move20V1AToB ==
  /\ a20v1 >= 20
  /\ a20v1' = a20v1 - 20
  /\ b20v1' = b20v1 + 20
  /\ UNCHANGED <<a20v2, b20v2, a24, b24, looseA, looseB>>

Move20V1BToA ==
  /\ b20v1 >= 20
  /\ b20v1' = b20v1 - 20
  /\ a20v1' = a20v1 + 20
  /\ UNCHANGED <<a20v2, b20v2, a24, b24, looseA, looseB>>

Move20V2AToB ==
  /\ a20v2 >= 20
  /\ a20v2' = a20v2 - 20
  /\ b20v2' = b20v2 + 20
  /\ UNCHANGED <<a20v1, b20v1, a24, b24, looseA, looseB>>

Move20V2BToA ==
  /\ b20v2 >= 20
  /\ b20v2' = b20v2 - 20
  /\ a20v2' = a20v2 + 20
  /\ UNCHANGED <<a20v1, b20v1, a24, b24, looseA, looseB>>

Move24AToB ==
  /\ a24 >= 24
  /\ a24' = a24 - 24
  /\ b24' = b24 + 24
  /\ UNCHANGED <<a20v1, b20v1, a20v2, b20v2, looseA, looseB>>

Move24BToA ==
  /\ b24 >= 24
  /\ b24' = b24 - 24
  /\ a24' = a24 + 24
  /\ UNCHANGED <<a20v1, b20v1, a20v2, b20v2, looseA, looseB>>

Unpack20V1A ==
  /\ a20v1 >= 20
  /\ a20v1' = a20v1 - 20
  /\ looseA' = looseA + 20
  /\ UNCHANGED <<b20v1, a20v2, b20v2, a24, b24, looseB>>

Unpack20V1B ==
  /\ b20v1 >= 20
  /\ b20v1' = b20v1 - 20
  /\ looseB' = looseB + 20
  /\ UNCHANGED <<a20v1, a20v2, b20v2, a24, b24, looseA>>

Unpack20V2A ==
  /\ a20v2 >= 20
  /\ a20v2' = a20v2 - 20
  /\ looseA' = looseA + 20
  /\ UNCHANGED <<a20v1, b20v1, b20v2, a24, b24, looseB>>

Unpack20V2B ==
  /\ b20v2 >= 20
  /\ b20v2' = b20v2 - 20
  /\ looseB' = looseB + 20
  /\ UNCHANGED <<a20v1, b20v1, a20v2, a24, b24, looseA>>

Unpack24A ==
  /\ a24 >= 24
  /\ a24' = a24 - 24
  /\ looseA' = looseA + 24
  /\ UNCHANGED <<a20v1, b20v1, a20v2, b20v2, b24, looseB>>

Unpack24B ==
  /\ b24 >= 24
  /\ b24' = b24 - 24
  /\ looseB' = looseB + 24
  /\ UNCHANGED <<a20v1, b20v1, a20v2, b20v2, a24, looseA>>

Pack20V1A ==
  /\ looseA >= 20
  /\ looseA' = looseA - 20
  /\ a20v1' = a20v1 + 20
  /\ UNCHANGED <<b20v1, a20v2, b20v2, a24, b24, looseB>>

Pack20V1B ==
  /\ looseB >= 20
  /\ looseB' = looseB - 20
  /\ b20v1' = b20v1 + 20
  /\ UNCHANGED <<a20v1, a20v2, b20v2, a24, b24, looseA>>

Pack20V2A ==
  /\ looseA >= 20
  /\ looseA' = looseA - 20
  /\ a20v2' = a20v2 + 20
  /\ UNCHANGED <<a20v1, b20v1, b20v2, a24, b24, looseB>>

Pack20V2B ==
  /\ looseB >= 20
  /\ looseB' = looseB - 20
  /\ b20v2' = b20v2 + 20
  /\ UNCHANGED <<a20v1, b20v1, a20v2, a24, b24, looseA>>

Pack24A ==
  /\ looseA >= 24
  /\ looseA' = looseA - 24
  /\ a24' = a24 + 24
  /\ UNCHANGED <<a20v1, b20v1, a20v2, b20v2, b24, looseB>>

Pack24B ==
  /\ looseB >= 24
  /\ looseB' = looseB - 24
  /\ b24' = b24 + 24
  /\ UNCHANGED <<a20v1, b20v1, a20v2, b20v2, a24, looseA>>

Next ==
  \/ Move20V1AToB
  \/ Move20V1BToA
  \/ Move20V2AToB
  \/ Move20V2BToA
  \/ Move24AToB
  \/ Move24BToA
  \/ Unpack20V1A
  \/ Unpack20V1B
  \/ Unpack20V2A
  \/ Unpack20V2B
  \/ Unpack24A
  \/ Unpack24B
  \/ Pack20V1A
  \/ Pack20V1B
  \/ Pack20V2A
  \/ Pack20V2B
  \/ Pack24A
  \/ Pack24B

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ a20v1 \in 0..88
  /\ b20v1 \in 0..88
  /\ a20v2 \in 0..88
  /\ b20v2 \in 0..88
  /\ a24 \in 0..88
  /\ b24 \in 0..88
  /\ looseA \in 0..88
  /\ looseB \in 0..88

PhysicalQuantityConserved ==
  a20v1 + b20v1 + a20v2 + b20v2 + a24 + b24 + looseA + looseB = 88

EveryIntact20BoxIsWhole ==
  /\ a20v1 % 20 = 0
  /\ b20v1 % 20 = 0
  /\ a20v2 % 20 = 0
  /\ b20v2 % 20 = 0

EveryIntact24BoxIsWhole ==
  /\ a24 % 24 = 0
  /\ b24 % 24 = 0

=============================================================================
