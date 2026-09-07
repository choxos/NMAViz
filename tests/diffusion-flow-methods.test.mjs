import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fitNetwork } from '../src/nma/model.js';
import { absorbingWalk, diffusionEstimates } from '../src/nma/diffusion.js';
import { evidenceFlow, flowMeasures } from '../src/nma/flow.js';
const near = (a, b, tol = 1e-8) => assert.ok(Math.abs(a-b) < tol, `${a} != ${b}`);
const row = (s, a, b, TE = 1, seTE = 1) => ({ studlab: s, treat1: a, treat2: b, TE, seTE });

test('absorbing walk on a chain: repeated visits, four expected steps, unit net current', () => {
  const model = fitNetwork([row('ab','A','B'), row('bc','B','C')]).common;
  const walk = absorbingWalk(model, 'A', 'C', 30);
  walk.visits.forEach((x, i) => near(x, [2,2,0][i]));
  near(walk.expectedSteps, 4);
  for (const mass of walk.history) near(mass.reduce((s,x)=>s+x,0),1);
  for (const edge of walk.crossings) near(edge.net,1);
  assert.ok(walk.history.at(-1)[2] > .9999);
});

test('iterative estimates and hat converge without reading the fitted inverse', () => {
  const model = fitNetwork([row('ab','A','B',2), row('bc','B','C',3), row('ac','A','C',7)]).common;
  const { Lplus, H, ...input } = model;
  const result = diffusionEstimates(input);
  assert.equal(result.status, 'converged');
  result.H.forEach((r,i)=>r.forEach((x,j)=>near(x,H[i][j])));
  result.fitted.forEach((x,i)=>near(x,model.fitted[i]));
  const short = diffusionEstimates(input, { maxSteps: 0 });
  assert.equal(short.status,'step-limit');
  assert.equal(short.converged,false);
  assert.throws(()=>diffusionEstimates(input, { maxSteps: -1 }));
});

test('multi-arm clique counts once and study replication increases study parallelism', () => {
  const rows = ['one','two'].flatMap(s=>[row(s,'A','B'),row(s,'A','C',2),row(s,'B','C')]);
  const model=fitNetwork(rows).common;
  const measures=flowMeasures(model,'A','C');
  near(measures.meanPathLength,1);
  near(measures.designParallelism,1);
  near(measures.studyParallelism,2);
  const walk=absorbingWalk(model,'A','C');
  const flow=evidenceFlow(model,'A','C');
  walk.crossings.forEach((e,i)=>near(e.net,flow.edges[i].signed));
});

for(const name of readdirSync(new URL('./fixtures/', import.meta.url)).filter(n=>n.endsWith('.json'))) {
  const f=JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  const c=f.comparisons;
  const model=fitNetwork(c.treat1.map((a,i)=>row(String(c.studlab[i]),a,c.treat2[i],c.TE[i],c.seTE[i]))).common;
  test(`${name}: design flow measures match netmeta including multi-arm designs`,()=> {
    let k=0;
    for(let a=0;a<model.n-1;a++) for(let b=a+1;b<model.n;b++) {
      const m=flowMeasures(model,model.treatments[a],model.treatments[b]);
      near(m.meanPathLength,f.measures.meanpath[k]);
      near(m.designParallelism,f.measures.minpar[k]);
      k++;
    }
  });
  test(`${name}: absorbing chain independently recovers evidence currents`,()=> {
    const a=model.treatments[0],b=model.treatments.at(-1);
    const walk=absorbingWalk(model,a,b),flow=evidenceFlow(model,a,b);
    walk.crossings.forEach((e,i)=>near(e.net,flow.edges[i].signed));
  });
}
