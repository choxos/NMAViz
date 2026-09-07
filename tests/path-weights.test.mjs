import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathWeights } from "../src/nma/path-weights.js";
import { optimizedPathContributions, randomWalkContributions, shortestPathContributions } from "../src/nma/contributions.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/path-methods/linde2016.json", import.meta.url)));
function flowOf(row) {
  const [treat1, treat2] = row.contrast.split(":");
  return { treat1, treat2, edges: fixture.edges.map((name, i) => {
    const [a, b] = name.split(":");
    return { comparison: { treat1: a, treat2: b }, from: row.h[i] >= 0 ? a : b, to: row.h[i] >= 0 ? b : a, flow: Math.abs(row.h[i]) };
  }) };
}
const sum = (values) => [...values].reduce((total, value) => total + value, 0);
const valuesOf = (map) => fixture.edges.map((name) => map.get(name.replace(":", " ")) ?? 0);

test("L2 reproduces every entry of the supplied Linde2016 matrix, including negative edges", () => {
  let negative = 0;
  for (const row of fixture.rows) {
    const values = valuesOf(optimizedPathContributions(flowOf(row), "l2"));
    values.forEach((value, i) => {
      assert.ok(Math.abs(value - row.l2[i]) < 1e-9, `${row.contrast}, ${fixture.edges[i]}`);
      if (value < -1e-10) negative++;
    });
  }
  assert.equal(negative, 50);
});

test("random walks reproduce all supplied entries; shortest paths retain their valid tie-dependent allocations", () => {
  let exactShortest = 0;
  for (const row of fixture.rows) {
    const flow = flowOf(row);
    const walk = valuesOf(randomWalkContributions(flow, 22));
    const shortest = valuesOf(shortestPathContributions(flow));
    walk.forEach((value, i) => assert.ok(Math.abs(value - row.randomwalk[i]) < 1e-9));
    assert.ok(Math.abs(sum(shortest) - 1) < 1e-9);
    assert.ok(shortest.every((value) => value >= 0));
    if (shortest.every((value, i) => Math.abs(value - row.shortest[i]) < 1e-9)) exactShortest++;
    for (const method of ["shortest", "randomwalk", "l1", "l2"])
      assert.ok(Math.abs(sum(row[method]) - 1) < 1e-8, `supplied ${method} matrix must sum to one`);
  }
  assert.ok(exactShortest >= 40);
});

test("L1 globally minimizes its objective with certified flow reconstruction, independently of nonunique cccp weights", () => {
  for (const row of fixture.rows) {
    const result = pathWeights(flowOf(row), { method: "l1" });
    assert.equal(result.paths.length, row.paths);
    assert.ok(result.weights.every((weight) => weight >= 0));
    assert.ok(result.residual < 1e-9);
    assert.ok(Math.abs(result.l1 - 1) < 1e-8);
    const values = valuesOf(optimizedPathContributions(flowOf(row), "l1"));
    assert.ok(Math.abs(sum(values) - sum(row.l1)) < 1e-8);
    assert.ok(values.every((weight) => weight >= 0));
    assert.ok(pathWeights(flowOf(row)).l2 <= result.l2 + 1e-9);
  }
});

test("exact solvers report exhausted bounds and nonconvergence instead of silently substituting methods", () => {
  assert.throws(() => pathWeights(flowOf(fixture.rows[0]), { maxPaths: 1 }), /exceeds 1 paths/);
  assert.throws(() => pathWeights(flowOf(fixture.rows[0]), { method: "l1", maxIterations: 0 }), /did not converge/);
  assert.throws(() => pathWeights(flowOf(fixture.rows[0]), { method: "other" }), /Unknown/);
});
