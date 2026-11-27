--------------------------- MODULE RecordedDeficit ---------------------------
EXTENDS Integers, FiniteSets

MaxQuantity == 3
MovementQuantities == 1..2
PolicyVerbs == {"issue", "scrap", "transfer"}
Verbs == PolicyVerbs \union {"exact-transfer"}
TransferVerbs == {"transfer", "exact-transfer"}
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
Available(physicalValue, issueDeficit, unlabelled) ==
  Max(physicalValue + unlabelled - issueDeficit, 0)
Intent(quantity, verb) == <<quantity, verb>>
PublishedIntent(mode, quantity, verb) == <<mode, quantity, verb>>

VARIABLES physical, deficit, signedNet, beforePhysical, beforeDeficit,
          beforeSignedNet, unlabelledNet, beforeUnlabelledNet,
          intentByOperation, resultShortfallByOperation,
          lastOperation, lastMode, lastRequested, lastShortfall, lastOutcome,
          lastReplayed, lastChangedIntentRejected, lastVerb, arrivals, beforeArrivals

vars == <<physical, deficit, signedNet, beforePhysical, beforeDeficit,
          beforeSignedNet, unlabelledNet, beforeUnlabelledNet,
          intentByOperation, resultShortfallByOperation,
          lastOperation, lastMode, lastRequested, lastShortfall, lastOutcome,
          lastReplayed, lastChangedIntentRejected, lastVerb, arrivals, beforeArrivals>>

Seen(op) == intentByOperation[op] # NoIntent

Init ==
  /\ physical = 0
  /\ deficit = 0
  \* A source can already have positive stock in the same unlabelled row.
  /\ unlabelledNet \in 0..MaxQuantity
  /\ signedNet = unlabelledNet
  /\ beforePhysical = 0
  /\ beforeDeficit = 0
  /\ beforeSignedNet = signedNet
  /\ beforeUnlabelledNet = unlabelledNet
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
\* The stored mode records the publication choice. A retry compares only the command.
StoredCommand(op) == <<intentByOperation[op][2], intentByOperation[op][3]>>
SameIntent(op, quantity, verb) ==
  Seen(op) /\ StoredCommand(op) = Intent(quantity, verb)
ChangedIntent(op, quantity, verb) ==
  Seen(op) /\ StoredCommand(op) # Intent(quantity, verb)

Receipt(quantity) ==
  /\ quantity \in MovementQuantities
  /\ physical + quantity <= MaxQuantity
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ beforeUnlabelledNet' = unlabelledNet
  /\ physical' = physical + quantity
  /\ deficit' = deficit
  /\ signedNet' = physical' - deficit' + unlabelledNet
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
  /\ UNCHANGED <<unlabelledNet, intentByOperation, resultShortfallByOperation>>

\* Record the physical report. Exact transfers name their source stock, and
\* only issue shortfalls enter the dedicated deficit bucket.
RecordMovement(op, quantity, verb, fabricate) ==
  LET available == IF verb = "exact-transfer" THEN physical
                   ELSE Available(physical, deficit, unlabelledNet)
      allocated == Min(quantity, available)
      \* A representative policy order uses lot stock before positive unlabelled stock.
      lotAllocated == Min(physical, allocated)
      unlabelledAllocated == allocated - lotAllocated
      shortfall == quantity - allocated
  IN
    /\ Fresh(op)
    /\ quantity \in MovementQuantities
    /\ IF verb = "issue" THEN deficit + shortfall <= MaxQuantity
                       ELSE unlabelledNet - unlabelledAllocated - shortfall >= -MaxQuantity
    /\ beforePhysical' = physical
    /\ beforeDeficit' = deficit
    /\ beforeSignedNet' = signedNet
    /\ beforeUnlabelledNet' = unlabelledNet
    /\ physical' = physical - lotAllocated
    /\ deficit' = IF verb = "issue" THEN deficit + shortfall ELSE deficit
    /\ unlabelledNet' = unlabelledNet - unlabelledAllocated -
                        (IF verb = "issue" THEN 0 ELSE shortfall)
    /\ signedNet' = physical' - deficit' + unlabelledNet'
    /\ intentByOperation' = [intentByOperation EXCEPT
         ![op] = PublishedIntent("record", quantity, verb)]
    /\ resultShortfallByOperation' = [resultShortfallByOperation EXCEPT
         ![op] = shortfall]
    /\ lastOperation' = op
    /\ lastMode' = "record"
    /\ lastVerb' = verb
    /\ beforeArrivals' = arrivals
    /\ arrivals' = IF verb \in TransferVerbs
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

