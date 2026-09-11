---- MODULE UseByReservation ----
EXTENDS Naturals, Integers, FiniteSets, TLC

\* Finite signed epoch-millisecond quotient. Runtime absence is null/undefined; the
\* model-only NoTime sentinel sits strictly outside the modeled instant domain.
Resources == {"early", "late"}
NoResource == "none"
MinTime == -2
MaxTime == 3
NoTime == MinTime - 1

UseByEpochMs(resource) ==
  CASE resource = "early" -> 0
    [] resource = "late"  -> 3
    [] OTHER               -> MaxTime + 1

VARIABLES nowEpochMs,
          stock,
          claimState,
          allowExpired,
          allocation,
          allocatedAtEpochMs,
          consumedResource,
          consumedAtEpochMs,
          shortageReport

vars ==
  <<nowEpochMs,
    stock,
    claimState,
    allowExpired,
    allocation,
    allocatedAtEpochMs,
    consumedResource,
    consumedAtEpochMs,
    shortageReport>>

ResourceUsable(resource, time, allowsExpired) ==
  resource \in stock /\ (allowsExpired \/ time < UseByEpochMs(resource))

\* Active allocated claims require that exact resource to remain usable; active
\* unallocated claims require at least one usable resource in current stock.
ClaimFeasible(stockSet, time, state, allowsExpired, allocatedResource) ==
  IF state # "active"
  THEN TRUE
  ELSE IF allocatedResource # NoResource
       THEN allocatedResource \in stockSet /\
            (allowsExpired \/ time < UseByEpochMs(allocatedResource))
       ELSE \E resource \in stockSet:
              allowsExpired \/ time < UseByEpochMs(resource)

\* A shortage is exactly the negation of current claim feasibility.
ShortageFor(stockSet, time, state, allowsExpired, allocatedResource) ==
  ~ClaimFeasible(stockSet, time, state, allowsExpired, allocatedResource)

Init ==
  /\ nowEpochMs = MinTime
  /\ stock = Resources
  /\ claimState = "none"
  /\ allowExpired = FALSE
  /\ allocation = NoResource
  /\ allocatedAtEpochMs = NoTime
  /\ consumedResource = NoResource
  /\ consumedAtEpochMs = NoTime
  /\ shortageReport = FALSE

CreateClaim(allowsExpired) ==
  /\ claimState = "none"
  /\ ClaimFeasible(stock, nowEpochMs, "active", allowsExpired, NoResource)
  /\ allowExpired' = allowsExpired
  /\ claimState' = "active"
  /\ allocation' = NoResource
  /\ allocatedAtEpochMs' = NoTime
  /\ consumedResource' = consumedResource
  /\ consumedAtEpochMs' = consumedAtEpochMs
  /\ nowEpochMs' = nowEpochMs
  /\ stock' = stock
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

Allocate(resource) ==
  /\ claimState = "active"
  /\ ResourceUsable(resource, nowEpochMs, allowExpired)
  /\ allocation' = resource
  /\ allocatedAtEpochMs' = nowEpochMs
  /\ UNCHANGED <<nowEpochMs, stock, claimState, allowExpired,
                  consumedResource, consumedAtEpochMs>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

AdvanceTime ==
  /\ nowEpochMs < MaxTime
  /\ nowEpochMs' = nowEpochMs + 1
  /\ UNCHANGED <<stock, claimState, allowExpired, allocation,
                  allocatedAtEpochMs, consumedResource, consumedAtEpochMs>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

PhysicalLoss(resource) ==
  /\ resource \in stock
  /\ stock' = stock \ {resource}
  /\ UNCHANGED <<nowEpochMs, claimState, allowExpired, allocation,
                  allocatedAtEpochMs, consumedResource, consumedAtEpochMs>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

Consume ==
  /\ claimState = "active"
  /\ allocation # NoResource
  /\ ResourceUsable(allocation, nowEpochMs, allowExpired)
  /\ stock' = stock \ {allocation}
  /\ claimState' = "consumed"
  /\ consumedResource' = allocation
  /\ consumedAtEpochMs' = nowEpochMs
  /\ allocation' = NoResource
  /\ allocatedAtEpochMs' = NoTime
  /\ UNCHANGED <<nowEpochMs, allowExpired>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

Release ==
  /\ claimState = "active"
  /\ claimState' = "released"
  /\ allocation' = NoResource
  /\ allocatedAtEpochMs' = NoTime
  /\ UNCHANGED <<nowEpochMs, stock, allowExpired,
                  consumedResource, consumedAtEpochMs>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

