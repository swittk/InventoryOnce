---- MODULE CatalogPublication ----
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS RevisionIds,
          MeaningValues,
          OperationIds,
          NoRevision,
          NoMeaning,
          NoPublication

VARIABLES retained,
          meaning,
          active,
          publicationByOperation

vars == <<retained, meaning, active, publicationByOperation>>

PublicationSnapshot(retainedSet, meaningMap, activeRevision) ==
  [retained |-> retainedSet,
   meaning  |-> meaningMap,
   active   |-> activeRevision]

Init ==
  /\ retained = {}
  /\ meaning = [revision \in RevisionIds |-> NoMeaning]
  /\ active = NoRevision
  /\ publicationByOperation = [operation \in OperationIds |-> NoPublication]

PublishNew(operation, revision, revisionMeaning) ==
  /\ publicationByOperation[operation] = NoPublication
  /\ revision \in RevisionIds \ retained
  /\ revisionMeaning \in MeaningValues
  /\ retained' = retained \cup {revision}
  /\ meaning' = [meaning EXCEPT ![revision] = revisionMeaning]
  /\ active' = revision
  /\ publicationByOperation' =
       [publicationByOperation EXCEPT
          ![operation] = PublicationSnapshot(retained', meaning', active')]

SwitchActive(operation, revision) ==
  /\ publicationByOperation[operation] = NoPublication
  /\ revision \in retained
  /\ retained' = retained
  /\ meaning' = meaning
  /\ active' = revision
  /\ publicationByOperation' =
       [publicationByOperation EXCEPT
          ![operation] = PublicationSnapshot(retained', meaning', active')]

ExactRetry(operation, requestedRevision, requestedMeaning) ==
  /\ publicationByOperation[operation] # NoPublication
  /\ requestedRevision = publicationByOperation[operation].active
  /\ requestedMeaning = publicationByOperation[operation].meaning[requestedRevision]
  /\ UNCHANGED vars

Next ==
  \/ \E operation \in OperationIds,
        revision \in RevisionIds,
        revisionMeaning \in MeaningValues:
       PublishNew(operation, revision, revisionMeaning)
  \/ \E operation \in OperationIds,
        revision \in RevisionIds:
       SwitchActive(operation, revision)
  \/ \E operation \in OperationIds,
        requestedRevision \in RevisionIds,
        requestedMeaning \in MeaningValues:
       ExactRetry(operation, requestedRevision, requestedMeaning)

Spec == Init /\ [][Next]_vars

PublicationRecordSet ==
  [retained : SUBSET RevisionIds,
   meaning  : [RevisionIds -> MeaningValues \cup {NoMeaning}],
   active   : RevisionIds \cup {NoRevision}]

TypeOK ==
  /\ retained \subseteq RevisionIds
  /\ meaning \in [RevisionIds -> MeaningValues \cup {NoMeaning}]
  /\ active \in RevisionIds \cup {NoRevision}
  /\ publicationByOperation \in
       [OperationIds -> PublicationRecordSet \cup {NoPublication}]

ActiveIsRetained ==
  active = NoRevision \/ active \in retained

RetainedRevisionsHaveMeaning ==
  \A revision \in retained:
    meaning[revision] \in MeaningValues

UnretainedRevisionsHaveNoMeaning ==
  \A revision \in RevisionIds \ retained:
    meaning[revision] = NoMeaning

PublishedSnapshotsRemainRetained ==
  \A operation \in OperationIds:
    publicationByOperation[operation] = NoPublication \/
      publicationByOperation[operation].retained \subseteq retained

PublishedMeaningsNeverChange ==
  \A operation \in OperationIds:
    publicationByOperation[operation] = NoPublication \/
      \A revision \in publicationByOperation[operation].retained:
        meaning[revision] = publicationByOperation[operation].meaning[revision]

PublishedActiveRevisionWasRetained ==
  \A operation \in OperationIds:
    publicationByOperation[operation] = NoPublication \/
      publicationByOperation[operation].active \in
        publicationByOperation[operation].retained

=============================================================================
