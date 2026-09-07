import { test } from "node:test";
import assert from "node:assert/strict";
import { fitNetwork } from "../src/nma/model.js";
import { bipartiteFlow } from "../src/nma/bipartite.js";

// Davies (2026), Table 3 and equation 22 onward. Paper uses second-minus-first.
const trials = [
  [["a", "b"], [1, 2], [.2, .3]],
  [["a", "b", "c"], [.8, 2.1, 1.5], [.4, .6, .5]],
  [["a", "d"], [1.2, 1.5], [.8, .9]],
  [["b", "c", "d"], [2, 1.6, 1.2], [1.2, 1.1, 1]],
  [["c", "d"], [1.4, .9], [.5, .4]],
];
const rows = trials.flatMap(([names, means, variances], k) => names.flatMap((treat1, i) =>
  names.slice(i + 1).map((treat2, offset) => {
    const j = i + offset + 1;
    return { studlab: String(k + 1), treat1, treat2, TE: means[i] - means[j], seTE: Math.sqrt(variances[i] + variances[j]) };
  })));
const supplied = Object.fromEntries(trials.map(([names, , variances], k) =>
  [String(k + 1), Object.fromEntries(names.map((t, i) => [t, variances[i]]))]));
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("Davies paper arm coefficients, block GLS equivalence and all conservation laws", () => {
  const model = fitNetwork(rows).common;
  const flow = bipartiteFlow(model, "a", "b", { armVariances: supplied });
  assert.ok(flow.supported);
  near(flow.blockError, 0);
  const paper = [-.607, .607, -.319, .294, .025, -.074, .074, .099, -.041, -.059, .016, -.016];
  flow.studies.flatMap((s) => s.arms).forEach((arm, i) => (near(arm.coefficient, -paper[i], .001), near(arm.netCrossings, arm.coefficient)));
  for (const trial of flow.studies) near(trial.arms.reduce((s, a) => s + a.coefficient, 0), 0);
  for (const t of model.treatments) near(flow.studies.flatMap((s) => s.arms).filter((a) => a.treatment === t).reduce((s, a) => s + a.coefficient, 0), t === "a" ? 1 : t === "b" ? -1 : 0);
  near(flow.reconstructed, model.TE[0][1]);
  let armEstimate = 0;
  flow.studies.forEach((trial, k) => trial.arms.forEach((arm) => {
    const i = trials[k][0].indexOf(arm.treatment);
    armEstimate += arm.coefficient * (trials[k][1][i] + 1000 * (k + 1));
  }));
  near(armEstimate, model.TE[0][1]);
  for (const row of [...flow.upward, ...flow.downward, ...flow.projected]) near(row.reduce((s, x) => s + x, 0), 1);
  near(flow.downward[0][0], .6);
  near(flow.upward[0][0], 5 / (5 + 2.5 + 1.25));
});

test("equal-split two-arm representation is explicit and does not alter coefficients", () => {
  const model = fitNetwork(rows.map((r) => r.studlab === "1" ? { ...r, TE: r.TE + 10 } : r)).random;
  assert.ok(model.tau > 0);
  const equal = bipartiteFlow(model, "a", "b");
  const actual = bipartiteFlow(model, "a", "b", { armVariances: supplied });
  assert.ok(equal.equalSplit);
  assert.equal(actual.equalSplit, false);
  near(equal.blockError, 0);
  near(actual.blockError, 0);
  assert.deepEqual(equal.studies.map((s) => s.arms.map((a) => a.coefficient)), actual.studies.map((s) => s.arms.map((a) => a.coefficient)));
});

test("invalid independent arm representation is unavailable rather than fabricated", () => {
  const model = fitNetwork(rows).common;
  const invalid = { ...supplied, "2": { a: -.1, b: 1.1, c: 1 } };
  const flow = bipartiteFlow(model, "a", "b", { armVariances: invalid });
  assert.equal(flow.supported, false);
  assert.equal(flow.projected, null);
  assert.equal(flow.studies[1].arms[0].weight, null);
  near(flow.reconstructed, model.TE[0][1]);
});
