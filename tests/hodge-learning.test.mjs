import test from 'node:test';
import assert from 'node:assert/strict';
import { fitNetwork } from '../src/nma/model.js';
import { hodge, hodgeCycleRows, hodgeRanking, sparseCyclic, triangles } from '../src/nma/hodge.js';
import { springs } from '../src/app/lenses/springs.js';
import { makeRig } from '../src/app/play.js';

test('adding a chord makes four-cycle inconsistency triangle-detectable', () => {
  const before = hodge(fitNetwork(hodgeCycleRows()).common);
  const after = hodge(fitNetwork(hodgeCycleRows(true)).common);
  assert.equal(before.harmonicDimension, 1);
  assert.equal(before.triangleCount, 0);
  assert.ok(before.energyHarmonic > 0);
  assert.equal(after.harmonicDimension, 0);
  assert.equal(after.triangleCount, 2);
  assert.ok(after.energyCurl > 0);
  assert.ok(after.energyHarmonic < 1e-12);
});

test('complete balanced ranking matches Borda and exact Kemeny keeps a Condorcet winner', () => {
  const rows = [['A','B',1],['A','C',1],['B','C',1]].map(([treat1,treat2,TE],i)=>({studlab:String(i),treat1,treat2,TE,seTE:1}));
  const ranking = hodgeRanking(fitNetwork(rows).common);
  assert.equal(ranking.balancedComplete, true);
  assert.deepEqual(ranking.kemeny.order, ['A','B','C']);
  assert.equal(ranking.kemeny.objective, 0);
  ranking.scores.forEach(s=>assert.ok(Math.abs(s.gradient*3-s.borda)<1e-10));
});

test('sparse cyclic optimization removes triangular residual and preserves a chordless one', () => {
  const ring = hodge(fitNetwork(hodgeCycleRows()).common);
  assert.deepEqual(sparseCyclic(ring).values, ring.residual);
  const filled = hodge(fitNetwork(hodgeCycleRows(true)).common);
  const sparse = sparseCyclic(filled);
  assert.ok(sparse.converged);
  assert.ok(sparse.objective < 1e-6);
});

test('spring prediction removes answer geometry and disables rest controls until reveal', () => {
  const rows = [0, 4].map((TE,i)=>({studlab:String(i),treat1:'A',treat2:'B',TE,seTE:1}));
  const fit = fitNetwork(rows);
  const rig = makeRig(rows.map(r=>({y:r.TE,k:1})));
  const context = {model:fit.common, state:{contrast:{treat1:'A',treat2:'B'},model:'common',wager:{contrast:'A\u0000B',model:'common',guess:0,settled:false}},measure:'MD',width:800,height:500,rig};
  const hidden = springs.draw(context);
  assert.doesNotMatch(hidden.stage,/spring-yoke|spring-row pooled|spring-row network|data-bob|wager-truth/);
  assert.match(hidden.controls,/data-play="settle" disabled/);
  context.state.wager.settled = true;
  const revealed = springs.draw(context);
  assert.match(revealed.stage,/spring-yoke/);
  assert.match(revealed.stage,/wager-truth/);
  context.model = fit.random;
  context.state.model = 'random';
  assert.match(springs.draw(context).stage,/spring-coil heterogeneity/);
});

test('sparse cyclic solver matches exact one-triangle L1 minimum while retaining harmonic flow', () => {
  const rows = hodgeCycleRows();
  rows.push({studlab:'AE',treat1:'A',treat2:'E',TE:5,seTE:0.7},{studlab:'BE',treat1:'B',treat2:'E',TE:1,seTE:0.8});
  const h = hodge(fitNetwork(rows).common);
  assert.equal(h.triangleCount, 1);
  assert.equal(h.harmonicDimension, 1);
  const candidates = h.residual.flatMap((r,i)=>h.curlAdjoint[i][0] ? [r/h.curlAdjoint[i][0]] : []);
  const exact = Math.min(...candidates.map(z=>h.residual.reduce((sum,r,i)=>sum+Math.abs(r-h.curlAdjoint[i][0]*z),0)));
  const result = sparseCyclic(h);
  assert.ok(result.converged);
  assert.ok(Math.abs(result.objective-exact)<1e-6);
  assert.ok(result.objective>1);
});


test('zero-information multi-arm contrast is absent from Hodge topology and stays finite', () => {
  const rows = [['A', 'B', 1, 1], ['A', 'C', 2, Math.sqrt(2)], ['B', 'C', 1, 1]]
    .map(([treat1, treat2, TE, seTE]) => ({ studlab: 'S', treat1, treat2, TE, seTE }));
  const model = fitNetwork(rows).common;
  assert.equal(model.w[1], 0);
  const h = hodge(model);
  assert.deepEqual(h.edges.map(e => `${e.treat1} ${e.treat2}`), ['A B', 'B C']);
  assert.equal(h.omittedZeroInformation, 1);
  assert.equal(h.triangleCount, 0);
  assert.deepEqual(triangles(model), []);
  assert.equal(h.harmonicDimension, 0);
  assert.equal(h.componentCount, 1);
  for (const name of ['observed', 'gradient', 'residual', 'curl', 'harmonic'])
    assert.ok(h[name].every(Number.isFinite), name);
  for (const name of ['energyTotal', 'energyGradient', 'energyResidual', 'energyCurl', 'energyHarmonic'])
    assert.ok(Number.isFinite(h[name]), name);
  assert.ok(h.energyResidual < 1e-20);
  const sparse = sparseCyclic(h);
  assert.ok(sparse.converged);
  assert.ok(sparse.values.every(Number.isFinite));
  assert.ok(Number.isFinite(sparse.objective));
  assert.ok(hodgeRanking(model, h).scores.every(s => Number.isFinite(s.borda)));
});
