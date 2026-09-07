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

/* The multivariate within-design projection matches netmeta for every fixture. */
test("Q splits into within-design and between-design parts, as netmeta splits it", () => {
  for (const name of names) {
    const fixture = load(name);
    const fit = fitNetwork(toRows(fixture.prepared));
    const decomp = fixture.decomp?.["Q.decomp"];
    if (!decomp) continue;

    assert.ok(fit.Qheterogeneity >= 0, `${name}: within-design Q is negative`);
    assert.ok(fit.Qinconsistency >= 0, `${name}: between-design Q is negative`);
    assert.ok(
      Math.abs(fit.Qheterogeneity + fit.Qinconsistency - fit.Q) < 1e-9,
      `${name}: the two parts do not add to the total`
    );

    const tolerance = 1e-7;
    assert.ok(
      Math.abs(fit.Qheterogeneity - decomp.Q[1]) < tolerance,
      `${name}: within-design Q is ${fit.Qheterogeneity}, netmeta says ${decomp.Q[1]}`
    );
    assert.ok(
      Math.abs(fit.Qinconsistency - decomp.Q[2]) < tolerance,
      `${name}: between-design Q is ${fit.Qinconsistency}, netmeta says ${decomp.Q[2]}`
    );
  }
});


function multiarm(studlab, means, variances) {
  return means.flatMap((_, i) => means.slice(i + 1).map((__, offset) => {
    const j = i + offset + 1;
    return { studlab, treat1: "ABCD"[i], treat2: "ABCD"[j],
      TE: means[i] - means[j], seTE: Math.sqrt(variances[i] + variances[j]) };
  }));
}

test("reversing and relabeling multi-arm contrasts preserves estimates, uncertainty and source rows", () => {
  const rows = [...multiarm("multi", [0, 1, 3, 6], [1, 2, 4, 8]),
    { studlab: "ab", treat1: "A", treat2: "B", TE: 3, seTE: 1 }];
  const fit = fitNetwork(rows);
  for (const labels of ["ABCD", "DCBA"]) {
    const rename = t => labels["ABCD".indexOf(t)];
    const changed = rows.map((r, i) => ({ ...r,
      treat1: rename(i % 2 ? r.treat1 : r.treat2),
      treat2: rename(i % 2 ? r.treat2 : r.treat1), TE: i % 2 ? r.TE : -r.TE }));
    const other = fitNetwork(changed);
    for (const model of ["common", "random"]) {
      for (const a of fit.treatments) for (const b of fit.treatments) {
        const i = fit[model].index.get(a), j = fit[model].index.get(b);
        const x = other[model].index.get(rename(a)), y = other[model].index.get(rename(b));
        closeTo(other[model].TE[x][y], fit[model].TE[i][j], 1e-9, "oriented estimate");
        closeTo(other[model].seTE[x][y], fit[model].seTE[i][j], 1e-9, "oriented SE");
      }
    }
    closeTo(other.Q, fit.Q, 1e-9, "Q");
    for (const row of other.rows) assert.deepEqual({ ...row, source: undefined },
      { ...changed[row.source], source: undefined });
  }
});

test("one design has no inconsistency, including unequal-variance multi-arm studies", () => {
  for (const rows of [
    [{ studlab: "1", treat1: "A", treat2: "B", TE: 0, seTE: 1 },
      { studlab: "2", treat1: "B", treat2: "A", TE: -2, seTE: 1 }],
    [...multiarm("1", [0, 1, 3], [1, 2, 10]), ...multiarm("2", [0, 4, 2], [10, 2, 1])],
  ]) {
    const fit = fitNetwork(rows);
    closeTo(fit.Qheterogeneity, fit.Q, 1e-10, "within-design Q");
    closeTo(fit.Qinconsistency, 0, 1e-10, "between-design Q");
  }
});

test("incomplete, duplicated, and invalid covariance studies are refused", () => {
  const valid = multiarm("trial", [0, 1, 3, 6], [1, 2, 4, 8]);
  assert.throws(() => fitNetwork(valid.slice(0, 3)), /every pairwise/);
  assert.throws(() => fitNetwork([valid[0], valid[0], valid[1]]), /duplicate/i);
  const invalid = multiarm("trial", [0, 1, 3], [1, 1, 1]);
  invalid[2].seTE = 10;
  assert.throws(() => fitNetwork(invalid), /variance|covariance|weight/i);
  const singular = multiarm("trial", [0, 1, 3], [1, 1, 1]);
  [1, 1, 4].forEach((v, i) => singular[i].seTE = Math.sqrt(v));
  assert.throws(() => fitNetwork(singular), /singular/i);
  assert.throws(() => fitNetwork([{ ...valid[0], seTE: Infinity }]), /standard error/);
  assert.throws(() => fitNetwork([{ ...valid[0], treat2: "A" }]), /itself/);
});


test("multi-arm effects must close every triangle, allowing three-decimal reporting precision", () => {
  const rows = multiarm("incoherent", [0, 0, 0], [1, 1, 1]);
  rows[2].TE = 3;
  assert.throws(() => fitNetwork(rows), /incoherent.*inconsistent.*effects/i);
  const rounded = multiarm("rounded", [0, 0.3334, 0.6668], [1, 1, 1]);
  rounded.forEach(row => row.TE = Math.round(row.TE * 1000) / 1000);
  assert.doesNotThrow(() => fitNetwork(rounded));
  const reversed = rounded.map(row => ({ ...row, treat1: row.treat2,
    treat2: row.treat1, TE: -row.TE }));
  matrixCloseTo(fitNetwork(reversed).common.TE, fitNetwork(rounded).common.TE, 1e-10, "rounded orientation");
  rounded[2].TE += 0.01;
  assert.throws(() => fitNetwork(rounded), /inconsistent.*effects/i);
});
