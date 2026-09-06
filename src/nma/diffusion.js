/* Network meta-analysis as a diffusion.
 *
 * Ruecker, Davies and Schwarzer (2026) show that the covariance matrix of a
 * network meta-analysis, normally obtained by inverting the Laplacian, is also
 * the sum of a geometric series of diffusion matrices:
 *
 *     D  = the diagonal matrix of weighted degrees, d = diag(L)
 *     T  = I - L D^-1                     the simple walk
 *     T~ = (T + I) / 2                    the lazy walk, which converges on a
 *                                         bipartite network too
 *     T8 = d0 1'                          the limit, d0 = d / sum(d)
 *
 *     C  = (1/2) X D^-1 [ sum over i of (T~^i - T8) ] X'
 *
 * The series converges, so a partial sum is a real quantity and not just an
 * approximation of one: after k steps it is the covariance that a walker who
 * has taken at most k steps can account for. That makes the convergence
 * honestly animatable. What a reader watches is the standard error of a
 * comparison falling from the value the direct evidence alone supports towards
 * the value the whole network supports, one step of separation at a time.
 */

import { multiply, zeros } from "./matrix.js";

/* The diffusion matrices of a fitted model. */
export function diffusion(model) {
  const { L } = model;
  const n = L.length;
  const degree = L.map((row, i) => row[i]);
  const totalDegree = degree.reduce((s, d) => s + d, 0);

  // T = I - L D^-1. Column j is the walker's next-step distribution when it
  // stands at treatment j, so the columns sum to one.
  const T = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) T[i][j] = (i === j ? 1 : 0) - L[i][j] / degree[j];

  // The lazy walk leaves half the mass behind at each step. Without it the
  // sequence oscillates forever on a bipartite network, and star networks,
  // which are the commonest shape in practice, are bipartite.
  const lazy = T.map((row, i) => row.map((x, j) => (x + (i === j ? 1 : 0)) / 2));

  const limitColumn = degree.map((d) => d / totalDegree);
  const limit = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) limit[i][j] = limitColumn[i];

  return { degree, T, lazy, limit, limitColumn };
}

/* Where a walker starting at one treatment has spread to after each step. */
export function diffusionMass(model, start, steps = 24, { lazyWalk = true } = {}) {
  const { T, lazy } = diffusion(model);
  const step = lazyWalk ? lazy : T;
  const n = model.treatments.length;
  let mass = new Array(n).fill(0);
  mass[model.index.get(start)] = 1;

  const history = [mass];
  for (let k = 0; k < steps; k++) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) next[i] += step[i][j] * mass[j];
    mass = next;
    history.push(mass);
  }
  return history;
}

/* The partial sums of the series, as the quadratic form that gives a variance.
 *
 * Returns, for each k, the matrix M_k with
 *
 *     Var(a vs b) after k steps = M_k[a][a] + M_k[b][b] - M_k[a][b] - M_k[b][a]
 *
 * which converges to the effective resistance between a and b, that is, to the
 * variance of the network estimate.
 */
export function diffusionPartials(model, steps = 60) {
  const { degree, lazy, limit } = diffusion(model);
  const n = degree.length;

  const partials = [];
  let power = null; // T~^i
  let running = zeros(n, n); // sum of (T~^i - T8)

  for (let i = 0; i <= steps; i++) {
    power = i === 0 ? identityMatrix(n) : multiply(lazy, power);
    running = running.map((row, r) => row.map((x, c) => x + power[r][c] - limit[r][c]));
    // M = (1/2) D^-1 * running, which is the running sum with each row divided
    // by that treatment's weighted degree.
    partials.push(running.map((row, r) => row.map((x) => x / (2 * degree[r]))));
  }
  return partials;
}

const identityMatrix = (n) => {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
};

export const varianceFrom = (M, a, b) => M[a][a] + M[b][b] - M[a][b] - M[b][a];
