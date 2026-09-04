---------------------------- MODULE RepairLiveness ----------------------------
EXTENDS FiniteSets, Integers

Components == {"event", "projection", "reservations", "counts", "receipt"}
Terminal == {"completed", "aborted"}

VARIABLES phase, planFrozen, planRetained, written, worldPublished, interruptions, workerReady

vars == <<phase, planFrozen, planRetained, written, worldPublished, interruptions, workerReady>>

Init ==
  /\ phase = "none"
  /\ planFrozen = FALSE
  /\ planRetained = FALSE
  /\ written = {}
  /\ worldPublished = FALSE
  /\ interruptions = 0
  /\ workerReady = FALSE

Begin ==
  /\ phase = "none"
  /\ phase' = "applying"
  /\ planFrozen' = TRUE
  /\ planRetained' = TRUE
  /\ workerReady' = TRUE
  /\ UNCHANGED <<written, worldPublished, interruptions>>

Interrupt ==
  /\ phase = "applying"
  /\ workerReady
  /\ interruptions < 2
  /\ interruptions' = interruptions + 1
  /\ workerReady' = FALSE
  /\ UNCHANGED <<phase, planFrozen, planRetained, written, worldPublished>>

\* A replacement worker reloads the durable frozen plan without changing staged durable writes.
ReloadWorker ==
  /\ phase = "applying"
  /\ planFrozen
  /\ planRetained
  /\ ~workerReady
  /\ workerReady' = TRUE
  /\ UNCHANGED <<phase, planFrozen, planRetained, written, worldPublished, interruptions>>

RepairWrite(component) ==
  /\ phase = "applying"
  /\ workerReady
  /\ planFrozen
  /\ planRetained
  /\ component \in Components \ written
  /\ written' = written \cup {component}
  /\ UNCHANGED <<phase, planFrozen, planRetained, worldPublished, interruptions, workerReady>>

PublishWorld ==
  /\ phase = "applying"
  /\ workerReady
  /\ planFrozen
  /\ planRetained
  /\ written = Components
  /\ ~worldPublished
  /\ worldPublished' = TRUE
  /\ UNCHANGED <<phase, planFrozen, planRetained, written, interruptions, workerReady>>

CompactOperation ==
  /\ phase = "applying"
  /\ workerReady
  /\ planFrozen
  /\ planRetained
  /\ worldPublished
  /\ phase' = "completed"
  /\ planRetained' = FALSE
  /\ workerReady' = FALSE
  /\ UNCHANGED <<planFrozen, written, worldPublished, interruptions>>

Abort ==
  /\ phase = "applying"
  /\ ~worldPublished
  /\ phase' = "aborted"
  /\ planRetained' = FALSE
  /\ workerReady' = FALSE
  /\ UNCHANGED <<planFrozen, written, worldPublished, interruptions>>

\* This action is the generic worker: it needs only the frozen plan/component flags.
RepairStep ==
  \/ ReloadWorker
  \/ \E component \in Components: RepairWrite(component)
  \/ PublishWorld
  \/ CompactOperation

Next ==
  \/ Begin
  \/ Interrupt
  \/ RepairStep
  \/ Abort

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ WF_vars(RepairStep)

TypeOK ==
  /\ phase \in {"none", "applying", "completed", "aborted"}
  /\ planFrozen \in BOOLEAN
  /\ planRetained \in BOOLEAN
  /\ written \subseteq Components
  /\ worldPublished \in BOOLEAN
  /\ interruptions \in 0..2
  /\ workerReady \in BOOLEAN

ApplyingHasFrozenPlan == phase # "applying" \/ (planFrozen /\ planRetained)

TerminalDropsFullPlan == phase \in Terminal => ~planRetained

PublishedWorldCannotAbort == worldPublished => phase \in {"applying", "completed"}

TerminalNeverReopens ==
  [][(phase \in Terminal) => (phase' = phase)]_vars

ApplyingEventuallyTerminates ==
  [](phase = "applying" => <>(phase \in Terminal))

=============================================================================
