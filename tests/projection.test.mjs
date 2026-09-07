/* Study-level contributions, held to the identities that make them worth
 * showing: they must add to the network estimate exactly, their treatment
 * balances must add to the target contrast, and the information matrix they are
 * built from must be the model's own Laplacian.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { reconstruction } from "../src/app/lenses/reconstruction.js";
import { studyContributions, canonicalEdges } from "../src/nma/projection.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(here, "..", "src", "data", "examples.json"), "utf8")
);

const modelOf = (c) =>
  fitNetwork(
    c.studlab.map((_, i) => ({
      studlab: String(c.studlab[i]),
      treat1: c.treat1[i],
      treat2: c.treat2[i],
      TE: c.TE[i],
      seTE: c.seTE[i],
    }))
  ).common;

for (const example of examples) {
  const model = modelOf(example.contrasts);
  const pairs = [];
  for (let i = 0; i < model.treatments.length - 1; i++)
    for (let j = i + 1; j < model.treatments.length; j++)
      pairs.push([model.treatments[i], model.treatments[j]]);
  const sample = pairs.slice(0, 10);

  test(`${example.id}: the study contributions rebuild the network estimate`, () => {
    for (const [a, b] of sample) {
      const projection = studyContributions(model, a, b);
      const expected = model.TE[model.index.get(a)][model.index.get(b)];
      assert.ok(
        Math.abs(projection.total - expected) < 1e-7 * Math.max(1, Math.abs(expected)),
        `${example.id} ${a} vs ${b}: the contributions add to ${projection.total}, but the estimate is ${expected}`
      );
      // Direct plus indirect is the same total, by construction.
      assert.ok(
        Math.abs(projection.direct.total + projection.indirect.total - projection.total) < 1e-9,
        `${example.id} ${a} vs ${b}: the direct and indirect parts do not add to the whole`
      );
    }
  });

  test(`${example.id}: the treatment balances add to the target contrast`, () => {
    for (const [a, b] of sample) {
      const projection = studyContributions(model, a, b);
      const total = new Array(model.treatments.length).fill(0);
      for (const study of projection.studies)
        study.balance.forEach((x, i) => (total[i] += x));
      total.forEach((value, i) => {
        const expected = i === model.index.get(a) ? 1 : i === model.index.get(b) ? -1 : 0;
        assert.ok(
          Math.abs(value - expected) < 1e-8,
          `${example.id} ${a} vs ${b}: the balance at ${model.treatments[i]} is ${value}, expected ${expected}`
        );
      });
    }
  });

  test(`${example.id}: the direct weight is between zero and one`, () => {
    for (const [a, b] of sample) {
      const projection = studyContributions(model, a, b);
      assert.ok(
        projection.direct.weight >= -1e-9 && projection.direct.weight <= 1 + 1e-9,
        `${example.id} ${a} vs ${b}: the direct weight is ${projection.direct.weight}`
      );
      for (const study of projection.studies)
        assert.ok(
          study.directWeight >= -1e-12,
          `${example.id} ${a} vs ${b}: ${study.studlab} has a negative direct weight`
        );
    }
  });
}

test("a study that made the comparison carries its own effect directly", () => {
  const model = modelOf({
    studlab: ["one", "two", "three"],
    treat1: ["A", "A", "B"],
    treat2: ["B", "C", "C"],
    TE: [1, 0.5, -0.4],
    seTE: [0.2, 0.3, 0.3],
  });
  const projection = studyContributions(model, "A", "B");
  const own = projection.studies.find((s) => s.studlab === "one");
  assert.ok(own.directWeight > 0.5, `the only A versus B study has weight ${own.directWeight}`);
  assert.ok(
    Math.abs(own.direct - own.directWeight * 1) < 1e-9,
    "its direct contribution should be its weight times its own effect"
  );
});


test("random-effects reconstruction retains between-study covariance", () => {
  const model = fitNetwork([
    { studlab: "one", treat1: "A", treat2: "B", TE: 0, seTE: 1 },
    { studlab: "two", treat1: "A", treat2: "B", TE: 10, seTE: 1 },
  ]).random;
  const result = studyContributions(model, "A", "B");
  assert.ok(Math.abs(result.direct.seTE - model.seTE[0][1]) < 1e-9);
});

test("canonical study-labelled paths exhaust residual edges and rebuild each example", () => {
  for (const example of examples) {
    const model = modelOf(example.contrasts);
    const [a, b] = model.treatments;
    const result = studyContributions(model, a, b);
    if (result.indirect.weight > 1e-8) assert.ok(result.paths.length > 0);
    assert.ok(result.pathResidual < 1e-8);
    assert.ok(Math.abs(result.paths.reduce((s, p) => s + p.contribution, 0) - result.indirect.total) < 1e-7);
    assert.ok(Math.abs(result.paths.reduce((s, p) => s + p.weight, 0) - result.indirect.weight) < 1e-8);
    for (const path of result.paths) {
      assert.equal(path.edges[0].from, a);
      assert.equal(path.edges.at(-1).to, b);
      assert.ok(path.edges.every(e => e.studlab));
    }
  }
});


test("canonical residual allocation chooses largest transfer and fixed pair ties", () => {
  const edges = canonicalEdges([0.4, 0.6, -0.7, -0.3], ["A", "B", "C", "D"], "A", "D", "trial");
  assert.deepEqual(edges.map(e => [e.from, e.to]), [["A", "D"], ["B", "C"], ["A", "C"]]);
  assert.ok(Math.abs(edges[1].weight - 0.6) < 1e-12);
  const ties = canonicalEdges([0.5, 0.5, -0.5, -0.5], ["B", "A", "D", "C"], "C", "A", "trial");
  assert.deepEqual(ties.map(e => [e.from, e.to]), [["A", "C"], ["B", "D"]]);
});

test("canonical labelled paths are invariant to input row order and contrast orientation", () => {
  const rows = [
    { studlab: "ab", treat1: "A", treat2: "B", TE: 1, seTE: 1 },
    { studlab: "bc", treat1: "B", treat2: "C", TE: 2, seTE: 1 },
    { studlab: "ac", treat1: "A", treat2: "C", TE: 4, seTE: 1 },
  ];
  const left = studyContributions(fitNetwork(rows).common, "A", "C");
  const right = studyContributions(fitNetwork(rows.reverse().map(r => ({ ...r, treat1: r.treat2, treat2: r.treat1, TE: -r.TE }))).common, "A", "C");
  assert.deepEqual(left.paths, right.paths);
});


test("Wang running example: canonical direct 2/3, indirect path 1/3, estimate 1/3", () => {
  const rows = [
    ["1", "A", "B", 1], ["1", "A", "C", 2], ["1", "B", "C", 1],
    ["2", "A", "B", 2], ["3", "A", "C", 1],
  ].map(([studlab, treat1, treat2, TE]) => ({ studlab, treat1, treat2, TE, seTE: Math.sqrt(2) }));
  const result = studyContributions(fitNetwork(rows).common, "B", "C");
  assert.ok(Math.abs(result.direct.weight - 2 / 3) < 1e-10);
  assert.ok(Math.abs(result.indirect.weight - 1 / 3) < 1e-10);
  assert.ok(Math.abs(result.total - 1 / 3) < 1e-10);
  assert.equal(result.paths.length, 1);
  assert.deepEqual(result.paths[0].edges.map(e => [e.studlab, e.from, e.to]), [["2", "B", "A"], ["3", "A", "C"]]);
  assert.ok(Math.abs(result.direct.seTE - Math.sqrt(2)) < 1e-10);
  assert.ok(Math.abs(result.indirect.seTE - 2) < 1e-10);
});


test("rounded multi-arm nonclosure has an effect residual despite exhausted coefficients", () => {
  for (const rounding of [0, 0.000001]) {
    const rows = [["A", "B", 1], ["A", "C", 2], ["B", "C", 1 + rounding]]
      .map(([treat1, treat2, TE]) => ({ studlab: "rounded", treat1, treat2, TE, seTE: Math.sqrt(2) }));
    const model = fitNetwork(rows).common;
    const projection = studyContributions(model, "A", "B");
    assert.ok(projection.pathResidual < 1e-10);
    assert.ok(Math.abs(projection.effectResidual + rounding / 3) < 1e-10);
    assert.ok(Math.abs(projection.canonicalTotal + projection.effectResidual - model.TE[0][1]) < 1e-10);
    const view = reconstruction.draw({ model, state: { contrast: { treat1: "A", treat2: "B" } },
      measure: "MD", width: 900, height: 700, dataset: {} });
    assert.match(view.inspector, /Effect reconstruction residual/);
    if (rounding) {
      assert.match(view.inspector, /do not exactly reconstruct/);
      assert.doesNotMatch(view.inspector, /agrees within numerical precision/);
    } else assert.match(view.inspector, /agrees within numerical precision/);
  }
});
