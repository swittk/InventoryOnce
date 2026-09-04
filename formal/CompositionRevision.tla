------------------------ MODULE CompositionRevision ------------------------
EXTENDS FiniteSets, Naturals

\* Two immutable generations of one heterogeneous calendar pack coexist.
Packs == {"v1-pack-1", "v1-pack-2", "v2-pack-1", "v2-pack-2"}
PackRevisions == {"pack-v1", "pack-v2"}
CompositionRevisions == {"composition-v1", "composition-v2"}
Components == {"active-A", "active-B", "placebo-P", "placebo-C"}
Locations == {"store", "room"}
Opened == "opened"
OpenOperations == {"open-1", "open-2", "open-3", "open-4"}
OperationStates == {"none", "completed"}
NoPack == "no-pack"
NoRevision == "no-revision"
NoLocation == "no-location"
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

UnopenedPacksAt(whereState, location, revision) ==
  {pack \in Packs:
    /\ whereState[pack] = location
    /\ PackRevision(pack) = revision}

IntactPackCount(whereState, revision) ==
  Cardinality({pack \in Packs:
    /\ whereState[pack] \in Locations
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
  operationLocationState,
  location,
  revision
) ==
  Cardinality({op \in OpenOperations:
    /\ operationStateState[op] = "completed"
    /\ operationRevisionState[op] = revision
    /\ operationLocationState[op] = location})

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
  operationLocationState,
  location,
  component
) ==
    CompletedOpenCountAt(
      operationStateState,
      operationRevisionState,
      operationLocationState,
      location,
      "composition-v1"
    ) * Composition("composition-v1", component)
  + CompletedOpenCountAt(
      operationStateState,
      operationRevisionState,
      operationLocationState,
      location,
      "composition-v2"
    ) * Composition("composition-v2", component)

\* This cached read shape is derived from physical truth and never drives a write.
ExactReport(whereState, looseState) ==
  [location \in Locations |->
    [kind \in ResourceKinds |->
      IF kind \in PackRevisions
        THEN Cardinality(UnopenedPacksAt(whereState, location, kind))
        ELSE looseState[location][kind]]]

VARIABLES where,
          loose,
          activeRevision,
          operationState,
          operationPack,
          operationPackageRevision,
          operationCompositionRevision,
          operationLocation,
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
          operationLocation,
          operationOutput,
          openedBy,
          report>>

Init ==
  /\ where = [pack \in Packs |->
       IF pack \in {"v1-pack-1", "v2-pack-1"} THEN "store" ELSE "room"]
  /\ loose = [location \in Locations |-> [component \in Components |-> 0]]
  /\ activeRevision = "composition-v1"
  /\ operationState = [op \in OpenOperations |-> "none"]
  /\ operationPack = [op \in OpenOperations |-> NoPack]
  /\ operationPackageRevision = [op \in OpenOperations |-> NoRevision]
  /\ operationCompositionRevision = [op \in OpenOperations |-> NoRevision]
  /\ operationLocation = [op \in OpenOperations |-> NoLocation]
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
                  operationLocation,
                  operationOutput,
                  openedBy,
                  report>>

Transfer(pack, destination) ==
  /\ pack \in Packs
  /\ where[pack] \in Locations
  /\ destination \in Locations
  /\ destination # where[pack]
  /\ where' = [where EXCEPT ![pack] = destination]
  /\ report' = ExactReport(where', loose)
  /\ UNCHANGED <<loose,
                  activeRevision,
                  operationState,
                  operationPack,
                  operationPackageRevision,
                  operationCompositionRevision,
                  operationLocation,
                  operationOutput,
                  openedBy>>

