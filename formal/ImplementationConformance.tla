------------------------- MODULE ImplementationConformance -------------------------
EXTENDS Naturals, Integers, FiniteSets, TLC

CONSTANTS MaxQuantity, OperationIds

VARIABLES source, destination, previousSource, previousDestination,
          seen, intentByOperation, lastKind, lastReplay, lastRejected, lastQuantity,
          lastSourceDelta, lastDestinationDelta

vars == <<source, destination, previousSource, previousDestination,
          seen, intentByOperation, lastKind, lastReplay, lastRejected, lastQuantity,
          lastSourceDelta, lastDestinationDelta>>

Quantities == 0..MaxQuantity
PositiveQuantities == 1..MaxQuantity
BusinessKinds == {"ReceiveMany", "IssueManyByPolicy",
                  "TransferManyByPolicy", "ReplaceAbsolute"}
IntentKinds == BusinessKinds \cup {"None"}
Kinds == IntentKinds \cup {"Replay", "RejectChangedIntent"}

ValidBusinessIntent(kind, quantity) ==
  /\ kind \in BusinessKinds
  /\ \/ /\ kind = "ReplaceAbsolute"
         /\ quantity \in Quantities
     \/ /\ kind # "ReplaceAbsolute"
         /\ quantity \in PositiveQuantities

Intent(kind, quantity) == <<kind, quantity>>

Init ==
  /\ source = 0
  /\ destination = 0
  /\ previousSource = 0
  /\ previousDestination = 0
  /\ seen = {}
  /\ intentByOperation = [op \in OperationIds |-> <<"None", 0>>]
  /\ lastKind = "None"
  /\ lastReplay = FALSE
  /\ lastRejected = FALSE
  /\ lastQuantity = 0
  /\ lastSourceDelta = 0
  /\ lastDestinationDelta = 0

Fresh(op) == op \in OperationIds /\ op \notin seen
SameIntent(op, kind, quantity) ==
  op \in seen /\ intentByOperation[op] = Intent(kind, quantity)
ChangedIntent(op, kind, quantity) ==
  op \in seen /\ intentByOperation[op] # Intent(kind, quantity)

ReceiveMany(op, quantity) ==
  /\ Fresh(op)
  /\ quantity \in PositiveQuantities
  /\ source' = source + quantity
  /\ destination' = destination
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ seen' = seen \cup {op}
  /\ intentByOperation' = [intentByOperation EXCEPT ![op] = Intent("ReceiveMany", quantity)]
  /\ lastKind' = "ReceiveMany"
  /\ lastReplay' = FALSE
  /\ lastRejected' = FALSE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = quantity
  /\ lastDestinationDelta' = 0

IssueManyByPolicy(op, quantity) ==
  /\ Fresh(op)
  /\ quantity \in PositiveQuantities
  /\ quantity <= source
  /\ source' = source - quantity
  /\ destination' = destination
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ seen' = seen \cup {op}
  /\ intentByOperation' = [intentByOperation EXCEPT ![op] = Intent("IssueManyByPolicy", quantity)]
  /\ lastKind' = "IssueManyByPolicy"
  /\ lastReplay' = FALSE
  /\ lastRejected' = FALSE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = 0 - quantity
  /\ lastDestinationDelta' = 0

TransferManyByPolicy(op, quantity) ==
  /\ Fresh(op)
  /\ quantity \in PositiveQuantities
  /\ quantity <= source
  /\ source' = source - quantity
  /\ destination' = destination + quantity
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ seen' = seen \cup {op}
  /\ intentByOperation' = [intentByOperation EXCEPT ![op] = Intent("TransferManyByPolicy", quantity)]
  /\ lastKind' = "TransferManyByPolicy"
  /\ lastReplay' = FALSE
  /\ lastRejected' = FALSE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = 0 - quantity
  /\ lastDestinationDelta' = quantity

ReplaceAbsolute(op, quantity) ==
  /\ Fresh(op)
  /\ quantity \in Quantities
  /\ source' = quantity
  /\ destination' = destination
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ seen' = seen \cup {op}
  /\ intentByOperation' = [intentByOperation EXCEPT ![op] = Intent("ReplaceAbsolute", quantity)]
  /\ lastKind' = "ReplaceAbsolute"
  /\ lastReplay' = FALSE
  /\ lastRejected' = FALSE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = quantity - source
  /\ lastDestinationDelta' = 0

