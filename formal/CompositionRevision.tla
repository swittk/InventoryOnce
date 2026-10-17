------------------------ MODULE CompositionRevision ------------------------
EXTENDS FiniteSets, Naturals

\* Scope: revision-frozen composition opening, exact component conservation, and retained intent.
\* Generic exact/changed retry observation is intentionally owned by InventoryOperation,
\* which composes with this model in implementation assurance rather than duplicating ghost state here.
\* Two immutable generations of one heterogeneous calendar pack coexist.
Packs == {"v1-pack-1", "v1-pack-2", "v2-pack-1", "v2-pack-2"}
PackRevisions == {"pack-v1", "pack-v2"}
CompositionRevisions == {"composition-v1", "composition-v2"}
Components == {"active-A", "active-B", "placebo-P", "placebo-C"}
Placements == {"store", "room"}
Opened == "opened"
OpenOperations == {"open-1", "open-2", "open-3", "open-4"}
OperationStates == {"none", "completed"}
NoPack == "no-pack"
NoRevision == "no-revision"
NoPlacement == "no-placement"
NoOperation == "no-operation"
ResourceKinds == PackRevisions \cup Components

PackRevision(pack) ==
  IF pack \in {"v1-pack-1", "v1-pack-2"}
    THEN "pack-v1"
    ELSE "pack-v2"

CompositionRevisionForPack(packageRevision) ==
  IF packageRevision = "pack-v1"
    THEN "composition-v1"
    ELSE "composition-v2"

\* Use the exact motivating compositions rather than a scaled toy ratio.
Composition(revision, component) ==
  IF revision = "composition-v1" THEN
    CASE component = "active-A" -> 21
      [] component = "placebo-P" -> 7
      [] OTHER -> 0
  ELSE
    CASE component = "active-A" -> 20
      [] component = "active-B" -> 5
      [] component = "placebo-C" -> 3
      [] OTHER -> 0

\* Keep every registered vector field explicit so a model edit cannot hide a changed component axis.
RegisteredCompositionVectorsAreExact ==
  /\ Composition("composition-v1", "active-A") = 21
  /\ Composition("composition-v1", "active-B") = 0
  /\ Composition("composition-v1", "placebo-P") = 7
  /\ Composition("composition-v1", "placebo-C") = 0
  /\ Composition("composition-v2", "active-A") = 20
  /\ Composition("composition-v2", "active-B") = 5
  /\ Composition("composition-v2", "placebo-P") = 0
  /\ Composition("composition-v2", "placebo-C") = 3

InitialPackCount(revision) ==
  Cardinality({pack \in Packs: PackRevision(pack) = revision})

InitialPotential(component) ==
    InitialPackCount("pack-v1")
      * Composition("composition-v1", component)
  + InitialPackCount("pack-v2")
      * Composition("composition-v2", component)

UnopenedPacksAt(whereState, placement, revision) ==
  {pack \in Packs:
    /\ whereState[pack] = placement
    /\ PackRevision(pack) = revision}

IntactPackCount(whereState, revision) ==
  Cardinality({pack \in Packs:
    /\ whereState[pack] \in Placements
    /\ PackRevision(pack) = revision})

OpenedPackCount(whereState, revision) ==
  Cardinality({pack \in Packs:
    /\ whereState[pack] = Opened
    /\ PackRevision(pack) = revision})

PackedPotential(whereState, component) ==
    IntactPackCount(whereState, "pack-v1")
      * Composition("composition-v1", component)
  + IntactPackCount(whereState, "pack-v2")
      * Composition("composition-v2", component)

LooseTotal(looseState, component) ==
  looseState["store"][component] + looseState["room"][component]

CompletedOpenCount(operationStateState, operationRevisionState, revision) ==
  Cardinality({op \in OpenOperations:
    /\ operationStateState[op] = "completed"
    /\ operationRevisionState[op] = revision})

CompletedOpenCountAt(
  operationStateState,
  operationRevisionState,
  operationPlacementState,
  placement,
  revision
) ==
  Cardinality({op \in OpenOperations:
    /\ operationStateState[op] = "completed"
    /\ operationRevisionState[op] = revision
    /\ operationPlacementState[op] = placement})

ProducedByCompletedOperations(
  operationStateState,
  operationRevisionState,
  component
) ==
    CompletedOpenCount(
      operationStateState,
      operationRevisionState,
      "composition-v1"
    ) * Composition("composition-v1", component)
  + CompletedOpenCount(
      operationStateState,
      operationRevisionState,
      "composition-v2"
    ) * Composition("composition-v2", component)

