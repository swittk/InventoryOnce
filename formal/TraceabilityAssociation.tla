---------------- MODULE TraceabilityAssociation ----------------
EXTENDS FiniteSets

Objects == {"P", "C1", "C2", "O"}
VARIABLE association
vars == <<association>>

Init == association = {}

Associate(child, durableParent) ==
  /\ child \in Objects
  /\ durableParent \in Objects
  /\ child # durableParent
  /\ <<child, durableParent>> \notin association
  /\ association' = association \cup {<<child, durableParent>>}

Disassociate(child, durableParent) ==
  /\ child \in Objects
  /\ durableParent \in Objects
  /\ <<child, durableParent>> \in association
  /\ association' = association \ {<<child, durableParent>>}

Next ==
  \/ \E child \in Objects, durableParent \in Objects: Associate(child, durableParent)
  \/ \E child \in Objects, durableParent \in Objects: Disassociate(child, durableParent)

Spec == Init /\ [][Next]_vars
TypeOK == association \subseteq Objects \X Objects
NoSelfAssociation == \A edge \in association: edge[1] # edge[2]
=============================================================================
