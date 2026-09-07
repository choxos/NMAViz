/* The flow of evidence through the network, for one comparison at a time.
 *
 * Koenig, Krahn and Binder (2013) observed that a row of the hat matrix says
 * exactly how much each comparison contributes to one network estimate, and
 * that those coefficients behave like a flow: they are the currents that run in
 * the network when one unit of current is injected at the first treatment and
 * drawn out at the second. Orienting each comparison the way its current runs
 * turns the network into a directed acyclic graph, and the picture then reads
 * as what it is: the evidence travelling from one treatment to the other.
 *
 * The current on the comparison between treatments i and j, for the network
 * estimate of a versus b, is
 *
 *     f_ij = w_ij * ( Lplus[a][i] - Lplus[a][j] - Lplus[b][i] + Lplus[b][j] )
 *
 * where w_ij is the total precision on that comparison. This is the entry of
 * the comparison-aggregated hat matrix, and Kirchhoff's current law holds at
 * every treatment: what flows in flows out, except at the two endpoints.
 */

/* The precision on each comparison, which is the sum of the weights of the
 * studies that report it. Multi-arm studies contribute their adjusted weights,
 * so this is the quantity that reproduces the Laplacian exactly, and it can
 * differ slightly from the precision of the pooled direct estimate. */
export function edgeWeights(model) {
  const weights = new Map();
  model.rows.forEach((row, i) => {
    const [a, b] =
      model.index.get(row.treat1) < model.index.get(row.treat2)
        ? [row.treat1, row.treat2]
        : [row.treat2, row.treat1];
    const key = `${a} ${b}`;
    weights.set(key, (weights.get(key) ?? 0) + model.w[i]);
  });
  return weights;
}

/* The evidence flow network for one comparison, with every edge oriented the
 * way its current runs. */
export function evidenceFlow(model, treat1, treat2) {
  const a = model.index.get(treat1);
  const b = model.index.get(treat2);
  if (a == null || b == null) return null;
  const { Lplus } = model;
  const weights = edgeWeights(model);

  const edges = model.direct.map((edge) => {
    const i = model.index.get(edge.treat1);
    const j = model.index.get(edge.treat2);
    const w = weights.get(`${edge.treat1} ${edge.treat2}`) ?? 0;
    const current = w * (Lplus[a][i] - Lplus[a][j] - Lplus[b][i] + Lplus[b][j]);
    // Draw the edge in the direction the current runs, so that an arrow always
    // points the way the evidence travels.
    const forward = current >= 0;
    return {
      comparison: edge,
      from: forward ? edge.treat1 : edge.treat2,
      to: forward ? edge.treat2 : edge.treat1,
      flow: Math.abs(current),
      signed: current,
      isTarget:
        (edge.treat1 === treat1 && edge.treat2 === treat2) ||
        (edge.treat1 === treat2 && edge.treat2 === treat1),
    };
  });

  // Koenig's three measures, computed over the comparisons rather than over
  // the designs. The two agree whenever no multi-arm study is involved; where
  // one is, netmeta groups a multi-arm study's comparisons into a single design
  // first, and the mean path length can differ.
  const direct = edges.find((e) => e.isTarget);
  const total = edges.reduce((s, e) => s + e.flow, 0);
  const largest = Math.max(...edges.map((e) => e.flow));

  // Two readings of "how much of this is direct evidence", which agree unless a
  // multi-arm study sits on the comparison.
  //
  // The current along the direct comparison is the hat matrix entry: the share
  // of this estimate that actually travels along that edge, on the same weights
  // the whole model uses. The published direct evidence proportion is instead
  // the ratio of variances, network over direct, and the direct variance is
  // computed on the studies' original standard errors rather than on their
  // multi-arm adjusted ones. Where a multi-arm study is involved the two
  // quantities are answering slightly different questions, so both are reported
  // rather than one being quietly preferred.
  const published = model.direct.find(
    (e) =>
      (e.treat1 === treat1 && e.treat2 === treat2) ||
      (e.treat1 === treat2 && e.treat2 === treat1)
  );

  return {
    treat1,
    treat2,
    edges,
    directFlow: direct ? direct.flow : 0,
    directProportion: published ? published.proportion : 0,
    // How many comparisons an average unit of evidence passes through.
    meanPathLength: total,
    // How many independent streams the evidence travels along, at its
    // narrowest point.
    minimalParallelism: largest > 0 ? 1 / largest : Infinity,
  };
}

