# Formal tooling choices

InventoryOnce uses formal tools for different proof obligations. More tools are not automatically more assurance; every extra notation must buy coverage that the existing stack cannot express or check cleanly.

## Mandatory now: TLA+ + TLC

TLA+ is the primary behavioral language and TLC is the mandatory model checker because InventoryOnce's hardest bugs are state-machine bugs: concurrent claims, retries, crash-separated writes, in-transit operations, corrections, count/reconcile races, and eventual repair. TLC gives complete explicit-state exploration for the finite models we commit, supports temporal properties/fairness, and can directly check implementation/refinement properties.

`scripts/formal-models.mjs` exports `formalModels`, the model registry consumed by the formal runner and conformance/audit scripts; every registered model is part of `pnpm formal`. `formal/AbstractTransfer.tla` is an imported module rather than a runner entry. The runner pins official TLA+ tools by version and SHA-256.

## Complement when state spaces demand it: Apalache

Apalache translates TLA+ safety obligations to SMT and can outperform explicit enumeration for some large integer/set state spaces. It is a good future second checker for compatible models such as quantity vectors, distributed rights, or larger reservation-scope instances.

It is **not** a replacement for the current TLC gate:

- its own documentation describes it as newer/experimental compared with TLC;
- bounded execution checking does not become an unbounded proof merely because SMT is used;
- language/temporal-property support differs from TLC;
- InventoryOnce already uses liveness/fairness and temporal refinement where TLC is a natural fit.

If Apalache becomes a gate, pin its exact release/container digest and solver versions, define explicit step/parameter bounds, and keep TLC on the models where exhaustive reachable-state enumeration is tractable.

## Add Alloy only when graph coverage increases

Alloy's relational logic/SAT analyzer is particularly well suited to structural questions: nested handling units, associations, genealogy, serial uniqueness, and forbidden graph shapes. The current TLA `TraceabilityGraph` already exhausts a bounded arbitrary containment/association/transformation graph, so maintaining a second spec language would currently duplicate coverage.

Add an Alloy gate when the production traceability schema becomes rich enough that relational assertions are materially clearer/stronger than the TLA graph model. Pin the Analyzer/solver and give every Alloy assertion an executable-schema/property-test companion.

## Theorem provers are escalation tools, not badges

Lean/Coq/Isabelle/Event-B-style proof can become worthwhile if InventoryOnce develops an important **unbounded** algebraic theorem that finite model checking and executable property tests cannot adequately cover—for example a generic quantity-vector conversion algebra or a parametrically unbounded resource-conservation theorem. Do not introduce one merely to say the package is 'formally verified'.

## Always required: executable refinement/property tests

A model can be correct while implementation is wrong. Every implemented semantic family needs real TypeScript tests that exercise the same invariants. Durable adapters additionally require failure injection immediately before and after every physical write boundary.

The intended stack is therefore:

```text
market/standards semantics
        ↓
abstract resource + claim + graph state machines
        ↓
TLA+/TLC safety + refinement + liveness
        ↓
(optional SMT/Alloy where they add coverage)
        ↓
real TypeScript executable refinement/property tests
        ↓
durable adapter conformance + crash/failpoint tests
```

Formal evidence is reported by exact model/property/bounds, never by a blanket phrase like 'TLA+ proved the package'.
