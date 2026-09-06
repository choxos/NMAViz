/* The diffusion series, against the model it is supposed to reproduce.
 *
 * The theorem says the geometric series of diffusion matrices gives the same
 * covariance matrix as inverting the Laplacian, so that is exactly what is
 * checked: the partial sums must converge to the effective resistances that the
 * engine computes the other way.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { diffusion, diffusionMass, diffusionPartials, varianceFrom } from "../src/nma/diffusion.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(here, "..", "src", "data", "examples.json"), "utf8")
);

const modelOf = (example) => {
  const c = example.contrasts;
  return fitNetwork(
    c.studlab.map((_, i) => ({
      studlab: String(c.studlab[i]),
      treat1: c.treat1[i],
      treat2: c.treat2[i],
      TE: c.TE[i],
      seTE: c.seTE[i],
    }))
  ).common;
};

for (const example of examples) {
  const model = modelOf(example);

  test(`${example.id}: the diffusion matrix is a transition matrix`, () => {
    const { T, lazy } = diffusion(model);
    const n = model.treatments.length;
    for (let j = 0; j < n; j++) {
      const column = T.reduce((s, row) => s + row[j], 0);
      assert.ok(Math.abs(column - 1) < 1e-9, `column ${j} of T sums to ${column}`);
      const lazyColumn = lazy.reduce((s, row) => s + row[j], 0);
      assert.ok(Math.abs(lazyColumn - 1) < 1e-9, `column ${j} of the lazy walk sums to ${lazyColumn}`);
      for (let i = 0; i < n; i++)
        assert.ok(lazy[i][j] >= -1e-12, `the lazy walk has a negative probability at ${i}, ${j}`);
    }
  });

  test(`${example.id}: the series converges to the variances the Laplacian gives`, () => {
    const partials = diffusionPartials(model, 300);
    const last = partials.at(-1);
    const n = model.treatments.length;
    let worst = 0;
    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++)
        worst = Math.max(worst, Math.abs(varianceFrom(last, i, j) - model.resistance[i][j]));
    assert.ok(
      worst < 1e-6,
      `${example.id}: the series is still ${worst} away from the exact variances after 300 steps`
    );
  });

  test(`${example.id}: diffusing mass is conserved`, () => {
    const history = diffusionMass(model, model.treatments[0], 30);
    for (const [step, mass] of history.entries()) {
      const total = mass.reduce((s, m) => s + m, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `step ${step} holds ${total} of the mass`);
    }
    // The lazy walk settles on the weighted degree distribution.
    const { limitColumn } = diffusion(model);
    const settled = diffusionMass(model, model.treatments[0], 2000).at(-1);
    settled.forEach((mass, i) =>
      assert.ok(
        Math.abs(mass - limitColumn[i]) < 1e-6,
        `${model.treatments[i]} settles at ${mass}, not at its degree share ${limitColumn[i]}`
      )
    );
  });
}
