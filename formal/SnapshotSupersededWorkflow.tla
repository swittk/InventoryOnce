--------------------- MODULE SnapshotSupersededWorkflow ---------------------
EXTENDS Naturals, FiniteSets

Rows == {"pending-op", "started-mutation"}
FenceStates == {"open", "closed"}
WorkflowOutcomes == {"unknown", "completed", "aborted"}

VARIABLES fence, snapshotCaptured, snapshotRevision, sourceRevision,
          dispositions, dispositionEventCount, published,
          publishedRevision, resumeAttempts, resumedAfterFence,
          workflowOutcome

vars == <<fence, snapshotCaptured, snapshotRevision, sourceRevision,
          dispositions, dispositionEventCount, published,
          publishedRevision, resumeAttempts, resumedAfterFence,
          workflowOutcome>>

Init ==
  /\ fence = "open"
  /\ snapshotCaptured = FALSE
  /\ snapshotRevision = 0
  /\ sourceRevision = 0
  /\ dispositions = {}
  /\ dispositionEventCount = 0
  /\ published = FALSE
  /\ publishedRevision = 0
  /\ resumeAttempts = {}
  /\ resumedAfterFence = {}
  /\ workflowOutcome = [row \in Rows |-> "unknown"]

ClaimFence ==
  /\ fence = "open"
  /\ fence' = "closed"
  /\ UNCHANGED <<snapshotCaptured, snapshotRevision, sourceRevision,
                  dispositions, dispositionEventCount, published,
                  publishedRevision, resumeAttempts, resumedAfterFence,
                  workflowOutcome>>

\* Ordinary legacy writes before the fence make the captured source revision a distinguishing value.
AdvanceSourceRevisionBeforeFence ==
  /\ fence = "open"
  /\ sourceRevision < 2
  /\ sourceRevision' = sourceRevision + 1
  /\ UNCHANGED <<fence, snapshotCaptured, snapshotRevision,
                  dispositions, dispositionEventCount, published,
                  publishedRevision, resumeAttempts, resumedAfterFence,
                  workflowOutcome>>

CaptureOpeningSnapshot ==
  /\ fence = "closed"
  /\ ~snapshotCaptured
  /\ snapshotCaptured' = TRUE
  /\ snapshotRevision' = sourceRevision
  /\ UNCHANGED <<fence, sourceRevision, dispositions,
                  dispositionEventCount, published, publishedRevision,
                  resumeAttempts, resumedAfterFence, workflowOutcome>>

DisposeSnapshotRow(row, physicalEventCount, outcome) ==
  /\ row \in Rows
  /\ physicalEventCount \in Nat
  /\ outcome \in WorkflowOutcomes
  /\ fence = "closed"
  /\ snapshotCaptured
  /\ row \notin dispositions
  /\ dispositions' = dispositions \union {row}
  /\ dispositionEventCount' = dispositionEventCount + physicalEventCount
  /\ workflowOutcome' = [workflowOutcome EXCEPT ![row] = outcome]
  /\ UNCHANGED <<fence, snapshotCaptured, snapshotRevision,
                  sourceRevision, published, publishedRevision,
                  resumeAttempts, resumedAfterFence>>

AttemptResumeAfterFence(row, didResume) ==
  /\ row \in Rows
  /\ didResume \in BOOLEAN
  /\ fence = "closed"
  /\ row \notin resumeAttempts
  /\ resumeAttempts' = resumeAttempts \union {row}
  /\ resumedAfterFence' =
       IF didResume THEN resumedAfterFence \union {row}
       ELSE resumedAfterFence
  /\ UNCHANGED <<fence, snapshotCaptured, snapshotRevision,
                  sourceRevision, dispositions, dispositionEventCount,
                  published, publishedRevision, workflowOutcome>>

PublishOpeningSnapshot ==
  /\ fence = "closed"
  /\ snapshotCaptured
  /\ dispositions = Rows
  /\ ~published
  /\ published' = TRUE
  /\ publishedRevision' = snapshotRevision
  /\ UNCHANGED <<fence, snapshotCaptured, snapshotRevision,
                  sourceRevision, dispositions, dispositionEventCount,
                  resumeAttempts, resumedAfterFence, workflowOutcome>>

