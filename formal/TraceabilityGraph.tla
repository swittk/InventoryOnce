------------------------- MODULE TraceabilityGraph -------------------------
EXTENDS FiniteSets, Integers

Objects == {"P", "C1", "C2", "O"}
ASSUME Cardinality(Objects) <= 4
NoParent == "none"
ParentDomain == Objects \cup {NoParent}
InputObjects == {"C1", "C2"}

VARIABLES active, parent, association, everConsumed, everProduced, genealogy

vars == <<active, parent, association, everConsumed, everProduced, genealogy>>

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

Aggregate(child, container) ==
  /\ child \in active
  /\ container \in active
  /\ child # container
  /\ parent[child] = NoParent
  /\ ParentChainsAreAcyclic([parent EXCEPT ![child] = container])
  /\ parent' = [parent EXCEPT ![child] = container]
  /\ UNCHANGED <<active, association, everConsumed, everProduced, genealogy>>

Disaggregate(child) ==
  /\ child \in active
  /\ parent[child] # NoParent
  /\ parent' = [parent EXCEPT ![child] = NoParent]
  /\ UNCHANGED <<active, association, everConsumed, everProduced, genealogy>>

Associate(child, durableParent) ==
  /\ child \in active
  /\ durableParent \in active
  /\ child # durableParent
  /\ <<child, durableParent>> \notin association
  /\ association' = association \cup {<<child, durableParent>>}
  /\ UNCHANGED <<active, parent, everConsumed, everProduced, genealogy>>

Disassociate(child, durableParent) ==
  /\ <<child, durableParent>> \in association
  /\ association' = association \ {<<child, durableParent>>}
  /\ UNCHANGED <<active, parent, everConsumed, everProduced, genealogy>>

\* Transformation records irreversible genealogy only; containment/association are explicit relations.
Transform ==
  /\ InputObjects \subseteq active
  /\ "O" \notin active
  /\ "O" \notin everProduced
  /\ \A i \in InputObjects: parent[i] = NoParent
  /\ active' = (active \ InputObjects) \cup {"O"}
  /\ everConsumed' = everConsumed \cup InputObjects
  /\ everProduced' = everProduced \cup {"O"}
  /\ genealogy' = genealogy \cup {<<"C1", "O">>, <<"C2", "O">>}
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

ContainmentIsAcyclic == ParentChainsAreAcyclic(parent)

ConsumedIdentityIsNotStillActive == everConsumed \cap active = {}

ProducedIdentityWasCreatedOnce == everProduced \subseteq active \cup everConsumed

GenealogyOnlyPointsFromConsumedToProduced ==
  \A edge \in genealogy:    edge[1] \in everConsumed /\ edge[2] \in everProduced

AggregationNeverConsumesIdentity ==
  \A o \in Objects:
    parent[o] # NoParent => o \in active /\ o \notin everConsumed

=============================================================================
