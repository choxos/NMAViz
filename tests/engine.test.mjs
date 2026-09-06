/* The engine against netmeta.
 *
 * tests/fixtures holds what netmeta 3.6.1 computes for six networks; every
 * check below is the JavaScript engine's answer compared to that, not to
 * itself. Regenerate the fixtures with `Rscript scripts/fixtures.R`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures");

const load = (name) => JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));

const names = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

/* Fixture comparisons arrive as parallel columns, the shape jsonlite writes a
 * data frame in. */
const toRows = (columns) =>
  columns.treat1.map((_, i) => ({
    treat1: columns.treat1[i],
    treat2: columns.treat2[i],
    studlab: String(columns.studlab[i]),
    TE: columns.TE[i],
    seTE: columns.seTE[i],
  }));

function closeTo(actual, expected, tolerance, label) {
  if (expected === null || Number.isNaN(expected)) return;
  assert.ok(
    Number.isFinite(actual),
    `${label}: expected a finite number near ${expected}, got ${actual}`
  );
  const slack = tolerance * Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= slack,
    `${label}: ${actual} differs from netmeta's ${expected} by ${Math.abs(actual - expected)}`
  );
}

function matrixCloseTo(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label}: wrong number of rows`);
  expected.forEach((row, i) =>
    row.forEach((value, j) => closeTo(actual[i][j], value, tolerance, `${label}[${i}][${j}]`))
  );
}

for (const name of names) {
  const fixture = load(name);
  const rows = toRows(fixture.comparisons);

  test(`${name}: internal row order and multi-arm variance adjustment`, () => {
    const fit = fitNetwork(rows);
    const prepared = fixture.prepared;
    assert.equal(fit.rows.length, prepared.studlab.length);
    fit.rows.forEach((row, i) => {
      const label = `${name} row ${i}`;
      assert.equal(String(row.studlab), String(prepared.studlab[i]), `${label} studlab`);
      assert.equal(row.treat1, prepared.treat1[i], `${label} treat1`);
      assert.equal(row.treat2, prepared.treat2[i], `${label} treat2`);
      closeTo(row.TE, prepared.TE[i], 1e-10, `${label} TE`);
      closeTo(fit.common.variance[i], prepared["variance.adjusted"][i], 1e-9,
        `${label} adjusted variance`);
      assert.equal(fit.common.narms[i], prepared.narms[i], `${label} narms`);
    });
  });

  test(`${name}: treatments, Laplacian and its pseudoinverse`, () => {
    const fit = fitNetwork(rows);
    assert.deepEqual(fit.treatments, fixture.treatments);
    assert.equal(fit.treatments.length, fixture.n);
    assert.equal(fit.rows.length, fixture.m);
    assert.equal(fit.studies.length, fixture.k);
    matrixCloseTo(fit.common.L, fixture.common["L.matrix"], 1e-9, `${name} L`);
    matrixCloseTo(fit.common.Lplus, fixture.common["Lplus.matrix"], 1e-9, `${name} Lplus`);
  });

  test(`${name}: common effect estimates and standard errors`, () => {
    const fit = fitNetwork(rows);
    matrixCloseTo(fit.common.TE, fixture.common.TE, 1e-8, `${name} TE.common`);
    matrixCloseTo(fit.common.seTE, fixture.common.seTE, 1e-8, `${name} seTE.common`);
  });

  test(`${name}: heterogeneity, Q and tau squared`, () => {
    const fit = fitNetwork(rows);
    closeTo(fit.Q, fixture.Q, 1e-8, `${name} Q`);
    closeTo(fit.df, fixture["df.Q"], 1e-8, `${name} df`);
    closeTo(fit.tau2, fixture.tau2, 1e-7, `${name} tau2`);
    closeTo(fit.I2, fixture.I2, 1e-7, `${name} I2`);
  });

  test(`${name}: random effects estimates`, () => {
    const fit = fitNetwork(rows);
    matrixCloseTo(fit.random.TE, fixture.random.TE, 1e-7, `${name} TE.random`);
    matrixCloseTo(fit.random.seTE, fixture.random.seTE, 1e-7, `${name} seTE.random`);
  });

  test(`${name}: direct, indirect and the direct evidence proportion`, () => {
    const fit = fitNetwork(rows);
    const at = (matrix, a, b) =>
      matrix[fixture.treatments.indexOf(a)][fixture.treatments.indexOf(b)];
    // netmeta reports the pairwise measures over every pair in upper triangular
    // order; the engine reports them per observed edge, so index by name.
    const pairs = [];
    for (let i = 0; i < fixture.n - 1; i++)
      for (let j = i + 1; j < fixture.n; j++)
        pairs.push(`${fixture.treatments[i]} ${fixture.treatments[j]}`);

    for (const edge of fit.common.direct) {
      const key = `${edge.treat1} ${edge.treat2}`;
      closeTo(edge.TE, at(fixture.common["TE.direct"], edge.treat1, edge.treat2), 1e-8,
        `${name} TE.direct ${key}`);
      closeTo(edge.seTE, at(fixture.common["seTE.direct"], edge.treat1, edge.treat2), 1e-8,
        `${name} seTE.direct ${key}`);
      closeTo(edge.proportion, fixture.measures["proportion.direct"][pairs.indexOf(key)], 1e-8,
        `${name} direct evidence proportion ${key}`);
      closeTo(edge.indirectTE, at(fixture.common["TE.indirect"], edge.treat1, edge.treat2), 1e-7,
        `${name} TE.indirect ${key}`);
      closeTo(edge.indirectSe, at(fixture.common["seTE.indirect"], edge.treat1, edge.treat2), 1e-7,
        `${name} seTE.indirect ${key}`);
    }
  });

  if (fixture.common["H.matrix"]?.length) {
    test(`${name}: hat matrix`, () => {
      const fit = fitNetwork(rows);
      // netmeta reports the hat matrix back in the order of the input data,
      // while the engine holds it in the internal sort order, so map through
      // each row's recorded source position before comparing.
      const at = new Array(fit.rows.length);
      fit.rows.forEach((row, i) => (at[row.source] = i));
      const permuted = at.map((i) => at.map((j) => fit.common.H[i][j]));
      matrixCloseTo(permuted, fixture.common["H.matrix"], 1e-8, `${name} H`);
    });
  }
}

test("a disconnected network is refused with a readable message", () => {
  assert.throws(
    () =>
      fitNetwork([
        { studlab: "1", treat1: "A", treat2: "B", TE: 0.2, seTE: 0.3 },
        { studlab: "2", treat1: "C", treat2: "D", TE: 0.1, seTE: 0.3 },
      ]),
    /disconnected/
  );
});

test("a zero standard error is refused rather than dividing by zero", () => {
  assert.throws(
    () => fitNetwork([{ studlab: "1", treat1: "A", treat2: "B", TE: 0.2, seTE: 0 }]),
    /standard error/
  );
});