Next ==
  \/ \E allowsExpired \in BOOLEAN: CreateClaim(allowsExpired)
  \/ \E resource \in Resources: Allocate(resource)
  \/ AdvanceTime
  \/ \E resource \in Resources: PhysicalLoss(resource)
  \/ Consume
  \/ Release

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ nowEpochMs \in MinTime..MaxTime
  /\ stock \subseteq Resources
  /\ claimState \in {"none", "active", "consumed", "released"}
  /\ allowExpired \in BOOLEAN
  /\ allocation \in Resources \cup {NoResource}
  /\ allocatedAtEpochMs \in {NoTime} \cup MinTime..MaxTime
  /\ consumedResource \in Resources \cup {NoResource}
  /\ consumedAtEpochMs \in {NoTime} \cup MinTime..MaxTime
  /\ shortageReport \in BOOLEAN

ReportMatchesCurrentTruth ==
  shortageReport =
    ShortageFor(stock, nowEpochMs, claimState, allowExpired, allocation)

OrdinaryAllocationWasUsable ==
  allocatedAtEpochMs = NoTime \/
    allowExpired \/
    allocatedAtEpochMs < UseByEpochMs(allocation)

OrdinaryConsumptionWasUsable ==
  consumedAtEpochMs = NoTime \/
    allowExpired \/
    consumedAtEpochMs < UseByEpochMs(consumedResource)

AllocationEvidenceIsPaired ==
  (allocation = NoResource) = (allocatedAtEpochMs = NoTime)

ConsumedClaimHasEvidence ==
  claimState = "consumed" =>
    /\ consumedResource \in Resources
    /\ consumedAtEpochMs \in MinTime..MaxTime


\* Deliberate negative control: advance the clock while retaining the old report.
AdvanceTimeStaleReportMutation ==
  /\ nowEpochMs < MaxTime
  /\ nowEpochMs' = nowEpochMs + 1
  /\ UNCHANGED <<stock, claimState, allowExpired, allocation,
                  allocatedAtEpochMs, consumedResource, consumedAtEpochMs, shortageReport>>

\* Deliberate negative control: bind an ordinary claim to a resource that is already expired.
AllocateExpiredMutation(resource) ==
  /\ claimState = "active"
  /\ resource \in stock
  /\ ~allowExpired
  /\ nowEpochMs >= UseByEpochMs(resource)
  /\ allocation' = resource
  /\ allocatedAtEpochMs' = nowEpochMs
  /\ UNCHANGED <<nowEpochMs, stock, claimState, allowExpired,
                  consumedResource, consumedAtEpochMs>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

\* Deliberate negative control: consume an ordinary allocation after its use-by boundary.
ConsumeExpiredMutation ==
  /\ claimState = "active"
  /\ allocation # NoResource
  /\ allocation \in stock
  /\ ~allowExpired
  /\ nowEpochMs >= UseByEpochMs(allocation)
  /\ stock' = stock \ {allocation}
  /\ claimState' = "consumed"
  /\ consumedResource' = allocation
  /\ consumedAtEpochMs' = nowEpochMs
  /\ allocation' = NoResource
  /\ allocatedAtEpochMs' = NoTime
  /\ UNCHANGED <<nowEpochMs, allowExpired>>
  /\ shortageReport' =
       ShortageFor(stock', nowEpochMs', claimState', allowExpired', allocation')

StaleReportMutationNext == Next \/ AdvanceTimeStaleReportMutation
StaleReportMutationSpec == Init /\ [][StaleReportMutationNext]_vars

ExpiredAllocationMutationNext ==
  Next \/ \E resource \in Resources: AllocateExpiredMutation(resource)
ExpiredAllocationMutationSpec == Init /\ [][ExpiredAllocationMutationNext]_vars

ExpiredConsumptionMutationNext == Next \/ ConsumeExpiredMutation
ExpiredConsumptionMutationSpec == Init /\ [][ExpiredConsumptionMutationNext]_vars


\* A zero millisecond allocation is evidence, not absence. This also forces the
\* positive graph to reach an allocation at zero before the mutant can fire.
EpochZeroAbsenceMutation ==
  /\ claimState = "active"
  /\ nowEpochMs = 0
  /\ allocation \in Resources
  /\ allocatedAtEpochMs = 0
  /\ allocatedAtEpochMs' = NoTime
  /\ UNCHANGED <<nowEpochMs, stock, claimState, allowExpired, allocation,
                  consumedResource, consumedAtEpochMs, shortageReport>>

EpochZeroMutationNext == Next \/ EpochZeroAbsenceMutation
EpochZeroMutationSpec == Init /\ [][EpochZeroMutationNext]_vars

=============================================================================
