--------------------------- MODULE AbstractTransfer ---------------------------
EXTENDS Integers

VARIABLES source, destination, status

vars == <<source, destination, status>>

Init ==
  /\ source = 2
  /\ destination = 0
  /\ status = "ready"

Transfer ==
  /\ status = "ready"
  /\ source > 0
  /\ source' = source - 1
  /\ destination' = destination + 1
  /\ status' = "done"

Next == Transfer

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ source \in 0..2
  /\ destination \in 0..2
  /\ status \in {"ready", "done"}

Conserved == source + destination = 2

=============================================================================
