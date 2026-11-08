---
title: Binary search
description: A logarithmic algorithm for finding a value in a sorted sequence.
publish: true
tags: [computing, algorithms]
created: 2026-11-08
---
**Binary search** locates a value in a sorted sequence by repeatedly discarding half of the remaining candidates. Its central idea is an **invariant**: if the target exists, it remains in the interval still being searched.

## Algorithm

The following Python function returns the index of a target, or `None` if it is absent. The interval uses an exclusive upper bound.

```python
def binary_search(values, target):
    low, high = 0, len(values)
    while low < high:
        middle = low + (high - low) // 2
        if values[middle] < target:
            low = middle + 1
        else:
            high = middle
    if low < len(values) and values[low] == target:
        return low
    return None
```

## Complexity

After $k$ iterations, the interval contains at most $\lceil n/2^k\rceil$ candidates. The running time is therefore $O(\log n)$, with constant auxiliary space.

| Input condition | Behavior |
| --- | --- |
| Empty sequence | Returns `None` |
| Present target | Returns its first index |
| Repeated values | Finds the leftmost match |
| Unsorted sequence | Precondition violated; no guarantee |

> [!warning] Check the precondition
> The sequence must be sorted according to the comparison used by the algorithm.

## Connections

An invariant plays a role similar to a maintained mathematical assumption in [[mathematics/Linear algebra|linear algebra]]. A written trace helps connect the implementation to its proof.

![[academic/Study notes#Questions before conclusions]]

## Try a trace

Search for `13` in `[2, 5, 8, 13, 21, 34]`. Record the bounds and midpoint on each iteration. The unusual word **intervalhalving** is included here as a content-only search example.
