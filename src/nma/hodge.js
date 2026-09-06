/* The Hodge decomposition of a network's inconsistency.
 *
 * Treat the pooled direct estimates as a flow on the edges of the treatment
 * graph, weighted by their precisions. Combinatorial Hodge theory (Jiang, Lim,
 * Yao and Ye, 2011) splits any such flow into three orthogonal parts:
 *
 *   gradient   the part that is the difference of a score attached to each
 *              treatment. In network meta-analysis this is exactly the
 *              consistency model: the scores are the fitted treatment effects
 *              and the gradient is the fitted direct estimate on every edge.
 *
 *   curl       the part of what is left that closes up around triangles. This
 *              is loop inconsistency of the familiar kind: three treatments
 *              whose three direct comparisons do not add to zero.
 *
 *   harmonic   what remains. It is inconsistency that lives on cycles no
 *              combination of triangles can reach, so it is invisible to any
 *              triangle-by-triangle check and appears only in networks with
 *              long loops and no chords.
 *
 * The three are orthogonal in the precision-weighted inner product, so their
 * squared lengths add, and the sum of the second and the third is the
 * between-comparison inconsistency the model already reports. That is what
 * makes this a decomposition of a familiar number rather than a new one.
 *
 * A caution the interface repeats: this is computed on the aggregated direct
 * estimates, one per comparison. Within-comparison heterogeneity is not part of
 * it, and the multi-arm weight reduction that keeps the model's estimates
 * correct does change what the edge weights mean here, so the split should be
 * read as a diagnostic and not as a replacement for a design-by-treatment
 * interaction model.
 */

import { edgeWeights } from "./flow.js";
import { eigenSymmetric, multiply, pseudoinverseSymmetric, transpose, zeros } from "./matrix.js";

/* Every set of three treatments that are all directly compared with each
 * other. These are the loops a triangle-by-triangle check can see. */
export function triangles(model) {
  const present = new Set(model.direct.map((e) => `${e.treat1}|${e.treat2}`));
  const has = (a, b) =>
    present.has(`${a}|${b}`) || present.has(`${b}|${a}`);
  const found = [];
  const n = model.treatments.length;
  for (let i = 0; i < n - 2; i++)
    for (let j = i + 1; j < n - 1; j++) {
      if (!has(model.treatments[i], model.treatments[j])) continue;
      for (let k = j + 1; k < n; k++)
        if (has(model.treatments[i], model.treatments[k]) &&
            has(model.treatments[j], model.treatments[k]))
          found.push([i, j, k]);
    }
  return found;
}

/* The rank of a symmetric matrix, counted from its eigenvalues against a
 * tolerance scaled to the largest of them, which is the only scale-free way to
 * decide what counts as zero. */
function rank(A, tolerance = 1e-9) {
  if (!A.length) return 0;
  const { values } = eigenSymmetric(A);
  const largest = Math.max(...values.map(Math.abs), 0);
  if (!(largest > 0)) return 0;
  return values.filter((v) => Math.abs(v) > tolerance * largest).length;
}

