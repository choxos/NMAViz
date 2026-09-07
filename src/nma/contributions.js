/* How much each comparison contributed to one network estimate.
 *
 * The flow along a comparison says how much evidence travels that way, but it
 * is not yet an answer to "which studies is this estimate resting on": a route
 * three comparisons long uses all three, and the credit has to be shared. The
 * standard construction splits the flow into paths, then splits each path's
 * share equally among the comparisons on it. What differs between methods is
 * how the paths are chosen.
 *
 *   shortest path  Take the shortest remaining route, drain it by its narrowest
 *                  comparison, repeat. Ruecker et al (2024) find this the most
 *                  stable and by far the fastest on large networks, and
 *                  recommend it in practice.
 *
 *   random walk    Let a walker start at the first treatment and step along the
 *                  flow, choosing each outgoing comparison with probability
 *                  proportional to its current, until it reaches the second.
 *                  Davies et al (2022) showed this has a closed form and none
 *                  of the path-selection ambiguity of the older algorithm.
 *
 * Both are computed here without enumerating paths: the shortest path method
 * drains at most one comparison per round, and the random walk is a dynamic
 * program over how many steps the walk has taken and how many it has left.
 */

import { flowPaths } from "./flow.js";
import { pathWeights } from "./path-weights.js";

const key = (edge) => `${edge.comparison.treat1} ${edge.comparison.treat2}`;

/* Each route's share, divided equally among the comparisons it uses. */
export function shortestPathContributions(flow) {
  const contributions = new Map(flow.edges.map((e) => [key(e), 0]));
  for (const path of flowPaths(flow, { limit: 5000 }))
    for (const edge of path.edges)
      contributions.set(key(edge), contributions.get(key(edge)) + path.share / path.length);
  return contributions;
}

/* The same quantity under the random walk, summed over path lengths rather
 * than over paths.
 *
 * Write A_k(u) for the probability that the walker stands at u after exactly k
 * steps, and B_l(v) for the probability that, starting from v, it reaches the
 * destination in exactly l more steps. A route that uses comparison u to v with
 * k steps before it and l steps after it has length k + 1 + l, so
 *
 *     contribution(u to v) = sum over k, l of  A_k(u) q(u,v) B_l(v) / (k+1+l)
 *
 * The flow network is acyclic, so no walk revisits a treatment and both k and l
 * are below the number of treatments. That makes this a small double sum rather
 * than a sum over the exponentially many paths.
 */
export function randomWalkContributions(flow, treatmentCount) {
  const outgoing = new Map();
  for (const edge of flow.edges) {
    if (edge.flow <= 1e-12) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  // At each treatment the walker splits the incoming evidence in proportion to
  // the currents leaving it.
  const transition = new Map();
  for (const [node, edges] of outgoing) {
    const total = edges.reduce((s, e) => s + e.flow, 0);
    for (const edge of edges) transition.set(`${edge.from}>${edge.to}`, edge.flow / total);
  }

  const steps = Math.max(1, treatmentCount);

  // Forward: where the walker is after k steps.
  const forward = [new Map([[flow.treat1, 1]])];
  for (let k = 1; k <= steps; k++) {
    const layer = new Map();
    for (const [node, mass] of forward[k - 1]) {
      if (node === flow.treat2) continue;
      for (const edge of outgoing.get(node) ?? []) {
        const q = transition.get(`${edge.from}>${edge.to}`);
        layer.set(edge.to, (layer.get(edge.to) ?? 0) + mass * q);
      }
    }
    forward.push(layer);
  }

  // Backward: how many steps are left from here.
  const backward = [new Map([[flow.treat2, 1]])];
  for (let l = 1; l <= steps; l++) {
    const layer = new Map();
    for (const [node, edges] of outgoing)
      for (const edge of edges) {
        const mass = backward[l - 1].get(edge.to);
        if (!mass) continue;
        const q = transition.get(`${edge.from}>${edge.to}`);
        layer.set(node, (layer.get(node) ?? 0) + q * mass);
      }
    backward.push(layer);
  }

  const contributions = new Map(flow.edges.map((e) => [key(e), 0]));
  for (const edge of flow.edges) {
    if (edge.flow <= 1e-12) continue;
    const q = transition.get(`${edge.from}>${edge.to}`);
    let total = 0;
    for (let k = 0; k <= steps; k++) {
      const before = forward[k].get(edge.from);
      if (!before) continue;
      for (let l = 0; l <= steps; l++) {
        const after = backward[l].get(edge.to);
        if (!after) continue;
        total += (before * q * after) / (k + 1 + l);
      }
    }
    contributions.set(key(edge), contributions.get(key(edge)) + total);
  }
  return contributions;
}

export function optimizedPathContributions(flow, method) {
  const result = pathWeights(flow, { method });
  const contributions = new Map(flow.edges.map((e) => [key(e), 0]));
  result.paths.forEach((path, p) => {
    for (const i of path) {
      const name = key(result.edges[i]);
      contributions.set(name, contributions.get(name) + result.weights[p] / path.length);
    }
  });
  return contributions;
}

export const CONTRIBUTION_METHODS = {
  shortestpath: {
    label: "Shortest path",
    compute: (flow) => shortestPathContributions(flow),
    note: "Take the shortest remaining route, drain it, repeat.",
  },
  l1: {
    label: "L1 optimization",
    compute: (flow) => optimizedPathContributions(flow, "l1"),
    note: "Minimize absolute path weights subject to reproducing every current. The optimum is one and is generally nonunique.",
  },
  l2: {
    label: "L2 pseudoinverse",
    compute: (flow) => optimizedPathContributions(flow, "l2"),
    note: "The unique minimum Euclidean norm solution can have negative path and edge weights. These are signed allocations, not probabilities.",
  },
  randomwalk: {
    label: "Random walk",
    compute: (flow, treatments) => randomWalkContributions(flow, treatments),
    note: "Follow the current at random, and average over every walk.",
  },
};