DisposeAny == \E row \in Rows : DisposeSnapshotRow(row, 0, "unknown")
AttemptResumeAny == \E row \in Rows : AttemptResumeAfterFence(row, FALSE)

\* These transitions are only enabled by the mutation configs below. They let
\* TLC prove each safety invariant catches the exact forbidden write.
ResumeSupersededRowAny ==
  \E row \in Rows :
    /\ row \in dispositions
    /\ AttemptResumeAfterFence(row, TRUE)

DispositionCreatesPhysicalEventAny ==
  \E row \in Rows : DisposeSnapshotRow(row, 1, "unknown")

DispositionGuessesCompletedOutcomeAny ==
  \E row \in Rows : DisposeSnapshotRow(row, 0, "completed")

AdvanceSourceRevisionAfterSnapshot ==
  /\ snapshotCaptured
  /\ sourceRevision' = sourceRevision + 1
  /\ UNCHANGED <<fence, snapshotCaptured, snapshotRevision,
                  dispositions, dispositionEventCount, published,
                  publishedRevision, resumeAttempts, resumedAfterFence,
                  workflowOutcome>>

TerminalStutter ==
  /\ published
  /\ UNCHANGED vars

Next ==
  \/ AdvanceSourceRevisionBeforeFence
  \/ ClaimFence
  \/ CaptureOpeningSnapshot
  \/ DisposeAny
  \/ AttemptResumeAny
  \/ PublishOpeningSnapshot
  \/ TerminalStutter

Spec == Init /\ [][Next]_vars

ResumeMutationSpec ==
  Init /\ [][Next \/ ResumeSupersededRowAny]_vars

DispositionEventMutationSpec ==
  Init /\ [][Next \/ DispositionCreatesPhysicalEventAny]_vars

OutcomeMutationSpec ==
  Init /\ [][Next \/ DispositionGuessesCompletedOutcomeAny]_vars

SourceAdvanceMutationSpec ==
  Init /\ [][Next \/ AdvanceSourceRevisionAfterSnapshot]_vars

FairSpec ==
  Spec
  /\ WF_vars(ClaimFence)
  /\ WF_vars(CaptureOpeningSnapshot)
  /\ WF_vars(DisposeAny)
  /\ WF_vars(PublishOpeningSnapshot)

TypeOK ==
  /\ fence \in FenceStates
  /\ snapshotCaptured \in BOOLEAN
  /\ snapshotRevision \in Nat
  /\ sourceRevision \in Nat
  /\ dispositions \subseteq Rows
  /\ dispositionEventCount \in Nat
  /\ published \in BOOLEAN
  /\ publishedRevision \in Nat
  /\ resumeAttempts \subseteq Rows
  /\ resumedAfterFence \subseteq Rows
  /\ workflowOutcome \in [Rows -> WorkflowOutcomes]

DispositionRequiresFencedSnapshot ==
  dispositions # {} => fence = "closed" /\ snapshotCaptured

DispositionGeneratesNoPhysicalEvent == dispositionEventCount = 0

SupersededRowsNeverResume == resumedAfterFence = {}

UnknownOutcomeNeverGuessed ==
  \A row \in Rows : row \in dispositions => workflowOutcome[row] = "unknown"

PublishedRetainsAllDispositions == published => dispositions = Rows

PublishedWorldMatchesSnapshot ==
  published => publishedRevision = snapshotRevision

\* Base Spec keeps sourceRevision fixed after capture; SourceAdvanceMutationSpec
\* proves any post-snapshot source movement is rejected at that transition.
ResumeAttemptCannotChangeSourceTruth ==
  snapshotCaptured => sourceRevision = snapshotRevision

\* The separate reachability witness config must falsify this claim using the unchanged ordinary Next relation.
NonzeroSnapshotIsUnreachable == ~(snapshotCaptured /\ snapshotRevision > 0)

FencedSnapshotEventuallyPublishes ==
  (fence = "closed" /\ snapshotCaptured) ~> published

=============================================================================
