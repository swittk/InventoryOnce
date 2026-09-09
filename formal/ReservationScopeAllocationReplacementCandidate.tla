---------------- MODULE ReservationScopeAllocationReplacementCandidate ----------------
EXTENDS FiniteSets

\* This unregistered candidate retains the complete ReservationScope state and action domain.
Tokens == {"u1", "u2"}
Claims == {"c1", "c2"}
NoToken == "none"
States == {"none", "active", "released", "consumed"}

VARIABLES onHand, claimState, scope, allocated, reportStatus, physicalLossOccurred

vars == <<onHand, claimState, scope, allocated, reportStatus, physicalLossOccurred>>

\* Inactive claims impose no feasibility constraint, so their candidate domain stays the full token set.
CandidateTokens(c, hand, st, sc, al) ==
  IF st[c] # "active" THEN Tokens
  ELSE IF al[c] # NoToken THEN {al[c]} \cap sc[c] \cap hand
  ELSE sc[c] \cap hand

\* This finite model intentionally fixes Claims to c1/c2; the second conjunct checks the exact two-claim matching case.
FeasibleFor(hand, st, sc, al) ==
  /\ \A c \in Claims:
       st[c] = "active" => CandidateTokens(c, hand, st, sc, al) # {}
  /\ ~((st["c1"] = "active") /\ (st["c2"] = "active"))
      \/ \E t1 \in CandidateTokens("c1", hand, st, sc, al),
             t2 \in CandidateTokens("c2", hand, st, sc, al):
             t1 # t2

StatusFor(hand, st, sc, al) ==
  IF FeasibleFor(hand, st, sc, al) THEN "feasible" ELSE "shortage"

Init ==
  /\ onHand = Tokens
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
       IN FeasibleFor(onHand, nextState, nextScope, allocated)
  /\ claimState' = [claimState EXCEPT ![c] = "active"]
  /\ scope' = [scope EXCEPT ![c] = requestedScope]
  /\ reportStatus' = StatusFor(onHand, claimState', scope', allocated)
  /\ UNCHANGED <<onHand, allocated, physicalLossOccurred>>

Refine(c, narrowerScope) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ narrowerScope \subseteq scope[c]
  /\ narrowerScope # {}
  /\ LET nextScope == [scope EXCEPT ![c] = narrowerScope]
       IN FeasibleFor(onHand, claimState, nextScope, allocated)
  /\ scope' = [scope EXCEPT ![c] = narrowerScope]
  /\ reportStatus' = StatusFor(onHand, claimState, scope', allocated)
  /\ UNCHANGED <<onHand, claimState, allocated, physicalLossOccurred>>

Allocate(c, t) ==
  /\ c \in Claims
  /\ t \in Tokens
  /\ claimState[c] = "active"
  /\ allocated[c] = NoToken
  /\ t \in scope[c] \cap onHand
  /\ LET nextAllocated == [allocated EXCEPT ![c] = t]
       IN FeasibleFor(onHand, claimState, scope, nextAllocated)
  /\ allocated' = [allocated EXCEPT ![c] = t]
  /\ reportStatus' = StatusFor(onHand, claimState, scope, allocated')
  /\ UNCHANGED <<onHand, claimState, scope, physicalLossOccurred>>

\* Model the existing public reallocation operation without widening the original Allocate action.
ReplaceAllocation(c, t) ==
  /\ c \in Claims
  /\ t \in Tokens
  /\ claimState[c] = "active"
  /\ allocated[c] # NoToken
  /\ t \in scope[c] \cap onHand
  /\ LET nextAllocated == [allocated EXCEPT ![c] = t]
       IN FeasibleFor(onHand, claimState, scope, nextAllocated)
  /\ allocated' = [allocated EXCEPT ![c] = t]
  /\ reportStatus' = StatusFor(onHand, claimState, scope, allocated')
  /\ UNCHANGED <<onHand, claimState, scope, physicalLossOccurred>>

Release(c) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ claimState' = [claimState EXCEPT ![c] = "released"]
  /\ allocated' = [allocated EXCEPT ![c] = NoToken]
  /\ reportStatus' = StatusFor(onHand, claimState', scope, allocated')
  /\ UNCHANGED <<onHand, scope, physicalLossOccurred>>

Consume(c) ==
  /\ c \in Claims
  /\ claimState[c] = "active"
  /\ allocated[c] # NoToken
  /\ allocated[c] \in onHand
  /\ onHand' = onHand \ {allocated[c]}
  /\ claimState' = [claimState EXCEPT ![c] = "consumed"]
  /\ reportStatus' = StatusFor(onHand', claimState', scope, allocated)
  /\ UNCHANGED <<scope, allocated, physicalLossOccurred>>

\* Count/correction/scrap records physical truth even when claims become short.
PhysicalLoss(t) ==
  /\ t \in onHand
  /\ onHand' = onHand \ {t}
  /\ reportStatus' = StatusFor(onHand', claimState, scope, allocated)
  /\ physicalLossOccurred' = TRUE
  /\ UNCHANGED <<claimState, scope, allocated>>

Next ==
  \/ \E c \in Claims, s \in SUBSET Tokens: Reserve(c, s)
  \/ \E c \in Claims, s \in SUBSET Tokens: Refine(c, s)
  \/ \E c \in Claims, t \in Tokens: Allocate(c, t)
  \/ \E c \in Claims, t \in Tokens: ReplaceAllocation(c, t)
  \/ \E c \in Claims: Release(c)
  \/ \E c \in Claims: Consume(c)
  \/ \E t \in Tokens: PhysicalLoss(t)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ onHand \subseteq Tokens
  /\ claimState \in [Claims -> States]
  /\ scope \in [Claims -> SUBSET Tokens]
  /\ allocated \in [Claims -> Tokens \cup {NoToken}]
  /\ reportStatus \in {"feasible", "shortage"}
  /\ physicalLossOccurred \in BOOLEAN

ReportMatchesCurrentPhysicalTruth ==
  reportStatus = StatusFor(onHand, claimState, scope, allocated)

AllocatedClaimsRespectScope ==
  \A c \in Claims:
    claimState[c] = "active" /\ allocated[c] # NoToken =>
      allocated[c] \in scope[c]

ShortageRequiresExplicitPhysicalLoss ==
  reportStatus = "shortage" => physicalLossOccurred

ConsumedTokenNoLongerOnHand ==
  \A c \in Claims:
    claimState[c] = "consumed" => allocated[c] \notin onHand

=============================================================================