\* Publish a policy movement only when recorded usable stock covers it.
RejectMovement(op, quantity, verb) ==
  LET available == Available(physical, deficit, unlabelledNet)
      shortfall == Max(quantity - available, 0)
      lotAllocated == Min(physical, quantity)
  IN
    /\ Fresh(op)
    /\ quantity \in MovementQuantities
    /\ beforePhysical' = physical
    /\ beforeDeficit' = deficit
    /\ beforeSignedNet' = signedNet
    /\ beforeUnlabelledNet' = unlabelledNet
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
          THEN /\ physical' = physical - lotAllocated
               /\ unlabelledNet' = unlabelledNet - (quantity - lotAllocated)
               /\ deficit' = deficit
               /\ signedNet' = physical' - deficit' + unlabelledNet'
               /\ intentByOperation' = [intentByOperation EXCEPT
                    ![op] = PublishedIntent("reject", quantity, verb)]
               /\ resultShortfallByOperation' = [resultShortfallByOperation EXCEPT
                    ![op] = 0]
               /\ lastOperation' = op
               /\ lastOutcome' = "reject-full"
          ELSE /\ physical' = physical
               /\ UNCHANGED unlabelledNet
               /\ deficit' = deficit
               /\ signedNet' = signedNet
               /\ lastOperation' = NoOperation
               /\ lastOutcome' = "reject-shortage"
               /\ UNCHANGED <<intentByOperation,
                               resultShortfallByOperation>>

Replay(op, mode, quantity, verb) ==
  /\ mode \in Modes
  /\ quantity \in MovementQuantities
  /\ SameIntent(op, quantity, verb)
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ beforeUnlabelledNet' = unlabelledNet
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
  /\ UNCHANGED <<physical, deficit, signedNet, unlabelledNet, intentByOperation,
                  resultShortfallByOperation>>

RejectChangedIntent(op, mode, quantity, verb) ==
  /\ mode \in Modes
  /\ quantity \in MovementQuantities
  /\ ChangedIntent(op, quantity, verb)
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ beforeUnlabelledNet' = unlabelledNet
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
  /\ UNCHANGED <<physical, deficit, signedNet, unlabelledNet, intentByOperation,
                  resultShortfallByOperation>>

Next(fabricate) ==
  \/ \E quantity \in MovementQuantities: Receipt(quantity)
  \/ \E op \in OperationIds, quantity \in MovementQuantities, verb \in Verbs:
       RecordMovement(op, quantity, verb, fabricate)
  \/ \E op \in OperationIds, quantity \in MovementQuantities, verb \in PolicyVerbs:
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
  /\ signedNet \in (-2 * MaxQuantity)..(2 * MaxQuantity)
  /\ beforePhysical \in 0..MaxQuantity
  /\ beforeDeficit \in 0..MaxQuantity
  /\ beforeSignedNet \in (-2 * MaxQuantity)..(2 * MaxQuantity)
  /\ unlabelledNet \in (-MaxQuantity)..MaxQuantity
  /\ beforeUnlabelledNet \in (-MaxQuantity)..MaxQuantity
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

SignedNetIsPhysicalMinusDeficit == signedNet = physical - deficit + unlabelledNet

RecordedDeficitNeverBecomesPhysical ==
  LET positive == physical + Max(unlabelledNet, 0)
      available == Available(physical, deficit, unlabelledNet)
  IN /\ 0 <= available /\ available <= positive
     /\ (deficit > 0 \/ unlabelledNet < 0) => available < positive \/ positive = 0

