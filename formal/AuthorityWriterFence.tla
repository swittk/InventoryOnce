-------------------------- MODULE AuthorityWriterFence --------------------------
EXTENDS FiniteSets, Integers

Writers == {"w1", "w2"}
Commands == {"c1", "c2"}
Intents == {"i1", "i2"}
FenceTokens == {"f1", "f2"}
CrashPoints == {"staged", "published", "projection"}
Modes == {"legacy", "shadow", "dual-run", "fencing", "authoritative"}
ProjectionStatuses == {"current", "lagging", "failed"}
MigrationStages == {"none", "staged", "published"}
ActivationKinds == {"none", "legacy-cutover", "greenfield"}
None == "none"
NoRoot == -1
MaxSourceVersion == Cardinality(Writers)
MaxWorldRevision == Cardinality(Commands)
IntentOrNone == Intents \cup {None}

\* Authority progression/certification, legacy-writer ownership, frozen source evidence, migration/repair,
\* authoritative retry/publication, compatibility projection, and denied legacy-attempt evidence.
VARIABLES mode, phase, adapterCertified, cutoverAuthorized,
  greenfieldAuthorized, activationKind, admitted, usedWriters, wroteWriters, sourceVersion,
  shadowRoot, dualRoot, dualIntent, mismatches,
  fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
  migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
  authorityEverActivated, commandIntent, publishedCommands,
  replayedCommands, changedRetryRejected, worldRevision,
  projectionRevision, projectionStatus, blockedLegacyWrites

vars == <<mode, phase, adapterCertified, cutoverAuthorized,
  greenfieldAuthorized, activationKind, admitted, usedWriters, wroteWriters, sourceVersion,
  shadowRoot, dualRoot, dualIntent, mismatches,
  fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
  migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
  authorityEverActivated, commandIntent, publishedCommands,
  replayedCommands, changedRetryRejected, worldRevision,
  projectionRevision, projectionStatus, blockedLegacyWrites>>

Init ==
  /\ mode = "legacy"
  /\ phase = 0
  /\ adapterCertified = FALSE
  /\ cutoverAuthorized = FALSE
  /\ greenfieldAuthorized = FALSE
  /\ activationKind = "none"
  /\ admitted = {}
  /\ usedWriters = {}
  /\ wroteWriters = {}
  /\ sourceVersion = 0
  /\ shadowRoot = NoRoot
  /\ dualRoot = NoRoot
  /\ dualIntent = [command \in Commands |-> None]
  /\ mismatches = {}
  /\ fenceToken = None
  /\ fencedRoot = NoRoot
  /\ firstReadRoot = NoRoot
  /\ secondReadRoot = NoRoot
  /\ migrationStage = "none"
  /\ targetRoot = NoRoot
  /\ crashed = FALSE
  /\ repairNeeded = FALSE
  /\ crashPoints = {}
  /\ authorityEverActivated = FALSE
  /\ commandIntent = [command \in Commands |-> None]
  /\ publishedCommands = {}
  /\ replayedCommands = {}
  /\ changedRetryRejected = {}
  /\ worldRevision = 0
  /\ projectionRevision = 0
  /\ projectionStatus = "current"
  /\ blockedLegacyWrites = {}

CertifyAdapter ==
  /\ mode = "legacy"
  /\ ~adapterCertified
  /\ adapterCertified' = TRUE
  /\ UNCHANGED <<mode, phase, admitted, usedWriters, wroteWriters,
    sourceVersion, shadowRoot, dualRoot, dualIntent, mismatches,
    fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

AuthorizeCutover ==
  /\ mode \in {"legacy", "shadow", "dual-run"}
  /\ ~greenfieldAuthorized
  /\ ~cutoverAuthorized
  /\ cutoverAuthorized' = TRUE
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, greenfieldAuthorized, activationKind>>

AuthorizeGreenfield ==
  /\ mode \in {"legacy", "shadow"}
  /\ adapterCertified
  /\ ~cutoverAuthorized
  /\ ~greenfieldAuthorized
  /\ greenfieldAuthorized' = TRUE
  /\ UNCHANGED <<mode, phase, adapterCertified, cutoverAuthorized,
    activationKind, admitted, usedWriters, wroteWriters, sourceVersion,
    shadowRoot, dualRoot, dualIntent, mismatches, fenceToken, fencedRoot,
    firstReadRoot, secondReadRoot, migrationStage, targetRoot, crashed,
    repairNeeded, crashPoints, authorityEverActivated, commandIntent,
    publishedCommands, replayedCommands, changedRetryRejected,
    worldRevision, projectionRevision, projectionStatus, blockedLegacyWrites>>

