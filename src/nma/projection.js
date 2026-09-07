/* Which studies produced this estimate, with the sign and the size.
 *
 * A contribution matrix says what share of an estimate each comparison is
 * responsible for, but shares are unsigned and they do not add up to the
 * estimate. This does. Following Wang, Zhang, Jin and O'Connor (2026), the
 * network estimate for a versus b is written as a plain sum over studies
 *
 *     theta(a vs b) = sum over studies k of C_k
 *
 * where C_k is a signed number in the units of the outcome: a study with a
 * positive C_k pushed the estimate up by that much, one with a negative C_k
 * pulled it down. There is no residual and no normalization, and the interface
 * shows the column adding up.
 *
 * The construction, with c = e_a - e_b:
 *
 *     u    = L^+ c                       L is the model's own Laplacian
 *     p_kr = w_kr * (x_kr . u)           one coefficient per contrast row
 *     C_k  = sum over the study's rows of p_kr * y_kr
 *     b_k  = sum over the study's rows of p_kr * x_kr
 *
 * and then sum_k C_k is exactly the model's estimate and sum_k b_k is exactly
 * c, because both statements are just L^+ L c = c written out study by study.
 *
 * Reduced-weight and reduced-dimension GLS are equivalent for coherent complete
 * multi-arm contrasts and their covariance. The covariance below includes the
 * fitted heterogeneity and retains correlations between direct and indirect.
 */

import { pseudoinverseSymmetric } from "./matrix.js";

/* The covariance of the pairwise contrasts a study reports.
 *
 * For a p-arm study the p(p-1)/2 contrasts are linearly dependent, so this
 * matrix is singular; that is fine, because it is only ever used inside a
 * quadratic form. The off-diagonal entries follow from the arm variances:
 *
 *     Cov(y_ij, y_kl) = (V_il - V_ik + V_jk - V_jl) / 2
 *
 * where V is the matrix of contrast variances with zero on the diagonal.
 */
export function studyCovariance(rows, tau = 0) {
  const arms = [...new Set(rows.flatMap((r) => [r.treat1, r.treat2]))];
  const position = new Map(arms.map((t, i) => [t, i]));
  const V = arms.map(() => arms.map(() => 0));
  for (const row of rows) {
    const i = position.get(row.treat1);
    const j = position.get(row.treat2);
    V[i][j] = row.seTE ** 2 + tau ** 2;
    V[j][i] = row.seTE ** 2 + tau ** 2;
  }
  const ends = rows.map((row) => [position.get(row.treat1), position.get(row.treat2)]);
  return rows.map((rowP, p) =>
    rows.map((rowQ, q) => {
      const [i, j] = ends[p];
      const [k, l] = ends[q];
      if (p === q) return V[i][j];
      return (V[i][l] - V[i][k] + V[j][k] - V[j][l]) / 2;
    })
  );
}

// Wang section 2.2: direct first, then maximum feasible endpoint transfer.
// The fixed treatment ordering breaks exact ties independently of row order.
export function canonicalEdges(balance, treatments, treat1, treat2, studlab) {
  const supply = balance.map(x => Math.max(0, x));
  const demand = balance.map(x => Math.max(0, -x));
  const order = treatments.map((_, i) => i).sort((i, j) => treatments[i].localeCompare(treatments[j], "en"));
  const edges = [];
  const transfer = (i, j, weight, direct) => {
    if (weight <= 1e-12) return;
    edges.push({ from: treatments[i], to: treatments[j], studlab, weight, direct });
    supply[i] -= weight;
    demand[j] -= weight;
  };
  const a = treatments.indexOf(treat1), b = treatments.indexOf(treat2);
  transfer(a, b, Math.min(supply[a], demand[b]), true);
  while (true) {
    let best = null;
    for (const i of order) for (const j of order) {
      const weight = Math.min(supply[i], demand[j]);
      if (weight > 1e-12 && (!best || weight > best.weight)) best = { i, j, weight };
    }
    if (!best) break;
    transfer(best.i, best.j, best.weight, false);
  }
  return edges;
}

// Widest path first; a sorted depth-first traversal of edges above the widest
// threshold resolves ties by treatment and study label without enumerating paths.
function studyPaths(edges, source, target, treatments) {
  const residual = edges.filter(e => !e.direct).map(e => ({ ...e, remaining: e.weight }));
  residual.sort((a, b) => a.to.localeCompare(b.to, "en") || a.studlab.localeCompare(b.studlab, "en") || a.from.localeCompare(b.from, "en"));
  const paths = [];
  while (true) {
    const capacity = new Map(treatments.map(t => [t, 0]));
    capacity.set(source, Infinity);
    for (let i = 0; i < treatments.length - 1; i++) {
      let changed = false;
      for (const edge of residual) {
        const candidate = Math.min(capacity.get(edge.from), edge.remaining);
        if (candidate > capacity.get(edge.to)) { capacity.set(edge.to, candidate); changed = true; }
      }
      if (!changed) break;
    }
    const weight = capacity.get(target);
    if (!(weight > 1e-12)) break;
    const visit = (node, seen) => {
      if (node === target) return [];
      for (const edge of residual) {
        if (edge.from !== node || edge.remaining < weight || seen.has(edge.to)) continue;
        const next = visit(edge.to, new Set([...seen, edge.to]));
        if (next) return [edge, ...next];
      }
      return null;
    };
    const route = visit(source, new Set([source]));
    if (!route) break;
    for (const edge of route) edge.remaining -= weight;
    const estimate = route.reduce((s, e) => s + e.estimate, 0);
    paths.push({ weight, estimate, contribution: weight * estimate,
      edges: route.map(({ remaining, ...edge }) => edge) });
  }
  return { paths, pathResidual: residual.reduce((s, e) => s + e.remaining, 0) };
}

