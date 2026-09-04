--------------------------- MODULE RecordedDeficit ---------------------------
EXTENDS Integers, FiniteSets

MaxQuantity == 3
IssueQuantities == 1..2
OperationIds == {"op-a", "op-b"}
Modes == {"record", "reject"}
NoOperation == "none"
NoMode == "none"
NoIntent == <<NoMode, 0>>
IntentValues == {NoIntent} \union (Modes \X IssueQuantities)
Outcomes == {"none", "receipt", "record-full", "record-shortage",
             "reject-full", "reject-shortage", "replay", "changed-intent"}

Min(left, right) == IF left <= right THEN left ELSE right
Max(left, right) == IF left >= right THEN left ELSE right
Available(physicalValue, deficitValue) == Max(physicalValue - deficitValue, 0)
Intent(mode, quantity) == <<mode, quantity>>

VARIABLES physical, deficit, signedNet, beforePhysical, beforeDeficit,
          beforeSignedNet, intentByOperation, resultShortfallByOperation,
          lastOperation, lastMode, lastRequested, lastShortfall, lastOutcome,
          lastReplayed, lastChangedIntentRejected

vars == <<physical, deficit, signedNet, beforePhysical, beforeDeficit,
          beforeSignedNet, intentByOperation, resultShortfallByOperation,
          lastOperation, lastMode, lastRequested, lastShortfall, lastOutcome,
          lastReplayed, lastChangedIntentRejected>>

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

Fresh(op) == op \in OperationIds /\ ~Seen(op)
SameIntent(op, mode, quantity) ==
  Seen(op) /\ intentByOperation[op] = Intent(mode, quantity)
ChangedIntent(op, mode, quantity) ==
  Seen(op) /\ intentByOperation[op] # Intent(mode, quantity)

Receipt(quantity) ==
  /\ quantity \in IssueQuantities
  /\ physical + quantity <= MaxQuantity
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ physical' = physical + quantity
  /\ deficit' = deficit
  /\ signedNet' = physical' - deficit'
  /\ lastOperation' = NoOperation
  /\ lastMode' = NoMode
  /\ lastRequested' = quantity
  /\ lastShortfall' = 0
  /\ lastOutcome' = "receipt"
  /\ lastReplayed' = FALSE
  /\ lastChangedIntentRejected' = FALSE
  /\ UNCHANGED <<intentByOperation, resultShortfallByOperation>>

RecordIssue(op, quantity) ==
  LET available == Available(physical, deficit)
      allocated == Min(quantity, available)
      shortfall == quantity - allocated
  IN
    /\ Fresh(op)
    /\ quantity \in IssueQuantities
    /\ deficit + shortfall <= MaxQuantity
    /\ beforePhysical' = physical
    /\ beforeDeficit' = deficit
    /\ beforeSignedNet' = signedNet
    /\ physical' = physical - allocated
    /\ deficit' = deficit + shortfall
    /\ signedNet' = physical' - deficit'
    /\ intentByOperation' = [intentByOperation EXCEPT
         ![op] = Intent("record", quantity)]
    /\ resultShortfallByOperation' = [resultShortfallByOperation EXCEPT
         ![op] = shortfall]
    /\ lastOperation' = op
    /\ lastMode' = "record"
    /\ lastRequested' = quantity
    /\ lastShortfall' = shortfall
    /\ lastOutcome' = IF shortfall = 0 THEN "record-full"
                        ELSE "record-shortage"
    /\ lastReplayed' = FALSE
    /\ lastChangedIntentRejected' = FALSE

RejectIssue(op, quantity) ==
  LET available == Available(physical, deficit)
      shortfall == Max(quantity - available, 0)
  IN
    /\ Fresh(op)
    /\ quantity \in IssueQuantities
    /\ beforePhysical' = physical
    /\ beforeDeficit' = deficit
    /\ beforeSignedNet' = signedNet
    /\ lastMode' = "reject"
    /\ lastRequested' = quantity
    /\ lastShortfall' = shortfall
    /\ lastReplayed' = FALSE
    /\ lastChangedIntentRejected' = FALSE
    /\ IF shortfall = 0
          THEN /\ physical' = physical - quantity
               /\ deficit' = deficit
               /\ signedNet' = physical' - deficit'
               /\ intentByOperation' = [intentByOperation EXCEPT
                    ![op] = Intent("reject", quantity)]
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

Replay(op, mode, quantity) ==
  /\ mode \in Modes
  /\ quantity \in IssueQuantities
  /\ SameIntent(op, mode, quantity)
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ lastOperation' = op
  /\ lastMode' = mode
  /\ lastRequested' = quantity
  /\ lastShortfall' = resultShortfallByOperation[op]
  /\ lastOutcome' = "replay"
  /\ lastReplayed' = TRUE
  /\ lastChangedIntentRejected' = FALSE
  /\ UNCHANGED <<physical, deficit, signedNet, intentByOperation,
                  resultShortfallByOperation>>

RejectChangedIntent(op, mode, quantity) ==
  /\ mode \in Modes
  /\ quantity \in IssueQuantities
  /\ ChangedIntent(op, mode, quantity)
  /\ beforePhysical' = physical
  /\ beforeDeficit' = deficit
  /\ beforeSignedNet' = signedNet
  /\ lastOperation' = op
  /\ lastMode' = mode
  /\ lastRequested' = quantity
  /\ lastShortfall' = resultShortfallByOperation[op]
  /\ lastOutcome' = "changed-intent"
  /\ lastReplayed' = FALSE
  /\ lastChangedIntentRejected' = TRUE
  /\ UNCHANGED <<physical, deficit, signedNet, intentByOperation,
                  resultShortfallByOperation>>

Next ==
  \/ \E quantity \in IssueQuantities: Receipt(quantity)
  \/ \E op \in OperationIds, quantity \in IssueQuantities:
       RecordIssue(op, quantity)
  \/ \E op \in OperationIds, quantity \in IssueQuantities:
       RejectIssue(op, quantity)
  \/ \E op \in OperationIds, mode \in Modes,
        quantity \in IssueQuantities: Replay(op, mode, quantity)
  \/ \E op \in OperationIds, mode \in Modes,
        quantity \in IssueQuantities: RejectChangedIntent(op, mode, quantity)

Spec == Init /\ [][Next]_vars

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

SignedNetIsPhysicalMinusDeficit == signedNet = physical - deficit

RecordedDeficitNeverBecomesPhysical ==
  /\ Available(physical, deficit) >= 0
  /\ Available(physical, deficit) <= physical
  /\ deficit > 0 => Available(physical, deficit) < physical \/ physical = 0

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
    /\ intentByOperation[lastOperation] = Intent(lastMode, lastRequested)
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
    /\ intentByOperation[lastOperation] = Intent(lastMode, lastRequested)
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
    /\ intentByOperation[lastOperation] # Intent(lastMode, lastRequested)
    /\ lastShortfall = resultShortfallByOperation[lastOperation]

=============================================================================
