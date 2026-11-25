------------------------------ MODULE PlacementGraph ------------------------------
EXTENDS FiniteSets, Integers

Nodes == {"ROOM", "SHELF", "BOX", "ITEM"}
StockRows == {"outer-stock", "nested-stock"}
Resources == {"u1", "u2"}
NoParent == "no-parent"
NoNode == "no-node"
NoResource == "no-resource"
ParentDomain == Nodes \cup {NoParent}
ResourceDomain == Resources \cup {NoResource}
TotalPhysicalResources == 2

VARIABLES parent, acceptsPlacement, stockAnchor,
          activeResources, retiredResources, genericUnits,
          embodimentByNode, retiredNodes, resourcePlacement,
          lastAction, anchorsBeforeLastMove, lastMovedNode,
          contentsBeforeLastEmbodimentTermination

vars == <<parent, acceptsPlacement, stockAnchor,
          activeResources, retiredResources, genericUnits,
          embodimentByNode, retiredNodes, resourcePlacement,
          lastAction, anchorsBeforeLastMove, lastMovedNode,
          contentsBeforeLastEmbodimentTermination>>

\* Four parent steps suffice to reach the root in this finite forest.
\* Reuse the constant set of valid parent maps across movement candidates.
RECURSIVE FollowParent(_, _, _)
FollowParent(p, node, steps) ==
  IF steps = 0 THEN node ELSE FollowParent(p, p[node], steps - 1)

ValidParentForests ==
  {p \in [ParentDomain -> ParentDomain]:
    p[NoParent] = NoParent /\
    \A node \in Nodes: FollowParent(p, node, Cardinality(Nodes)) = NoParent}

PlacementForest(p) == p \in ValidParentForests

EmbodiedNodesFor(resource, embodiment) ==
  {node \in Nodes: embodiment[node] = resource}

ResourceIsEmbodied(resource, embodiment) ==
  EmbodiedNodesFor(resource, embodiment) # {}

\* Direct contents are child nodes, ordinary stock rows, and unique stock resources placed in the node.
DirectContentsAt(node, p, anchors, active, placements) ==
  {child \in Nodes: p[child] = node}
    \cup {row \in StockRows: anchors[row] = node}
    \cup {resource \in active: placements[resource] = node}

Init ==
  /\ parent = [node \in ParentDomain |-> NoParent]
  /\ acceptsPlacement = Nodes
  /\ stockAnchor = [row \in StockRows |->
       IF row = "outer-stock" THEN "BOX" ELSE "ITEM"]
  \* u1 is live and embodies ITEM; u2 is still one generic unit available for future individualization.
  /\ activeResources = {"u1"}
  /\ retiredResources = {}
  /\ genericUnits = 1
  /\ embodimentByNode = [node \in Nodes |->
       IF node = "ITEM" THEN "u1" ELSE NoResource]
  /\ retiredNodes = {}
  /\ resourcePlacement = [resource \in Resources |-> NoParent]
  /\ lastAction = "init"
  /\ anchorsBeforeLastMove = stockAnchor
  /\ lastMovedNode = NoNode
  /\ contentsBeforeLastEmbodimentTermination = {}

\* Standalone placement nodes have topology authority because no stock resource embodies them.
MoveStandaloneNode(node, destination) ==
  /\ node \in Nodes \ retiredNodes
  /\ embodimentByNode[node] = NoResource
  /\ destination \in Nodes \ retiredNodes
  /\ node # destination
  /\ destination \in acceptsPlacement
  /\ parent[node] # destination
  /\ PlacementForest([parent EXCEPT ![node] = destination])
  /\ parent' = [parent EXCEPT ![node] = destination]
  /\ anchorsBeforeLastMove' = stockAnchor
  /\ lastAction' = "move"
  /\ lastMovedNode' = node
  /\ UNCHANGED <<acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, embodimentByNode,
                  retiredNodes, resourcePlacement,
                  contentsBeforeLastEmbodimentTermination>>

UnplaceStandaloneNode(node) ==
  /\ node \in Nodes \ retiredNodes
  /\ embodimentByNode[node] = NoResource
  /\ parent[node] # NoParent
  /\ parent' = [parent EXCEPT ![node] = NoParent]
  /\ lastAction' = "unplace"
  /\ lastMovedNode' = node
  /\ UNCHANGED <<acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, embodimentByNode,
                  retiredNodes, resourcePlacement, anchorsBeforeLastMove,
                  contentsBeforeLastEmbodimentTermination>>

