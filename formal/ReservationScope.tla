-------------------------- MODULE ReservationScope --------------------------
EXTENDS FiniteSets

Tokens == {"u1", "u2"}
Claims == {"c1", "c2"}
NoToken == "none"
States == {"none", "active", "released", "consumed"}

VARIABLES onHand, available, claimState, scope, allocated, reportStatus,
          physicalLossOccurred

vars == <<onHand, available, claimState, scope, allocated, reportStatus,
          physicalLossOccurred>>

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
  /\ physicalLossOccurred = FALSE

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
  /\ UNCHANGED <<onHand, available, allocated, physicalLossOccurred>>

Refine(c, narrowerScope) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ narrowerScope \subseteq scope[c]
  /\ narrowerScope # {}
  /\ LET nextScope == [scope EXCEPT ![c] = narrowerScope]
       IN FeasibleFor(available, claimState, nextScope, allocated)
  /\ scope' = [scope EXCEPT ![c] = narrowerScope]
  /\ reportStatus' = StatusFor(available, claimState, scope', allocated)
  /\ UNCHANGED <<onHand, available, claimState, allocated, physicalLossOccurred>>

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
  /\ UNCHANGED <<onHand, available, claimState, scope, physicalLossOccurred>>

Release(c) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ claimState' = [claimState EXCEPT ![c] = "released"]
  /\ allocated' = [allocated EXCEPT ![c] = NoToken]
  /\ reportStatus' = StatusFor(available, claimState', scope, allocated')
  /\ UNCHANGED <<onHand, available, scope, physicalLossOccurred>>

Consume(c) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ allocated[c] # NoToken
  /\ allocated[c] \in available
  /\ onHand' = onHand \ {allocated[c]}
  /\ available' = available \ {allocated[c]}
  /\ claimState' = [claimState EXCEPT ![c] = "consumed"]
  /\ reportStatus' = StatusFor(available', claimState', scope, allocated)
  /\ UNCHANGED <<scope, allocated, physicalLossOccurred>>

\* An ordinary detach keeps accounted stock but must not make the current claim book short.
Detach(t) ==
  /\ t \in available
  /\ LET nextAvailable == available \ {t}
       IN FeasibleFor(nextAvailable, claimState, scope, allocated)
  /\ available' = available \ {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ UNCHANGED <<onHand, claimState, scope, allocated, physicalLossOccurred>>

\* Placing a detached/missing token restores it to ordinary reservation/allocation capacity.
Place(t) ==
  /\ t \in onHand \ available
  /\ available' = available \cup {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ UNCHANGED <<onHand, claimState, scope, allocated, physicalLossOccurred>>

\* Count/correction/scrap records physical truth even when claims become short.
PhysicalLoss(t) ==
  /\ t \in onHand
  /\ onHand' = onHand \ {t}
  /\ available' = available \ {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ physicalLossOccurred' = TRUE
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
  /\ physicalLossOccurred \in BOOLEAN

ReportMatchesCurrentPhysicalTruth ==
  reportStatus = StatusFor(available, claimState, scope, allocated)

AllocatedClaimsRespectScope ==
  \A c \in Claims:
    claimState[c] = "active" /\ allocated[c] # NoToken =>
      allocated[c] \in scope[c]

ShortageRequiresExplicitPhysicalLoss ==
  reportStatus = "shortage" => physicalLossOccurred

ConsumedTokenNoLongerOnHand ==
  \A c \in Claims:
    claimState[c] = "consumed" => allocated[c] \notin onHand

UnplacedStockCannotSatisfyClaims ==
  \A c \in Claims:
    claimState[c] = "active" /\ reportStatus = "feasible" =>
      IF allocated[c] # NoToken
      THEN allocated[c] \in available
      ELSE scope[c] \cap available # {}

OrdinaryDetachPreservesExactAllocations ==
  ~physicalLossOccurred =>
    \A c \in Claims:
      claimState[c] = "active" /\ allocated[c] # NoToken =>
        allocated[c] \in available

\* Deliberately wrong ordinary detach used only by the registered mutation checker.
DetachAllocatedWithoutProtection(t) ==
  /\ t \in available
  /\ available' = available \ {t}
  /\ reportStatus' = StatusFor(available', claimState, scope, allocated)
  /\ UNCHANGED <<onHand, claimState, scope, allocated, physicalLossOccurred>>

DetachAvailabilityMutationNext ==
  Next \/ \E t \in Tokens: DetachAllocatedWithoutProtection(t)

DetachAvailabilityMutationSpec ==
  Init /\ [][DetachAvailabilityMutationNext]_vars

=============================================================================
