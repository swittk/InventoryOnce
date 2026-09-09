---- MODULE UseByReservation ----
EXTENDS Naturals, Integers, FiniteSets, TLC

Resources == {"early", "late"}
NoResource == "none"
NoTime == -1
MaxTime == 3

UseBy(resource) ==
  CASE resource = "early" -> 1
    [] resource = "late"  -> 3
    [] OTHER               -> MaxTime + 1

VARIABLES now,
          stock,
          claimState,
          allowExpired,
          allocation,
          allocatedAt,
          consumedResource,
          consumedAt,
          shortageReport

vars ==
  <<now,
    stock,
    claimState,
    allowExpired,
    allocation,
    allocatedAt,
    consumedResource,
    consumedAt,
    shortageReport>>

ResourceUsable(resource, time, allowsExpired) ==
  resource \in stock /\ (allowsExpired \/ time < UseBy(resource))

\* Active allocated claims require that exact resource to remain usable; active
\* unallocated claims require at least one usable resource in current stock.
ClaimFeasible(stockSet, time, state, allowsExpired, allocatedResource) ==
  IF state # "active"
  THEN TRUE
  ELSE IF allocatedResource # NoResource
       THEN allocatedResource \in stockSet /\
            (allowsExpired \/ time < UseBy(allocatedResource))
       ELSE \E resource \in stockSet:
              allowsExpired \/ time < UseBy(resource)

\* A shortage is exactly the negation of current claim feasibility.
ShortageFor(stockSet, time, state, allowsExpired, allocatedResource) ==
  ~ClaimFeasible(stockSet, time, state, allowsExpired, allocatedResource)

Init ==
  /\ now = 0
  /\ stock = Resources
  /\ claimState = "none"
  /\ allowExpired = FALSE
  /\ allocation = NoResource
  /\ allocatedAt = NoTime
  /\ consumedResource = NoResource
  /\ consumedAt = NoTime
  /\ shortageReport = FALSE

CreateClaim(allowsExpired) ==
  /\ claimState = "none"
  /\ ClaimFeasible(stock, now, "active", allowsExpired, NoResource)
  /\ allowExpired' = allowsExpired
  /\ claimState' = "active"
  /\ allocation' = NoResource
  /\ allocatedAt' = NoTime
  /\ consumedResource' = consumedResource
  /\ consumedAt' = consumedAt
  /\ now' = now
  /\ stock' = stock
  /\ shortageReport' =
       ShortageFor(stock', now', claimState', allowExpired', allocation')

Allocate(resource) ==
  /\ claimState = "active"
  /\ ResourceUsable(resource, now, allowExpired)
  /\ allocation' = resource
  /\ allocatedAt' = now
  /\ UNCHANGED <<now, stock, claimState, allowExpired,
                  consumedResource, consumedAt>>
  /\ shortageReport' =
       ShortageFor(stock', now', claimState', allowExpired', allocation')

AdvanceTime ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<stock, claimState, allowExpired, allocation,
                  allocatedAt, consumedResource, consumedAt>>
  /\ shortageReport' =
       ShortageFor(stock', now', claimState', allowExpired', allocation')

PhysicalLoss(resource) ==
  /\ resource \in stock
  /\ stock' = stock \ {resource}
  /\ UNCHANGED <<now, claimState, allowExpired, allocation,
                  allocatedAt, consumedResource, consumedAt>>
  /\ shortageReport' =
       ShortageFor(stock', now', claimState', allowExpired', allocation')

Consume ==
  /\ claimState = "active"
  /\ allocation # NoResource
  /\ ResourceUsable(allocation, now, allowExpired)
  /\ stock' = stock \ {allocation}
  /\ claimState' = "consumed"
  /\ consumedResource' = allocation
  /\ consumedAt' = now
  /\ allocation' = NoResource
  /\ allocatedAt' = NoTime
  /\ UNCHANGED <<now, allowExpired>>
  /\ shortageReport' =
       ShortageFor(stock', now', claimState', allowExpired', allocation')

Release ==
  /\ claimState = "active"
  /\ claimState' = "released"
  /\ allocation' = NoResource
  /\ allocatedAt' = NoTime
  /\ UNCHANGED <<now, stock, allowExpired,
                  consumedResource, consumedAt>>
  /\ shortageReport' =
       ShortageFor(stock', now', claimState', allowExpired', allocation')

Next ==
  \/ \E allowsExpired \in BOOLEAN: CreateClaim(allowsExpired)
  \/ \E resource \in Resources: Allocate(resource)
  \/ AdvanceTime
  \/ \E resource \in Resources: PhysicalLoss(resource)
  \/ Consume
  \/ Release

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ now \in 0..MaxTime
  /\ stock \subseteq Resources
  /\ claimState \in {"none", "active", "consumed", "released"}
  /\ allowExpired \in BOOLEAN
  /\ allocation \in Resources \cup {NoResource}
  /\ allocatedAt \in {NoTime} \cup 0..MaxTime
  /\ consumedResource \in Resources \cup {NoResource}
  /\ consumedAt \in {NoTime} \cup 0..MaxTime
  /\ shortageReport \in BOOLEAN

ReportMatchesCurrentTruth ==
  shortageReport =
    ShortageFor(stock, now, claimState, allowExpired, allocation)

OrdinaryAllocationWasUsable ==
  allocatedAt = NoTime \/
    allowExpired \/
    allocatedAt < UseBy(allocation)

OrdinaryConsumptionWasUsable ==
  consumedAt = NoTime \/
    allowExpired \/
    consumedAt < UseBy(consumedResource)

AllocationEvidenceIsPaired ==
  (allocation = NoResource) = (allocatedAt = NoTime)

ConsumedClaimHasEvidence ==
  claimState = "consumed" =>
    /\ consumedResource \in Resources
    /\ consumedAt \in 0..MaxTime

=============================================================================