\* Moving an embodied unique stock resource is the sole authority for the node's direct parent.
MoveEmbodiedResource(node, resource, destination) ==
  /\ node \in Nodes \ retiredNodes
  /\ resource \in activeResources
  /\ embodimentByNode[node] = resource
  /\ resourcePlacement[resource] = parent[node]
  /\ destination \in ParentDomain
  /\ destination # node
  /\ destination # resourcePlacement[resource]
  /\ destination = NoParent
       \/ (destination \in acceptsPlacement /\ destination \notin retiredNodes)
  /\ PlacementForest([parent EXCEPT ![node] = destination])
  /\ resourcePlacement' =
       [resourcePlacement EXCEPT ![resource] = destination]
  /\ parent' = [parent EXCEPT ![node] = destination]
  /\ anchorsBeforeLastMove' = stockAnchor
  /\ lastAction' = "embodied-resource-move"
  /\ lastMovedNode' = node
  /\ UNCHANGED <<acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, embodimentByNode,
                  retiredNodes, contentsBeforeLastEmbodimentTermination>>

\* Non-embodying unique stock remains ordinary individually tracked inventory.
MoveUnembodiedResource(resource, destination) ==
  /\ resource \in activeResources
  /\ ~ResourceIsEmbodied(resource, embodimentByNode)
  /\ destination \in ParentDomain
  /\ destination # resourcePlacement[resource]
  /\ destination = NoParent
       \/ (destination \in acceptsPlacement /\ destination \notin retiredNodes)
  /\ resourcePlacement' =
       [resourcePlacement EXCEPT ![resource] = destination]
  /\ lastAction' = "resource-move"
  /\ UNCHANGED <<parent, acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, embodimentByNode,
                  retiredNodes, anchorsBeforeLastMove, lastMovedNode,
                  contentsBeforeLastEmbodimentTermination>>

\* Split one generic physical unit into a fresh unique resource identity.
Individualize(resource, destination) ==
  /\ resource \in Resources \ (activeResources \cup retiredResources)
  /\ genericUnits > 0
  /\ destination \in ParentDomain
  /\ destination = NoParent
       \/ (destination \in acceptsPlacement /\ destination \notin retiredNodes)
  /\ activeResources' = activeResources \cup {resource}
  /\ resourcePlacement' =
       [resourcePlacement EXCEPT ![resource] = destination]
  /\ genericUnits' = genericUnits - 1
  /\ lastAction' = "individualize"
  /\ UNCHANGED <<parent, acceptsPlacement, stockAnchor, retiredResources,
                  embodimentByNode, retiredNodes, anchorsBeforeLastMove,
                  lastMovedNode, contentsBeforeLastEmbodimentTermination>>

\* Bind an already-individualized resource to one non-retired placement node.
Embody(node, resource) ==
  /\ node \in Nodes \ retiredNodes
  /\ resource \in activeResources
  /\ embodimentByNode[node] = NoResource
  /\ ~ResourceIsEmbodied(resource, embodimentByNode)
  /\ resourcePlacement[resource] = parent[node]
  /\ embodimentByNode' = [embodimentByNode EXCEPT ![node] = resource]
  /\ lastAction' = "embody"
  /\ UNCHANGED <<parent, acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, retiredNodes,
                  resourcePlacement, anchorsBeforeLastMove, lastMovedNode,
                  contentsBeforeLastEmbodimentTermination>>