ProducedAtByCompletedOperations(
  operationStateState,
  operationRevisionState,
  operationPlacementState,
  placement,
  component
) ==
    CompletedOpenCountAt(
      operationStateState,
      operationRevisionState,
      operationPlacementState,
      placement,
      "composition-v1"
    ) * Composition("composition-v1", component)
  + CompletedOpenCountAt(
      operationStateState,
      operationRevisionState,
      operationPlacementState,
      placement,
      "composition-v2"
    ) * Composition("composition-v2", component)

\* This cached read shape is derived from physical truth and never drives a write.
ExactReport(whereState, looseState) ==
  [placement \in Placements |->
    [kind \in ResourceKinds |->
      IF kind \in PackRevisions
        THEN Cardinality(UnopenedPacksAt(whereState, placement, kind))
        ELSE looseState[placement][kind]]]

VARIABLES where,
          loose,
          activeRevision,
          operationState,
          operationPack,
          operationPackageRevision,
          operationCompositionRevision,
          operationPlacement,
          operationOutput,
          openedBy,
          report

vars == <<where,
          loose,
          activeRevision,
          operationState,
          operationPack,
          operationPackageRevision,
          operationCompositionRevision,
          operationPlacement,
          operationOutput,
          openedBy,
          report>>

Init ==
  /\ where = [pack \in Packs |->
       IF pack \in {"v1-pack-1", "v2-pack-1"} THEN "store" ELSE "room"]
  /\ loose = [placement \in Placements |-> [component \in Components |-> 0]]
  /\ activeRevision = "composition-v1"
  /\ operationState = [op \in OpenOperations |-> "none"]
  /\ operationPack = [op \in OpenOperations |-> NoPack]
  /\ operationPackageRevision = [op \in OpenOperations |-> NoRevision]
  /\ operationCompositionRevision = [op \in OpenOperations |-> NoRevision]
  /\ operationPlacement = [op \in OpenOperations |-> NoPlacement]
  /\ operationOutput = [op \in OpenOperations |->
       [component \in Components |-> 0]]
  /\ openedBy = [pack \in Packs |-> NoOperation]
  /\ report = ExactReport(where, loose)

Activate(revision) ==
  /\ revision \in CompositionRevisions
  /\ revision # activeRevision
  /\ activeRevision' = revision
  /\ UNCHANGED <<where,
                  loose,
                  operationState,
                  operationPack,
                  operationPackageRevision,
                  operationCompositionRevision,
                  operationPlacement,
                  operationOutput,
                  openedBy,
                  report>>

Transfer(pack, destination) ==
  /\ pack \in Packs
  /\ where[pack] \in Placements
  /\ destination \in Placements
  /\ destination # where[pack]
  /\ where' = [where EXCEPT ![pack] = destination]
  /\ report' = ExactReport(where', loose)
  /\ UNCHANGED <<loose,
                  activeRevision,
                  operationState,
                  operationPack,
                  operationPackageRevision,
                  operationCompositionRevision,
                  operationPlacement,
                  operationOutput,
                  openedBy>>

Open(op, pack) ==
  /\ op \in OpenOperations
  /\ pack \in Packs
  /\ operationState[op] = "none"
  /\ openedBy[pack] = NoOperation
  /\ where[pack] \in Placements
  /\ LET placement == where[pack]
         packageRevision == PackRevision(pack)
         compositionRevision == CompositionRevisionForPack(packageRevision)
         frozenOutput == [component \in Components |->
           Composition(compositionRevision, component)]
         nextWhere == [where EXCEPT ![pack] = Opened]
         nextLoose ==
           [candidatePlacement \in Placements |->
             IF candidatePlacement = placement
               THEN [component \in Components |->
                      loose[candidatePlacement][component]
                        + frozenOutput[component]]
               ELSE loose[candidatePlacement]]
       IN /\ where' = nextWhere
          /\ loose' = nextLoose
          /\ operationOutput' = [operationOutput EXCEPT ![op] = frozenOutput]
          /\ report' = ExactReport(nextWhere, nextLoose)
  /\ operationState' = [operationState EXCEPT ![op] = "completed"]
  /\ operationPack' = [operationPack EXCEPT ![op] = pack]
  /\ operationPackageRevision' =
       [operationPackageRevision EXCEPT ![op] = PackRevision(pack)]
  /\ operationCompositionRevision' =
       [operationCompositionRevision EXCEPT
         ![op] = CompositionRevisionForPack(PackRevision(pack))]
  /\ operationPlacement' = [operationPlacement EXCEPT ![op] = where[pack]]
  /\ openedBy' = [openedBy EXCEPT ![pack] = op]
  /\ UNCHANGED activeRevision

