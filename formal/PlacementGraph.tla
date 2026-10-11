------------------------------ MODULE PlacementGraph ------------------------------
EXTENDS FiniteSets, Integers

Nodes == {"ROOM", "SHELF", "BOX", "ITEM"}
StockRows == {"outer-stock", "nested-stock"}
NoParent == "no-parent"
NoNode == "no-node"
ParentDomain == Nodes \cup {NoParent}

VARIABLES parent, acceptsPlacement, stockAnchor,
          lastAction, anchorsBeforeLastMove, lastMovedNode

vars == <<parent, acceptsPlacement, stockAnchor,
          lastAction, anchorsBeforeLastMove, lastMovedNode>>

\* A finite functional parent graph is acyclic iff every nonempty node subset
\* has at least one member whose parent escapes that subset.
PlacementForest(p) ==
  /\ p[NoParent] = NoParent
  /\ \A subset \in SUBSET Nodes:
       subset # {} => \E node \in subset: p[node] \notin subset

DirectContentsAt(node, p, anchors) ==
  {child \in Nodes: p[child] = node}
    \cup {row \in StockRows: anchors[row] = node}

Init ==
  /\ parent = [node \in ParentDomain |-> NoParent]
  /\ acceptsPlacement = Nodes
  /\ stockAnchor = [row \in StockRows |->
       IF row = "outer-stock" THEN "BOX" ELSE "ITEM"]
  /\ lastAction = "init"
  /\ anchorsBeforeLastMove = stockAnchor
  /\ lastMovedNode = NoNode

Move(node, destination) ==
  /\ node \in Nodes
  /\ destination \in Nodes
  /\ node # destination
  /\ destination \in acceptsPlacement
  /\ parent[node] # destination
  /\ PlacementForest([parent EXCEPT ![node] = destination])
  /\ parent' = [parent EXCEPT ![node] = destination]
  /\ acceptsPlacement' = acceptsPlacement
  /\ anchorsBeforeLastMove' = stockAnchor
  /\ stockAnchor' = stockAnchor
  /\ lastAction' = "move"
  /\ lastMovedNode' = node

Unplace(node) ==
  /\ node \in Nodes
  /\ parent[node] # NoParent
  /\ parent' = [parent EXCEPT ![node] = NoParent]
  /\ acceptsPlacement' = acceptsPlacement
  /\ stockAnchor' = stockAnchor
  /\ anchorsBeforeLastMove' = anchorsBeforeLastMove
  /\ lastAction' = "unplace"
  /\ lastMovedNode' = node

AllowPlacement(node) ==
  /\ node \in Nodes
  /\ node \notin acceptsPlacement
  /\ acceptsPlacement' = acceptsPlacement \cup {node}
  /\ UNCHANGED <<parent, stockAnchor, anchorsBeforeLastMove,
                  lastAction, lastMovedNode>>

RejectPlacement(node) ==
  /\ node \in acceptsPlacement
  /\ DirectContentsAt(node, parent, stockAnchor) = {}
  /\ acceptsPlacement' = acceptsPlacement \ {node}
  /\ UNCHANGED <<parent, stockAnchor, anchorsBeforeLastMove,
                  lastAction, lastMovedNode>>

Next ==
  \/ \E node \in Nodes, destination \in Nodes: Move(node, destination)
  \/ \E node \in Nodes: Unplace(node)
  \/ \E node \in Nodes: AllowPlacement(node)
  \/ \E node \in Nodes: RejectPlacement(node)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ parent \in [ParentDomain -> ParentDomain]
  /\ acceptsPlacement \subseteq Nodes
  /\ stockAnchor \in [StockRows -> Nodes]
  /\ lastAction \in {"init", "move", "unplace"}
  /\ anchorsBeforeLastMove \in [StockRows -> Nodes]
  /\ lastMovedNode \in Nodes \cup {NoNode}

PlacementIsAcyclic == PlacementForest(parent)

PlacementTargetsAcceptContents ==
  \A node \in Nodes:
    DirectContentsAt(node, parent, stockAnchor) # {} =>
      node \in acceptsPlacement

AncestorMovePreservesDirectStockAnchors ==
  lastAction = "move" => stockAnchor = anchorsBeforeLastMove

\* Deliberate negative control: atomically introduce a two-node placement cycle.
CycleMutation ==
  /\ parent' = [parent EXCEPT !["BOX"] = "SHELF", !["SHELF"] = "BOX"]
  /\ UNCHANGED <<acceptsPlacement, stockAnchor, anchorsBeforeLastMove,
                  lastAction, lastMovedNode>>

CycleMutationNext == Next \/ CycleMutation
CycleMutationSpec == Init /\ [][CycleMutationNext]_vars

\* Deliberate negative control: remove placement capability while direct content remains.
RejectingTargetMutation ==
  /\ "BOX" \in acceptsPlacement
  /\ acceptsPlacement' = acceptsPlacement \ {"BOX"}
  /\ UNCHANGED <<parent, stockAnchor, anchorsBeforeLastMove,
                  lastAction, lastMovedNode>>

RejectingTargetMutationNext == Next \/ RejectingTargetMutation
RejectingTargetMutationSpec == Init /\ [][RejectingTargetMutationNext]_vars

\* Deliberate negative control: move an ancestor by rewriting a descendant row's direct anchor.
DescendantRewriteMutation ==
  /\ parent' = [parent EXCEPT !["BOX"] = "ROOM"]
  /\ acceptsPlacement' = acceptsPlacement
  /\ anchorsBeforeLastMove' = stockAnchor
  /\ stockAnchor' = [stockAnchor EXCEPT !["nested-stock"] = "ROOM"]
  /\ lastAction' = "move"
  /\ lastMovedNode' = "BOX"

DescendantRewriteMutationNext == Next \/ DescendantRewriteMutation
DescendantRewriteMutationSpec == Init /\ [][DescendantRewriteMutationNext]_vars

=============================================================================
