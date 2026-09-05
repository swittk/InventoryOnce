-------------------------- MODULE TransferLifecycle --------------------------
EXTENDS Naturals, FiniteSets

Transfers == {"T1", "T2"}
Intents == {"I1", "I2"}
NoIntent == "none"
Phases == {"ready", "prepared", "in-transit", "partially-received", "received", "released"}
InitialSource == 5

VARIABLES sourceFree, phase, intent, prepared, dispatched, transit, received,
          owner, transitCustodian, destinationCustodian

vars == <<sourceFree, phase, intent, prepared, dispatched, transit, received,
          owner, transitCustodian, destinationCustodian>>

Init ==
  /\ sourceFree = InitialSource
  /\ phase = [t \in Transfers |-> "ready"]
  /\ intent = [t \in Transfers |-> NoIntent]
  /\ prepared = [t \in Transfers |-> 0]
  /\ dispatched = [t \in Transfers |-> 0]
  /\ transit = [t \in Transfers |-> 0]
  /\ received = [t \in Transfers |-> 0]
  /\ owner = [t \in Transfers |-> "clinic"]
  /\ transitCustodian = [t \in Transfers |-> "clinic"]
  /\ destinationCustodian = [t \in Transfers |-> "clinic"]

Prepare(t, q, i) ==
  /\ t \in Transfers
  /\ q \in 1..InitialSource
  /\ i \in Intents
  /\ phase[t] = "ready"
  /\ q <= sourceFree
  /\ sourceFree' = sourceFree - q
  /\ phase' = [phase EXCEPT ![t] = "prepared"]
  /\ intent' = [intent EXCEPT ![t] = i]
  /\ prepared' = [prepared EXCEPT ![t] = q]
  /\ UNCHANGED <<dispatched, transit, received, owner,
                  transitCustodian, destinationCustodian>>

Release(t) ==
  /\ t \in Transfers
  /\ phase[t] = "prepared"
  /\ sourceFree' = sourceFree + prepared[t]
  /\ prepared' = [prepared EXCEPT ![t] = 0]
  /\ phase' = [phase EXCEPT ![t] = "released"]
  /\ UNCHANGED <<intent, dispatched, transit, received, owner,
                  transitCustodian, destinationCustodian>>

Dispatch(t) ==
  /\ t \in Transfers
  /\ phase[t] = "prepared"
  /\ dispatched' = [dispatched EXCEPT ![t] = prepared[t]]
  /\ transit' = [transit EXCEPT ![t] = prepared[t]]
  /\ prepared' = [prepared EXCEPT ![t] = 0]
  /\ phase' = [phase EXCEPT ![t] = "in-transit"]
  /\ transitCustodian' = [transitCustodian EXCEPT ![t] = "carrier"]
  /\ UNCHANGED <<sourceFree, intent, received, owner, destinationCustodian>>

Receive(t, q) ==
  /\ t \in Transfers
  /\ phase[t] \in {"in-transit", "partially-received"}
  /\ q \in 1..InitialSource
  /\ q <= transit[t]
  /\ transit' = [transit EXCEPT ![t] = @ - q]
  /\ received' = [received EXCEPT ![t] = @ + q]
  /\ phase' = [phase EXCEPT ![t] = IF transit'[t] = 0 THEN "received" ELSE "partially-received"]
  /\ destinationCustodian' = [destinationCustodian EXCEPT ![t] = "destination"]
  /\ UNCHANGED <<sourceFree, intent, prepared, dispatched, owner, transitCustodian>>

\* Exact retries are semantic stutters. Changed-intent retry has no enabled action.
Retry(t, i) ==
  /\ t \in Transfers
  /\ i \in Intents
  /\ phase[t] # "ready"
  /\ intent[t] = i
  /\ UNCHANGED vars

Next ==
  \/ \E t \in Transfers, q \in 1..InitialSource, i \in Intents: Prepare(t, q, i)
  \/ \E t \in Transfers: Release(t)
  \/ \E t \in Transfers: Dispatch(t)
  \/ \E t \in Transfers, q \in 1..InitialSource: Receive(t, q)
  \/ \E t \in Transfers, i \in Intents: Retry(t, i)

