------------------------- MODULE TraceabilityGraph -------------------------
EXTENDS FiniteSets, Integers

Objects == {"P", "C1", "C2", "O"}
InputObjects == {"C1", "C2"}

VARIABLES active, association, everConsumed, everProduced, genealogy, productionCount

vars == <<active, association, everConsumed, everProduced, genealogy, productionCount>>

Init ==
  /\ active = {"P", "C1", "C2"}
  /\ association = {}
  /\ everConsumed = {}
  /\ everProduced = {}
  /\ genealogy = {}
  /\ productionCount = 0

Associate(subject, related) ==
  /\ subject \in active
  /\ related \in active
  /\ subject # related
  /\ <<subject, related>> \notin association
  /\ association' = association \cup {<<subject, related>>}
  /\ UNCHANGED <<active, everConsumed, everProduced, genealogy, productionCount>>

Disassociate(subject, related) ==
  /\ <<subject, related>> \in association
  /\ association' = association \ {<<subject, related>>}
  /\ UNCHANGED <<active, everConsumed, everProduced, genealogy, productionCount>>

\* Transformation records irreversible genealogy only. Placement is a separate state machine.
Transform ==
  /\ InputObjects \subseteq active
  /\ "O" \notin active
  /\ "O" \notin everProduced
  /\ active' = (active \ InputObjects) \cup {"O"}
  /\ everConsumed' = everConsumed \cup InputObjects
  /\ everProduced' = everProduced \cup {"O"}
  /\ genealogy' = genealogy \cup {<<"C1", "O">>, <<"C2", "O">>}
  /\ productionCount' = productionCount + 1
  /\ UNCHANGED association

Next ==
  \/ \E subject \in Objects, related \in Objects: Associate(subject, related)
  \/ \E subject \in Objects, related \in Objects: Disassociate(subject, related)
  \/ Transform

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ active \subseteq Objects
  /\ association \subseteq Objects \X Objects
  /\ everConsumed \subseteq Objects
  /\ everProduced \subseteq Objects
  /\ genealogy \subseteq Objects \X Objects
  \* Permit the ghost counter to reach the duplicate state so uniqueness remains independent.
  /\ productionCount \in 0..2

NoSelfAssociation == \A edge \in association: edge[1] # edge[2]

ConsumedIdentityIsNotStillActive == everConsumed \cap active = {}

ProducedIdentityWasCreatedOnce ==
  /\ productionCount <= 1
  /\ everProduced \subseteq active \cup everConsumed

GenealogyOnlyPointsFromConsumedToProduced ==
  \A edge \in genealogy:
    edge[1] \in everConsumed /\ edge[2] \in everProduced

\* Associations are durable across consumption and disappear only via Disassociate.
AssociationEndpointsRemainKnown ==
  \A edge \in association:
    edge[1] \in active \cup everConsumed
      /\ edge[2] \in active \cup everConsumed

\* Deliberate negative control: record the same produced identity a second time.
\* This ghost counter makes uniqueness falsifiable even though everProduced is a set.
DuplicateProductionMutation ==
  /\ "O" \in everProduced
  /\ productionCount' = productionCount + 1
  /\ UNCHANGED <<active, association, everConsumed, everProduced, genealogy>>

DuplicateProductionMutationNext == Next \/ DuplicateProductionMutation
DuplicateProductionMutationSpec == Init /\ [][DuplicateProductionMutationNext]_vars

=============================================================================
