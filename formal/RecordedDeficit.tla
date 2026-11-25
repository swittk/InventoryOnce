--------------------------- MODULE RecordedDeficit ---------------------------
EXTENDS Integers, FiniteSets

MaxQuantity == 3
MovementQuantities == 1..2
Verbs == {"issue", "scrap", "transfer"}
NoVerb == "none"
NoArrivals == <<0, 0>>
OperationIds == {"op-a", "op-b"}
Modes == {"record", "reject"}
NoOperation == "none"
NoMode == "none"
NoIntent == <<NoMode, 0, NoVerb>>
IntentValues == {NoIntent} \union (Modes \X MovementQuantities \X Verbs)
Outcomes == {"none", "receipt", "record-full", "record-shortage",
             "reject-full", "reject-shortage", "replay", "changed-intent"}

Min(left, right) == IF left <= right THEN left ELSE right
Max(left, right) == IF left >= right THEN left ELSE right
Available(physicalValue, deficitValue) == Max(physicalValue - deficitValue, 0)
Intent(mode, quantity, verb) == <<mode, quantity, verb>>

VARIABLES physical, deficit, signedNet, beforePhysical, beforeDeficit,
          beforeSignedNet, intentByOperation, resultShortfallByOperation,
          lastOperation, lastMode, lastRequested, lastShortfall, lastOutcome,
          lastReplayed, lastChangedIntentRejected, lastVerb, arrivals, beforeArrivals

vars == <<physical, deficit, signedNet, beforePhysical, beforeDeficit,
          beforeSignedNet, intentByOperation, resultShortfallByOperation,
          lastOperation, lastMode, lastRequested, lastShortfall, lastOutcome,
          lastReplayed, lastChangedIntentRejected, lastVerb, arrivals, beforeArrivals>>

Seen(op) == intentByOperation[op] # NoIntent

Init ==
  /\ physical = 0
  /\ deficit = 0
  /\ signedNet = 0
  /\ beforePhysical = 0
  /\ beforeDeficit = 0
  /\ beforeSignedNet = 0
  /\ intentByOperation = [op \in OperationIds |-> NoIntent]
  /\ resultShortfallByOperation = [op \in OperationIds |-> 0]
  /\ lastOperation = NoOperation
  /\ lastMode = NoMode
  /\ lastRequested = 0
  /\ lastShortfall = 0
  /\ lastOutcome = "none"
  /\ lastReplayed = FALSE
  /\ lastChangedIntentRejected = FALSE
  /\ lastVerb = NoVerb
  /\ arrivals = NoArrivals
  /\ beforeArrivals = NoArrivals

Fresh(op) == op \in OperationIds /\ ~Seen(op)
SameIntent(op, mode, quantity, verb) ==
  Seen(op) /\ intentByOperation[op] = Intent(mode, quantity, verb)
ChangedIntent(op, mode, quantity, verb) ==
  Seen(op) /\ intentByOperation[op] # Intent(mode, quantity, verb)

Receipt(quantity) ==
  /\ quantity \in MovementQuantities
  /\ physical + quantity <= MaxQuantity
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ physical' = physical + quantity
  /\ deficit' = deficit
  /\ signedNet' = physical' - deficit'
  /\ lastOperation' = NoOperation
  /\ lastMode' = NoMode
  /\ lastVerb' = NoVerb
  /\ beforeArrivals' = arrivals
  /\ UNCHANGED arrivals
  /\ lastRequested' = quantity
  /\ lastShortfall' = 0
  /\ lastOutcome' = "receipt"
  /\ lastReplayed' = FALSE
  /\ lastChangedIntentRejected' = FALSE
  /\ UNCHANGED <<intentByOperation, resultShortfallByOperation>>

RecordMovement(op, quantity, verb, fabricate) ==
  LET available == Available(physical, deficit)
      allocated == Min(quantity, available)
      shortfall == quantity - allocated
  IN
    /\ Fresh(op)
    /\ quantity \in MovementQuantities
    /\ deficit + shortfall <= MaxQuantity
    /\ beforePhysical' = physical
    /\ beforeDeficit' = deficit
    /\ beforeSignedNet' = signedNet
    /\ physical' = physical - allocated
    /\ deficit' = deficit + shortfall
    /\ signedNet' = physical' - deficit'
    /\ intentByOperation' = [intentByOperation EXCEPT
         ![op] = Intent("record", quantity, verb)]
    /\ resultShortfallByOperation' = [resultShortfallByOperation EXCEPT
         ![op] = shortfall]
    /\ lastOperation' = op
    /\ lastMode' = "record"
    /\ lastVerb' = verb
    /\ beforeArrivals' = arrivals
    /\ arrivals' = IF verb = "transfer"
                      THEN IF fabricate
                           THEN <<arrivals[1] + quantity, arrivals[2]>>
                           ELSE <<arrivals[1] + allocated, arrivals[2] + shortfall>>
                      ELSE arrivals
    /\ lastRequested' = quantity
    /\ lastShortfall' = shortfall
    /\ lastOutcome' = IF shortfall = 0 THEN "record-full"
                        ELSE "record-shortage"
    /\ lastReplayed' = FALSE
    /\ lastChangedIntentRejected' = FALSE

