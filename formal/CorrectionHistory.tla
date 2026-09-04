-------------------------- MODULE CorrectionHistory --------------------------
EXTENDS Integers

VARIABLES phase, originalRecorded, errorDeclarationWritten,
          correctedEventWritten, visibleQuantity, recordVersion

vars == <<phase, originalRecorded, errorDeclarationWritten,
          correctedEventWritten, visibleQuantity, recordVersion>>

Init ==
  /\ phase = "none"
  /\ originalRecorded = FALSE
  /\ errorDeclarationWritten = FALSE
  /\ correctedEventWritten = FALSE
  /\ visibleQuantity = 0
  /\ recordVersion = 0

RecordOriginal ==
  /\ phase = "none"
  /\ phase' = "original"
  /\ originalRecorded' = TRUE
  /\ visibleQuantity' = 1
  /\ recordVersion' = 1
  /\ UNCHANGED <<errorDeclarationWritten, correctedEventWritten>>

StartCorrection ==
  /\ phase = "original"
  /\ phase' = "correcting"
  /\ UNCHANGED <<originalRecorded, errorDeclarationWritten,
                 correctedEventWritten, visibleQuantity, recordVersion>>

WriteErrorDeclaration ==
  /\ phase = "correcting"
  /\ ~errorDeclarationWritten
  /\ errorDeclarationWritten' = TRUE
  /\ UNCHANGED <<phase, originalRecorded, correctedEventWritten,
                 visibleQuantity, recordVersion>>

WriteCorrectedEvent ==
  /\ phase = "correcting"
  /\ ~correctedEventWritten
  /\ correctedEventWritten' = TRUE
  /\ UNCHANGED <<phase, originalRecorded, errorDeclarationWritten,
                 visibleQuantity, recordVersion>>

CompleteCorrection ==
  /\ phase = "correcting"
  /\ errorDeclarationWritten
  /\ correctedEventWritten
  /\ phase' = "corrected"
  /\ visibleQuantity' = 2
  /\ recordVersion' = 2
  /\ UNCHANGED <<originalRecorded, errorDeclarationWritten, correctedEventWritten>>

Next ==
  \/ RecordOriginal
  \/ StartCorrection
  \/ WriteErrorDeclaration
  \/ WriteCorrectedEvent
  \/ CompleteCorrection

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in {"none", "original", "correcting", "corrected"}
  /\ originalRecorded \in BOOLEAN
  /\ errorDeclarationWritten \in BOOLEAN
  /\ correctedEventWritten \in BOOLEAN
  /\ visibleQuantity \in 0..2
  /\ recordVersion \in 0..2

OriginalHistoryIsNeverErased ==
  phase = "none" \/ originalRecorded

PartialCorrectionDoesNotRewriteCurrentTruth ==
  phase # "correcting" \/ visibleQuantity = 1

CorrectedVisibilityRequiresBothNewFacts ==
  phase # "corrected" \/
    /\ errorDeclarationWritten
    /\ correctedEventWritten
    /\ visibleQuantity = 2
    /\ recordVersion = 2

VisibleProjectionMatchesLogicalRecordVersion ==
  \/ recordVersion = 0 /\ visibleQuantity = 0
  \/ recordVersion = 1 /\ visibleQuantity = 1
  \/ recordVersion = 2 /\ visibleQuantity = 2

=============================================================================