AdmitWriter(writer) ==
  /\ writer \in Writers
  /\ mode \in {"legacy", "shadow", "dual-run"}
  /\ writer \notin usedWriters
  /\ admitted' = admitted \cup {writer}
  /\ usedWriters' = usedWriters \cup {writer}
  /\ UNCHANGED <<mode, phase, adapterCertified, wroteWriters,
    sourceVersion, shadowRoot, dualRoot, dualIntent, mismatches,
    fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

WriteSource(writer) ==
  /\ writer \in admitted
  /\ writer \notin wroteWriters
  /\ wroteWriters' = wroteWriters \cup {writer}
  /\ sourceVersion' = sourceVersion + 1
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    shadowRoot, dualRoot, dualIntent, mismatches, fenceToken,
    fencedRoot, firstReadRoot, secondReadRoot, migrationStage,
    targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ReleaseWriter(writer) ==
  /\ writer \in admitted
  /\ admitted' = admitted \ {writer}
  /\ UNCHANGED <<mode, phase, adapterCertified, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

EnterShadow ==
  /\ mode = "legacy"
  /\ adapterCertified
  /\ mode' = "shadow"
  /\ phase' = 1
  /\ shadowRoot' = sourceVersion
  /\ UNCHANGED <<adapterCertified, admitted, usedWriters, wroteWriters,
    sourceVersion, dualRoot, dualIntent, mismatches, fenceToken,
    fencedRoot, firstReadRoot, secondReadRoot, migrationStage,
    targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

RefreshShadow ==
  /\ mode = "shadow"
  /\ shadowRoot # sourceVersion
  /\ shadowRoot' = sourceVersion
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, dualRoot, dualIntent, mismatches,
    fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

EnterDualRun ==
  /\ mode = "shadow"
  /\ ~greenfieldAuthorized
  /\ shadowRoot = sourceVersion
  /\ mode' = "dual-run"
  /\ phase' = 2
  /\ dualRoot' = sourceVersion
  /\ UNCHANGED <<adapterCertified, admitted, usedWriters, wroteWriters,
    sourceVersion, shadowRoot, dualIntent, mismatches, fenceToken,
    fencedRoot, firstReadRoot, secondReadRoot, migrationStage,
    targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

DualCheck(command, intent) ==
  /\ command \in Commands
  /\ intent \in Intents
  /\ mode = "dual-run"
  /\ dualRoot = sourceVersion
  /\ dualIntent[command] = None
  /\ dualIntent' = [dualIntent EXCEPT ![command] = intent]
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, mismatches,
    fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

RejectChangedDualRetry(command, intent) ==
  /\ command \in Commands
  /\ intent \in Intents
  /\ mode = "dual-run"
  /\ dualIntent[command] # None
  /\ dualIntent[command] # intent
  /\ command \notin changedRetryRejected
  /\ changedRetryRejected' = changedRetryRejected \cup {command}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, worldRevision, projectionRevision,
    projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

RecordDualMismatch(command) ==
  /\ command \in Commands
  /\ mode = "dual-run"
  /\ command \notin mismatches
  /\ mismatches' = mismatches \cup {command}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ClaimFence(token) ==
  /\ token \in FenceTokens
  /\ mode = "dual-run"
  \* Fence ownership requires explicit operator authorization and zero admitted legacy writers/mismatches.
  /\ cutoverAuthorized
  /\ admitted = {}
  /\ mismatches = {}
  /\ dualRoot = sourceVersion
  /\ mode' = "fencing"
  /\ fenceToken' = token
  /\ fencedRoot' = sourceVersion
  /\ firstReadRoot' = NoRoot
  /\ secondReadRoot' = NoRoot
  /\ migrationStage' = "none"
  /\ targetRoot' = NoRoot
  /\ crashed' = FALSE
  /\ repairNeeded' = FALSE
  /\ UNCHANGED <<phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, crashPoints, authorityEverActivated, commandIntent,
    publishedCommands, replayedCommands, changedRetryRejected,
    worldRevision, projectionRevision, projectionStatus,
    blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