\* Return one empty embodied instance to the generic pool and permanently retire its old identities.
DeindividualizeEmbodied(node) ==
  /\ node \in Nodes \ retiredNodes
  /\ embodimentByNode[node] # NoResource
  /\ DirectContentsAt(
       node, parent, stockAnchor, activeResources, resourcePlacement
     ) = {}
  /\ LET resource == embodimentByNode[node]
     IN /\ embodimentByNode' = [embodimentByNode EXCEPT ![node] = NoResource]
        /\ activeResources' = activeResources \ {resource}
        /\ retiredResources' = retiredResources \cup {resource}
        /\ resourcePlacement' =
             [resourcePlacement EXCEPT ![resource] = NoParent]
  /\ parent' = [parent EXCEPT ![node] = NoParent]
  /\ acceptsPlacement' = acceptsPlacement \ {node}
  /\ retiredNodes' = retiredNodes \cup {node}
  /\ genericUnits' = genericUnits + 1
  /\ contentsBeforeLastEmbodimentTermination' =
       DirectContentsAt(
         node, parent, stockAnchor, activeResources, resourcePlacement
       )
  /\ lastAction' = "deindividualize"
  /\ lastMovedNode' = node
  /\ UNCHANGED <<stockAnchor, anchorsBeforeLastMove>>

AllowPlacement(node) ==
  /\ node \in Nodes \ retiredNodes
  /\ node \notin acceptsPlacement
  /\ acceptsPlacement' = acceptsPlacement \cup {node}
  /\ UNCHANGED <<parent, stockAnchor, activeResources, retiredResources,
                  genericUnits, embodimentByNode, retiredNodes,
                  resourcePlacement, anchorsBeforeLastMove,
                  contentsBeforeLastEmbodimentTermination,
                  lastAction, lastMovedNode>>

RejectPlacement(node) ==
  /\ node \in acceptsPlacement
  /\ node \notin retiredNodes
  /\ DirectContentsAt(
       node, parent, stockAnchor, activeResources, resourcePlacement
     ) = {}
  /\ acceptsPlacement' = acceptsPlacement \ {node}
  /\ UNCHANGED <<parent, stockAnchor, activeResources, retiredResources,
                  genericUnits, embodimentByNode, retiredNodes,
                  resourcePlacement, anchorsBeforeLastMove,
                  contentsBeforeLastEmbodimentTermination,
                  lastAction, lastMovedNode>>

\* Empty only the direct source. Its children's own contents stay anchored.
MoveDirectContents(source, destination, splitEmbodiment) ==
  LET nextParent == [node \in ParentDomain |->
                       IF parent[node] = source THEN destination ELSE parent[node]]
  IN
    /\ source \in Nodes \ retiredNodes
    /\ destination \in acceptsPlacement \ retiredNodes
    /\ destination # source
    /\ DirectContentsAt(source, parent, stockAnchor, activeResources, resourcePlacement) # {}
    /\ PlacementForest(nextParent)
    /\ parent' = nextParent
    /\ stockAnchor' = [row \in StockRows |->
                         IF stockAnchor[row] = source THEN destination ELSE stockAnchor[row]]
    /\ resourcePlacement' = [resource \in Resources |->
        IF resource \in activeResources /\ resourcePlacement[resource] = source /\
           ~(splitEmbodiment /\ ResourceIsEmbodied(resource, embodimentByNode))
        THEN destination ELSE resourcePlacement[resource]]
    \* An ancestor move's saved anchor snapshot has no meaning after a new direct move.
    /\ anchorsBeforeLastMove' = stockAnchor'
    /\ lastAction' = "move-direct-contents"
    /\ lastMovedNode' = source
    /\ UNCHANGED <<acceptsPlacement, activeResources, retiredResources, genericUnits,
                    embodimentByNode, retiredNodes,
                    contentsBeforeLastEmbodimentTermination>>

Next(splitEmbodiment) ==
  \/ \E node \in Nodes, destination \in Nodes:
       MoveStandaloneNode(node, destination)
  \/ \E source \in Nodes, destination \in Nodes:
       MoveDirectContents(source, destination, splitEmbodiment)
  \/ \E node \in Nodes: UnplaceStandaloneNode(node)
  \/ \E node \in Nodes, resource \in Resources,
       destination \in ParentDomain:
       MoveEmbodiedResource(node, resource, destination)
  \/ \E resource \in Resources, destination \in ParentDomain:
       MoveUnembodiedResource(resource, destination)
  \/ \E resource \in Resources, destination \in ParentDomain:
       Individualize(resource, destination)
  \/ \E node \in Nodes, resource \in Resources: Embody(node, resource)
  \/ \E node \in Nodes: DeindividualizeEmbodied(node)
  \/ \E node \in Nodes: AllowPlacement(node)
  \/ \E node \in Nodes: RejectPlacement(node)

