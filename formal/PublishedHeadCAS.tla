----------------------------- MODULE PublishedHeadCAS -----------------------------
EXTENDS FiniteSets, Integers

Attempts == {"A0", "B0", "B1"}
Operations == {"A", "B"}
Components == {"event", "projection", "reservations", "counts", "receipt"}
Worlds == {"w0", "wA", "wB0", "wB1"}
None == "none"

OperationOf(attempt) == IF attempt = "A0" THEN "A" ELSE "B"
BaseRevision(attempt) == IF attempt = "B1" THEN 1 ELSE 0
BaseWorld(attempt) == IF attempt = "B1" THEN "wA" ELSE "w0"
TargetWorld(attempt) ==
  CASE attempt = "A0" -> "wA"
    [] attempt = "B0" -> "wB0"
    [] OTHER -> "wB1"
PlanDigest(attempt) ==
  CASE attempt = "A0" -> "dA0"
    [] attempt = "B0" -> "dB0"
    [] OTHER -> "dB1"

VARIABLES prepared, worldBlobs, headRevision, headWorld,
          fenceAttempt, fenceDigest, written, worldPublished, abortClaimed,
          history, publishedAttempts

vars == <<prepared, worldBlobs, headRevision, headWorld,
          fenceAttempt, fenceDigest, written, worldPublished, abortClaimed,
          history, publishedAttempts>>

Init ==
  /\ prepared = {}
  /\ worldBlobs = {"w0"}
  /\ headRevision = 0
  /\ headWorld = "w0"
  /\ fenceAttempt = None
  /\ fenceDigest = None
  /\ written = {}
  /\ worldPublished = FALSE
  /\ abortClaimed = FALSE
  /\ history = [op \in Operations |-> "none"]
  /\ publishedAttempts = {}

\* Immutable plan blobs may remain orphaned after their base becomes stale.
Prepare(attempt) ==
  /\ attempt \in Attempts
  /\ history[OperationOf(attempt)] = "none"
  /\ attempt \notin prepared
  /\ prepared' = prepared \cup {attempt}
  /\ UNCHANGED <<worldBlobs, headRevision, headWorld,
                 fenceAttempt, fenceDigest, written, worldPublished,
                 abortClaimed,
                 history, publishedAttempts>>

\* The only ownership transition is one compare-and-set of the singleton head.
Claim(attempt) ==
  /\ attempt \in prepared
  /\ fenceAttempt = None
  /\ history[OperationOf(attempt)] = "none"
  /\ headRevision = BaseRevision(attempt)
  /\ headWorld = BaseWorld(attempt)
  /\ fenceAttempt' = attempt
  /\ fenceDigest' = PlanDigest(attempt)
  /\ written' = {}
  /\ worldPublished' = FALSE
  /\ abortClaimed' = FALSE
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 history, publishedAttempts>>

Stage(component) ==
  /\ fenceAttempt \in Attempts
  /\ history[OperationOf(fenceAttempt)] = "none"
  /\ ~worldPublished
  /\ ~abortClaimed
  /\ component \in Components \ written
  /\ written' = written \cup {component}
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 fenceAttempt, fenceDigest, worldPublished, abortClaimed,
                 history, publishedAttempts>>

\* Immutable target data is written before the visible pointer changes.
WriteWorldBlob ==
  /\ fenceAttempt \in Attempts
  /\ history[OperationOf(fenceAttempt)] = "none"
  /\ written = Components
  /\ ~worldPublished
  /\ ~abortClaimed
  /\ TargetWorld(fenceAttempt) \notin worldBlobs
  /\ worldBlobs' = worldBlobs \cup {TargetWorld(fenceAttempt)}
  /\ UNCHANGED <<prepared, headRevision, headWorld,
                 fenceAttempt, fenceDigest, written, worldPublished,
                 abortClaimed,
                 history, publishedAttempts>>

\* Publication is one atomic head-pointer CAS; partial blobs remain invisible.
Publish ==
  /\ fenceAttempt \in Attempts
  /\ history[OperationOf(fenceAttempt)] = "none"
  /\ written = Components
  /\ ~abortClaimed
  /\ TargetWorld(fenceAttempt) \in worldBlobs
  /\ ~worldPublished
  /\ headRevision = BaseRevision(fenceAttempt)
  /\ headWorld = BaseWorld(fenceAttempt)
  /\ headRevision' = headRevision + 1
  /\ headWorld' = TargetWorld(fenceAttempt)
  /\ worldPublished' = TRUE
  /\ publishedAttempts' = publishedAttempts \cup {fenceAttempt}
  /\ UNCHANGED <<prepared, worldBlobs, fenceAttempt, fenceDigest,
                 written, abortClaimed, history>>

\* Compact replay history may lag publication; the head retains repair evidence.
WriteCompletedHistory ==
  /\ fenceAttempt \in Attempts
  /\ worldPublished
  /\ ~abortClaimed
  /\ history[OperationOf(fenceAttempt)] = "none"
  /\ history' = [history EXCEPT ![OperationOf(fenceAttempt)] = "completed"]
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 fenceAttempt, fenceDigest, written, worldPublished,
                 abortClaimed,
                 publishedAttempts>>

ClearCompletedFence ==
  /\ fenceAttempt \in Attempts
  /\ worldPublished
  /\ history[OperationOf(fenceAttempt)] = "completed"
  /\ fenceAttempt' = None
  /\ fenceDigest' = None
  /\ written' = {}
  /\ worldPublished' = FALSE
  /\ abortClaimed' = FALSE
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 history, publishedAttempts>>

