---- MODULE ReclassificationConservation ----
EXTENDS Naturals, FiniteSets, TLC

Positions ==
  {"aLoose1", "aLoose2", "aLoose3",
   "aBox1", "aBox2", "aBox3",
   "bLoose1", "bLoose2", "bLoose3"}

Items == {"A", "B"}
PackageBuckets == {"loose", "box24"}

ItemOf(position) ==
  IF position \in {"aLoose1", "aLoose2", "aLoose3",
                   "aBox1", "aBox2", "aBox3"}
  THEN "A"
  ELSE "B"

PackageOf(position) ==
  IF position \in {"aBox1", "aBox2", "aBox3"}
  THEN "box24"
  ELSE "loose"

InitialQuantity(position) ==
  CASE position = "aLoose1" -> 4
    [] position = "aBox1"   -> 2
    [] position = "bLoose1" -> 3
    [] OTHER                 -> 0

MaxQuantity == 9

VARIABLE quantity

vars == <<quantity>>

SameConservationBucket(left, right) ==
  /\ ItemOf(left) = ItemOf(right)
  /\ PackageOf(left) = PackageOf(right)

Init ==
  quantity = [position \in Positions |-> InitialQuantity(position)]

Move(source, destination, amount) ==
  /\ source # destination
  /\ SameConservationBucket(source, destination)
  /\ amount \in 1..quantity[source]
  /\ quantity' =
       [quantity EXCEPT
          ![source] = @ - amount,
          ![destination] = @ + amount]

Split(source, destination1, destination2, amount1, amount2) ==
  /\ Cardinality({source, destination1, destination2}) = 3
  /\ SameConservationBucket(source, destination1)
  /\ SameConservationBucket(source, destination2)
  /\ amount1 \in 1..quantity[source]
  /\ amount2 \in 1..(quantity[source] - amount1)
  /\ quantity' =
       [quantity EXCEPT
          ![source] = @ - amount1 - amount2,
          ![destination1] = @ + amount1,
          ![destination2] = @ + amount2]

Merge(source1, source2, destination, amount1, amount2) ==
  /\ Cardinality({source1, source2, destination}) = 3
  /\ SameConservationBucket(source1, source2)
  /\ SameConservationBucket(source1, destination)
  /\ amount1 \in 1..quantity[source1]
  /\ amount2 \in 1..quantity[source2]
  /\ quantity' =
       [quantity EXCEPT
          ![source1] = @ - amount1,
          ![source2] = @ - amount2,
          ![destination] = @ + amount1 + amount2]

Next ==
  \/ \E source \in Positions,
        destination \in Positions,
        amount \in 1..MaxQuantity:
       Move(source, destination, amount)
  \/ \E source \in Positions,
        destination1 \in Positions,
        destination2 \in Positions,
        amount1 \in 1..MaxQuantity,
        amount2 \in 1..MaxQuantity:
       Split(source, destination1, destination2, amount1, amount2)
  \/ \E source1 \in Positions,
        source2 \in Positions,
        destination \in Positions,
        amount1 \in 1..MaxQuantity,
        amount2 \in 1..MaxQuantity:
       Merge(source1, source2, destination, amount1, amount2)

Spec == Init /\ [][Next]_vars

RECURSIVE PositionSum(_, _)
PositionSum(positionSet, values) ==
  IF positionSet = {}
  THEN 0
  ELSE LET position == CHOOSE candidate \in positionSet: TRUE
       IN values[position] + PositionSum(positionSet \ {position}, values)

TotalForItem(item, values) ==
  PositionSum(
    {position \in Positions : ItemOf(position) = item},
    values
  )

TotalForBucket(item, packageBucket, values) ==
  PositionSum(
    {position \in Positions :
       ItemOf(position) = item /\
       PackageOf(position) = packageBucket},
    values
  )

TypeOK ==
  quantity \in [Positions -> 0..MaxQuantity]

ItemQuantityConserved ==
  \A item \in Items:
    TotalForItem(item, quantity) =
      TotalForItem(item, [position \in Positions |-> InitialQuantity(position)])

PackagingBucketConserved ==
  \A item \in Items,
    packageBucket \in PackageBuckets:
    TotalForBucket(item, packageBucket, quantity) =
      TotalForBucket(
        item,
        packageBucket,
        [position \in Positions |-> InitialQuantity(position)]
      )

=============================================================================