Spec == Init /\ [][Next(FALSE)]_vars
DirectContentsSplitMutationSpec == Init /\ [][Next(TRUE)]_vars

TypeOK ==
  /\ parent \in [ParentDomain -> ParentDomain]
  /\ acceptsPlacement \subseteq Nodes
  /\ stockAnchor \in [StockRows -> Nodes]
  /\ activeResources \subseteq Resources
  /\ retiredResources \subseteq Resources
  /\ genericUnits \in 0..TotalPhysicalResources
  /\ embodimentByNode \in [Nodes -> ResourceDomain]
  /\ retiredNodes \subseteq Nodes
  /\ resourcePlacement \in [Resources -> ParentDomain]
  /\ lastAction \in {
       "init", "move", "unplace", "embodied-resource-move", "move-direct-contents",
       "resource-move", "individualize", "embody", "deindividualize"
     }
  /\ anchorsBeforeLastMove \in [StockRows -> Nodes]
  /\ lastMovedNode \in Nodes \cup {NoNode}
  /\ contentsBeforeLastEmbodimentTermination \subseteq
       Nodes \cup StockRows \cup Resources

PlacementIsAcyclic == PlacementForest(parent)

PlacementTargetsAcceptContents ==
  \A node \in Nodes:
    DirectContentsAt(
      node, parent, stockAnchor, activeResources, resourcePlacement
    ) # {} =>
      node \in acceptsPlacement

AncestorMovePreservesDirectStockAnchors ==
  lastAction \in {"move", "embodied-resource-move"} =>
    stockAnchor = anchorsBeforeLastMove

