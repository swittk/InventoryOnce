------------------------- MODULE TraceabilityGraph -------------------------
EXTENDS FiniteSets, Integers

Objects == {"P", "C1", "C2", "O"}
ASSUME Cardinality(Objects) <= 4
NoParent == "none"
ParentDomain == Objects \cup {NoParent}
InputObjects == {"C1", "C2"}

VARIABLES active, parent, association, everConsumed, everProduced, genealogy, productionCount

vars == <<active, parent, association, everConsumed, everProduced, genealogy, productionCount>>

ParentChainTerminates(p, o) ==
  \/ p[o] = NoParent
  \/ p[p[o]] = NoParent
  \/ p[p[p[o]]] = NoParent
  \/ p[p[p[p[o]]]] = NoParent

ParentChainsAreAcyclic(p) ==
  /\ p[NoParent] = NoParent
  /\ \A o \in Objects: ParentChainTerminates(p, o)

Init ==
  /\ active = {"P", "C1", "C2"}
  /\ parent = [o \in ParentDomain |-> NoParent]
  /\ association = {}
  /\ everConsumed = {}
  /\ everProduced = {}
  /\ genealogy = {}
  /\ productionCount = 0

Aggregate(child, container) ==
  /\ child \in active
  /\ container \in active
  /\ child # container
  /\ parent[child] = NoParent
  /\ ParentChainsAreAcyclic([parent EXCEPT ![child] = container])
  /\ parent' = [parent EXCEPT ![child] = container]
  /\ UNCHANGED <<active, association, everConsumed, everProduced, genealogy, productionCount>>

Disaggregate(child) ==
  /\ child \in active
  /\ parent[child] # NoParent
  /\ parent' = [parent EXCEPT ![child] = NoParent]
  /\ UNCHANGED <<active, association, everConsumed, everProduced, genealogy, productionCount>>

Associate(child, durableParent) ==
  /\ child \in active
  /\ durableParent \in active
  /\ child # durableParent
  /\ <<child, durableParent>> \notin association
  /\ association' = association \cup {<<child, durableParent>>}
  /\ UNCHANGED <<active, parent, everConsumed, everProduced, genealogy, productionCount>>

Disassociate(child, durableParent) ==
  /\ <<child, durableParent>> \in association
  /\ association' = association \ {<<child, durableParent>>}
  /\ UNCHANGED <<active, parent, everConsumed, everProduced, genealogy, productionCount>>

\* Transformation records irreversible genealogy only; containment/association are explicit relations.
Transform ==
  /\ InputObjects \subseteq active
  /\ "O" \notin active
  /\ "O" \notin everProduced
  /\ \A i \in InputObjects: parent[i] = NoParent
  \* An input may not be consumed while an active object is still contained in it.
  /\ \A o \in active: parent[o] \notin InputObjects
  /\ active' = (active \ InputObjects) \cup {"O"}
  /\ everConsumed' = everConsumed \cup InputObjects
  /\ everProduced' = everProduced \cup {"O"}
  /\ genealogy' = genealogy \cup {<<"C1", "O">>, <<"C2", "O">>}
  /\ productionCount' = productionCount + 1
  /\ UNCHANGED <<parent, association>>

Next ==
  \/ \E child \in Objects, p \in Objects: Aggregate(child, p)
  \/ \E child \in Objects: Disaggregate(child)
  \/ \E child \in Objects, p \in Objects: Associate(child, p)
  \/ \E child \in Objects, p \in Objects: Disassociate(child, p)
  \/ Transform

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ active \subseteq Objects
  /\ parent \in [ParentDomain -> ParentDomain]
  /\ association \subseteq Objects \X Objects
  /\ everConsumed \subseteq Objects
  /\ everProduced \subseteq Objects
  /\ genealogy \subseteq Objects \X Objects
  /\ productionCount \in 0..1

ContainmentIsAcyclic == ParentChainsAreAcyclic(parent)

ConsumedIdentityIsNotStillActive == everConsumed \cap active = {}

ProducedIdentityWasCreatedOnce ==
  /\ productionCount <= 1
  /\ everProduced \subseteq active \cup everConsumed

GenealogyOnlyPointsFromConsumedToProduced ==
  \A edge \in genealogy:    edge[1] \in everConsumed /\ edge[2] \in everProduced

\* Associations are durable across consumption and disappear only via Disassociate.
AssociationEndpointsRemainKnown ==
  \A edge \in association:
    edge[1] \in active \cup everConsumed /\ edge[2] \in active \cup everConsumed

AggregationNeverConsumesIdentity ==
  \A o \in Objects:
    parent[o] # NoParent => o \in active /\ o \notin everConsumed


\* Deliberate negative control: record the same produced identity a second time.
\* This ghost counter makes the uniqueness claim falsifiable even though everProduced is a set.
DuplicateProductionMutation ==
  /\ "O" \in everProduced
  /\ productionCount' = productionCount + 1
  /\ UNCHANGED <<active, parent, association, everConsumed, everProduced, genealogy>>

DuplicateProductionMutationNext == Next \/ DuplicateProductionMutation
DuplicateProductionMutationSpec == Init /\ [][DuplicateProductionMutationNext]_vars

=============================================================================