UnwitnessedSourceDebit ==
  IF lastOutcome = "record-shortage" /\ lastVerb # "issue" THEN lastShortfall ELSE 0

WitnessedUnlabelledDebit == beforeUnlabelledNet - unlabelledNet - UnwitnessedSourceDebit

WitnessedDebit == beforePhysical - physical + WitnessedUnlabelledDebit

\* Issue transitions may consume only capacity available before the step;
\* recorded deficit is a liability and can never fund physical allocation.
IssueConsumesOnlyAvailableCapacity ==
  lastOutcome \in {"record-full", "record-shortage", "reject-full"} =>
    /\ 0 <= WitnessedUnlabelledDebit
    /\ WitnessedUnlabelledDebit <= Max(beforeUnlabelledNet, 0)
    /\ WitnessedDebit = lastRequested - lastShortfall
    /\ WitnessedDebit <= IF lastVerb = "exact-transfer" THEN beforePhysical
                         ELSE Available(beforePhysical, beforeDeficit, beforeUnlabelledNet)

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
    /\ intentByOperation[lastOperation] = PublishedIntent(lastMode, lastRequested, lastVerb)
    /\ resultShortfallByOperation[lastOperation] = lastShortfall
    /\ deficit = IF lastVerb = "issue" THEN beforeDeficit + lastShortfall ELSE beforeDeficit
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
    /\ StoredCommand(lastOperation) = Intent(lastRequested, lastVerb)
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
    /\ StoredCommand(lastOperation) # Intent(lastRequested, lastVerb)
    /\ lastShortfall = resultShortfallByOperation[lastOperation]

\* A transfer publishes the two arrival portions with the signed source in one step.
\* Other verbs, rejected attempts, and retries cannot add destination stock.
TransferArrivalsMatchSeparateWitnesses ==
  IF lastVerb \in TransferVerbs /\ lastOutcome \in {"record-full", "record-shortage", "reject-full"}
  THEN /\ arrivals[1] - beforeArrivals[1] = WitnessedDebit
       /\ arrivals[2] - beforeArrivals[2] = lastShortfall
       /\ arrivals[1] + arrivals[2] - beforeArrivals[1] - beforeArrivals[2]
          = beforeSignedNet - signedNet
  ELSE arrivals = beforeArrivals

\* The ordinary model must admit one witnessed transfer mixed with unknown arrival.
MixedTransferIsUnreachable ==
  ~(lastVerb \in TransferVerbs /\ lastOutcome = "record-shortage" /\
    arrivals[1] > beforeArrivals[1] /\ arrivals[2] > beforeArrivals[2])

\* A signed unlabelled posting can settle against a row already on hand.
UnlabelledSourceChangesByReportedRemainder ==
  unlabelledNet = beforeUnlabelledNet - UnwitnessedSourceDebit -
    (IF lastOutcome \in {"record-full", "record-shortage", "reject-full"} /\ lastVerb # "exact-transfer"
     THEN Max(lastRequested - lastShortfall - beforePhysical, 0) ELSE 0)

PositiveUnlabelledSettlementIsUnreachable ==
  ~(lastVerb = "exact-transfer" /\ lastOutcome = "record-shortage" /\
    beforePhysical > physical /\ beforeUnlabelledNet > unlabelledNet /\ unlabelledNet > 0)

\* A policy transfer can witness a positive unlabelled row after selecting lot stock.
PositiveUnlabelledAllocationIsUnreachable ==
  ~(lastVerb = "transfer" /\ lastOutcome = "record-full" /\
    beforePhysical > physical /\ WitnessedUnlabelledDebit > 0 /\ lastShortfall = 0)

\* A Reject-mode retry can return a shortage that was published in Record mode.
CrossModeShortageReplayIsUnreachable ==
  ~(lastOutcome = "replay" /\ lastOperation \in OperationIds /\
    intentByOperation[lastOperation][1] = "record" /\ lastMode = "reject" /\ lastShortfall > 0)

=============================================================================