\* Require a common destination for the exact child edges, direct rows and live serials.
\* The unchanged clauses also protect stock anchored below the moving children.
DirectContentsStep ==
  lastAction' = "move-direct-contents" =>
    \E destination \in Nodes \ {lastMovedNode'}:
      /\ \A node \in ParentDomain:
         parent'[node] = IF parent[node] = lastMovedNode' THEN destination ELSE parent[node]
      /\ \A row \in StockRows:
         stockAnchor'[row] = IF stockAnchor[row] = lastMovedNode' THEN destination ELSE stockAnchor[row]
      /\ \A resource \in Resources:
         resourcePlacement'[resource] =
           IF resource \in activeResources /\ resourcePlacement[resource] = lastMovedNode'
           THEN destination ELSE resourcePlacement[resource]

DirectContentsPublishesTogether == [][DirectContentsStep]_vars

EmbodimentIsOneToOne ==
  \A left \in Nodes, right \in Nodes:
    (left # right
      /\ embodimentByNode[left] # NoResource
      /\ embodimentByNode[right] # NoResource)
        => embodimentByNode[left] # embodimentByNode[right]

EmbodiedResourceIsActive ==
  \A node \in Nodes:
    embodimentByNode[node] # NoResource =>
      embodimentByNode[node] \in activeResources

EmbodiedResourceTracksNodeParent ==
  \A node \in Nodes:
    embodimentByNode[node] # NoResource =>
      resourcePlacement[embodimentByNode[node]] = parent[node]

EmbodimentTerminationRequiresEmptyNode ==
  lastAction = "deindividualize" =>
    contentsBeforeLastEmbodimentTermination = {}

RetiredIdentitiesNeverReactivate ==
  /\ activeResources \cap retiredResources = {}
  /\ \A node \in retiredNodes:
       /\ embodimentByNode[node] = NoResource
       /\ parent[node] = NoParent
       /\ node \notin acceptsPlacement
       /\ DirectContentsAt(
            node, parent, stockAnchor, activeResources, resourcePlacement
          ) = {}

GenericAndUniqueResourcesAreConserved ==
  genericUnits + Cardinality(activeResources) = TotalPhysicalResources

\* Deliberate negative control: atomically introduce a two-node placement cycle.
CycleMutation ==
  /\ parent' = [parent EXCEPT !["BOX"] = "SHELF", !["SHELF"] = "BOX"]
  /\ UNCHANGED <<acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, embodimentByNode,
                  retiredNodes, resourcePlacement, anchorsBeforeLastMove,
                  contentsBeforeLastEmbodimentTermination,
                  lastAction, lastMovedNode>>

CycleMutationNext == Next(FALSE) \/ CycleMutation
CycleMutationSpec == Init /\ [][CycleMutationNext]_vars

\* Deliberate negative control: remove placement capability while direct content remains.
RejectingTargetMutation ==
  /\ "BOX" \in acceptsPlacement
  /\ acceptsPlacement' = acceptsPlacement \ {"BOX"}
  /\ UNCHANGED <<parent, stockAnchor, activeResources, retiredResources,
                  genericUnits, embodimentByNode, retiredNodes,
                  resourcePlacement, anchorsBeforeLastMove,
                  contentsBeforeLastEmbodimentTermination,
                  lastAction, lastMovedNode>>

RejectingTargetMutationNext == Next(FALSE) \/ RejectingTargetMutation
RejectingTargetMutationSpec == Init /\ [][RejectingTargetMutationNext]_vars

\* Deliberate negative control: move an ancestor by rewriting a descendant row's direct anchor.
DescendantRewriteMutation ==
  /\ embodimentByNode["BOX"] = NoResource
  /\ parent' = [parent EXCEPT !["BOX"] = "ROOM"]
  /\ anchorsBeforeLastMove' = stockAnchor
  /\ stockAnchor' = [stockAnchor EXCEPT !["nested-stock"] = "ROOM"]
  /\ lastAction' = "move"
  /\ lastMovedNode' = "BOX"
  /\ UNCHANGED <<acceptsPlacement, activeResources, retiredResources,
                  genericUnits, embodimentByNode, retiredNodes,
                  resourcePlacement,
                  contentsBeforeLastEmbodimentTermination>>

DescendantRewriteMutationNext == Next(FALSE) \/ DescendantRewriteMutation
DescendantRewriteMutationSpec == Init /\ [][DescendantRewriteMutationNext]_vars

\* Deliberate negative control: stock moves but its embodied node does not.
EmbodiedMoveDesyncMutation ==
  /\ embodimentByNode["ITEM"] = "u1"
  /\ resourcePlacement["u1"] # "BOX"
  /\ resourcePlacement' = [resourcePlacement EXCEPT !["u1"] = "BOX"]
  /\ anchorsBeforeLastMove' = stockAnchor
  /\ lastAction' = "embodied-resource-move"
  /\ lastMovedNode' = "ITEM"
  /\ UNCHANGED <<parent, acceptsPlacement, stockAnchor, activeResources,
                  retiredResources, genericUnits, embodimentByNode,
                  retiredNodes, contentsBeforeLastEmbodimentTermination>>

EmbodiedMoveDesyncMutationNext == Next(FALSE) \/ EmbodiedMoveDesyncMutation
EmbodiedMoveDesyncMutationSpec == Init /\ [][EmbodiedMoveDesyncMutationNext]_vars

\* Deliberate negative control: destroy a dependent embodied resource.
UnsafeEmbodimentTerminationMutation ==
  /\ embodimentByNode["ITEM"] = "u1"
  /\ DirectContentsAt(
       "ITEM", parent, stockAnchor, activeResources, resourcePlacement
     ) # {}
  /\ embodimentByNode' = [embodimentByNode EXCEPT !["ITEM"] = NoResource]
  /\ activeResources' = activeResources \ {"u1"}
  /\ retiredResources' = retiredResources \cup {"u1"}
  /\ resourcePlacement' = [resourcePlacement EXCEPT !["u1"] = NoParent]
  /\ parent' = [parent EXCEPT !["ITEM"] = NoParent]
  /\ acceptsPlacement' = acceptsPlacement \ {"ITEM"}
  /\ retiredNodes' = retiredNodes \cup {"ITEM"}
  /\ genericUnits' = genericUnits + 1
  /\ contentsBeforeLastEmbodimentTermination' =
       DirectContentsAt(
         "ITEM", parent, stockAnchor, activeResources, resourcePlacement
       )
  /\ lastAction' = "deindividualize"
  /\ lastMovedNode' = "ITEM"
  /\ UNCHANGED <<stockAnchor, anchorsBeforeLastMove>>

UnsafeEmbodimentTerminationNext ==
  Next(FALSE) \/ UnsafeEmbodimentTerminationMutation

UnsafeEmbodimentTerminationSpec ==
  Init /\ [][UnsafeEmbodimentTerminationNext]_vars

=============================================================================
