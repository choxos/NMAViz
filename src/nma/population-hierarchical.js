import { validatePopulationData, populationPoints, conditionalLikelihood, conditionalLogLikelihood, aggregateBinaryLogLikelihood, logMeanExp, logistic } from './population.js';
import { samplePosterior } from './posterior.js';

const mean = x => x.reduce((s, v) => s + v, 0) / x.length;
const vector = x => Array.isArray(x) ? x : [x];
const dot = (a, b) => a.reduce((s, v, j) => s + v * b[j], 0);
const summary = values => {
  const ordered = [...values].sort((a, b) => a - b);
  return { mean: mean(values), lower: ordered[Math.floor(0.025 * (ordered.length - 1))], upper: ordered[Math.ceil(0.975 * (ordered.length - 1))] };
};

/** Thesis 4.6 and A.1.2: non-centered homogeneous trial heterogeneity.
 * Trial baseline contrasts have variance tau² and covariance tau²/2.
 * UME uses independent observed two-arm contrasts, without consistency.
 * Known likelihood nuisance parameters are supplied in data.parameters. */
export function buildHierarchicalPopulation(data, {
  modifiers = 'shared', randomEffects = true, consistency = 'consistent', n = 32, priors: supplied = {},
} = {}) {
  validatePopulationData(data);
  if (!['shared', 'independent', 'exchangeable', 'none'].includes(modifiers) || !['consistent', 'ume'].includes(consistency))
    throw new Error('Unknown modifier or consistency model.');
  if (typeof randomEffects !== 'boolean') throw new Error('randomEffects must be boolean.');
  const priors = { baseline: 5, effect: 2.5, prognostic: 2.5, modifier: 1, tau: 0.5, modifierScale: 0.5, ...supplied };
  if (Object.values(priors).some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Prior standard deviations must be finite and positive.');
  const family = data.family ?? 'binary';
  const rows = [...data.ipd, ...data.agd];
  const studies = [...new Set(rows.map(r => r.study))];
  const treatments = [data.reference, ...new Set(rows.filter(r => r.treatment !== data.reference).map(r => r.treatment))];
  const covariates = vector(data.ipd[0].x).map((_, j) => data.covariates?.[j] ?? `x${j + 1}`);
  const arms = studies.map(s => [...new Set(rows.filter(r => r.study === s).map(r => r.treatment))].sort((a, b) => treatments.indexOf(a) - treatments.indexOf(b)));
  const pair = (a, b) => JSON.stringify([a, b].sort());
  const contrasts = [...new Set(arms.flatMap(a => a.slice(1).map(t => pair(a[0], t))))];
  if (consistency === 'ume' && (arms.some(a => a.length !== 2) || contrasts.length <= treatments.length - 1))
    throw new Error('UME checking requires a closed loop of two-arm trial contrasts; multi-arm UME is outside this laboratory.');
  const names = [], scales = [], initial = [];
  const add = (name, sd, start = 0) => { names.push(name); scales.push(sd); initial.push(start); return names.length - 1; };
  const baselines = studies.map(s => add(`baseline:${s}`, priors.baseline));
  const effects = new Map((consistency === 'ume' ? contrasts : treatments.slice(1)).map(t => [t, add(`effect:${t}`, priors.effect)]));
  const prognostic = covariates.map(c => add(`prognostic:${c}`, priors.prognostic));
  const modifier = new Map();
  let modifierMean = [], modifierSD = [];
  if (modifiers === 'exchangeable') {
    modifierMean = covariates.map(c => add(`modifier-mean:${c}`, priors.modifier));
    modifierSD = covariates.map(c => add(`log-modifier-sd:${c}`, null, Math.log(priors.modifierScale)));
  }
  for (const t of modifiers === 'none' ? [] : modifiers === 'shared' ? ['active'] : treatments.slice(1))
    modifier.set(t, covariates.map(c => add(`${modifiers === 'exchangeable' ? 'z-modifier' : 'modifier'}:${t}:${c}`, modifiers === 'exchangeable' ? 1 : priors.modifier)));
  const tauIndex = randomEffects ? add('log-tau', null, Math.log(priors.tau)) : -1;
  const random = randomEffects ? arms.map((a, s) => a.slice(1).map(t => add(`z:${studies[s]}:${t}`, 1))) : [];
  if (names.length > 40) throw new Error('Hierarchical teaching sampler supports at most 40 parameters.');
  // Cholesky of the equicorrelation matrix: no unidentifiable extra shared latent.
  const factors = arms.map(a => {
    const size = a.length - 1, L = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let i = 0; i < size; i++) for (let j = 0; j <= i; j++) {
      let v = i === j ? 1 : 0.5;
      for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(v) : v / L[j][j];
    }
    return L;
  });
  const decode = b => {
    const slopes = Object.fromEntries(treatments.map(t => [t, covariates.map((_, j) => {
      if (t === data.reference || modifiers === 'none') return 0;
      const v = b[modifier.get(modifiers === 'shared' ? 'active' : t)[j]];
      return modifiers === 'exchangeable' ? b[modifierMean[j]] + Math.exp(b[modifierSD[j]]) * v : v;
    })]));
    const offsets = arms.map((a, s) => [0, ...a.slice(1).map((t, i) => {
      let effect;
      if (consistency === 'ume') effect = (a[0] < t ? 1 : -1) * b[effects.get(pair(a[0], t))];
      else effect = (t === data.reference ? 0 : b[effects.get(t)]) - (a[0] === data.reference ? 0 : b[effects.get(a[0])]);
      return effect + (randomEffects ? Math.exp(b[tauIndex]) * dot(factors[s][i], random[s].map(index => b[index])) : 0);
    })]);
    return { slopes, offsets };
  };
  const prepare = row => ({ row, s: studies.indexOf(row.study), a: arms[studies.indexOf(row.study)].indexOf(row.treatment) });
  const individual = data.ipd.map(row => ({ ...prepare(row), x: vector(row.x) }));
  const aggregate = data.agd.map(row => ({ ...prepare(row), points: populationPoints(row.population, n).map(vector) }));
  const eta = (b, decoded, r, x) => b[baselines[r.s]] + decoded.offsets[r.s][r.a] + dot(x, prognostic.map((index, j) => b[index] + decoded.slopes[r.row.treatment][j]));
  const logLikelihood = b => {
    if (b.length !== names.length || !b.every(Number.isFinite)) return -Infinity;
    const decoded = decode(b);
    let ll = 0;
    for (const r of individual) {
      const e = eta(b, decoded, r, r.x);
      if (!Number.isFinite(e)) return -Infinity;
      ll += conditionalLogLikelihood(family, r.row.y, e, data.parameters);
    }
    for (const r of aggregate) {
      const es = r.points.map(x => eta(b, decoded, r, x));
      if (!es.every(Number.isFinite)) return -Infinity;
      if (family === 'binary') {
        if (data.binomialApproximation === 'two') ll += aggregateBinaryLogLikelihood(r.row.events, r.row.n, es.map(logistic), 'two');
        else {
          if (r.row.events) ll += r.row.events * logMeanExp(es.map(e => conditionalLogLikelihood('binary', 1, e)));
          if (r.row.n - r.row.events) ll += (r.row.n - r.row.events) * logMeanExp(es.map(e => conditionalLogLikelihood('binary', 0, e)));
        }
      } else if (family === 'normal') ll += conditionalLogLikelihood('normal', r.row.mean, mean(es), { sigma: r.row.se });
      else if (family === 'ordinal') r.row.counts.forEach((count, category) => {
        if (count) ll += count * logMeanExp(es.map(e => conditionalLogLikelihood(family, category, e, data.parameters)));
      });
      else ll += logMeanExp(es.map(e => conditionalLogLikelihood(family, r.row.y, e, data.parameters)));
    }
    return Number.isFinite(ll) ? ll : -Infinity;
  };
  const logPrior = b => {
    if (b.length !== names.length || !b.every(Number.isFinite)) return -Infinity;
    let lp = scales.reduce((s, sd, j) => sd === null ? s : s - 0.5 * (b[j] / sd) ** 2 - Math.log(sd * Math.sqrt(2 * Math.PI)), 0);
    // Half-normal on the positive SD, with Jacobian for log-SD coordinates.
    for (const [index, sd] of [...(randomEffects ? [[tauIndex, priors.tau]] : []), ...modifierSD.map(index => [index, priors.modifierScale])])
      lp += Math.log(Math.sqrt(2 / Math.PI) / sd) - 0.5 * (Math.exp(b[index]) / sd) ** 2 + b[index];
    return Number.isFinite(lp) ? lp : -Infinity;
  };
  const standardize = (b, population, { study = studies[0], points = n } = {}) => {
    if (consistency === 'ume') throw new Error('UME has no coherent network-wide treatment ranking or standardized effects.');
    const s = studies.indexOf(study);
    if (s < 0) throw new Error('Target baseline must refer to an observed study.');
    const xs = populationPoints(population, points).map(vector);
    if (xs.some(x => x.length !== covariates.length)) throw new Error('Target covariates must match fitted dimensions.');
    const decoded = decode(b);
    const effect = t => t === data.reference ? 0 : b[effects.get(t)];
    const predictions = treatments.map(t => {
      // Absolute response borrows the chosen study baseline; random effects are
      // excluded, so these are mean treatment effects, not a new-trial prediction.
      const es = xs.map(x => b[baselines[s]] - effect(arms[s][0]) + effect(t) + dot(x, prognostic.map((index, j) => b[index] + decoded.slopes[t][j])));
      const response = mean(es.map(e => family === 'binary' ? logistic(e) : family === 'normal' ? e : family === 'survival' ? Math.exp(-Math.exp(e)) : conditionalLikelihood('ordinal', 0, e, data.parameters)));
      const logOdds = family === 'binary' ? logMeanExp(es.map(e => conditionalLogLikelihood('binary', 1, e))) - logMeanExp(es.map(e => conditionalLogLikelihood('binary', 0, e))) : null;
      return { treatment: t, response, logOdds, conditionalEffect: effect(t) + mean(xs.map(x => dot(x, decoded.slopes[t]))) };
    });
    return predictions.map(p => ({ ...p, marginalLogOR: family === 'binary' ? p.logOdds - predictions[0].logOdds : null }));
  };
  return { names, initial, family, studies, treatments, covariates, priors, modifiers, randomEffects, consistency,
    logLikelihood, logPrior, logDensity: b => logPrior(b) + logLikelihood(b), standardize,
    randomEffectCorrelation: factors.map((_, s) => arms[s].slice(1).map((__, i) => arms[s].slice(1).map((___, j) => i === j ? 1 : 0.5))),
    priorDescription: 'Independent zero-mean Normal coefficients; half-Normal tau and modifier SD with log-scale Jacobians; standard-Normal non-centered latent effects.',
  };
}