BlockLegacyWrite(writer) ==
  /\ writer \in Writers
  /\ mode \in {"fencing", "authoritative"}
  /\ writer \notin blockedLegacyWrites
  /\ blockedLegacyWrites' = blockedLegacyWrites \cup {writer}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ReadFirstSource ==
  /\ mode = "fencing"
  /\ ~crashed
  /\ firstReadRoot = NoRoot
  /\ firstReadRoot' = sourceVersion
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, secondReadRoot, migrationStage,
    targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ReadSecondSource ==
  /\ mode = "fencing"
  /\ ~crashed
  /\ firstReadRoot # NoRoot
  /\ secondReadRoot = NoRoot
  /\ secondReadRoot' = sourceVersion
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, migrationStage,
    targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

StageMigration ==
  /\ mode = "fencing"
  /\ ~crashed
  /\ migrationStage = "none"
  /\ firstReadRoot # NoRoot
  /\ firstReadRoot = secondReadRoot
  /\ firstReadRoot = fencedRoot
  /\ migrationStage' = "staged"
  /\ targetRoot' = secondReadRoot
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    crashed, repairNeeded, crashPoints, authorityEverActivated,
    commandIntent, publishedCommands, replayedCommands,
    changedRetryRejected, worldRevision, projectionRevision,
    projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

CrashStaged ==
  /\ mode = "fencing"
  /\ migrationStage = "staged"
  /\ ~crashed
  /\ "staged" \notin crashPoints
  /\ crashed' = TRUE
  /\ repairNeeded' = TRUE
  /\ crashPoints' = crashPoints \cup {"staged"}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, authorityEverActivated, commandIntent,
    publishedCommands, replayedCommands, changedRetryRejected,
    worldRevision, projectionRevision, projectionStatus,
    blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

PublishMigration ==
  /\ mode = "fencing"
  /\ ~crashed
  /\ migrationStage = "staged"
  /\ targetRoot = fencedRoot
  /\ migrationStage' = "published"
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

CrashPublished ==
  /\ mode = "fencing"
  /\ migrationStage = "published"
  /\ ~crashed
  /\ "published" \notin crashPoints
  /\ crashed' = TRUE
  /\ repairNeeded' = TRUE
  /\ crashPoints' = crashPoints \cup {"published"}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, authorityEverActivated, commandIntent,
    publishedCommands, replayedCommands, changedRetryRejected,
    worldRevision, projectionRevision, projectionStatus,
    blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

RepairCrash ==
  /\ crashed
  /\ repairNeeded
  /\ crashed' = FALSE
  /\ repairNeeded' = FALSE
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashPoints, authorityEverActivated,
    commandIntent, publishedCommands, replayedCommands,
    changedRetryRejected, worldRevision, projectionRevision,
    projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ReleaseFence ==
  /\ mode = "fencing"
  /\ migrationStage = "none"
  /\ ~crashed
  /\ mode' = "dual-run"
  /\ fenceToken' = None
  /\ fencedRoot' = NoRoot
  /\ firstReadRoot' = NoRoot
  /\ secondReadRoot' = NoRoot
  /\ targetRoot' = NoRoot
  /\ UNCHANGED <<phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, migrationStage, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    projectionRevision, projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ActivateAuthority ==
  /\ mode = "fencing"
  /\ ~crashed
  /\ migrationStage = "published"
  /\ targetRoot = fencedRoot
  /\ sourceVersion = fencedRoot
  /\ mismatches = {}
  /\ mode' = "authoritative"
  /\ phase' = 3
  /\ authorityEverActivated' = TRUE
  /\ activationKind' = "legacy-cutover"
  /\ projectionRevision' = worldRevision
  /\ projectionStatus' = "lagging"
  /\ UNCHANGED <<adapterCertified, admitted, usedWriters, wroteWriters,
    sourceVersion, shadowRoot, dualRoot, dualIntent, mismatches,
    fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    commandIntent, publishedCommands, replayedCommands,
    changedRetryRejected, worldRevision, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized>>

