---
title: Linear algebra
description: Vectors, linear transformations, and the geometry of systems of equations.
publish: true
tags: [mathematics, foundations]
created: 2026-11-08
---
**Linear algebra** studies vectors, vector spaces, and linear transformations. It provides a common language for geometry, scientific computing, and data analysis.

## Vectors and coordinates

A vector in the plane can be written as $\mathbf{v}=(v_1,v_2)$. Addition and multiplication by a scalar preserve the vector space structure.

![[assets/coordinate-plane.png|A coordinate plane showing a blue vector from the origin.]]

For vectors $\mathbf{u},\mathbf{v}\in\mathbb{R}^n$, their dot product is

$$
\mathbf{u}\cdot\mathbf{v}=\sum_{i=1}^{n}u_i v_i.
$$

### Length and orthogonality

The Euclidean norm is $\lVert\mathbf{v}\rVert=\sqrt{\mathbf{v}\cdot\mathbf{v}}$. Nonzero vectors are orthogonal when their dot product is zero.

## Linear transformations

A transformation $T$ is linear if $T(a\mathbf{u}+b\mathbf{v})=aT(\mathbf{u})+bT(\mathbf{v})$. In coordinates, a matrix describes this transformation:

$$
\begin{pmatrix}2&0\\0&3\end{pmatrix}
\begin{pmatrix}x\\y\end{pmatrix}
=\begin{pmatrix}2x\\3y\end{pmatrix}.
$$

> [!example] A geometric interpretation
> The matrix above stretches horizontal distances by two and vertical distances by three.

## Working with evidence

Keep definitions separate from observed examples. A numerical experiment can suggest a pattern, while a proof explains why the pattern holds.[^proof]

Connections to computation include [[programming/Binary search|binary search]] and its use of invariants. For a general workflow, read [[academic/Study notes]].

[^proof]: A demonstration on finitely many inputs does not establish a universal claim.
