------------------------- MODULE ResourceDimensions -------------------------
EXTENDS Integers, FiniteSets

Tokens == {"u1", "u2"}
PlacementNodes == {"A", "B", "TRANSIT"}
NoPlacement == "NO_PLACEMENT"
Owners == {"owner-a", "owner-b"}
Custodians == {"clinic", "carrier"}
Statuses == {"usable", "hold"}
NoWhereaboutsState == "none"
WhereaboutsStates == {"detached", "missing"}
NoWhereaboutsId == "NO_WHEREABOUTS"
WhereaboutsIds == {"whereabouts-u1", "whereabouts-u2"}
NoLastPlacement == "NO_LAST_PLACEMENT"

WhereaboutsIdFor(t) ==
  IF t = "u1" THEN "whereabouts-u1" ELSE "whereabouts-u2"

OtherWhereaboutsId(t) ==
  IF t = "u1" THEN "whereabouts-u2" ELSE "whereabouts-u1"

VARIABLES active, placement, whereaboutsState, whereaboutsId, lastPlacement,
          owner, custody, status, externalIn, externalOut

vars == <<active, placement, whereaboutsState, whereaboutsId, lastPlacement,
          owner, custody, status, externalIn, externalOut>>

Placed(t) == placement[t] \in PlacementNodes
Unresolved(t) == whereaboutsState[t] \in WhereaboutsStates

Init ==
  /\ active = {"u1"}
  /\ placement = [t \in Tokens |-> IF t = "u1" THEN "A" ELSE NoPlacement]
  /\ whereaboutsState = [t \in Tokens |-> NoWhereaboutsState]
  /\ whereaboutsId = [t \in Tokens |-> NoWhereaboutsId]
  /\ lastPlacement = [t \in Tokens |-> NoLastPlacement]
  /\ owner = [t \in Tokens |-> "owner-a"]
  /\ custody = [t \in Tokens |-> "clinic"]
  /\ status = [t \in Tokens |-> "usable"]
  /\ externalIn = 0
  /\ externalOut = 0

MoveDirectPlacement(t, nextPlacementNode) ==
  /\ t \in active
  /\ Placed(t)
  /\ whereaboutsState[t] = NoWhereaboutsState
  /\ nextPlacementNode \in PlacementNodes
  /\ nextPlacementNode # placement[t]
  /\ placement' = [placement EXCEPT ![t] = nextPlacementNode]
  /\ UNCHANGED <<active, whereaboutsState, whereaboutsId, lastPlacement,
                  owner, custody, status, externalIn, externalOut>>

Detach(t) ==
  /\ t \in active
  /\ Placed(t)
  /\ whereaboutsState[t] = NoWhereaboutsState
  /\ placement' = [placement EXCEPT ![t] = NoPlacement]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = "detached"]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = WhereaboutsIdFor(t)]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = placement[t]]
  /\ UNCHANGED <<active, owner, custody, status, externalIn, externalOut>>

MarkPlacedMissing(t) ==
  /\ t \in active
  /\ Placed(t)
  /\ whereaboutsState[t] = NoWhereaboutsState
  /\ placement' = [placement EXCEPT ![t] = NoPlacement]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = "missing"]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = WhereaboutsIdFor(t)]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = placement[t]]
  /\ UNCHANGED <<active, owner, custody, status, externalIn, externalOut>>

MarkDetachedMissing(t) ==
  /\ t \in active
  /\ whereaboutsState[t] = "detached"
  /\ placement[t] = NoPlacement
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = "missing"]
  /\ UNCHANGED <<active, placement, whereaboutsId, lastPlacement,
                  owner, custody, status, externalIn, externalOut>>

PlaceKnown(t, nextPlacementNode) ==
  /\ t \in active
  /\ Unresolved(t)
  /\ placement[t] = NoPlacement
  /\ nextPlacementNode \in PlacementNodes
  /\ placement' = [placement EXCEPT ![t] = nextPlacementNode]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = NoWhereaboutsState]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = NoWhereaboutsId]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = NoLastPlacement]
  /\ UNCHANGED <<active, owner, custody, status, externalIn, externalOut>>

ChangeOwner(t, nextOwner) ==
  /\ t \in active
  /\ nextOwner \in Owners
  /\ nextOwner # owner[t]
  /\ owner' = [owner EXCEPT ![t] = nextOwner]
  /\ UNCHANGED <<active, placement, whereaboutsState, whereaboutsId,
                  lastPlacement, custody, status, externalIn, externalOut>>

ChangeCustody(t, nextCustodian) ==
  /\ t \in active
  /\ nextCustodian \in Custodians
  /\ nextCustodian # custody[t]
  /\ custody' = [custody EXCEPT ![t] = nextCustodian]
  /\ UNCHANGED <<active, placement, whereaboutsState, whereaboutsId,
                  lastPlacement, owner, status, externalIn, externalOut>>

ChangeStatus(t, nextStatus) ==
  /\ t \in active
  /\ nextStatus \in Statuses
  /\ nextStatus # status[t]
  /\ status' = [status EXCEPT ![t] = nextStatus]
  /\ UNCHANGED <<active, placement, whereaboutsState, whereaboutsId,
                  lastPlacement, owner, custody, externalIn, externalOut>>