ActivateGreenfield ==
  /\ mode \in {"legacy", "shadow"}
  /\ ~crashed
  /\ adapterCertified
  \* Greenfield activation is fail-closed unless explicitly authorized with no legacy writer/source truth.
  /\ greenfieldAuthorized
  /\ admitted = {}
  /\ sourceVersion = 0
  /\ mismatches = {}
  /\ fenceToken = None
  /\ migrationStage = "none"
  /\ worldRevision = 0
  /\ mode' = "authoritative"
  /\ phase' = 3
  /\ authorityEverActivated' = TRUE
  /\ activationKind' = "greenfield"
  /\ targetRoot' = 0
  /\ projectionRevision' = 0
  /\ projectionStatus' = "current"
  /\ UNCHANGED <<adapterCertified, cutoverAuthorized, greenfieldAuthorized,
    admitted, usedWriters, wroteWriters, sourceVersion, shadowRoot,
    dualRoot, dualIntent, mismatches, fenceToken, fencedRoot,
    firstReadRoot, secondReadRoot, migrationStage, crashed, repairNeeded,
    crashPoints, commandIntent, publishedCommands, replayedCommands,
    changedRetryRejected, worldRevision, blockedLegacyWrites>>

PublishCommand(command, intent) ==
  /\ command \in Commands
  /\ intent \in Intents
  /\ mode = "authoritative"
  /\ ~crashed
  /\ commandIntent[command] = None
  /\ worldRevision < MaxWorldRevision
  /\ commandIntent' = [commandIntent EXCEPT ![command] = intent]
  /\ publishedCommands' = publishedCommands \cup {command}
  /\ worldRevision' = worldRevision + 1
  /\ projectionStatus' = "lagging"
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, replayedCommands, changedRetryRejected,
    projectionRevision, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ReplayCommand(command, intent) ==
  /\ command \in Commands
  /\ intent \in Intents
  /\ mode = "authoritative"
  /\ ~crashed
  /\ commandIntent[command] = intent
  /\ command \notin replayedCommands
  /\ replayedCommands' = replayedCommands \cup {command}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    changedRetryRejected, worldRevision, projectionRevision,
    projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

RejectChangedCommand(command, intent) ==
  /\ command \in Commands
  /\ intent \in Intents
  /\ mode = "authoritative"
  /\ ~crashed
  /\ commandIntent[command] # None
  /\ commandIntent[command] # intent
  /\ command \notin changedRetryRejected
  /\ changedRetryRejected' = changedRetryRejected \cup {command}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, worldRevision, projectionRevision,
    projectionStatus, blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

CrashBeforeProjection ==
  /\ mode = "authoritative"
  /\ projectionStatus = "lagging"
  /\ ~crashed
  /\ "projection" \notin crashPoints
  /\ crashed' = TRUE
  /\ repairNeeded' = TRUE
  /\ crashPoints' = crashPoints \cup {"projection"}
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, authorityEverActivated, commandIntent,
    publishedCommands, replayedCommands, changedRetryRejected,
    worldRevision, projectionRevision, projectionStatus,
    blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ProjectFailure ==
  /\ mode = "authoritative"
  /\ ~crashed
  /\ projectionStatus = "lagging"
  /\ projectionStatus' = "failed"
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision, projectionRevision,
    blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

ProjectSuccess ==
  /\ mode = "authoritative"
  /\ ~crashed
  /\ \/ projectionStatus # "current"
     \/ projectionRevision # worldRevision
  /\ projectionRevision' = worldRevision
  /\ projectionStatus' = "current"
  /\ UNCHANGED <<mode, phase, adapterCertified, admitted, usedWriters,
    wroteWriters, sourceVersion, shadowRoot, dualRoot, dualIntent,
    mismatches, fenceToken, fencedRoot, firstReadRoot, secondReadRoot,
    migrationStage, targetRoot, crashed, repairNeeded, crashPoints,
    authorityEverActivated, commandIntent, publishedCommands,
    replayedCommands, changedRetryRejected, worldRevision,
    blockedLegacyWrites, cutoverAuthorized, greenfieldAuthorized, activationKind>>

Next ==
  \/ CertifyAdapter
  \/ AuthorizeCutover
  \/ AuthorizeGreenfield
  \/ \E writer \in Writers: AdmitWriter(writer)
  \/ \E writer \in Writers: WriteSource(writer)
  \/ \E writer \in Writers: ReleaseWriter(writer)
  \/ EnterShadow
  \/ RefreshShadow
  \/ EnterDualRun
  \/ \E command \in Commands, intent \in Intents: DualCheck(command, intent)
  \/ \E command \in Commands, intent \in Intents: RejectChangedDualRetry(command, intent)
  \/ \E command \in Commands: RecordDualMismatch(command)
  \/ \E token \in FenceTokens: ClaimFence(token)
  \/ \E writer \in Writers: BlockLegacyWrite(writer)
  \/ ReadFirstSource
  \/ ReadSecondSource
  \/ StageMigration
  \/ CrashStaged
  \/ PublishMigration
  \/ CrashPublished
  \/ RepairCrash
  \/ ReleaseFence
  \/ ActivateAuthority
  \/ ActivateGreenfield
  \/ \E command \in Commands, intent \in Intents: PublishCommand(command, intent)
  \/ \E command \in Commands, intent \in Intents: ReplayCommand(command, intent)
  \/ \E command \in Commands, intent \in Intents: RejectChangedCommand(command, intent)
  \/ CrashBeforeProjection
  \/ ProjectFailure
  \/ ProjectSuccess

