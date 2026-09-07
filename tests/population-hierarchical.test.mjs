import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHierarchicalPopulation, sampleHierarchicalPopulation } from '../src/nma/population-hierarchical.js';

const normalData = () => ({ reference: 'A', family: 'normal', parameters: { sigma: 1 }, agd: [],
  ipd: ['A', 'B'].flatMap(treatment => [-1, -0.5, 0.5, 1].map(x => ({ study: 'AB', treatment, x, y: 0.5 * x + (treatment === 'B' ? 1 : 0) }))),
});

test('Finite extreme outcomes retain their log likelihood for IPD and aggregate tails', () => {
  const data = normalData();
  data.ipd.forEach(r => { r.y = r.treatment === 'A' ? 50 : 51; });
  const model = buildHierarchicalPopulation(data, { modifiers: 'none' });
  assert.ok(Math.abs(model.logLikelihood(model.initial) - (-10209.351508265638)) < 1e-9);
  const sampled = sampleHierarchicalPopulation(data, { modifiers: 'none', chains: 2, draws: 8, warmup: 0 });
  assert.ok(Number.isFinite(sampled.deviance.mean));
  for (const family of ['binary', 'normal', 'ordinal', 'survival']) {
    const d = normalData(); d.family = family;
    d.ipd.forEach(r => { r.y = family === 'survival' ? { time: 100, event: 1 } : 0; });
    d.agd = ['A', 'B'].map(treatment => ({ study: 'aggregate', treatment, population: { mean: 0, width: 0 },
      n: 10, events: 1, mean: 100, se: 1, counts: [1, 8, 1], y: { time: 100, event: 1 } }));
    const m = buildHierarchicalPopulation(d, { randomEffects: false, modifiers: 'none' });
    const b = m.initial.map((v, i) => m.names[i].startsWith('baseline:') ? (family === 'survival' ? 5 : 100) : v);
    assert.ok(Number.isFinite(m.logLikelihood(b)), family);
  }
});

test('Hierarchical likelihood matches explicit normal regression; proper prior shrinks sampled effects', () => {
  const data = normalData();
  const model = buildHierarchicalPopulation(data, { randomEffects: false, modifiers: 'none' });
  const truth = [0, 1, 0.5];
  assert.ok(Math.abs(model.logLikelihood(truth) + 8 * Math.log(Math.sqrt(2 * Math.PI))) < 1e-10);
  const result = sampleHierarchicalPopulation(data, { randomEffects: false, modifiers: 'none', chains: 4, draws: 1800, warmup: 700, seed: 25, target: { mean: 1, width: 0 } });
  const expectedEffect = (4 - 16 / 8.04) / (4.16 - 16 / 8.04);
  const effect = result.parameters.find(p => p.name === 'effect:B');
  assert.ok(Math.abs(effect.mean - expectedEffect) < 0.09, JSON.stringify(effect));
  assert.ok(Math.abs(result.parameters.find(p => p.name === 'prognostic:x1').mean - 2.5 / 5.16) < 0.07);
  assert.ok(effect.lower < expectedEffect && effect.upper > expectedEffect);
  assert.ok(result.target[1].response.lower < result.target[1].response.upper);
  assert.ok(result.diagnostics.parameters.every(p => Number.isFinite(p.rhat) && p.ess > 20));
});

test('Multi-arm heterogeneity has the required half correlation and half-normal Jacobian', () => {
  const data = normalData();
  data.ipd.push(...data.ipd.filter(r => r.treatment === 'B').map(r => ({ ...r, treatment: 'C', y: r.y + 1 })));
  const model = buildHierarchicalPopulation(data, { modifiers: 'exchangeable' });
  assert.deepEqual(model.randomEffectCorrelation, [[[1, 0.5], [0.5, 1]]]);
  const b = [...model.initial], index = model.names.indexOf('log-tau');
  const other = [...b]; other[index] += Math.log(2);
  assert.ok(Math.abs(model.logPrior(other) - model.logPrior(b) - (Math.log(2) - 1.5)) < 1e-10);
  assert.ok(Number.isFinite(model.logDensity(b)));
  const extreme = [...b]; extreme[index] = 1000;
  assert.equal(model.logDensity(extreme), -Infinity);
  assert.throws(() => buildHierarchicalPopulation(data, { priors: { tau: -1 } }), /Prior/);
});

test('UME admits a closed-loop inconsistency while refusing an unidentifiable tree', () => {
  const data = normalData();
  assert.throws(() => buildHierarchicalPopulation(data, { consistency: 'ume' }), /closed loop/);
  for (const [study, a, b, effect] of [['AC', 'A', 'C', 2], ['BC', 'B', 'C', 4]])
    data.ipd.push(...[a, b].flatMap(treatment => [-1, -0.5, 0.5, 1].map(x => ({ study, treatment, x, y: 0.5 * x + (treatment === b ? effect : 0) }))));
  const ume = buildHierarchicalPopulation(data, { consistency: 'ume', randomEffects: false, modifiers: 'none' });
  const b = ume.names.map(name => name === 'prognostic:x1' ? 0.5 : name === 'effect:["A","B"]' ? 1 : name === 'effect:["A","C"]' ? 2 : name === 'effect:["B","C"]' ? 4 : 0);
  assert.ok(Math.abs(ume.logLikelihood(b) + 24 * Math.log(Math.sqrt(2 * Math.PI))) < 1e-10);
  assert.throws(() => ume.standardize(b, { mean: 0, width: 1 }), /no coherent/);
  const result = sampleHierarchicalPopulation(data, { consistency: 'ume', randomEffects: false, modifiers: 'none', chains: 2, draws: 12, warmup: 2 });
  assert.ok(Number.isFinite(result.deviance.mean));
  assert.equal(result.target, null);
  assert.equal(result.diagnostics.converged, false);
});

test('Posterior standardization distinguishes conditional from marginal binary effects', () => {
  const data = normalData(); data.family = 'binary'; data.ipd.forEach(r => { r.y = +(r.y > 0); });
  const model = buildHierarchicalPopulation(data, { randomEffects: false, modifiers: 'shared' });
  const b = model.names.map(name => name === 'effect:B' ? 1 : name === 'prognostic:x1' ? 2 : 0);
  const target = model.standardize(b, { mean: 0, width: 2 }, { points: 128 });
  assert.equal(target[1].conditionalEffect, 1);
  assert.ok(target[1].marginalLogOR > 0 && target[1].marginalLogOR < 1);
  b[model.names.indexOf('baseline:AB')] = 100;
  const extreme = model.standardize(b, { mean: 0, width: 0 });
  assert.equal(extreme[1].marginalLogOR, 1);
  assert.equal(extreme[0].marginalLogOR, 0);
});