Receive(t, atPlacementNode) ==
  /\ t \in Tokens \ active
  /\ atPlacementNode \in PlacementNodes
  /\ externalIn < 2
  /\ active' = active \cup {t}
  /\ placement' = [placement EXCEPT ![t] = atPlacementNode]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = NoWhereaboutsState]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = NoWhereaboutsId]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = NoLastPlacement]
  /\ owner' = [owner EXCEPT ![t] = "owner-a"]
  /\ custody' = [custody EXCEPT ![t] = "clinic"]
  /\ status' = [status EXCEPT ![t] = "usable"]
  /\ externalIn' = externalIn + 1
  /\ UNCHANGED externalOut

Issue(t) ==
  /\ t \in active
  /\ externalOut < 2
  /\ active' = active \ {t}
  /\ placement' = [placement EXCEPT ![t] = NoPlacement]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = NoWhereaboutsState]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = NoWhereaboutsId]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = NoLastPlacement]
  /\ externalOut' = externalOut + 1
  /\ UNCHANGED <<owner, custody, status, externalIn>>

Next ==
  \/ \E t \in Tokens, l \in PlacementNodes: MoveDirectPlacement(t, l)
  \/ \E t \in Tokens: Detach(t)
  \/ \E t \in Tokens: MarkPlacedMissing(t)
  \/ \E t \in Tokens: MarkDetachedMissing(t)
  \/ \E t \in Tokens, l \in PlacementNodes: PlaceKnown(t, l)
  \/ \E t \in Tokens, o \in Owners: ChangeOwner(t, o)
  \/ \E t \in Tokens, c \in Custodians: ChangeCustody(t, c)
  \/ \E t \in Tokens, s \in Statuses: ChangeStatus(t, s)
  \/ \E t \in Tokens, l \in PlacementNodes: Receive(t, l)
  \/ \E t \in Tokens: Issue(t)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ active \subseteq Tokens
  /\ placement \in [Tokens -> PlacementNodes \cup {NoPlacement}]
  /\ whereaboutsState \in [Tokens -> WhereaboutsStates \cup {NoWhereaboutsState}]
  /\ whereaboutsId \in [Tokens -> WhereaboutsIds \cup {NoWhereaboutsId}]
  /\ lastPlacement \in [Tokens -> PlacementNodes \cup {NoLastPlacement}]
  /\ owner \in [Tokens -> Owners]
  /\ custody \in [Tokens -> Custodians]
  /\ status \in [Tokens -> Statuses]
  /\ externalIn \in 0..2
  /\ externalOut \in 0..2

ResourceAccounting ==
  Cardinality(active) = 1 + externalIn - externalOut

InTransitStillExists ==
  \A t \in Tokens: placement[t] = "TRANSIT" => t \in active

UnresolvedStockStillExists ==
  \A t \in Tokens: Unresolved(t) => t \in active

UnresolvedWhereaboutsIdentityIsStable ==
  \A t \in Tokens:
    Unresolved(t) =>
      /\ whereaboutsId[t] = WhereaboutsIdFor(t)
      /\ lastPlacement[t] \in PlacementNodes

CurrentPhysicalStateIsExclusive ==
  \A t \in Tokens:
    IF t \in active
    THEN
      \/ /\ Placed(t)
         /\ whereaboutsState[t] = NoWhereaboutsState
         /\ whereaboutsId[t] = NoWhereaboutsId
         /\ lastPlacement[t] = NoLastPlacement
      \/ /\ placement[t] = NoPlacement
         /\ Unresolved(t)
         /\ whereaboutsId[t] = WhereaboutsIdFor(t)
         /\ lastPlacement[t] \in PlacementNodes
    ELSE
      /\ placement[t] = NoPlacement
      /\ whereaboutsState[t] = NoWhereaboutsState
      /\ whereaboutsId[t] = NoWhereaboutsId
      /\ lastPlacement[t] = NoLastPlacement

\* Negative control: model the old mistake where "take it out" removes current stock.
DetachIssueMutation(t) ==
  /\ t \in active
  /\ Placed(t)
  /\ active' = active \ {t}
  /\ placement' = [placement EXCEPT ![t] = NoPlacement]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = "detached"]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = WhereaboutsIdFor(t)]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = placement[t]]
  /\ UNCHANGED <<owner, custody, status, externalIn, externalOut>>

DetachIssueMutationNext ==
  Next \/ \E t \in Tokens: DetachIssueMutation(t)

DetachIssueMutationSpec == Init /\ [][DetachIssueMutationNext]_vars

\* Negative control: collapse one detach cohort onto another resource's lifecycle identity.
WhereaboutsIdentityMutation(t) ==
  /\ t \in active
  /\ Placed(t)
  /\ placement' = [placement EXCEPT ![t] = NoPlacement]
  /\ whereaboutsState' = [whereaboutsState EXCEPT ![t] = "detached"]
  /\ whereaboutsId' = [whereaboutsId EXCEPT ![t] = OtherWhereaboutsId(t)]
  /\ lastPlacement' = [lastPlacement EXCEPT ![t] = placement[t]]
  /\ UNCHANGED <<active, owner, custody, status, externalIn, externalOut>>

WhereaboutsIdentityMutationNext ==
  Next \/ \E t \in Tokens: WhereaboutsIdentityMutation(t)

WhereaboutsIdentityMutationSpec ==
  Init /\ [][WhereaboutsIdentityMutationNext]_vars

=============================================================================
