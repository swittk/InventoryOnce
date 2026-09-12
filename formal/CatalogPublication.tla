---- MODULE CatalogPublication ----
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS RevisionIds,
          MeaningValues,
          OperationIds,
          NoRevision,
          NoMeaning,
          NoPublication,
          NoRetryEvidence

VARIABLES retained,
          meaning,
          active,
          publicationByOperation,
          retryEvidence

vars == <<retained, meaning, active, publicationByOperation, retryEvidence>>

PublicationSnapshot(retainedSet, meaningMap, activeRevision) ==
  [retained |-> retainedSet,
   meaning  |-> meaningMap,
   active   |-> activeRevision]

\* Record one bounded retry witness so TLC checks retry semantics instead of treating retry as stutter.
RetryEvidence(operation, requestedRevision, requestedMeaning, outcome) ==
  [operation |-> operation,
   revision  |-> requestedRevision,
   meaning   |-> requestedMeaning,
   outcome   |-> outcome]

Init ==
  /\ retained = {}
  /\ meaning = [revision \in RevisionIds |-> NoMeaning]
  /\ active = NoRevision
  /\ publicationByOperation = [operation \in OperationIds |-> NoPublication]
  /\ retryEvidence = NoRetryEvidence

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
  /\ UNCHANGED retryEvidence

SwitchActive(operation, revision) ==
  /\ publicationByOperation[operation] = NoPublication
  /\ revision \in retained
  /\ retained' = retained
  /\ meaning' = meaning
  /\ active' = revision
  /\ publicationByOperation' =
       [publicationByOperation EXCEPT
          ![operation] = PublicationSnapshot(retained', meaning', active')]
  /\ UNCHANGED retryEvidence

ExactRetry(operation, requestedRevision, requestedMeaning) ==
  /\ retryEvidence = NoRetryEvidence
  /\ publicationByOperation[operation] # NoPublication
  /\ requestedRevision = publicationByOperation[operation].active
  /\ requestedMeaning = publicationByOperation[operation].meaning[requestedRevision]
  /\ retryEvidence' =
       RetryEvidence(operation, requestedRevision, requestedMeaning, "exact")
  /\ UNCHANGED <<retained, meaning, active, publicationByOperation>>

ChangedRetry(operation, requestedRevision, requestedMeaning) ==
  /\ retryEvidence = NoRetryEvidence
  /\ publicationByOperation[operation] # NoPublication
  /\ ~(requestedRevision = publicationByOperation[operation].active /\
       requestedMeaning = publicationByOperation[operation].meaning[requestedRevision])
  /\ retryEvidence' =
       RetryEvidence(operation, requestedRevision, requestedMeaning, "changed")
  /\ UNCHANGED <<retained, meaning, active, publicationByOperation>>

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
  \/ \E operation \in OperationIds,
        requestedRevision \in RevisionIds,
        requestedMeaning \in MeaningValues:
       ChangedRetry(operation, requestedRevision, requestedMeaning)

Spec == Init /\ [][Next]_vars

PublicationRecordSet ==
  [retained : SUBSET RevisionIds,
   meaning  : [RevisionIds -> MeaningValues \cup {NoMeaning}],
   active   : RevisionIds \cup {NoRevision}]

RetryEvidenceSet ==
  [operation : OperationIds,
   revision  : RevisionIds,
   meaning   : MeaningValues,
   outcome   : {"exact", "changed"}]

TypeOK ==
  /\ retained \subseteq RevisionIds
  /\ meaning \in [RevisionIds -> MeaningValues \cup {NoMeaning}]
  /\ active \in RevisionIds \cup {NoRevision}
  /\ publicationByOperation \in
       [OperationIds -> PublicationRecordSet \cup {NoPublication}]
  /\ retryEvidence \in RetryEvidenceSet \cup {NoRetryEvidence}

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

ExactRetryEvidenceMatchesFrozenPublication ==
  IF retryEvidence = NoRetryEvidence
  THEN TRUE
  ELSE retryEvidence.outcome # "exact" \/
    /\ publicationByOperation[retryEvidence.operation] # NoPublication
    /\ retryEvidence.revision = publicationByOperation[retryEvidence.operation].active
    /\ retryEvidence.meaning =
         publicationByOperation[retryEvidence.operation].meaning[retryEvidence.revision]

ChangedRetryEvidenceConflictsWithFrozenPublication ==
  IF retryEvidence = NoRetryEvidence
  THEN TRUE
  ELSE retryEvidence.outcome # "changed" \/
    /\ publicationByOperation[retryEvidence.operation] # NoPublication
    /\ ~(retryEvidence.revision = publicationByOperation[retryEvidence.operation].active /\
         retryEvidence.meaning =
           publicationByOperation[retryEvidence.operation].meaning[retryEvidence.revision])

=============================================================================