/* Signed, covariance-aware contributions of every study to one network
 * estimate, split into the part that runs along the comparison itself and the
 * part that comes round through the rest of the network. */
export function studyContributions(model, treat1, treat2) {
  const n = model.treatments.length;
  const at = (t) => model.index.get(t);
  const a = at(treat1);
  const b = at(treat2);
  if (a == null || b == null) return null;

  const c = new Array(n).fill(0);
  c[a] = 1;
  c[b] = -1;
  const u = pseudoinverseSymmetric(model.L).map((row) =>
    row.reduce((s, x, j) => s + x * c[j], 0)
  );

  const byStudy = new Map();
  model.rows.forEach((row, index) => {
    if (!byStudy.has(row.studlab)) byStudy.set(row.studlab, []);
    byStudy.get(row.studlab).push(index);
  });

  const studies = [...byStudy.entries()].map(([studlab, indices]) => {
    const rows = indices.map((i) => model.rows[i]);
    const arms = [...new Set(rows.flatMap((r) => [r.treat1, r.treat2]))].sort((x, y) =>
      x.localeCompare(y, "en")
    );

    // p_r = w_r * (x_r . u), the coefficient this contrast row carries.
    const p = indices.map((i) => {
      const row = model.rows[i];
      return model.w[i] * (u[at(row.treat1)] - u[at(row.treat2)]);
    });

    const contribution = p.reduce((s, x, r) => s + x * rows[r].TE, 0);

    const balance = new Array(n).fill(0);
    rows.forEach((row, r) => {
      balance[at(row.treat1)] += p[r];
      balance[at(row.treat2)] -= p[r];
    });

    // The part that runs along the comparison itself, if this study made it.
    const target = rows.findIndex(
      (row) =>
        (row.treat1 === treat1 && row.treat2 === treat2) ||
        (row.treat1 === treat2 && row.treat2 === treat1)
    );
    const directWeight =
      target === -1 ? 0 : Math.min(Math.max(balance[a], 0), Math.max(-balance[b], 0));
    const sign = target === -1 ? 0 : rows[target].treat1 === treat1 ? 1 : -1;

    const d = rows.map(() => 0);
    if (target !== -1) d[target] = directWeight * sign;
    const direct = target === -1 ? 0 : directWeight * sign * rows[target].TE;

    const edges = canonicalEdges(balance, model.treatments, treat1, treat2, studlab).map(edge => {
      const index = rows.findIndex(row => (row.treat1 === edge.from && row.treat2 === edge.to) || (row.treat2 === edge.from && row.treat1 === edge.to));
      if (index < 0) throw new Error("Canonical projection requires complete within-study contrasts.");
      const sign = rows[index].treat1 === edge.from ? 1 : -1;
      return { ...edge, estimate: sign * rows[index].TE };
    });

    return {
      edges,
      studlab,
      arms,
      rows,
      p,
      d,
      balance,
      contribution,
      direct,
      indirect: contribution - direct,
      directWeight,
      observed: target === -1 ? null : sign * rows[target].TE,
      observedSe: target === -1 ? null : rows[target].seTE,
      covariance: studyCovariance(rows, model.tau),
    };
  });

  const quadratic = (V, left, right) =>
    left.reduce((s, x, i) => s + x * right.reduce((t, z, j) => t + V[i][j] * z, 0), 0);

  let varianceDirect = 0;
  let varianceIndirect = 0;
  let covariance = 0;
  for (const study of studies) {
    const indirectCoefficients = study.p.map((x, i) => x - study.d[i]);
    varianceDirect += quadratic(study.covariance, study.d, study.d);
    varianceIndirect += quadratic(
      study.covariance,
      indirectCoefficients,
      indirectCoefficients
    );
    covariance += quadratic(study.covariance, study.d, indirectCoefficients);
  }

  const weightDirect = studies.reduce((s, r) => s + r.directWeight, 0);
  const weightIndirect = 1 - weightDirect;
  const totalDirect = studies.reduce((s, r) => s + r.direct, 0);
  const totalIndirect = studies.reduce((s, r) => s + r.indirect, 0);

  const part = (weight, total, variance) => ({
    weight,
    total,
    estimate: weight > 1e-9 ? total / weight : NaN,
    seTE: weight > 1e-9 ? Math.sqrt(Math.max(0, variance)) / weight : NaN,
  });

  const pathDecomposition = studyPaths(studies.flatMap(study => study.edges), treat1, treat2, model.treatments);
  const canonicalTotal = totalDirect + pathDecomposition.paths.reduce((sum, path) => sum + path.contribution, 0);
  // Rounded within-study contrasts may not close exactly even when every
  // canonical coefficient is exhausted. Preserve that effect-scale discrepancy.
  const effectResidual = model.TE[a][b] - canonicalTotal;

  return {
    treat1,
    treat2,
    ...pathDecomposition,
    canonicalTotal,
    effectResidual,
    studies: studies.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution)),
    total: totalDirect + totalIndirect,
    direct: part(weightDirect, totalDirect, varianceDirect),
    indirect: part(weightIndirect, totalIndirect, varianceIndirect),
    covariance,
    // The difference between the two parts, with their covariance kept, which
    // is the honest way to ask whether they disagree.
    seDifference:
      weightDirect > 1e-9 && weightIndirect > 1e-9
        ? Math.sqrt(
            Math.max(
              0,
              varianceDirect / weightDirect ** 2 +
                varianceIndirect / weightIndirect ** 2 -
                (2 * covariance) / (weightDirect * weightIndirect)
            )
          )
        : NaN,
  };
}
