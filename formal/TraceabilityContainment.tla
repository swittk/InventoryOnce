---------------- MODULE TraceabilityContainment ----------------
EXTENDS Integers

Objects == {"P", "C1", "C2", "O"}
NoParent == "none"
ParentDomain == Objects \cup {NoParent}

VARIABLE parent
vars == <<parent>>

ParentChainTerminates(p, o) ==
  \/ p[o] = NoParent
  \/ p[p[o]] = NoParent
  \/ p[p[p[o]]] = NoParent
  \/ p[p[p[p[o]]]] = NoParent

ParentChainsAreAcyclic(p) ==
  /\ p[NoParent] = NoParent
  /\ \A o \in Objects: ParentChainTerminates(p, o)

Init == parent = [o \in ParentDomain |-> NoParent]

Aggregate(child, container) ==
  /\ child \in Objects
  /\ container \in Objects
  /\ child # container
  /\ parent[child] = NoParent
  /\ ParentChainsAreAcyclic([parent EXCEPT ![child] = container])
  /\ parent' = [parent EXCEPT ![child] = container]

Disaggregate(child) ==
  /\ child \in Objects
  /\ parent[child] # NoParent
  /\ parent' = [parent EXCEPT ![child] = NoParent]

Next ==
  \/ \E child \in Objects, container \in Objects: Aggregate(child, container)
  \/ \E child \in Objects: Disaggregate(child)

Spec == Init /\ [][Next]_vars
TypeOK == parent \in [ParentDomain -> ParentDomain]
ContainmentIsAcyclic == ParentChainsAreAcyclic(parent)
=============================================================================