\* Abort first atomically marks the head so a concurrent publish CAS cannot win.
StartAbort ==
  /\ fenceAttempt \in Attempts
  /\ ~worldPublished
  /\ ~abortClaimed
  /\ history[OperationOf(fenceAttempt)] = "none"
  /\ abortClaimed' = TRUE
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 fenceAttempt, fenceDigest, written, worldPublished,
                 history, publishedAttempts>>

\* Repair then writes durable terminal evidence before releasing the head.
WriteAbortedHistory ==
  /\ fenceAttempt \in Attempts
  /\ ~worldPublished
  /\ abortClaimed
  /\ history[OperationOf(fenceAttempt)] = "none"
  /\ history' = [history EXCEPT ![OperationOf(fenceAttempt)] = "aborted"]
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 fenceAttempt, fenceDigest, written, worldPublished,
                 abortClaimed,
                 publishedAttempts>>

ClearAbortedFence ==
  /\ fenceAttempt \in Attempts
  /\ ~worldPublished
  /\ history[OperationOf(fenceAttempt)] = "aborted"
  /\ fenceAttempt' = None
  /\ fenceDigest' = None
  /\ written' = {}
  /\ worldPublished' = FALSE
  /\ abortClaimed' = FALSE
  /\ UNCHANGED <<prepared, worldBlobs, headRevision, headWorld,
                 history, publishedAttempts>>

RepairStep ==
  \/ \E component \in Components: Stage(component)
  \/ WriteWorldBlob
  \/ Publish
  \/ WriteCompletedHistory
  \/ ClearCompletedFence
  \/ WriteAbortedHistory
  \/ ClearAbortedFence

\* Native stock publication applies all visible rows and the replay receipt in one transaction.
\* Its plan may have been prepared from separate indexed reads, so the base must still win.
PublishNative(attempt, checkBase) ==
  /\ attempt \in prepared
  /\ fenceAttempt = None
  /\ history[OperationOf(attempt)] = "none"
  /\ ~checkBase \/ (headRevision = BaseRevision(attempt) /\ headWorld = BaseWorld(attempt))
  /\ headRevision' = headRevision + 1
  /\ headWorld' = TargetWorld(attempt)
  /\ worldBlobs' = worldBlobs \cup {TargetWorld(attempt)}
  /\ history' = [history EXCEPT ![OperationOf(attempt)] = "completed"]
  /\ publishedAttempts' = publishedAttempts \cup {attempt}
  /\ UNCHANGED <<prepared, fenceAttempt, fenceDigest, written, worldPublished, abortClaimed>>

Next ==
  \/ \E attempt \in Attempts: Prepare(attempt)
  \/ \E attempt \in Attempts: Claim(attempt)
  \/ \E attempt \in Attempts: PublishNative(attempt, TRUE)
  \/ StartAbort
  \/ RepairStep

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ WF_vars(RepairStep)

TypeOK ==
  /\ prepared \subseteq Attempts
  /\ worldBlobs \subseteq Worlds
  /\ headRevision \in 0..2
  /\ headWorld \in Worlds
  /\ fenceAttempt \in Attempts \cup {None}
  /\ fenceDigest \in {"dA0", "dB0", "dB1", None}
  /\ written \subseteq Components
  /\ worldPublished \in BOOLEAN
  /\ abortClaimed \in BOOLEAN
  /\ history \in [Operations -> {"none", "completed", "aborted"}]
  /\ publishedAttempts \subseteq Attempts

HeadReferencesCompleteWorld == headWorld \in worldBlobs

FenceRetainsExactPreparedPlan ==
  IF fenceAttempt = None
  THEN fenceDigest = None
  ELSE /\ fenceAttempt \in prepared
       /\ fenceDigest = PlanDigest(fenceAttempt)

PartialWritesAreInvisible ==
  fenceAttempt \in Attempts /\ ~worldPublished
    => /\ headRevision = BaseRevision(fenceAttempt)
       /\ headWorld = BaseWorld(fenceAttempt)

PublishedFencePointsAtExactTarget ==
  fenceAttempt \in Attempts /\ worldPublished
    => /\ headRevision = BaseRevision(fenceAttempt) + 1
       /\ headWorld = TargetWorld(fenceAttempt)
       /\ fenceAttempt \in publishedAttempts

OnePublicationPerOperation ==
  \A op \in Operations:
    Cardinality({attempt \in publishedAttempts: OperationOf(attempt) = op}) <= 1

CompletedHistoryHasPublishedAttempt ==
  \A op \in Operations:
    history[op] = "completed"
      => \E attempt \in publishedAttempts: OperationOf(attempt) = op

AbortedHistoryNeverPublished ==
  \A op \in Operations:
    history[op] = "aborted"
      => ~\E attempt \in publishedAttempts: OperationOf(attempt) = op

AbortMarkerBlocksPublication == abortClaimed => ~worldPublished

\* The visible target must come from the attempt based on the preceding revision.
HeadFollowsPublishedAttempts ==
  /\ headRevision = Cardinality(publishedAttempts)
  /\ headRevision # 0 =>
       \E attempt \in publishedAttempts:
         /\ TargetWorld(attempt) = headWorld
         /\ BaseRevision(attempt) + 1 = headRevision

\* Drop only the native base check to expose a real stale-plan overwrite.
NativeStaleMutationSpec ==
  Init /\ [][Next \/ \E attempt \in Attempts:
    headRevision > BaseRevision(attempt) /\ PublishNative(attempt, FALSE)]_vars

FenceEventuallyClears == [](fenceAttempt # None => <> (fenceAttempt = None))

=============================================================================