Open(op, pack) ==
  /\ op \in OpenOperations
  /\ pack \in Packs
  /\ operationState[op] = "none"
  /\ openedBy[pack] = NoOperation
  /\ where[pack] \in Locations
  /\ LET location == where[pack]
         packageRevision == PackRevision(pack)
         compositionRevision == CompositionRevisionForPack(packageRevision)
         frozenOutput == [component \in Components |->
           Composition(compositionRevision, component)]
         nextWhere == [where EXCEPT ![pack] = Opened]
         nextLoose ==
           [candidateLocation \in Locations |->
             IF candidateLocation = location
               THEN [component \in Components |->
                      loose[candidateLocation][component]
                        + frozenOutput[component]]
               ELSE loose[candidateLocation]]
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
  /\ operationLocation' = [operationLocation EXCEPT ![op] = where[pack]]
  /\ openedBy' = [openedBy EXCEPT ![pack] = op]
  /\ UNCHANGED activeRevision

\* Only the exact durable intent can replay; changed package/composition/location has no transition.
ReplayOpen(
  op,
  pack,
  requestedPackageRevision,
  requestedCompositionRevision,
  requestedLocation
) ==
  /\ op \in OpenOperations
  /\ operationState[op] = "completed"
  /\ operationPack[op] = pack
  /\ operationPackageRevision[op] = requestedPackageRevision
  /\ operationCompositionRevision[op] = requestedCompositionRevision
  /\ operationLocation[op] = requestedLocation
  /\ UNCHANGED vars

Next ==
  \/ \E revision \in CompositionRevisions: Activate(revision)
  \/ \E pack \in Packs, destination \in Locations: Transfer(pack, destination)
  \/ \E op \in OpenOperations, pack \in Packs: Open(op, pack)
  \/ \E op \in OpenOperations,
       pack \in Packs,
       requestedPackageRevision \in PackRevisions,
       requestedCompositionRevision \in CompositionRevisions,
       requestedLocation \in Locations:
         ReplayOpen(
           op,
           pack,
           requestedPackageRevision,
           requestedCompositionRevision,
           requestedLocation
         )

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ where \in [Packs -> Locations \cup {Opened}]
  /\ loose \in [Locations -> [Components -> 0..82]]
  /\ activeRevision \in CompositionRevisions
  /\ operationState \in [OpenOperations -> OperationStates]
  /\ operationPack \in [OpenOperations -> Packs \cup {NoPack}]
  /\ operationPackageRevision \in
       [OpenOperations -> PackRevisions \cup {NoRevision}]
  /\ operationCompositionRevision \in
       [OpenOperations -> CompositionRevisions \cup {NoRevision}]
  /\ operationLocation \in [OpenOperations -> Locations \cup {NoLocation}]
  /\ operationOutput \in [OpenOperations -> [Components -> 0..21]]
  /\ openedBy \in [Packs -> OpenOperations \cup {NoOperation}]
  /\ report \in [Locations -> [ResourceKinds -> 0..82]]

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
           /\ operationLocation[op] \in Locations
           /\ operationOutput[op] = [component \in Components |->
                Composition(operationCompositionRevision[op], component)]
      ELSE /\ operationPack[op] = NoPack
           /\ operationPackageRevision[op] = NoRevision
           /\ operationCompositionRevision[op] = NoRevision
           /\ operationLocation[op] = NoLocation
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
  \A location \in Locations, component \in Components:
    loose[location][component] =
      ProducedAtByCompletedOperations(
        operationState,
        operationCompositionRevision,
        operationLocation,
        location,
        component
      )

ComponentPotentialIsConserved ==
  \A component \in Components:
    PackedPotential(where, component) + LooseTotal(loose, component)
      = InitialPotential(component)

ComponentIdentitiesNeverMerge ==
  /\ "tablet" \notin ResourceKinds
  /\ \A location \in Locations:
       /\ DOMAIN loose[location] = Components
       /\ DOMAIN report[location] = ResourceKinds

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
      /\ operationLocation'[op] = operationLocation[op]
      /\ operationOutput'[op] = operationOutput[op]

\* This temporal safety check is stronger than a current-state invariant: completed intent is append-only.
CompletedOperationIntentNeverChanges ==
  [][CompletedOperationIntentStaysFrozen]_vars

=============================================================================