\* Deliberately reports a zero source delta so the generic state/result delta invariant must reject it.
ReplaceAbsoluteDeltaMutation(op, quantity) ==
  /\ Fresh(op)
  /\ quantity \in Quantities
  /\ source' = quantity
  /\ destination' = destination
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ seen' = seen \cup {op}
  /\ intentByOperation' = [intentByOperation EXCEPT ![op] = Intent("ReplaceAbsolute", quantity)]
  /\ lastKind' = "ReplaceAbsolute"
  /\ lastReplay' = FALSE
  /\ lastRejected' = FALSE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = 0
  /\ lastDestinationDelta' = 0

\* Drives only the deliberately wrong replacement transition for mutation checking.
ReplaceAbsoluteDeltaMutationNext ==
  \/ \E op \in OperationIds, quantity \in Quantities : ReplaceAbsoluteDeltaMutation(op, quantity)

\* Runs the forbidden replacement-delta transition under normal stuttering semantics.
ReplaceAbsoluteDeltaMutationSpec == Init /\ [][ReplaceAbsoluteDeltaMutationNext]_vars

Replay(op, kind, quantity) ==
  /\ ValidBusinessIntent(kind, quantity)
  /\ SameIntent(op, kind, quantity)
  /\ UNCHANGED <<source, destination, seen, intentByOperation>>
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ lastKind' = "Replay"
  /\ lastReplay' = TRUE
  /\ lastRejected' = FALSE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = 0
  /\ lastDestinationDelta' = 0

RejectChangedIntent(op, kind, quantity) ==
  /\ ValidBusinessIntent(kind, quantity)
  /\ ChangedIntent(op, kind, quantity)
  /\ UNCHANGED <<source, destination, seen, intentByOperation>>
  /\ previousSource' = source
  /\ previousDestination' = destination
  /\ lastKind' = "RejectChangedIntent"
  /\ lastReplay' = FALSE
  /\ lastRejected' = TRUE
  /\ lastQuantity' = quantity
  /\ lastSourceDelta' = 0
  /\ lastDestinationDelta' = 0

Next ==
  \/ \E op \in OperationIds, quantity \in PositiveQuantities : ReceiveMany(op, quantity)
  \/ \E op \in OperationIds, quantity \in PositiveQuantities : IssueManyByPolicy(op, quantity)
  \/ \E op \in OperationIds, quantity \in PositiveQuantities : TransferManyByPolicy(op, quantity)
  \/ \E op \in OperationIds, quantity \in Quantities : ReplaceAbsolute(op, quantity)
  \/ \E op \in OperationIds, kind \in BusinessKinds, quantity \in Quantities : Replay(op, kind, quantity)
  \/ \E op \in OperationIds, kind \in BusinessKinds, quantity \in Quantities : RejectChangedIntent(op, kind, quantity)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ source \in Nat
  /\ destination \in Nat
  /\ previousSource \in Nat
  /\ previousDestination \in Nat
  /\ seen \subseteq OperationIds
  /\ intentByOperation \in [OperationIds -> IntentKinds \X Quantities]
  /\ lastKind \in Kinds
  /\ lastReplay \in BOOLEAN
  /\ lastRejected \in BOOLEAN
  /\ lastQuantity \in Quantities
  /\ lastSourceDelta \in Int
  /\ lastDestinationDelta \in Int

NonNegative == source >= 0 /\ destination >= 0
\* Every reported source/destination delta equals the actual transition from its recorded pre-state.
ResultDeltasMatchStateTransition ==
  /\ lastSourceDelta = source - previousSource
  /\ lastDestinationDelta = destination - previousDestination
ReplayIsStuttering == lastKind = "Replay" => lastSourceDelta = 0 /\ lastDestinationDelta = 0
ChangedIntentIsStuttering == lastKind = "RejectChangedIntent" => lastSourceDelta = 0 /\ lastDestinationDelta = 0
TransferConserves == lastKind = "TransferManyByPolicy" =>
  /\ lastSourceDelta = 0 - lastQuantity
  /\ lastDestinationDelta = lastQuantity
ReceiveResultAgrees == lastKind = "ReceiveMany" =>
  /\ lastSourceDelta = lastQuantity
  /\ lastDestinationDelta = 0
IssueResultAgrees == lastKind = "IssueManyByPolicy" =>
  /\ lastSourceDelta = 0 - lastQuantity
  /\ lastDestinationDelta = 0
ReplaceResultAgrees == lastKind = "ReplaceAbsolute" =>
  /\ source = lastQuantity
  /\ lastSourceDelta = lastQuantity - previousSource
  /\ lastDestinationDelta = 0
SeenIntentConsistent == \A op \in OperationIds :
  (op \in seen) <=> (intentByOperation[op] # <<"None", 0>>)
ResultFlagsAgree ==
  /\ (lastReplay <=> lastKind = "Replay")
  /\ (lastRejected <=> lastKind = "RejectChangedIntent")

=============================================================================