/* Split the flow into the paths that carry it, by repeatedly taking the
 * shortest remaining path from the first treatment to the second and draining
 * it by the smallest flow along that path.
 *
 * This is the shortestpath decomposition of Ruecker et al (2024). It always
 * terminates, because each round removes at least one edge, and it is the
 * decomposition they recommend in practice for its speed and stability. The
 * result is a set of routes with the share of the estimate each one carries,
 * which is what a reader means when they ask where an estimate came from.
 */
export function flowPaths(flow, { limit = 60 } = {}) {
  const remaining = new Map(
    flow.edges.filter((e) => e.flow > 1e-12).map((e) => [`${e.from}>${e.to}`, e.flow])
  );
  const outgoing = new Map();
  for (const edge of flow.edges) {
    if (edge.flow <= 1e-12) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }

  const paths = [];
  while (paths.length < limit) {
    const route = shortestRoute(outgoing, remaining, flow.treat1, flow.treat2);
    if (!route) break;
    const carried = Math.min(...route.map((e) => remaining.get(`${e.from}>${e.to}`)));
    if (!(carried > 1e-12)) break;
    for (const e of route) {
      const key = `${e.from}>${e.to}`;
      const left = remaining.get(key) - carried;
      if (left <= 1e-12) remaining.delete(key);
      else remaining.set(key, left);
    }
    paths.push({
      treatments: [flow.treat1, ...route.map((e) => e.to)],
      edges: route,
      share: carried,
      length: route.length,
    });
  }
  return paths.sort((a, b) => b.share - a.share);
}

/* Breadth-first search over the edges that still carry flow. The flow network
 * is acyclic, so the first route found is a shortest one. */
function shortestRoute(outgoing, remaining, start, finish) {
  const queue = [[start, []]];
  const seen = new Set([start]);
  while (queue.length) {
    const [node, route] = queue.shift();
    for (const edge of outgoing.get(node) ?? []) {
      if (!remaining.has(`${edge.from}>${edge.to}`)) continue;
      if (edge.to === finish) return [...route, edge];
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push([edge.to, [...route, edge]]);
    }
  }
  return null;
}

/* Koenig et al. (2013), sections 3.3.1 and 3.4: clique net flow is
 * half the L1 norm of its treatment injections, independent of contrast coding. */
export function flowMeasures(model, treat1, treat2) {
  const a = model.index.get(treat1), b = model.index.get(treat2);
  if (a == null || b == null || a === b) throw new Error("Choose two different treatments.");
  const studies = new Map();
  model.rows.forEach((row, r) => {
    if (!studies.has(row.studlab)) studies.set(row.studlab, { name: row.studlab, treatments: new Set(), injection: new Array(model.n).fill(0) });
    const study = studies.get(row.studlab);
    study.treatments.add(row.treat1).add(row.treat2);
    const i = model.index.get(row.treat1), j = model.index.get(row.treat2);
    const h = model.w[r] * (model.Lplus[a][i] - model.Lplus[a][j] - model.Lplus[b][i] + model.Lplus[b][j]);
    study.injection[i] += h;
    study.injection[j] -= h;
  });
  const designs = new Map();
  const netFlow = (injection) => injection.reduce((s, x) => s + Math.abs(x), 0) / 2;
  for (const study of studies.values()) {
    study.flow = netFlow(study.injection);
    const key = JSON.stringify([...study.treatments].sort());
    if (!designs.has(key)) designs.set(key, { name: [...study.treatments].sort().join(" / "), injection: new Array(model.n).fill(0) });
    const design = designs.get(key);
    study.injection.forEach((x, i) => { design.injection[i] += x; });
  }
  for (const design of designs.values()) design.flow = netFlow(design.injection);
  const studyFlows = [...studies.values()], designFlows = [...designs.values()];
  return { studyFlows, designFlows,
    studyParallelism: 1 / Math.max(...studyFlows.map((s) => s.flow)),
    designParallelism: 1 / Math.max(...designFlows.map((d) => d.flow)),
    meanPathLength: designFlows.reduce((s, d) => s + d.flow, 0) };
}