\* Deliberate forbidden transition used only by the mutation gate: credit t using other transfer's transit stock.
CrossReceiveMutation(t, other, q) ==
  /\ t \in Transfers
  /\ other \in Transfers
  /\ t # other
  /\ phase[t] \in {"in-transit", "partially-received"}
  /\ phase[other] \in {"in-transit", "partially-received"}
  /\ q \in 1..InitialSource
  /\ q <= transit[other]
  /\ transit' = [transit EXCEPT ![other] = @ - q]
  /\ received' = [received EXCEPT ![t] = @ + q]
  /\ phase' = [phase EXCEPT ![t] = "partially-received"]
  /\ destinationCustodian' = [destinationCustodian EXCEPT ![t] = "destination"]
  /\ UNCHANGED <<sourceFree, intent, prepared, dispatched, owner, transitCustodian>>

IsolationMutationNext ==
  \/ Next
  \/ \E t \in Transfers, other \in Transfers, q \in 1..InitialSource:
       CrossReceiveMutation(t, other, q)

Spec == Init /\ [][Next]_vars
IsolationMutationSpec == Init /\ [][IsolationMutationNext]_vars

TypeOK ==
  /\ sourceFree \in 0..InitialSource
  /\ phase \in [Transfers -> Phases]
  /\ intent \in [Transfers -> Intents \cup {NoIntent}]
  /\ prepared \in [Transfers -> 0..InitialSource]
  /\ dispatched \in [Transfers -> 0..InitialSource]
  /\ transit \in [Transfers -> 0..InitialSource]
  /\ received \in [Transfers -> 0..InitialSource]
  /\ owner \in [Transfers -> {"clinic"}]
  /\ transitCustodian \in [Transfers -> {"clinic", "carrier"}]
  /\ destinationCustodian \in [Transfers -> {"clinic", "destination"}]

RECURSIVE TransferSum(_, _)
TransferSum(transferSet, values) ==
  IF transferSet = {}
  THEN 0
  ELSE LET transfer == CHOOSE candidate \in transferSet: TRUE
       IN values[transfer] + TransferSum(transferSet \ {transfer}, values)

TransferQuantityConserved ==
  sourceFree +
    TransferSum(Transfers, prepared) +
    TransferSum(Transfers, transit) +
    TransferSum(Transfers, received) = InitialSource

ReceivedNeverExceedsDispatched ==
  \A t \in Transfers: received[t] <= dispatched[t]

TransferIsolation ==
  \A t \in Transfers:
    phase[t] \in {"in-transit", "partially-received", "received"} =>
      transit[t] + received[t] = dispatched[t]

PreparedIsUnavailableAtSource ==
  \A t \in Transfers: phase[t] = "prepared" => prepared[t] > 0

DispatchedIsNotPrepared ==
  \A t \in Transfers:
    phase[t] \in {"in-transit", "partially-received", "received"} => prepared[t] = 0

BeforeReceiptDestinationIsEmpty ==
  \A t \in Transfers: phase[t] = "in-transit" => received[t] = 0

PartialReceiptLeavesTransit ==
  \A t \in Transfers: phase[t] = "partially-received" => transit[t] > 0 /\ received[t] > 0

CompletedReceiptLeavesNoTransit ==
  \A t \in Transfers: phase[t] = "received" => transit[t] = 0 /\ received[t] = dispatched[t]

ReleasedReturnsCommitment ==
  \A t \in Transfers: phase[t] = "released" => prepared[t] = 0 /\ dispatched[t] = 0

\* State predicate only: NoIntent is present exactly while a transfer remains ready.
\* Cross-step immutability is enforced by the action structure: only Prepare writes intent.
IntentNeverChanges ==
  \A t \in Transfers: phase[t] = "ready" <=> intent[t] = NoIntent

\* `owner` is constant in this bounded lifecycle model; these checks pin that modeled constant.
\* They do not independently prove custody/ownership separation without an ownership-change action.
OwnershipIsOrthogonal ==
  \A t \in Transfers: owner[t] = "clinic"

TransitCustodyDoesNotChangeOwnership ==
  \A t \in Transfers: transitCustodian[t] = "carrier" => owner[t] = "clinic"

=============================================================================