Spec ==
  /\ Init
  /\ [][Next]_vars
  \* Once repair is continuously enabled, weak fairness requires the claimed crash/fence work to progress.
  /\ WF_vars(RepairCrash)
  \* A fully published fenced migration eventually activates; fairness does not force prepared writers to claim a fence.
  /\ WF_vars(ActivateAuthority)
  \* Explicitly authorized empty greenfield state eventually resolves activation versus writer admission.
  /\ WF_vars(ActivateGreenfield)
  \* Compatibility projection repair eventually catches the projector up to authoritative truth.
  /\ WF_vars(ProjectSuccess)

TypeOK ==
  /\ mode \in Modes
  /\ phase \in 0..3
  /\ adapterCertified \in BOOLEAN
  /\ cutoverAuthorized \in BOOLEAN
  /\ greenfieldAuthorized \in BOOLEAN
  /\ ~(cutoverAuthorized /\ greenfieldAuthorized)
  /\ activationKind \in ActivationKinds
  /\ admitted \subseteq Writers
  /\ usedWriters \subseteq Writers
  /\ wroteWriters \subseteq Writers
  /\ sourceVersion \in 0..MaxSourceVersion
  /\ shadowRoot \in NoRoot..MaxSourceVersion
  /\ dualRoot \in NoRoot..MaxSourceVersion
  /\ dualIntent \in [Commands -> IntentOrNone]
  /\ mismatches \subseteq Commands
  /\ fenceToken \in FenceTokens \cup {None}
  /\ fencedRoot \in NoRoot..MaxSourceVersion
  /\ firstReadRoot \in NoRoot..MaxSourceVersion
  /\ secondReadRoot \in NoRoot..MaxSourceVersion
  /\ migrationStage \in MigrationStages
  /\ targetRoot \in NoRoot..MaxSourceVersion
  /\ crashed \in BOOLEAN
  /\ repairNeeded \in BOOLEAN
  /\ crashPoints \subseteq CrashPoints
  /\ authorityEverActivated \in BOOLEAN
  /\ commandIntent \in [Commands -> IntentOrNone]
  /\ publishedCommands \subseteq Commands
  /\ replayedCommands \subseteq Commands
  /\ changedRetryRejected \subseteq Commands
  /\ worldRevision \in 0..MaxWorldRevision
  /\ projectionRevision \in 0..MaxWorldRevision
  /\ projectionStatus \in ProjectionStatuses
  /\ blockedLegacyWrites \subseteq Writers

ModeMatchesMonotonicPhase ==
  /\ (mode = "legacy" => phase = 0)
  /\ (mode = "shadow" => phase = 1)
  /\ (mode \in {"dual-run", "fencing"} => phase = 2)
  /\ (mode = "authoritative" => phase = 3)

CertificationPrecedesCutover == phase >= 1 => adapterCertified

ExplicitAuthorizationPrecedesFence ==
  /\ (mode = "fencing" => cutoverAuthorized)
  /\ (mode = "authoritative" /\ activationKind = "legacy-cutover"
        => cutoverAuthorized)
  /\ (mode = "authoritative" /\ activationKind = "greenfield"
        => greenfieldAuthorized)

AdmissionOwnership ==
  /\ admitted \subseteq usedWriters
  /\ wroteWriters \subseteq usedWriters
  /\ sourceVersion = Cardinality(wroteWriters)

FenceExcludesLegacyWriters ==
  mode \in {"fencing", "authoritative"} => admitted = {}

NoLegacyPhysicalWriteAfterFence ==
  /\ (mode = "fencing" => sourceVersion = fencedRoot)
  /\ (mode = "authoritative" /\ activationKind = "legacy-cutover"
        => sourceVersion = fencedRoot)
  /\ (mode = "authoritative" /\ activationKind = "greenfield"
        => sourceVersion = 0)

