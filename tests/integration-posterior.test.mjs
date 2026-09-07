import test from 'node:test';
import assert from 'node:assert/strict';
import { sobolPoints, normalCDF, normalQuantile, populationIntegrationPoints, integratePopulation } from '../src/nma/integration.js';
import { samplePosterior, posteriorDiagnostics } from '../src/nma/posterior.js';

test('Sobol first three dimensions match Joe-Kuo reference points including origin', () => {
  assert.deepEqual(sobolPoints(8, 3, { seed: null }), [
    [0, 0, 0], [.5, .5, .5], [.75, .25, .25], [.25, .75, .75],
    [.375, .375, .625], [.875, .875, .125], [.625, .125, .875], [.125, .625, .375],
  ]);
  assert.deepEqual(sobolPoints(8, 3), sobolPoints(8, 3));
  assert.throws(() => sobolPoints(12, 3), /power of two/);
  assert.throws(() => sobolPoints(8, 9), /1 to 8/);
});

test('Normal transforms recover known quantiles and probability', () => {
  assert.ok(Math.abs(normalQuantile(.975) - 1.95996398454005) < 1e-7);
  for (const p of [.001, .1, .5, .9, .999]) assert.ok(Math.abs(normalCDF(normalQuantile(p)) - p) < 1e-7);
});

test('Correlated QMC integrates analytic moments, mixed marginals and error sequence', () => {
  const marginals = [{ type: 'normal', mean: 2, sd: 3 }, { type: 'normal', mean: 4, sd: 2 }];
  const result = integratePopulation(([x, y]) => x * y, { marginals, correlation: [[1, .4], [.4, 1]], points: 4096 });
  assert.ok(Math.abs(result.estimate - 10.4) < .015, JSON.stringify(result));
  assert.equal(result.history.at(-1).empiricalError, 0);
  assert.ok(result.standardError > 0);
  assert.ok(Math.abs(result.history.at(-2).empiricalError) < Math.abs(result.history[2].empiricalError));
  const mixed = integratePopulation(([x, b]) => x * b, {
    marginals: [{ type: 'uniform', min: 0, max: 2 }, { type: 'bernoulli', probability: .3 }], points: 4096,
  });
  assert.ok(Math.abs(mixed.estimate - .3) < .002);
  const lognormal = integratePopulation(([x]) => x, { marginals: [{ type: 'lognormal', mean: .4, sd: .3 }], points: 4096 });
  assert.ok(Math.abs(lognormal.estimate - Math.exp(.445)) < .001);
});

test('Integration validates correlation, marginal and integrand boundaries', () => {
  const marginals = [{ type: 'normal' }, { type: 'normal' }];
  assert.throws(() => populationIntegrationPoints({ marginals, correlation: [[1, 1], [1, 1]] }), /positive definite/);
  assert.throws(() => populationIntegrationPoints({ marginals, correlation: [[1, .1], [.2, 1]] }), /symmetric/);
  assert.throws(() => populationIntegrationPoints({ marginals: [{ type: 'bernoulli', probability: 2 }] }), /probability/);
  assert.throws(() => integratePopulation(() => NaN, { marginals }), /nonfinite/);
});

test('Metropolis posterior reproduces analytic conjugate normal posterior and deterministic seed', () => {
  const options = { initial: [[-3], [-1], [3], [5]], draws: 4000, warmup: 1000, seed: 123 };
  const logPosterior = ([mu]) => -.5 * mu * mu - .5 * ((2 - mu) ** 2 + (3 - mu) ** 2);
  const result = samplePosterior(logPosterior, options);
  const p = result.diagnostics.parameters[0];
  assert.ok(Math.abs(p.mean - 5 / 3) < .045, JSON.stringify(p));
  assert.ok(Math.abs(p.sd - Math.sqrt(1 / 3)) < .04, JSON.stringify(p));
  assert.ok(p.rhat < 1.01);
  assert.ok(p.ess > 400);
  assert.ok(p.mcse > 0 && p.mcse < .03);
  assert.equal(result.diagnostics.converged, true);
  const a = samplePosterior(logPosterior, { ...options, draws: 8, warmup: 0 });
  const b = samplePosterior(logPosterior, { ...options, draws: 8, warmup: 0 });
  assert.deepEqual(a.chains, b.chains);
});

test('True bounded non-Gaussian target samples its density and reports stuck chains', () => {
  const result = samplePosterior(([x]) => x > 0 && x < 1 ? Math.log(x) + 4 * Math.log1p(-x) : -Infinity,
    { initial: [[.1], [.3], [.6], [.9]], draws: 3000, warmup: 800, seed: 20 });
  const p = result.diagnostics.parameters[0];
  assert.ok(Math.abs(p.mean - 2 / 7) < .02, JSON.stringify(p));
  assert.ok(result.invalidProposals > 0);
  assert.ok(result.chains.every(chain => chain.every(([x]) => x > 0 && x < 1)));
  const stuck = posteriorDiagnostics([Array.from({ length: 20 }, () => [0]), Array.from({ length: 20 }, () => [5])]);
  assert.equal(stuck.converged, false);
  assert.equal(stuck.rhat[0], Infinity);
  assert.equal(stuck.ess[0], 0);
  assert.throws(() => samplePosterior(() => NaN, { initial: [[0], [1]] }), /Log density/);
});
