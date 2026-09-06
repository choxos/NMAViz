/* The Hodge decomposition, checked as a decomposition.
 *
 * The claims worth testing are structural rather than numeric: the three parts
 * must add back to the observed flow, they must be orthogonal in the
 * precision-weighted inner product, their squared lengths must therefore add,
 * and the curl part must vanish on a network with no triangle while the
 * harmonic part must vanish on a network whose loops are all triangles.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { hodge, triangles } from "../src/nma/hodge.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(here, "..", "src", "data", "examples.json"), "utf8")
);

const modelOf = (rows) => fitNetwork(rows).common;
const rowsOf = (c) =>
  c.studlab.map((_, i) => ({
    studlab: String(c.studlab[i]),
    treat1: c.treat1[i],
    treat2: c.treat2[i],
    TE: c.TE[i],
    seTE: c.seTE[i],
  }));

const dot = (weight, a, b) => a.reduce((s, x, i) => s + weight[i] * x * b[i], 0);

for (const example of examples) {
  const model = modelOf(rowsOf(example.contrasts));

  test(`${example.id}: the three parts add back to the observed flow`, () => {
    const h = hodge(model);
    h.observed.forEach((y, i) => {
      const rebuilt = h.gradient[i] + h.curl[i] + h.harmonic[i];
      assert.ok(
        Math.abs(y - rebuilt) < 1e-9,
        `edge ${i}: ${rebuilt} does not rebuild the observed ${y}`
      );
    });
  });

  test(`${example.id}: the parts are orthogonal and their energies add`, () => {
    const h = hodge(model);
    const scale = Math.max(h.energyTotal, 1e-9);
    assert.ok(
      Math.abs(dot(h.weight, h.gradient, h.curl)) < 1e-7 * scale,
      "the gradient and curl parts are not orthogonal"
    );
    assert.ok(
      Math.abs(dot(h.weight, h.gradient, h.harmonic)) < 1e-7 * scale,
      "the gradient and harmonic parts are not orthogonal"
    );
    assert.ok(
      Math.abs(dot(h.weight, h.curl, h.harmonic)) < 1e-7 * scale,
      "the curl and harmonic parts are not orthogonal"
    );
    assert.ok(
      Math.abs(h.energyResidual - (h.energyCurl + h.energyHarmonic)) < 1e-7 * scale,
      `the residual energy ${h.energyResidual} is not the curl ${h.energyCurl} plus the harmonic ${h.energyHarmonic}`
    );
  });

  test(`${example.id}: the residual energy is the model's own between-comparison Q`, () => {
    const h = hodge(model);
    // Cochran's Q splits into a part within each comparison and a part between
    // them. The Hodge residual is exactly that second part, so computing it the
    // other way round has to give the same number.
    let within = 0;
    const pooled = new Map(h.edges.map((e, i) => [`${e.treat1} ${e.treat2}`, h.observed[i]]));
    model.rows.forEach((row, r) => {
      const forward = pooled.has(`${row.treat1} ${row.treat2}`);
      const centre = forward
        ? pooled.get(`${row.treat1} ${row.treat2}`)
        : -pooled.get(`${row.treat2} ${row.treat1}`);
      within += model.w[r] * (row.TE - centre) ** 2;
    });
    const between = model.Q - within;
    assert.ok(
      Math.abs(h.energyResidual - between) < 1e-7 * Math.max(1, Math.abs(between)),
      `${example.id}: the residual energy is ${h.energyResidual} but Q leaves ${between} between comparisons`
    );
  });

  test(`${example.id}: a network with no triangle has no curl`, () => {
    const h = hodge(model);
    if (triangles(model).length === 0)
      assert.ok(
        h.energyCurl < 1e-12,
        `${example.id} has no triangle but a curl energy of ${h.energyCurl}`
      );
  });
}

test("a single triangle puts all of its inconsistency in the curl", () => {
  // Three treatments, three comparisons, and effects that do not close: the
  // whole residual is around the one triangle, so nothing is left over.
  const model = modelOf([
    { studlab: "1", treat1: "A", treat2: "B", TE: 1, seTE: 1 },
    { studlab: "2", treat1: "B", treat2: "C", TE: 1, seTE: 1 },
    { studlab: "3", treat1: "A", treat2: "C", TE: 0, seTE: 1 },
  ]);
  const h = hodge(model);
  assert.equal(h.triangleCount, 1);
  assert.ok(h.energyResidual > 0.1, "this network is supposed to be inconsistent");
  assert.ok(
    h.energyHarmonic < 1e-10,
    `a single triangle should leave no harmonic part, but it has ${h.energyHarmonic}`
  );
    // Going A to B to C and back to A should return to where it started. Here it
  // gains 1 + 1 and gives back 0, so the loop fails to close by 2.
  assert.ok(Math.abs(h.loops[0].gap - 2) < 1e-9, `the loop gap is ${h.loops[0].gap}`);
});

test("a square with no chord puts its inconsistency in the harmonic part", () => {
  // Four treatments in a ring. There is no triangle, so no triangle-by-triangle
  // check can see the inconsistency around the ring; Hodge calls it harmonic.
  const model = modelOf([
    { studlab: "1", treat1: "A", treat2: "B", TE: 1, seTE: 1 },
    { studlab: "2", treat1: "B", treat2: "C", TE: 1, seTE: 1 },
    { studlab: "3", treat1: "C", treat2: "D", TE: 1, seTE: 1 },
    { studlab: "4", treat1: "A", treat2: "D", TE: 0, seTE: 1 },
  ]);
  const h = hodge(model);
  assert.equal(h.triangleCount, 0);
  assert.ok(h.energyCurl < 1e-12, "a network with no triangle cannot have curl");
  assert.ok(
    h.energyHarmonic > 0.1,
    `the ring is inconsistent, so the harmonic part should carry it, not ${h.energyHarmonic}`
  );
});
