import test from "node:test";
import assert from "node:assert/strict";
import { maic, maicMoments, maicContrast, aggregateBinaryLogLikelihood, populationExample, populationPoints, fitPopulation, standardizePopulation, conditionalLikelihood, integratedLikelihood, validatePopulationData } from "../src/nma/population.js";
import { populationLens } from "../src/app/lenses/population.js";

test("MAIC solves scalar and joint moment balance, reports ESS, and rejects impossible overlap", () => {
  const scalar = maic([-1, 0, 1], 0.4);
  assert.ok(Math.abs(scalar.matchedMean - 0.4) < 1e-9);
  assert.ok(scalar.ess > 1 && scalar.ess < 3);
  assert.equal(maic([-1, 0, 1], 0).ess, 3);
  const joint = maicMoments([[-1, -1], [-1, 1], [1, -1], [1, 1]], [0.3, -0.2]);
  joint.matchedMean.forEach((value, j) => assert.ok(Math.abs(value - [0.3, -0.2][j]) < 1e-8));
  assert.throws(() => maic([-1, 0, 1], 2), /overlap/);
  assert.throws(() => maicMoments([[0, 0], [1, 1], [2, 2]], [0.4, 1]), /dependent|overlap/);
});

test("MAIC bootstrap re-estimates weights and only anchors in the aggregate trial population", () => {
  const data = populationExample();
  const result = maicContrast(data, { mean: 0.8, width: 1.5 }, { bootstrap: 30 });
  assert.equal(result.bootstrapSuccessful, 30);
  assert.ok(result.se > 0);
  assert.ok(Number.isFinite(result.anchored.contrast));
  assert.ok(result.anchored.se > result.se);
  assert.equal(maicContrast(data, { mean: 0, width: 1.5 }, { bootstrap: 0 }).anchored, null);
  assert.equal(maicContrast(data, { mean: 0.8, width: 0.5 }, { bootstrap: 0 }).anchored, null);
  const boundary = populationExample(); boundary.ipd.forEach((r) => { r.y = 0; });
  assert.throws(() => maicContrast(boundary, { mean: 0.8, width: 1.5 }), /No finite MAIC/);
  assert.throws(() => maicContrast(populationExample("survival"), { mean: 0.8, width: 1.5 }), /survival estimator/);
});

