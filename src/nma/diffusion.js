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
 * has taken at most k steps can account for. Partial variances rise toward
 * the full variance; they are not valid interim confidence intervals.
 */

import { apply, inverse, multiply, transpose, zeros } from "./matrix.js";

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

/* Davies et al. (2022), supplement F-G: visits exclude the final arrival.
 * T uses column-source orientation throughout this module. */
export function absorbingWalk(model, start, finish, steps = 24) {
  const a = model.index.get(start);
  const b = model.index.get(finish);
  if (a == null || b == null || a === b) throw new Error("Choose two different treatments.");
  if (!Number.isInteger(steps) || steps < 0) throw new Error("Steps must be a nonnegative integer.");
  const { T } = diffusion(model);
  const transient = model.treatments.map((_, i) => i).filter((i) => i !== b);
  const fundamental = inverse(transient.map((i) => transient.map((j) => (i === j ? 1 : 0) - T[i][j])));
  const visits = model.treatments.map((_, i) => i === b ? 0 : fundamental[transient.indexOf(i)][transient.indexOf(a)]);
  const transition = T.map((row, i) => row.map((x, j) => j === b ? Number(i === b) : x));
  let mass = model.treatments.map((_, i) => Number(i === a));
  const history = [mass];
  for (let k = 0; k < steps; k++) {
    mass = apply(transition, mass);
    history.push(mass);
  }
  const crossings = model.direct.map((edge) => {
    const i = model.index.get(edge.treat1), j = model.index.get(edge.treat2);
    const forward = visits[i] * T[j][i], backward = visits[j] * T[i][j];
    return { treat1: edge.treat1, treat2: edge.treat2, forward, backward, net: forward - backward };
  });
  return { transition, fundamental, visits, history, crossings, expectedSteps: visits.reduce((s, x) => s + x, 0) };
}

/* Ruecker et al. (2026), equations 3-4 and section 3.3.1. Convergence is
 * checked on the transition remainder, not inferred from an animation budget. */
export function diffusionEstimates(model, { maxSteps = 300, tolerance = 1e-10 } = {}) {
  if (!Number.isInteger(maxSteps) || maxSteps < 0 || !Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Provide a nonnegative step limit and a positive finite tolerance.");
  const { degree, lazy, limit } = diffusion(model);
  const n = degree.length;
  let power = identityMatrix(n), M = zeros(n, n);
  const rhs = model.treatments.map((_, i) => model.rows.reduce((s, row, r) => s + model.B[r][i] * model.w[r] * row.TE, 0));
  const history = [];
  let converged = false;
  for (let step = 0; step <= maxSteps; step++) {
    M = M.map((row, i) => row.map((x, j) => x + (power[i][j] - limit[i][j]) / (2 * degree[i])));
    const potentials = apply(M, rhs);
    const TE = potentials.map((x) => potentials.map((y) => x - y));
    const residual = Math.max(...power.flatMap((row, i) => row.map((x, j) => Math.abs(x - limit[i][j]))));
    history.push({ step, TE, residual, M });
    if (residual <= tolerance) { converged = true; break; }
    power = multiply(lazy, power);
  }
  const covariance = multiply(multiply(model.B, M), transpose(model.B));
  const H = covariance.map((row) => row.map((x, j) => x * model.w[j]));
  return { history, M, covariance, H, fitted: apply(H, model.rows.map((row) => row.TE)), converged,
    status: converged ? "converged" : "step-limit", residual: history.at(-1).residual, tolerance };
}
