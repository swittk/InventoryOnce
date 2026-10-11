--------------------------- MODULE FungibilityPool ---------------------------
EXTENDS FiniteSets, Naturals

\* Each token is one indivisible physical unit whose exact item identity never changes.
Tokens == {"old-1", "old-2", "new-1", "new-2", "double-1"}
Items == {"old", "new", "double"}
Placements == {"store", "room"}
Issued == "issued"
Revisions == {"pool-v1", "pool-v2"}
Claims == {"c1", "c2"}
ClaimStates == {"none", "active", "allocated", "released", "consumed"}
NoRevision == "none-revision"
ClaimAmounts == 1..2

ItemOf(t) ==
  CASE t \in {"old-1", "old-2"} -> "old"
    [] t \in {"new-1", "new-2"} -> "new"
    [] OTHER -> "double"

MemberItems(revision) ==
  IF revision = "pool-v1"
    THEN {"old", "new"}
    ELSE {"old", "new", "double"}

\* pool-v2 deliberately includes an item whose one unit contributes two pool units.
Weight(revision, item) ==
  IF item \notin MemberItems(revision) THEN 0
  ELSE IF revision = "pool-v2" /\ item = "double" THEN 2
  ELSE 1

MemberTokens(revision) == {t \in Tokens: ItemOf(t) \in MemberItems(revision)}
OnHand(where) == {t \in Tokens: where[t] # Issued}
IssuedTokens(where) == Tokens \ OnHand(where)

Basis(revision, tokenSet) ==
    Cardinality({token \in tokenSet: ItemOf(token) = "old"}) * Weight(revision, "old")
  + Cardinality({token \in tokenSet: ItemOf(token) = "new"}) * Weight(revision, "new")
  + Cardinality({token \in tokenSet: ItemOf(token) = "double"}) * Weight(revision, "double")

PoolTotal(revision, where) == Basis(revision, OnHand(where))
InitialPoolTotal(revision) == Basis(revision, Tokens)

EmptyAllocation == {}
ActiveClaim(state, c) == state[c] \in {"active", "allocated"}

EligiblePlacements(c) == IF c = "c1" THEN {"store"} ELSE Placements

PoolAllocations(revision, amount, where) ==
  {candidate \in SUBSET OnHand(where):
    /\ candidate \subseteq MemberTokens(revision)
    /\ Basis(revision, candidate) = amount}

ClaimAllocations(c, revision, amount, where) ==
  {candidate \in PoolAllocations(revision, amount, where):
    \A token \in candidate: where[token] \in EligiblePlacements(c)}

ClaimChoices(c, where, state, revision, amount, allocation) ==
  IF state[c] = "allocated"
    THEN {allocation[c]}
  ELSE IF state[c] = "active"
    THEN ClaimAllocations(c, revision[c], amount[c], where)
  ELSE {EmptyAllocation}

PairwiseDisjoint(assignments) ==
  \A left, right \in Claims:
    left # right => assignments[left] \cap assignments[right] = {}

FeasibleFor(where, state, revision, amount, allocation) ==
  \E assignments \in [Claims -> SUBSET Tokens]:
    /\ \A c \in Claims:
         assignments[c] \in ClaimChoices(c, where, state, revision, amount, allocation)
    /\ PairwiseDisjoint(assignments)

AllocatedTokens(state, allocation) ==
  UNION {allocation[c]: c \in {candidate \in Claims: state[candidate] = "allocated"}}

VARIABLES where,
          activeRevision,
          claimState,
          claimRevision,
          claimAmount,
          allocation,
          poolReport

vars == <<where,
          activeRevision,
          claimState,
          claimRevision,
          claimAmount,
          allocation,
          poolReport>>

Init ==
  /\ where = [t \in Tokens |-> IF t \in {"old-1", "new-1", "double-1"}
                                  THEN "store"
                                  ELSE "room"]
  /\ activeRevision = "pool-v1"
  /\ claimState = [c \in Claims |-> "none"]
  /\ claimRevision = [c \in Claims |-> NoRevision]
  /\ claimAmount = [c \in Claims |-> 0]
  /\ allocation = [c \in Claims |-> EmptyAllocation]
  /\ poolReport = [revision \in Revisions |-> PoolTotal(revision, where)]

Activate(revision) ==
  /\ revision \in Revisions
  /\ revision # activeRevision
  /\ activeRevision' = revision
  /\ UNCHANGED <<where,
                  claimState,
                  claimRevision,
                  claimAmount,
                  allocation,
                  poolReport>>

Reserve(c, requestedAmount) ==
  /\ c \in Claims
  /\ requestedAmount \in ClaimAmounts
  /\ claimState[c] = "none"
  /\ LET nextState == [claimState EXCEPT ![c] = "active"]
         nextRevision == [claimRevision EXCEPT ![c] = activeRevision]
         nextAmount == [claimAmount EXCEPT ![c] = requestedAmount]
         nextAllocation == [allocation EXCEPT ![c] = EmptyAllocation]
       IN /\ FeasibleFor(where, nextState, nextRevision, nextAmount, nextAllocation)
          /\ claimState' = nextState
          /\ claimRevision' = nextRevision
          /\ claimAmount' = nextAmount
          /\ allocation' = nextAllocation
  /\ UNCHANGED <<where, activeRevision, poolReport>>

Allocate(c, selected) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ selected \in ClaimAllocations(
       c,
       claimRevision[c],
       claimAmount[c],
       where
     )
  /\ LET nextState == [claimState EXCEPT ![c] = "allocated"]
         nextAllocation == [allocation EXCEPT ![c] = selected]
       IN /\ FeasibleFor(where, nextState, claimRevision, claimAmount, nextAllocation)
          /\ claimState' = nextState
          /\ allocation' = nextAllocation
  /\ UNCHANGED <<where,
                  activeRevision,
                  claimRevision,
                  claimAmount,
                  poolReport>>

Release(c) ==
  /\ c \in Claims
  /\ ActiveClaim(claimState, c)
  /\ claimState' = [claimState EXCEPT ![c] = "released"]
  /\ allocation' = [allocation EXCEPT ![c] = EmptyAllocation]
  /\ UNCHANGED <<where,
                  activeRevision,
                  claimRevision,
                  claimAmount,
                  poolReport>>

Consume(c) ==
  /\ c \in Claims
  /\ claimState[c] = "allocated"
  /\ allocation[c] # {}
  /\ allocation[c] \subseteq OnHand(where)
  /\ where' = [t \in Tokens |-> IF t \in allocation[c] THEN Issued ELSE where[t]]
  /\ claimState' = [claimState EXCEPT ![c] = "consumed"]
  /\ poolReport' = [revision \in Revisions |-> PoolTotal(revision, where')]
  /\ FeasibleFor(where', claimState', claimRevision, claimAmount, allocation)
  /\ UNCHANGED <<activeRevision,
                  claimRevision,
                  claimAmount,
                  allocation>>