export function sampleHierarchicalPopulation(data, options = {}) {
  const model = buildHierarchicalPopulation(data, options);
  const chains = options.chains ?? 4;
  if (!Number.isInteger(chains) || chains < 2 || chains > 8) throw new Error('Use 2 to 8 chains.');
  const initial = Array.from({ length: chains }, (_, c) => model.initial.map((v, j) => v + 0.2 * (c - (chains - 1) / 2) * (j % 2 ? -1 : 1)));
  const sampled = samplePosterior(model.logDensity, { initial, draws: options.draws ?? 500, warmup: options.warmup ?? 500, seed: options.seed ?? 173, proposalScale: options.proposalScale ?? 0.2 });
  const all = sampled.chains.flat();
  const deviance = summary(all.map(b => -2 * model.logLikelihood(b)));
  const standardized = options.target && model.consistency === 'consistent' ? all.map(b => model.standardize(b, options.target, { study: options.targetStudy })) : null;
  const target = standardized ? model.treatments.map((treatment, index) => {
    const values = standardized.map(values => values[index]);
    return { treatment, response: summary(values.map(v => v.response)), conditionalEffect: summary(values.map(v => v.conditionalEffect)),
      marginalLogOR: model.family === 'binary' ? summary(values.map(v => v.marginalLogOR)) : null };
  }) : null;
  const parameters = model.names.map((name, index) => ({ name: name.replace(/^log-/, ''), ...summary(all.map(b => name.startsWith('log-') ? Math.exp(b[index]) : b[index])) }));
  return { ...sampled, names: model.names, parameters, target, deviance, priors: model.priors, priorDescription: model.priorDescription,
    consistency: model.consistency, modifiers: model.modifiers, randomEffects: model.randomEffects,
    targetBaselineStudy: options.targetStudy ?? model.studies[0],
    limitations: 'Small synthetic-model teaching sampler, at most 40 parameters. Likelihood nuisance parameters are known. One-parameter binomial deviance omits count constants; two-parameter binomial retains its parameter-dependent combination term. Compare deviance only on the same data and approximation. Target absolute responses borrow the selected study baseline; survival response is S(1), ordinal response is P(category 0). UME is restricted to loops of two-arm trials and has no network-wide target standardization. Convergence is not guaranteed.',
  };
}
