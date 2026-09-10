------------------------- MODULE ResourceDimensions -------------------------
EXTENDS Integers, FiniteSets

Tokens == {"u1", "u2"}
Locations == {"A", "B", "TRANSIT"}
NoLocation == "OUTSIDE"
Owners == {"owner-a", "owner-b"}
Custodians == {"clinic", "carrier"}
Statuses == {"usable", "hold"}

VARIABLES active, loc, owner, custody, status, externalIn, externalOut

vars == <<active, loc, owner, custody, status, externalIn, externalOut>>

Init ==
  /\ active = {"u1"}
  /\ loc = [t \in Tokens |-> IF t = "u1" THEN "A" ELSE NoLocation]
  /\ owner = [t \in Tokens |-> "owner-a"]
  /\ custody = [t \in Tokens |-> "clinic"]
  /\ status = [t \in Tokens |-> "usable"]
  /\ externalIn = 0
  /\ externalOut = 0

MoveLocation(t, nextLocation) ==
  /\ t \in active
  /\ nextLocation \in Locations
  /\ nextLocation # loc[t]
  /\ loc' = [loc EXCEPT ![t] = nextLocation]
  /\ UNCHANGED <<active, owner, custody, status, externalIn, externalOut>>

ChangeOwner(t, nextOwner) ==
  /\ t \in active
  /\ nextOwner \in Owners
  /\ nextOwner # owner[t]
  /\ owner' = [owner EXCEPT ![t] = nextOwner]
  /\ UNCHANGED <<active, loc, custody, status, externalIn, externalOut>>

ChangeCustody(t, nextCustodian) ==
  /\ t \in active
  /\ nextCustodian \in Custodians
  /\ nextCustodian # custody[t]
  /\ custody' = [custody EXCEPT ![t] = nextCustodian]
  /\ UNCHANGED <<active, loc, owner, status, externalIn, externalOut>>

ChangeStatus(t, nextStatus) ==
  /\ t \in active
  /\ nextStatus \in Statuses
  /\ nextStatus # status[t]
  /\ status' = [status EXCEPT ![t] = nextStatus]
  /\ UNCHANGED <<active, loc, owner, custody, externalIn, externalOut>>

Receive(t, atLocation) ==
  /\ t \in Tokens \ active
  /\ atLocation \in Locations
  /\ externalIn < 2
  /\ active' = active \cup {t}
  /\ loc' = [loc EXCEPT ![t] = atLocation]
  /\ owner' = [owner EXCEPT ![t] = "owner-a"]
  /\ custody' = [custody EXCEPT ![t] = "clinic"]
  /\ status' = [status EXCEPT ![t] = "usable"]
  /\ externalIn' = externalIn + 1
  /\ UNCHANGED externalOut

Issue(t) ==
  /\ t \in active
  /\ externalOut < 2
  /\ active' = active \ {t}
  /\ loc' = [loc EXCEPT ![t] = NoLocation]
  /\ externalOut' = externalOut + 1
  /\ UNCHANGED <<owner, custody, status, externalIn>>

Next ==
  \/ \E t \in Tokens, l \in Locations: MoveLocation(t, l)
  \/ \E t \in Tokens, o \in Owners: ChangeOwner(t, o)
  \/ \E t \in Tokens, c \in Custodians: ChangeCustody(t, c)
  \/ \E t \in Tokens, s \in Statuses: ChangeStatus(t, s)
  \/ \E t \in Tokens, l \in Locations: Receive(t, l)
  \/ \E t \in Tokens: Issue(t)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ active \subseteq Tokens
  /\ loc \in [Tokens -> Locations \cup {NoLocation}]
  /\ owner \in [Tokens -> Owners]
  /\ custody \in [Tokens -> Custodians]
  /\ status \in [Tokens -> Statuses]
  /\ externalIn \in 0..2
  /\ externalOut \in 0..2

ResourceAccounting ==
  Cardinality(active) = 1 + externalIn - externalOut

\* Regression check implied by ActiveTokensHaveExactlyOneRealLocation because "TRANSIT" \in Locations; not independent evidence.
InTransitStillExists ==
  \A t \in Tokens: loc[t] = "TRANSIT" => t \in active

\* Check active-token existence is exactly equivalent to placement at a configured real location; loc is already a total function.
ActiveTokensHaveExactlyOneRealLocation ==
  \A t \in Tokens: t \in active <=> loc[t] \in Locations

=============================================================================