Transfer(token, destination) ==
  /\ token \in OnHand(where)
  /\ token \notin AllocatedTokens(claimState, allocation)
  /\ destination \in Placements
  /\ destination # where[token]
  /\ LET nextWhere == [where EXCEPT ![token] = destination]
       IN FeasibleFor(
            nextWhere,
            claimState,
            claimRevision,
            claimAmount,
            allocation
          )
  /\ where' = [where EXCEPT ![token] = destination]
  /\ poolReport' = [revision \in Revisions |-> PoolTotal(revision, where')]
  /\ UNCHANGED <<activeRevision,
                  claimState,
                  claimRevision,
                  claimAmount,
                  allocation>>

DirectIssue(revision, selected) ==
  /\ revision \in Revisions
  /\ selected \in PoolAllocations(revision, 1, where)
  /\ selected \cap AllocatedTokens(claimState, allocation) = {}
  /\ LET nextWhere == [t \in Tokens |-> IF t \in selected THEN Issued ELSE where[t]]
       IN FeasibleFor(nextWhere, claimState, claimRevision, claimAmount, allocation)
  /\ where' = [t \in Tokens |-> IF t \in selected THEN Issued ELSE where[t]]
  /\ poolReport' = [candidateRevision \in Revisions |->
                      PoolTotal(candidateRevision, where')]
  /\ UNCHANGED <<activeRevision,
                  claimState,
                  claimRevision,
                  claimAmount,
                  allocation>>

Next ==
  \/ \E revision \in Revisions: Activate(revision)
  \/ \E c \in Claims, requestedAmount \in ClaimAmounts:
       Reserve(c, requestedAmount)
  \/ \E c \in Claims, selected \in SUBSET Tokens: Allocate(c, selected)
  \/ \E c \in Claims: Release(c)
  \/ \E c \in Claims: Consume(c)
  \/ \E token \in Tokens, destination \in Placements:
       Transfer(token, destination)
  \/ \E revision \in Revisions, selected \in SUBSET Tokens:
       DirectIssue(revision, selected)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ where \in [Tokens -> Placements \cup {Issued}]
  /\ activeRevision \in Revisions
  /\ claimState \in [Claims -> ClaimStates]
  /\ claimRevision \in [Claims -> Revisions \cup {NoRevision}]
  /\ claimAmount \in [Claims -> 0..2]
  /\ allocation \in [Claims -> SUBSET Tokens]
  /\ poolReport \in [Revisions -> 0..7]

PoolReportMatchesExactPhysicalTruth ==
  \A revision \in Revisions:
    poolReport[revision] = PoolTotal(revision, where)

PoolViewsConserveActualIssuedTokens ==
  \A revision \in Revisions:
    poolReport[revision] + Basis(revision, IssuedTokens(where)) =
      InitialPoolTotal(revision)

ClaimsFreezeOneExactRevision ==
  \A c \in Claims:
    claimState[c] # "none" => claimRevision[c] \in Revisions

AllocatedClaimsUseOnlyFrozenRevisionMembers ==
  \A c \in Claims:
    claimState[c] = "allocated" =>
      allocation[c] \subseteq MemberTokens(claimRevision[c])

AllocatedClaimsMatchFrozenRevisionBasis ==
  \A c \in Claims:
    claimState[c] = "allocated" =>
      Basis(claimRevision[c], allocation[c]) = claimAmount[c]

AllocatedClaimsRemainInEligiblePlacements ==
  \A c \in Claims:
    claimState[c] = "allocated" =>
      \A token \in allocation[c]: where[token] \in EligiblePlacements(c)

ActiveAllocationsRemainDisjoint ==
  \A left, right \in Claims:
    left # right /\
    claimState[left] = "allocated" /\
    claimState[right] = "allocated" =>
      allocation[left] \cap allocation[right] = {}

IssuedTokensCannotBackActiveClaims ==
  \A c \in Claims:
    ActiveClaim(claimState, c) => allocation[c] \subseteq OnHand(where)

AllActiveClaimsRemainFeasible ==
  FeasibleFor(where, claimState, claimRevision, claimAmount, allocation)

=============================================================================