UnfencedStateIsClean ==
  mode \in {"legacy", "shadow", "dual-run"}
    => /\ fenceToken = None
       /\ fencedRoot = NoRoot
       /\ firstReadRoot = NoRoot
       /\ secondReadRoot = NoRoot
       /\ migrationStage = "none"
       /\ targetRoot = NoRoot

FencedReadsAreStable ==
  /\ (firstReadRoot # NoRoot => firstReadRoot = fencedRoot)
  /\ (secondReadRoot # NoRoot => secondReadRoot = fencedRoot)

PublishedTargetMatchesStableSource ==
  migrationStage \in {"staged", "published"}
    => /\ mode \in {"fencing", "authoritative"}
       /\ targetRoot = fencedRoot
       /\ firstReadRoot = secondReadRoot
       /\ firstReadRoot = fencedRoot

MismatchCannotBeBypassed ==
  mode \in {"fencing", "authoritative"} => mismatches = {}

AuthorityRequiresAllEvidence ==
  mode = "authoritative"
    => /\ authorityEverActivated
       /\ adapterCertified
       /\ \/ /\ activationKind = "legacy-cutover"
              /\ cutoverAuthorized
              /\ migrationStage = "published"
              /\ targetRoot = fencedRoot
              /\ sourceVersion = fencedRoot
              /\ fenceToken \in FenceTokens
          \/ /\ activationKind = "greenfield"
              /\ greenfieldAuthorized
              /\ migrationStage = "none"
              /\ targetRoot = 0
              /\ sourceVersion = 0
              /\ fenceToken = None

ActivationProvenanceIsExact ==
  /\ (mode = "authoritative") = (activationKind # "none")
  /\ (activationKind = "legacy-cutover"
        => /\ mode = "authoritative"
           /\ cutoverAuthorized)
  /\ (activationKind = "greenfield"
        => /\ mode = "authoritative"
           /\ greenfieldAuthorized)

GreenfieldCannotFabricateLegacyEvidence ==
  activationKind = "greenfield"
    => /\ sourceVersion = 0
       /\ shadowRoot \in {NoRoot, 0}
       /\ dualRoot = NoRoot
       /\ mismatches = {}
       /\ fenceToken = None
       /\ fencedRoot = NoRoot
       /\ firstReadRoot = NoRoot
       /\ secondReadRoot = NoRoot
       /\ migrationStage = "none"
       /\ targetRoot = 0

AuthorityIsIrreversible == authorityEverActivated => mode = "authoritative"

ShadowCannotPublishPhysicalTruth ==
  mode # "authoritative"
    => /\ publishedCommands = {}
       /\ worldRevision = 0
       /\ \A command \in Commands: commandIntent[command] = None

OnePublicationPerCommand ==
  /\ worldRevision = Cardinality(publishedCommands)
  /\ \A command \in Commands:
       (command \in publishedCommands) = (commandIntent[command] # None)

\* An exact replay can only be recorded for an already-published authoritative command.
ReplayReferencesPublishedTruth == replayedCommands \subseteq publishedCommands

\* Changed-retry rejection is only recorded after either dual-run or authoritative intent was frozen.
ChangedRetryRequiresFrozenIntent ==
  \A command \in changedRetryRejected:
    dualIntent[command] # None \/ commandIntent[command] # None

\* A denied legacy attempt can only have been observed after reaching the fence-capable phase.
BlockedLegacyAttemptsRequireFencePhase ==
  blockedLegacyWrites # {} => phase >= 2

ProjectionCannotMutateAuthoritativeTruth ==
  /\ projectionRevision <= worldRevision
  /\ (mode = "authoritative" /\ projectionStatus = "current"
        => projectionRevision = worldRevision)

CrashBeforePublicationIsInvisible ==
  mode = "fencing" => worldRevision = 0

CrashStateIsExplicitlyRepairable == crashed = repairNeeded

CrashRepairLiveness == crashed ~> ~crashed

PublishedActivationLiveness ==
  (mode = "fencing" /\ migrationStage = "published")
    ~> mode = "authoritative"

GreenfieldActivationRaceResolution ==
  (mode \in {"legacy", "shadow"}
    /\ adapterCertified
    /\ greenfieldAuthorized
    /\ admitted = {}
    /\ sourceVersion = 0)
      ~> (mode = "authoritative" \/ admitted # {})

ProjectionRepairLiveness ==
  (mode = "authoritative" /\ projectionStatus \in {"lagging", "failed"})
    ~> projectionStatus = "current"

=============================================================================
