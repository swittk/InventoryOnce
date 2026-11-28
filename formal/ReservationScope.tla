-------------------------- MODULE ReservationScope --------------------------
EXTENDS FiniteSets

Tokens == {"u1", "u2"}
Claims == {"c1", "c2"}
NoToken == "none"
States == {"none", "active", "released", "consumed"}

VARIABLES onHand, available, claimState, scope, allocated, reportStatus,
          capacityReduced

vars == <<onHand, available, claimState, scope, allocated, reportStatus,
          capacityReduced>>

\* Accounted detached/missing tokens remain in onHand but are absent from available.
\* Inactive claims impose no feasibility constraint, so their candidate domain stays the full token set.
CandidateTokens(c, avail, st, sc, al) ==
  IF st[c] # "active" THEN Tokens
  ELSE IF al[c] # NoToken THEN {al[c]} \cap sc[c] \cap avail
  ELSE sc[c] \cap avail

\* This finite model intentionally fixes Claims to c1/c2; the second conjunct checks the exact two-claim matching case.
FeasibleFor(avail, st, sc, al) ==
  /\ \A c \in Claims:
       st[c] = "active" => CandidateTokens(c, avail, st, sc, al) # {}
  /\ ~((st["c1"] = "active") /\ (st["c2"] = "active"))
      \/ \E t1 \in CandidateTokens("c1", avail, st, sc, al),
             t2 \in CandidateTokens("c2", avail, st, sc, al):
             t1 # t2

StatusFor(avail, st, sc, al) ==
  IF FeasibleFor(avail, st, sc, al) THEN "feasible" ELSE "shortage"

Init ==
  /\ onHand = Tokens
  /\ available = Tokens
  /\ claimState = [c \in Claims |-> "none"]
  /\ scope = [c \in Claims |-> Tokens]
  /\ allocated = [c \in Claims |-> NoToken]
  /\ reportStatus = "feasible"
  /\ capacityReduced = FALSE

Reserve(c, requestedScope) ==
  /\ c \in Claims
  /\ claimState[c] = "none"
  /\ requestedScope \subseteq Tokens
  /\ requestedScope # {}
  /\ LET nextState == [claimState EXCEPT ![c] = "active"]
         nextScope == [scope EXCEPT ![c] = requestedScope]
       IN FeasibleFor(available, nextState, nextScope, allocated)
  /\ claimState' = [claimState EXCEPT ![c] = "active"]
  /\ scope' = [scope EXCEPT ![c] = requestedScope]
  /\ reportStatus' = StatusFor(available, claimState', scope', allocated)
  /\ UNCHANGED <<onHand, available, allocated, capacityReduced>>

Refine(c, narrowerScope) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ narrowerScope \subseteq scope[c]
  /\ narrowerScope # {}
  /\ LET nextScope == [scope EXCEPT ![c] = narrowerScope]
       IN FeasibleFor(available, claimState, nextScope, allocated)
  /\ scope' = [scope EXCEPT ![c] = narrowerScope]
  /\ reportStatus' = StatusFor(available, claimState, scope', allocated)
  /\ UNCHANGED <<onHand, available, claimState, allocated, capacityReduced>>

Allocate(c, t) ==
  /\ c \in Claims
  /\ t \in Tokens
  /\ claimState[c] = "active"
  /\ allocated[c] = NoToken
  /\ t \in scope[c] \cap available
  /\ LET nextAllocated == [allocated EXCEPT ![c] = t]
       IN FeasibleFor(available, claimState, scope, nextAllocated)
  /\ allocated' = [allocated EXCEPT ![c] = t]
  /\ reportStatus' = StatusFor(available, claimState, scope, allocated')
  /\ UNCHANGED <<onHand, available, claimState, scope, capacityReduced>>

Release(c) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ claimState' = [claimState EXCEPT ![c] = "released"]
  /\ allocated' = [allocated EXCEPT ![c] = NoToken]
  /\ reportStatus' = StatusFor(available, claimState', scope, allocated')
  /\ UNCHANGED <<onHand, available, scope, capacityReduced>>

Consume(c) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ allocated[c] # NoToken
  /\ allocated[c] \in available
  /\ onHand' = onHand \ {allocated[c]}
  /\ available' = available \ {allocated[c]}
  /\ claimState' = [claimState EXCEPT ![c] = "consumed"]
  /\ reportStatus' = StatusFor(available', claimState', scope, allocated)
  /\ UNCHANGED <<scope, allocated, capacityReduced>>