test("general marginal likelihood integrates probabilities and event densities, not averaged hazards", () => {
  const population = { mean: 0, width: 1 };
  assert.ok(Math.abs(integratedLikelihood("binary", 1, 0, 2, population, 128) - 0.5) < 1e-12);
  const ordinal = [0, 1, 2].map((y) => integratedLikelihood("ordinal", y, 0.2, 1, population));
  assert.ok(Math.abs(ordinal.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  assert.ok(Math.abs(conditionalLikelihood("normal", 0, 0) - 1 / Math.sqrt(2 * Math.PI)) < 1e-12);
  const event = integratedLikelihood("survival", { time: 1, event: 1 }, 0, 2, population, 128, { shape: 1 });
  const points = populationPoints(population, 128);
  const correct = points.reduce((s, x) => s + Math.exp(2 * x) * Math.exp(-Math.exp(2 * x)), 0) / 128;
  assert.ok(Math.abs(event - correct) < 1e-12);
  const censor = integratedLikelihood("survival", { time: 1, event: 0 }, 0, 2, population, 128, { shape: 1 });
  assert.ok(censor > 0 && censor < 1);
  assert.throws(() => conditionalLikelihood("ordinal", 3, 0), /Ordinal/);
  assert.throws(() => conditionalLikelihood("survival", { time: -1, event: 1 }, 0), /Survival/);
});

test("two-parameter binomial matches Poisson-binomial moments and rejects incompatible support", () => {
  const expected = Math.log(70 * 0.625 ** 4 * 0.375 ** 4);
  assert.ok(Math.abs(aggregateBinaryLogLikelihood(4, 10, [0.25, 0.75], "two") - expected) < 1e-11);
  assert.ok(Math.abs(aggregateBinaryLogLikelihood(4, 10, [0.3, 0.3], "two") - aggregateBinaryLogLikelihood(4, 10, [0.3, 0.3], "one")) < 1e-11);
  assert.equal(aggregateBinaryLogLikelihood(9, 10, [0.25, 0.75], "two"), -Infinity);
  const fit = fitPopulation({ ...populationExample(), binomialApproximation: "two" });
  assert.ok(fit.converged && fit.identifiable);
  assert.ok(Number.isFinite(fit.logLikelihood(fit.coefficients)));
});

test("mixed normal likelihood recovers exact known coefficients and Hessian uncertainty", () => {
  const data = populationExample("normal");
  for (const row of data.ipd) row.y = -0.5 + 0.7 * row.x + (row.treatment === "B" ? -0.8 + 0.9 * row.x : 0);
  const fit = fitPopulation(data);
  assert.ok(fit.converged && fit.identifiable);
  [-0.5, -0.3, -0.8, -0.4, 0.7, 0.9].forEach((expected, i) => assert.ok(Math.abs(fit.coefficients[i] - expected) < 3e-5, `${i}: ${fit.coefficients[i]}`));
  assert.ok(fit.covariance.every((row, i) => row[i] > 0));
  assert.ok(Math.abs(fit.integrationLogLikelihood(fit.coefficients, 128) - fit.logLikelihood(fit.coefficients)) < 1e-9);
});

test("all four outcome families fit actual mixed data, STC excludes aggregate-only treatments", () => {
  for (const family of ["binary", "normal", "ordinal", "survival"]) {
    const fit = fitPopulation(populationExample(family));
    assert.ok(fit.converged, `${family} score ${fit.gradientMax}`);
    assert.ok(fit.identifiable, family);
    assert.ok(fit.logLikelihood(fit.coefficients) > fit.logLikelihood(fit.coefficients.map(() => 0)));
    const result = standardizePopulation(fit, { mean: 0.8, width: 1.5 });
    assert.ok(result.every((r) => Number.isFinite(r.risk)));
  }
  const stc = fitPopulation(populationExample(), { method: "stc" });
  assert.deepEqual(stc.treatments, ["A", "B"]);
  assert.throws(() => stc.predict("C", 0), /fitted treatment/);
});

test("multiple covariates, Sobol marginals and independent modifiers use the same likelihood", () => {
  const data = populationExample("normal");
  data.covariates = ["severity", "history"];
  for (const row of data.ipd) {
    const x = row.x;
    const z = Math.sin(3 * x);
    row.x = [x, z];
    row.y = -0.5 + 0.7 * x - 0.3 * z + (row.treatment === "B" ? -0.8 + 0.9 * x + 0.2 * z : 0);
  }
  for (const row of data.agd) row.population = { marginals: [{ type: "normal", mean: 0.8, sd: 0.5 }, { type: "bernoulli", probability: 0.4 }], correlation: [[1, 0.2], [0.2, 1]] };
  const fit = fitPopulation(data);
  assert.ok(fit.converged && fit.identifiable);
  assert.equal(fit.covariates.length, 2);
  assert.ok(Math.abs(fit.coefficients[fit.names.indexOf("prognostic:history")] + 0.3) < 1e-4);
  const independent = fitPopulation(populationExample(), { modifiers: "independent" });
  assert.equal(independent.identifiable, false, "one aggregate AC trial cannot identify both C effect and independent C modifier");
});

test("noncollapsibility distinguishes average conditional and marginal log odds ratios", () => {
  const fit = fitPopulation(populationExample());
  const result = standardizePopulation(fit, { mean: 0, width: 1.5 });
  assert.ok(Math.abs(result[1].marginalLogOR - result[1].conditionalLogOR) > 0.01);
  assert.ok(Math.abs(standardizePopulation(fit, { mean: 0.8, width: 0 })[1].marginalLogOR - standardizePopulation(fit, { mean: 0.8, width: 0 })[1].conditionalLogOR) < 1e-12);
});

test("population import validates trust boundaries and the game hides outcomes until a prediction", () => {
  const invalid = populationExample(); invalid.ipd[0].y = 7;
  assert.throws(() => validatePopulationData(invalid), /Binary/);
  const duplicate = populationExample(); duplicate.agd[0].study = "AB";
  assert.throws(() => validatePopulationData(duplicate), /double counting/);
  const state = { options: {} };
  const hidden = populationLens.draw({ state, box: { left: 0, right: 800, top: 0 } });
  assert.match(hidden.stage, /Make a prediction to reveal/);
  assert.doesNotMatch(hidden.inspector, /<th>MLE<\/th>/);
  state.options.populationPrediction = "higher";
  const revealed = populationLens.draw({ state, box: { left: 0, right: 800, top: 0 } });
  assert.doesNotMatch(revealed.stage, /Make a prediction to reveal/);
  assert.match(revealed.inspector, /Correct/);
  for (const family of ["normal", "ordinal", "survival"]) {
    state.options.populationFamily = family;
    assert.match(populationLens.draw({ state, box: { left: 0, right: 800, top: 0 } }).inspector, /Optimizer converged/);
  }
  state.options.populationFamily = "binary"; state.options.populationMethod = "maic";
  const maicView = populationLens.draw({ state, box: { left: 0, right: 800, top: 0 } });
  assert.match(maicView.stage, /MAIC weighted IPD outcomes/);
  assert.match(maicView.inspector, /Bootstrap SE/);
});
