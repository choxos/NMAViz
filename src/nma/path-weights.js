import { apply, pseudoinverseSymmetric, zeros } from "./matrix.js";

// Rücker et al. (2024), equations 4, 6, 7. Orienting every edge with its
// current makes Z nonnegative without changing either optimization problem.
export function pathWeights(flow, { method = "l2", maxPaths = 5000, maxIterations = 10000 } = {}) {
  if (!["l1", "l2"].includes(method)) throw new Error("Unknown path-weight method.");
  const edges = flow.edges.filter((e) => e.flow > 1e-12);
  if (!edges.length || flow.treat1 === flow.treat2) throw new Error("Select distinct connected treatments.");
  if (edges.length > 150) throw new Error("Exact path optimization is limited to 150 active comparisons. Choose shortest path or random walk.");
  const outgoing = new Map();
  edges.forEach((edge, i) => {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(i);
  });
  const paths = [];
  function visit(node, route, seen) {
    if (node === flow.treat2) {
      if (paths.length >= maxPaths) throw new Error(`Exact path optimization exceeds ${maxPaths} paths. Choose shortest path or random walk.`);
      paths.push(route);
      return;
    }
    for (const i of outgoing.get(node) ?? []) {
      if (seen.has(edges[i].to)) throw new Error("Path optimization requires an acyclic evidence flow.");
      visit(edges[i].to, [...route, i], new Set([...seen, edges[i].to]));
    }
  }
  visit(flow.treat1, [], new Set([flow.treat1]));
  if (!paths.length) throw new Error("No evidence path joins the selected treatments.");

  // Work in edge space: Z (Z'Z)+ h avoids a quadratic matrix in path count.
  const gram = zeros(edges.length, edges.length);
  for (const path of paths) for (const i of path) for (const j of path) gram[i][j]++;
  const inverse = pseudoinverseSymmetric(gram);
  const edgeTotals = (x) => {
    const totals = new Array(edges.length).fill(0);
    paths.forEach((path, p) => { for (const i of path) totals[i] += x[p]; });
    return totals;
  };
  const project = (x) => {
    const totals = edgeTotals(x);
    const correction = apply(inverse, edges.map((edge, i) => edge.flow - totals[i]));
    return paths.map((path, p) => x[p] + path.reduce((sum, i) => sum + correction[i], 0));
  };
  const residual = (x) => Math.max(...edgeTotals(x).map((value, i) => Math.abs(value - edges[i].flow)));
  let weights = project(new Array(paths.length).fill(0));
  let iterations = 0;
  if (method === "l1") {
    // ADMM for min ||z||_1 subject to Z'phi=h, phi=z. Affine projection
    // and soft thresholding are the two exact proximal steps. Unlike cccp,
    // this solver chooses its own member of the generally nonunique optimum.
    let z = new Array(paths.length).fill(0);
    const dual = new Array(paths.length).fill(0);
    let threshold = 1 / paths.length;
    for (; iterations < maxIterations; iterations++) {
      const phi = project(z.map((value, p) => value - dual[p]));
      const previous = z;
      z = phi.map((value, p) => {
        const v = value + dual[p];
        return Math.sign(v) * Math.max(0, Math.abs(v) - threshold);
      });
      phi.forEach((value, p) => { dual[p] += value - z[p]; });
      if (iterations % 25 === 24) {
        const primal = Math.hypot(...phi.map((value, p) => value - z[p]));
        const dualResidual = Math.hypot(...z.map((value, p) => value - previous[p])) / threshold;
        const factor = primal > 10 * dualResidual ? 0.5 : dualResidual > 10 * primal ? 2 : 1;
        threshold *= factor;
        for (let p = 0; p < dual.length; p++) dual[p] *= factor;
      }
      const norm = z.reduce((sum, value) => sum + Math.abs(value), 0);
      // Unit total is a lower bound on the L1 objective (paper Appendix B.3).
      // Feasibility plus nonnegativity and this bound certify global optimality.
      if (Math.min(...z) >= 0 && residual(z) < 1e-9 && Math.abs(norm - 1) < 1e-8) {
        weights = z;
        break;
      }
    }
    if (iterations === maxIterations) throw new Error("L1 optimization did not converge to a certified solution. Choose shortest path or random walk.");
  }
  const error = residual(weights);
  if (error > 1e-8) throw new Error("Path weights failed to reconstruct the evidence flow.");
  return { paths, edges, weights, residual: error, iterations, l1: weights.reduce((sum, x) => sum + Math.abs(x), 0), l2: Math.hypot(...weights) };
}