RejectMovement(op, quantity, verb) ==
  LET available == Available(physical, deficit)
      shortfall == Max(quantity - available, 0)
  IN
    /\ Fresh(op)
    /\ quantity \in MovementQuantities
    /\ beforePhysical' = physical
    /\ beforeDeficit' = deficit
    /\ beforeSignedNet' = signedNet
    /\ lastMode' = "reject"
    /\ lastVerb' = verb
    /\ beforeArrivals' = arrivals
    /\ arrivals' = IF verb = "transfer" /\ shortfall = 0
                      THEN <<arrivals[1] + quantity, arrivals[2]>>
                      ELSE arrivals
    /\ lastRequested' = quantity
    /\ lastShortfall' = shortfall
    /\ lastReplayed' = FALSE
    /\ lastChangedIntentRejected' = FALSE
    /\ IF shortfall = 0
          THEN /\ physical' = physical - quantity
               /\ deficit' = deficit
               /\ signedNet' = physical' - deficit'
               /\ intentByOperation' = [intentByOperation EXCEPT
                    ![op] = Intent("reject", quantity, verb)]
               /\ resultShortfallByOperation' = [resultShortfallByOperation EXCEPT
                    ![op] = 0]
               /\ lastOperation' = op
               /\ lastOutcome' = "reject-full"
          ELSE /\ physical' = physical
               /\ deficit' = deficit
               /\ signedNet' = signedNet
               /\ lastOperation' = NoOperation
               /\ lastOutcome' = "reject-shortage"
               /\ UNCHANGED <<intentByOperation,
                               resultShortfallByOperation>>

Replay(op, mode, quantity, verb) ==
  /\ mode \in Modes
  /\ quantity \in MovementQuantities
  /\ SameIntent(op, mode, quantity, verb)
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ lastOperation' = op
  /\ lastMode' = mode
  /\ lastVerb' = verb
  /\ beforeArrivals' = arrivals
  /\ UNCHANGED arrivals
  /\ lastRequested' = quantity
  /\ lastShortfall' = resultShortfallByOperation[op]
  /\ lastOutcome' = "replay"
  /\ lastReplayed' = TRUE
  /\ lastChangedIntentRejected' = FALSE
  /\ UNCHANGED <<physical, deficit, signedNet, intentByOperation,
                  resultShortfallByOperation>>

RejectChangedIntent(op, mode, quantity, verb) ==
  /\ mode \in Modes
  /\ quantity \in MovementQuantities
  /\ ChangedIntent(op, mode, quantity, verb)
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ lastOperation' = op
  /\ lastMode' = mode
  /\ lastVerb' = verb
  /\ beforeArrivals' = arrivals
  /\ UNCHANGED arrivals
  /\ lastRequested' = quantity
  /\ lastShortfall' = resultShortfallByOperation[op]
  /\ lastOutcome' = "changed-intent"
  /\ lastReplayed' = FALSE
  /\ lastChangedIntentRejected' = TRUE
  /\ UNCHANGED <<physical, deficit, signedNet, intentByOperation,
                  resultShortfallByOperation>>

Next(fabricate) ==
  \/ \E quantity \in MovementQuantities: Receipt(quantity)
  \/ \E op \in OperationIds, quantity \in MovementQuantities, verb \in Verbs:
       RecordMovement(op, quantity, verb, fabricate)
  \/ \E op \in OperationIds, quantity \in MovementQuantities, verb \in Verbs:
       RejectMovement(op, quantity, verb)
  \/ \E op \in OperationIds, mode \in Modes,
        quantity \in MovementQuantities, verb \in Verbs: Replay(op, mode, quantity, verb)
  \/ \E op \in OperationIds, mode \in Modes,
        quantity \in MovementQuantities, verb \in Verbs: RejectChangedIntent(op, mode, quantity, verb)

Spec == Init /\ [][Next(FALSE)]_vars
FabricatedTransferMutationSpec == Init /\ [][Next(TRUE)]_vars

TypeOK ==
  /\ physical \in 0..MaxQuantity
  /\ deficit \in 0..MaxQuantity
  /\ signedNet \in (-MaxQuantity)..MaxQuantity
  /\ beforePhysical \in 0..MaxQuantity
  /\ beforeDeficit \in 0..MaxQuantity
  /\ beforeSignedNet \in (-MaxQuantity)..MaxQuantity
  /\ intentByOperation \in [OperationIds -> IntentValues]
  /\ resultShortfallByOperation \in [OperationIds -> 0..MaxQuantity]
  /\ lastOperation \in OperationIds \union {NoOperation}
  /\ lastMode \in Modes \union {NoMode}
  /\ lastRequested \in 0..MaxQuantity
  /\ lastShortfall \in 0..MaxQuantity
  /\ lastOutcome \in Outcomes
  /\ lastReplayed \in BOOLEAN
  /\ lastChangedIntentRejected \in BOOLEAN
  /\ lastVerb \in Verbs \union {NoVerb}
  /\ arrivals \in (0..4) \X (0..4)
  /\ beforeArrivals \in (0..4) \X (0..4)

