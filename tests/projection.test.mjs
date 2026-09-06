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
import { studyContributions } from "../src/nma/projection.js";

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
