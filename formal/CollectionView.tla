--------------------------- MODULE CollectionView ---------------------------
EXTENDS FiniteSets, Naturals

\* Grouping views are read-only taxonomies over exact item revisions, not substitution pools.
Tokens == {"old-1", "old-2", "new-1", "new-2", "other-1", "future-1"}
Items == {"brand-old", "brand-new", "other-ocp", "future-ocp"}
Locations == {"store", "room"}
Issued == "issued"
ViewRevisions == {"brand-v1", "all-v1", "all-v2"}
AllViewRevisions == {"all-v1", "all-v2"}

ItemOf(token) ==
  CASE token \in {"old-1", "old-2"} -> "brand-old"
    [] token \in {"new-1", "new-2"} -> "brand-new"
    [] token = "other-1" -> "other-ocp"
    [] OTHER -> "future-ocp"

Members(viewRevision) ==
  CASE viewRevision = "brand-v1" -> {"brand-old", "brand-new"}
    [] viewRevision = "all-v1" -> {"brand-old", "brand-new", "other-ocp"}
    [] OTHER -> Items

ExactBreakdown(viewRevision, whereState) ==
  [item \in Items |->
    IF item \in Members(viewRevision)
      THEN Cardinality({token \in Tokens:
             /\ whereState[token] # Issued
             /\ ItemOf(token) = item})
      ELSE 0]

ExactReports(whereState) ==
  [viewRevision \in ViewRevisions |-> ExactBreakdown(viewRevision, whereState)]

SumViewReport(viewRevision, reportState) ==
    reportState[viewRevision]["brand-old"]
  + reportState[viewRevision]["brand-new"]
  + reportState[viewRevision]["other-ocp"]
  + reportState[viewRevision]["future-ocp"]

VARIABLES where, activeAllViewRevision, reports

vars == <<where, activeAllViewRevision, reports>>

Init ==
  /\ where = [token \in Tokens |->
       IF token \in {"old-1", "new-1", "other-1"}
         THEN "store"
         ELSE "room"]
  /\ activeAllViewRevision = "all-v1"
  /\ reports = ExactReports(where)

ActivateAllView(revision) ==
  /\ revision \in AllViewRevisions
  /\ revision # activeAllViewRevision
  /\ activeAllViewRevision' = revision
  /\ UNCHANGED <<where, reports>>

Transfer(token, destination) ==
  /\ token \in Tokens
  /\ where[token] \in Locations
  /\ destination \in Locations
  /\ destination # where[token]
  /\ where' = [where EXCEPT ![token] = destination]
  /\ reports' = ExactReports(where')
  /\ UNCHANGED activeAllViewRevision

IssueExact(token) ==
  /\ token \in Tokens
  /\ where[token] \in Locations
  /\ where' = [where EXCEPT ![token] = Issued]
  /\ reports' = ExactReports(where')
  /\ UNCHANGED activeAllViewRevision

Next ==
  \/ \E revision \in AllViewRevisions: ActivateAllView(revision)
  \/ \E token \in Tokens, destination \in Locations: Transfer(token, destination)
  \/ \E token \in Tokens: IssueExact(token)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ where \in [Tokens -> Locations \cup {Issued}]
  /\ activeAllViewRevision \in AllViewRevisions
  /\ reports \in [ViewRevisions -> [Items -> 0..6]]

ReportsMatchExactPhysicalIdentity == reports = ExactReports(where)

NonMembersNeverAppearInAView ==
  \A viewRevision \in ViewRevisions, item \in Items:
    item \notin Members(viewRevision) => reports[viewRevision][item] = 0

ActivePointerDoesNotRewriteRetainedViews ==
  /\ reports["all-v1"] = ExactBreakdown("all-v1", where)
  /\ reports["all-v2"] = ExactBreakdown("all-v2", where)

ViewMembershipNeverChangesItemIdentity ==
  \A viewRevision \in ViewRevisions:
    \A item \in Members(viewRevision):
      reports[viewRevision][item]
        = Cardinality({token \in Tokens:
            /\ where[token] # Issued
            /\ ItemOf(token) = item})

IssuedTokensDisappearOnlyFromTheirExactItemBucket ==
  \A viewRevision \in ViewRevisions:
    Cardinality({token \in Tokens:
      /\ where[token] # Issued
      /\ ItemOf(token) \in Members(viewRevision)})
      = SumViewReport(viewRevision, reports)

=============================================================================