Next ==
  \/ \E revision \in CompositionRevisions: Activate(revision)
  \/ \E pack \in Packs, destination \in Placements: Transfer(pack, destination)
  \/ \E op \in OpenOperations, pack \in Packs: Open(op, pack)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ where \in [Packs -> Placements \cup {Opened}]
  /\ loose \in [Placements -> [Components -> 0..82]]
  /\ activeRevision \in CompositionRevisions
  /\ operationState \in [OpenOperations -> OperationStates]
  /\ operationPack \in [OpenOperations -> Packs \cup {NoPack}]
  /\ operationPackageRevision \in
       [OpenOperations -> PackRevisions \cup {NoRevision}]
  /\ operationCompositionRevision \in
       [OpenOperations -> CompositionRevisions \cup {NoRevision}]
  /\ operationPlacement \in [OpenOperations -> Placements \cup {NoPlacement}]
  /\ operationOutput \in [OpenOperations -> [Components -> 0..21]]
  /\ openedBy \in [Packs -> OpenOperations \cup {NoOperation}]
  /\ report \in [Placements -> [ResourceKinds -> 0..82]]

SourcePackageConservationPerRevision ==
  \A revision \in PackRevisions:
    IntactPackCount(where, revision) + OpenedPackCount(where, revision)
      = InitialPackCount(revision)

FrozenCompletedOpenVector ==
  \A op \in OpenOperations:
    IF operationState[op] = "completed"
      THEN /\ operationPack[op] \in Packs
           /\ operationPackageRevision[op] = PackRevision(operationPack[op])
           /\ operationCompositionRevision[op] =
                CompositionRevisionForPack(operationPackageRevision[op])
           /\ operationPlacement[op] \in Placements
           /\ operationOutput[op] = [component \in Components |->
                Composition(operationCompositionRevision[op], component)]
      ELSE /\ operationPack[op] = NoPack
           /\ operationPackageRevision[op] = NoRevision
           /\ operationCompositionRevision[op] = NoRevision
           /\ operationPlacement[op] = NoPlacement
           /\ operationOutput[op] = [component \in Components |-> 0]

ExactComponentProductionFromOpenedRevisions ==
  \A component \in Components:
    LooseTotal(loose, component) =
      ProducedByCompletedOperations(
        operationState,
        operationCompositionRevision,
        component
      )

ComponentsStayAtTheirOpeningLocation ==
  \A placement \in Placements, component \in Components:
    loose[placement][component] =
      ProducedAtByCompletedOperations(
        operationState,
        operationCompositionRevision,
        operationPlacement,
        placement,
        component
      )

ComponentPotentialIsConserved ==
  \A component \in Components:
    PackedPotential(where, component) + LooseTotal(loose, component)
      = InitialPotential(component)

ComponentIdentitiesNeverMerge ==
  /\ "tablet" \notin ResourceKinds
  /\ \A placement \in Placements:
       /\ DOMAIN loose[placement] = Components
       /\ DOMAIN report[placement] = ResourceKinds

ReportIsDerivedOnly == report = ExactReport(where, loose)

OpenedPackHasExactlyOneCompletedOperation ==
  \A pack \in Packs:
    where[pack] = Opened =>
      /\ openedBy[pack] \in OpenOperations
      /\ operationState[openedBy[pack]] = "completed"
      /\ operationPack[openedBy[pack]] = pack

OperationIdentityContributesAtMostOneOpen ==
  \A op \in OpenOperations:
    Cardinality({pack \in Packs: openedBy[pack] = op}) =
      IF operationState[op] = "completed" THEN 1 ELSE 0

OpenedCountMatchesCompletedOperationCount ==
  \A packageRevision \in PackRevisions:
    OpenedPackCount(where, packageRevision) =
      CompletedOpenCount(
        operationState,
        operationCompositionRevision,
        CompositionRevisionForPack(packageRevision)
      )

ActivePointerNeverReinterpretsOpenedIntent ==
  \A op \in OpenOperations:
    operationState[op] = "completed" =>
      /\ operationPackageRevision[op] = PackRevision(operationPack[op])
      /\ operationCompositionRevision[op] =
           CompositionRevisionForPack(operationPackageRevision[op])
      /\ operationOutput[op] = [component \in Components |->
           Composition(operationCompositionRevision[op], component)]

\* One step cannot change any field of an already completed durable opening.
CompletedOperationIntentStaysFrozen ==
  \A op \in OpenOperations:
    operationState[op] = "completed" =>
      /\ operationState'[op] = "completed"
      /\ operationPack'[op] = operationPack[op]
      /\ operationPackageRevision'[op] = operationPackageRevision[op]
      /\ operationCompositionRevision'[op] = operationCompositionRevision[op]
      /\ operationPlacement'[op] = operationPlacement[op]
      /\ operationOutput'[op] = operationOutput[op]

\* This temporal safety check is stronger than a current-state invariant: completed intent is append-only.
CompletedOperationIntentNeverChanges ==
  [][CompletedOperationIntentStaysFrozen]_vars

=============================================================================