SignedNetIsPhysicalMinusDeficit == signedNet = physical - deficit

RecordedDeficitNeverBecomesPhysical ==
  /\ Available(physical, deficit) >= 0
  /\ Available(physical, deficit) <= physical
  /\ deficit > 0 => Available(physical, deficit) < physical \/ physical = 0

\* Issue transitions may consume only capacity available before the step;
\* recorded deficit is a liability and can never fund physical allocation.
IssueConsumesOnlyAvailableCapacity ==
  ~(lastOutcome \in {"record-full", "record-shortage", "reject-full"}) \/
    beforePhysical - physical <= Available(beforePhysical, beforeDeficit)

\* Scope: Seen(op) is defined by intentByOperation[op] # NoIntent; the first
\* conjunct below records that representation invariant rather than adding a new transition check.
SeenIntentAndResultAreDurable ==
  \A op \in OperationIds:
    /\ Seen(op) <=> (intentByOperation[op] # NoIntent)
    /\ ~Seen(op) => resultShortfallByOperation[op] = 0
    /\ intentByOperation[op][1] = "reject" =>
         resultShortfallByOperation[op] = 0
    /\ resultShortfallByOperation[op] <= intentByOperation[op][2]

ReceiptPreservesDeficit ==
  lastOutcome # "receipt" \/
    /\ lastOperation = NoOperation
    /\ lastMode = NoMode
    /\ deficit = beforeDeficit
    /\ physical = beforePhysical + lastRequested
    /\ signedNet = beforeSignedNet + lastRequested

RecordShortageIsExplicit ==
  lastOutcome # "record-shortage" \/
    /\ lastOperation \in OperationIds
    /\ Seen(lastOperation)
    /\ lastMode = "record"
    /\ lastShortfall > 0
    /\ intentByOperation[lastOperation] = Intent(lastMode, lastRequested, lastVerb)
    /\ resultShortfallByOperation[lastOperation] = lastShortfall
    /\ deficit = beforeDeficit + lastShortfall
    /\ signedNet = beforeSignedNet - lastRequested

RejectShortagePreservesTruth ==
  lastOutcome # "reject-shortage" \/
    /\ lastOperation = NoOperation
    /\ lastMode = "reject"
    /\ lastShortfall > 0
    /\ physical = beforePhysical
    /\ deficit = beforeDeficit
    /\ signedNet = beforeSignedNet

FullIssueNeverCreatesDeficit ==
  ~(lastOutcome \in {"record-full", "reject-full"}) \/
    /\ lastOperation \in OperationIds
    /\ Seen(lastOperation)
    /\ lastShortfall = 0
    /\ deficit = beforeDeficit
    /\ signedNet = beforeSignedNet - lastRequested
    /\ resultShortfallByOperation[lastOperation] = 0

ReplayPreservesTruthAndResult ==
  lastOutcome # "replay" \/
    /\ lastReplayed
    /\ ~lastChangedIntentRejected
    /\ physical = beforePhysical
    /\ deficit = beforeDeficit
    /\ signedNet = beforeSignedNet
    /\ lastOperation \in OperationIds
    /\ Seen(lastOperation)
    /\ intentByOperation[lastOperation] = Intent(lastMode, lastRequested, lastVerb)
    /\ lastShortfall = resultShortfallByOperation[lastOperation]

ChangedIntentRejectsAndStutters ==
  lastOutcome # "changed-intent" \/
    /\ ~lastReplayed
    /\ lastChangedIntentRejected
    /\ physical = beforePhysical
    /\ deficit = beforeDeficit
    /\ signedNet = beforeSignedNet
    /\ lastOperation \in OperationIds
    /\ Seen(lastOperation)
    /\ intentByOperation[lastOperation] # Intent(lastMode, lastRequested, lastVerb)
    /\ lastShortfall = resultShortfallByOperation[lastOperation]

\* A transfer publishes the two arrival portions with the signed source in one step.
\* Other verbs, rejected attempts, and retries cannot add destination stock.
TransferArrivalsMatchSeparateWitnesses ==
  IF lastVerb = "transfer" /\ lastOutcome \in {"record-full", "record-shortage", "reject-full"}
  THEN /\ arrivals[1] - beforeArrivals[1] = beforePhysical - physical
       /\ arrivals[2] - beforeArrivals[2] = lastShortfall
       /\ arrivals[1] + arrivals[2] - beforeArrivals[1] - beforeArrivals[2]
          = beforeSignedNet - signedNet
  ELSE arrivals = beforeArrivals

\* The ordinary model must admit one witnessed transfer mixed with unknown arrival.
MixedTransferIsUnreachable ==
  ~(lastVerb = "transfer" /\ lastOutcome = "record-shortage" /\
    arrivals[1] > beforeArrivals[1] /\ arrivals[2] > beforeArrivals[2])

=============================================================================