\* Recording a detach preserves stock and the exact claim, even if the claim becomes short.
Detach(t) ==
  /\ t \in available
  /\ available' = available \ {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ capacityReduced' = TRUE
  /\ UNCHANGED <<onHand, claimState, scope, allocated>>

\* Placing a detached/missing token restores it to ordinary reservation/allocation capacity.
Place(t) ==
  /\ t \in onHand \ available
  /\ available' = available \cup {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ UNCHANGED <<onHand, claimState, scope, allocated, capacityReduced>>

\* Count/correction/scrap records physical truth even when claims become short.
PhysicalLoss(t) ==
  /\ t \in onHand
  /\ onHand' = onHand \ {t}
  /\ available' = available \ {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ capacityReduced' = TRUE
  /\ UNCHANGED <<claimState, scope, allocated>>

Next ==
  \/ \E c \in Claims, s \in SUBSET Tokens: Reserve(c, s)
  \/ \E c \in Claims, s \in SUBSET Tokens: Refine(c, s)
  \/ \E c \in Claims, t \in Tokens: Allocate(c, t)
  \/ \E c \in Claims: Release(c)
  \/ \E c \in Claims: Consume(c)
  \/ \E t \in Tokens: Detach(t)
  \/ \E t \in Tokens: Place(t)
  \/ \E t \in Tokens: PhysicalLoss(t)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ onHand \subseteq Tokens
  /\ available \subseteq onHand
  /\ claimState \in [Claims -> States]
  /\ scope \in [Claims -> SUBSET Tokens]
  /\ allocated \in [Claims -> Tokens \cup {NoToken}]
  /\ reportStatus \in {"feasible", "shortage"}
  /\ capacityReduced \in BOOLEAN

ReportMatchesCurrentPhysicalTruth ==
  reportStatus = StatusFor(available, claimState, scope, allocated)

AllocatedClaimsRespectScope ==
  \A c \in Claims:
    claimState[c] = "active" /\ allocated[c] # NoToken =>
      allocated[c] \in scope[c]

ShortageRequiresCapacityReduction ==
  reportStatus = "shortage" => capacityReduced

ConsumedTokenNoLongerOnHand ==
  \A c \in Claims:
    claimState[c] = "consumed" => allocated[c] \notin onHand

UnplacedStockCannotSatisfyClaims ==
  \A c \in Claims:
    claimState[c] = "active" /\ reportStatus = "feasible" =>
      IF allocated[c] # NoToken
      THEN allocated[c] \in available
      ELSE scope[c] \cap available # {}

ActiveExactAllocationsAreDisjoint ==
  \A left, right \in Claims:
    /\ left # right
    /\ claimState[left] = "active"
    /\ claimState[right] = "active"
    /\ allocated[left] # NoToken
    /\ allocated[right] # NoToken
    => allocated[left] # allocated[right]

\* Negated in the reachability check: detached stock keeps its exact active hold.
ExactHoldAlwaysAvailable ==
  \A c \in Claims:
    claimState[c] = "active" /\ allocated[c] \in onHand =>
      allocated[c] \in available

\* Deliberately omit simultaneous feasibility from explicit allocation.
AllocateWithoutFeasibility(c, t) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ allocated[c] = NoToken
  /\ t \in scope[c] \cap available
  /\ allocated' = [allocated EXCEPT ![c] = t]
  /\ reportStatus' = StatusFor(available, claimState, scope, allocated')
  /\ UNCHANGED <<onHand, available, claimState, scope, capacityReduced>>

AllocateWithoutFeasibilitySpec ==
  Init /\ [][Next \/ \E c \in Claims, t \in Tokens: AllocateWithoutFeasibility(c, t)]_vars

\* A broken detach keeps the old feasibility report even after taking away its capacity.
DetachWithStaleReport(t) ==
  /\ t \in available
  /\ available' = available \ {t}
  /\ capacityReduced' = TRUE
  /\ UNCHANGED <<onHand, claimState, scope, allocated, reportStatus>>

DetachAvailabilityMutationSpec ==
  Init /\ [][Next \/ \E t \in Tokens: DetachWithStaleReport(t)]_vars

=============================================================================
