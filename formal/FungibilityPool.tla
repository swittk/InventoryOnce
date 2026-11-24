--------------------------- MODULE FungibilityPool ---------------------------
EXTENDS FiniteSets, Naturals

\* Each token is one indivisible physical unit whose exact item identity never changes.
Tokens == {"old-1", "old-2", "new-1", "new-2", "double-1"}
Items == {"old", "new", "double"}
Locations == {"store", "room"}
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

EligibleLocations(c) == IF c = "c1" THEN {"store"} ELSE Locations

PoolAllocations(revision, amount, where) ==
  {candidate \in SUBSET OnHand(where):
    /\ candidate \subseteq MemberTokens(revision)
    /\ Basis(revision, candidate) = amount}

ClaimAllocations(c, revision, amount, where) ==
  {candidate \in PoolAllocations(revision, amount, where):
    \A token \in candidate: where[token] \in EligibleLocations(c)}

ClaimChoices(c, where, state, revision, amount, allocation) ==
  IF state[c] = "allocated"
    THEN {selected \in {allocation[c]}:
           \A token \in selected: where[token] \in EligibleLocations(c)}
  ELSE IF state[c] = "active"
    THEN ClaimAllocations(c, revision[c], amount[c], where)
  ELSE {EmptyAllocation}

\* With two claims, two disjoint valid choices are exactly a feasible assignment.
FeasibleFor(where, state, revision, amount, allocation) ==
  \E left \in ClaimChoices("c1", where, state, revision, amount, allocation),
     right \in ClaimChoices("c2", where, state, revision, amount, allocation):
    left \cap right = {}

VARIABLES where,
          activeRevision,
          claimState,
          claimRevision,
          claimAmount,
          allocation,
          poolReport,
          claimsFeasible

vars == <<where,
          activeRevision,
          claimState,
          claimRevision,
          claimAmount,
          allocation,
          poolReport,
          claimsFeasible>>

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
  /\ claimsFeasible = TRUE

Activate(revision) ==
  /\ revision \in Revisions
  /\ revision # activeRevision
  /\ activeRevision' = revision
  /\ UNCHANGED <<where,
                  claimState,
                  claimRevision,
                  claimAmount,
                  allocation,
                  poolReport,
                  claimsFeasible>>

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
  /\ claimsFeasible' = TRUE
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
  /\ claimsFeasible' = TRUE
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
  /\ claimsFeasible' = FeasibleFor(where, claimState', claimRevision, claimAmount, allocation')
  /\ UNCHANGED <<where,
                  activeRevision,
                  claimRevision,
                  claimAmount,
                  poolReport>>

Consume(c) ==
  /\ c \in Claims
  /\ claimState[c] = "allocated"
  /\ allocation[c] # {}
  /\ \A token \in allocation[c]: where[token] \in EligibleLocations(c)
  /\ where' = [t \in Tokens |-> IF t \in allocation[c] THEN Issued ELSE where[t]]
  /\ claimState' = [claimState EXCEPT ![c] = "consumed"]
  /\ poolReport' = [revision \in Revisions |-> PoolTotal(revision, where')]
  /\ claimsFeasible' = FeasibleFor(where', claimState', claimRevision, claimAmount, allocation)
  /\ claimsFeasible => claimsFeasible'
  /\ UNCHANGED <<activeRevision,
                  claimRevision,
                  claimAmount,
                  allocation>>

Transfer(token, destination) ==
  /\ token \in OnHand(where)
  /\ destination \in Locations
  /\ destination # where[token]
  /\ where' = [where EXCEPT ![token] = destination]
  /\ poolReport' = [revision \in Revisions |-> PoolTotal(revision, where')]
  /\ claimsFeasible' = FeasibleFor(where', claimState, claimRevision, claimAmount, allocation)
  /\ UNCHANGED <<activeRevision,
                  claimState,
                  claimRevision,
                  claimAmount,
                  allocation>>

DirectIssue(revision, selected) ==
  /\ revision \in Revisions
  /\ selected \in PoolAllocations(revision, 1, where)
  /\ where' = [t \in Tokens |-> IF t \in selected THEN Issued ELSE where[t]]
  /\ poolReport' = [candidateRevision \in Revisions |->
                      PoolTotal(candidateRevision, where')]
  /\ claimsFeasible' = FeasibleFor(where', claimState, claimRevision, claimAmount, allocation)
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
  \/ \E token \in Tokens, destination \in Locations:
       Transfer(token, destination)
  \/ \E revision \in Revisions, selected \in SUBSET Tokens:
       DirectIssue(revision, selected)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ where \in [Tokens -> Locations \cup {Issued}]
  /\ activeRevision \in Revisions
  /\ claimState \in [Claims -> ClaimStates]
  /\ claimRevision \in [Claims -> Revisions \cup {NoRevision}]
  /\ claimAmount \in [Claims -> 0..2]
  /\ allocation \in [Claims -> SUBSET Tokens]
  /\ poolReport \in [Revisions -> 0..7]
  /\ claimsFeasible \in BOOLEAN

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

FeasibleExactClaimsHaveEligibleStock ==
  \A c \in Claims:
    claimsFeasible /\ claimState[c] = "allocated" =>
      \A token \in allocation[c]: where[token] \in EligibleLocations(c)

ActiveAllocationsRemainDisjoint ==
  \A left, right \in Claims:
    left # right /\
    claimState[left] = "allocated" /\
    claimState[right] = "allocated" =>
      allocation[left] \cap allocation[right] = {}

IssuedTokensCannotBackFeasibleClaims ==
  \A c \in Claims:
    claimsFeasible /\ ActiveClaim(claimState, c) => allocation[c] \subseteq OnHand(where)

ClaimReportMatchesCurrentPhysicalTruth ==
  claimsFeasible = FeasibleFor(where, claimState, claimRevision, claimAmount, allocation)

\* Negated in the reachability check: an exact allocated token can be recorded out of scope.
AllocatedClaimNeverStrandedByTransfer ==
  \A c \in Claims:
    claimState[c] = "allocated" /\ allocation[c] \subseteq OnHand(where) =>
      \A token \in allocation[c]: where[token] \in EligibleLocations(c)

=============================================================================