export function hodge(model) {
  const edges = model.direct;
  const m = edges.length;
  const n = model.treatments.length;
  const at = (t) => model.index.get(t);

  // The observed flow: one direct estimate per comparison, oriented from the
  // first treatment to the second, with the precision the model itself put on
  // that comparison.
  //
  // The weights have to be the model's own, which are the sums of the
  // multi-arm adjusted study weights, and the estimates have to be pooled with
  // those same weights. Anything else, including the published direct estimate
  // pooled on the studies' original standard errors, leaves a residual that is
  // not orthogonal to the consistency fit, and then the three parts no longer
  // decompose anything.
  const aggregate = edgeWeights(model);
  const weight = edges.map((e) => aggregate.get(`${e.treat1} ${e.treat2}`) ?? 0);
  const totals = edges.map(() => 0);
  const position = new Map(edges.map((e, i) => [`${e.treat1} ${e.treat2}`, i]));
  model.rows.forEach((row, r) => {
    const forward = position.get(`${row.treat1} ${row.treat2}`);
    const index = forward ?? position.get(`${row.treat2} ${row.treat1}`);
    const sign = forward != null ? 1 : -1;
    totals[index] += model.w[r] * sign * row.TE;
  });
  const observed = totals.map((total, i) => total / weight[i]);

  // The gradient part is the consistency model's own fitted values, which the
  // engine has already computed: the difference of the two network estimates.
  const gradient = edges.map((e) => model.TE[at(e.treat1)][at(e.treat2)]);
  const residual = observed.map((y, i) => y - gradient[i]);

  // Curl operator on triangles, oriented i to j to k to i.
  const loops = triangles(model);
  const signedIndex = (a, b) => {
    const forward = position.get(`${model.treatments[a]} ${model.treatments[b]}`);
    if (forward != null) return { index: forward, sign: 1 };
    const backward = position.get(`${model.treatments[b]} ${model.treatments[a]}`);
    return backward == null ? null : { index: backward, sign: -1 };
  };

  const C = zeros(loops.length, m);
  loops.forEach(([i, j, k], row) => {
    for (const [a, b] of [
      [i, j],
      [j, k],
      [k, i],
    ]) {
      const entry = signedIndex(a, b);
      if (entry) C[row][entry.index] += entry.sign;
    }
  });

  // Project the residual onto the curl space. The adjoint of curl in the
  // weighted inner product is W^-1 C', so the projection solves
  // C W^-1 C' z = C r, and the curl part is W^-1 C' z. It is orthogonal to
  // every gradient because the curl of a gradient is zero.
  let curl = new Array(m).fill(0);
  if (loops.length) {
    const Ct = transpose(C);
    const scaledCt = Ct.map((row, e) => row.map((x) => x / weight[e]));
    const normal = multiply(C, scaledCt);
    const target = C.map((row) => row.reduce((s, x, e) => s + x * residual[e], 0));
    // The normal matrix is singular whenever the triangles are not independent,
    // which is the usual case, so the projection needs a true pseudoinverse
    // rather than the Laplacian shortcut.
    const z = multiply(pseudoinverseSymmetric(normal), target.map((t) => [t])).map((row) => row[0]);
    curl = scaledCt.map((row) => row.reduce((s, x, t) => s + x * z[t], 0));
  }
  const harmonic = residual.map((r, i) => r - curl[i]);

  const energy = (values) => values.reduce((s, v, i) => s + weight[i] * v * v, 0);
  const loopEnergy = loops.map(([i, j, k], row) => {
    // How far the three direct estimates are from closing, which is what a
    // reader means by an inconsistent loop.
    const gap = C[row].reduce((s, x, e) => s + x * observed[e], 0);
    return {
      treatments: [model.treatments[i], model.treatments[j], model.treatments[k]],
      indices: [i, j, k],
      gap,
      // The share of the curl energy this triangle's own edges carry.
      energy: C[row].reduce((s, x, e) => s + (x !== 0 ? weight[e] * curl[e] ** 2 : 0), 0),
    };
  });

  // The dimension of the harmonic space, which is the first Betti number of the
  // clique complex: edges, minus the gradients, minus the curls.
  //
  // This matters more than it sounds. When it is zero there is no such thing as
  // inconsistency that triangles cannot see, and the harmonic part of every
  // network is exactly zero rather than merely small. Reporting an energy of
  // 1e-30 without saying that leaves a reader to wonder whether their network
  // happens to be clean; the truth is that its shape has no room for the thing
  // being measured. Every network bundled with this site is of that kind.
  const rankOfCurl = loops.length ? rank(multiply(C, transpose(C))) : 0;
  const harmonicDimension = Math.max(0, m - Math.max(0, n - 1) - rankOfCurl);

  return {
    edges,
    observed,
    weight,
    gradient,
    residual,
    curl,
    harmonic,
    harmonicDimension,
    loops: loopEnergy.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)),
    triangleCount: loops.length,
    energyTotal: energy(observed),
    energyGradient: energy(gradient),
    energyResidual: energy(residual),
    energyCurl: energy(curl),
    energyHarmonic: energy(harmonic),
  };
}
