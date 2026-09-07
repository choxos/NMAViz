/* Phillippo thesis, Chapters 2, 4 and 7. Fixed-effect likelihood laboratory:
 * Explicit covariate distributions and effect-modifier assumptions are required.
 * Likelihood estimates and posterior samples are distinct analysis outputs. */
import { eigenSymmetric, inverse } from "./matrix.js";
import { populationIntegrationPoints, seededRandom } from "./integration.js";

export const logistic = (x) => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
export const logit = (p) => Math.log(p / (1 - p));
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const softplus = (x) => Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));
export const logMeanExp = (values) => {
  const maximum = Math.max(...values);
  return maximum === -Infinity ? -Infinity : maximum + Math.log(mean(values.map((x) => Math.exp(x - maximum))));
};

function logGamma(z) {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.9999999999998099;
  coefficients.forEach((c, i) => { x += c / (z + i + 1); });
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function aggregateBinaryLogLikelihood(events, n, probabilities, approximation = "one") {
  if (!["one", "two"].includes(approximation) || !Number.isInteger(n) || n < 1 || !Number.isInteger(events) || events < 0 || events > n || !Array.isArray(probabilities) || !probabilities.length || !probabilities.every((p) => Number.isFinite(p) && p >= 0 && p <= 1))
    throw new Error("Invalid aggregate binary data or approximation.");
  const first = mean(probabilities), second = mean(probabilities.map((p) => p * p));
  if (first === 0) return events === 0 ? 0 : -Infinity;
  if (first === 1) return events === n ? 0 : -Infinity;
  const size = approximation === "two" ? n * first * first / second : n;
  const probability = approximation === "two" ? second / first : first;
  if (size < events) return -Infinity;
  const combination = logGamma(size + 1) - logGamma(events + 1) - logGamma(size - events + 1);
  return combination + (events ? events * Math.log(probability) : 0) + (size > events ? (size - events) * Math.log1p(-probability) : 0);
}

export function maic(values, target) {
  if (!Array.isArray(values) || values.length < 2 || !values.every(Number.isFinite) || !Number.isFinite(target))
    throw new Error("MAIC requires finite covariates and a target mean.");
  if (target <= Math.min(...values) || target >= Math.max(...values))
    throw new Error("No overlap: the target mean must lie strictly inside the observed covariate range.");
  let alpha = 0;
  const weightsAt = (a) => {
    const z = values.map((x) => a * (x - target));
    const shift = Math.max(...z);
    const w = z.map((v) => Math.exp(v - shift));
    const sum = w.reduce((s, v) => s + v, 0);
    return w.map((v) => v / sum);
  };
  let weights;
  let residual;
  for (let iteration = 0; iteration < 200; iteration++) {
    weights = weightsAt(alpha);
    const matched = dot(weights, values);
    residual = matched - target;
    if (Math.abs(residual) < 1e-10) break;
    const variance = dot(weights, values.map((x) => (x - matched) ** 2));
    let step = residual / Math.max(variance, 1e-15);
    while (Math.abs(dot(weightsAt(alpha - step), values) - target) >= Math.abs(residual) && Math.abs(step) > 1e-12) step /= 2;
    alpha -= step;
  }
  weights = weightsAt(alpha);
  residual = dot(weights, values) - target;
  if (Math.abs(residual) > 1e-7) throw new Error("MAIC calibration failed to converge.");
  return { alpha, weights, matchedMean: dot(weights, values), residual, ess: 1 / dot(weights, weights) };
}

export function maicMoments(values, target) {
  if (!Array.isArray(target) || !target.length || !target.every(Number.isFinite) || !Array.isArray(values) || values.length < 2 || !values.every((x) => Array.isArray(x) && x.length === target.length && x.every(Number.isFinite)))
    throw new Error("MAIC moment vectors must match the finite target vector.");
  if (target.length === 1) return maic(values.map((x) => x[0]), target[0]);
  let alpha = target.map(() => 0);
  const at = (a) => {
    const z = values.map((x) => dot(a, x.map((v, j) => v - target[j])));
    const shift = Math.max(...z);
    const raw = z.map((v) => Math.exp(v - shift));
    const sum = raw.reduce((s, v) => s + v, 0);
    const weights = raw.map((w) => w / sum);
    const matched = target.map((_, j) => dot(weights, values.map((x) => x[j])));
    const residual = matched.map((v, j) => v - target[j]);
    return { weights, matched, residual, norm: Math.hypot(...residual) };
  };
  for (let i = 0; i < 200; i++) {
    const current = at(alpha);
    if (current.norm < 1e-9) return { alpha, weights: current.weights, matchedMean: current.matched, residual: current.residual, ess: 1 / dot(current.weights, current.weights) };
    const covariance = target.map((_, j) => target.map((__, k) => dot(current.weights, values.map((x) => (x[j] - current.matched[j]) * (x[k] - current.matched[k])))));
    let inv;
    try { inv = inverse(covariance); } catch { throw new Error("MAIC moments are dependent or target overlap is insufficient."); }
    const step = inv.map((row) => dot(row, current.residual));
    let scale = 1;
    while (scale > 1e-10 && at(alpha.map((v, j) => v - scale * step[j])).norm >= current.norm) scale /= 2;
    alpha = alpha.map((v, j) => v - scale * step[j]);
  }
  throw new Error("MAIC cannot balance these moments: check overlap and redundant constraints.");
}

export function maicContrast(data, target, { bootstrap = 100, seed = 17 } = {}) {
  validatePopulationData(data);
  const family = data.family ?? "binary";
  if (!["binary", "normal"].includes(family)) throw new Error("The MAIC experiment supports binary and normal outcomes; censored survival needs a weighted survival estimator.");
  if (!Number.isInteger(bootstrap) || bootstrap < 0 || bootstrap > 1000) throw new Error("Use 0 to 1000 bootstrap replicates.");
  const treatments = [data.reference, ...new Set(data.ipd.filter((r) => r.treatment !== data.reference).map((r) => r.treatment))];
  if (treatments.length !== 2 || new Set(data.ipd.map((r) => r.study)).size !== 1) throw new Error("MAIC currently requires one two-arm IPD trial.");
  const vector = (x) => Array.isArray(x) ? x : [x];
  const targetPoints = populationPoints(target, 128).map(vector);
  const targetMeans = targetPoints[0].map((_, j) => mean(targetPoints.map((x) => x[j])));
  const estimate = (rows) => {
    const calibration = maicMoments(rows.map((r) => vector(r.x)), targetMeans);
    const risks = treatments.map((t) => {
      const indices = rows.map((r, i) => r.treatment === t ? i : -1).filter((i) => i >= 0);
      const mass = indices.reduce((s, i) => s + calibration.weights[i], 0);
      return indices.reduce((s, i) => s + calibration.weights[i] * rows[i].y, 0) / mass;
    });
    if (family === "binary" && risks.some((p) => !(p > 0 && p < 1))) throw new Error("No finite MAIC log odds ratio: both IPD arms need events and non-events.");
    return { ...calibration, treatments, risks, contrast: family === "binary" ? logit(risks[1]) - logit(risks[0]) : risks[1] - risks[0] };
  };
  const result = estimate(data.ipd);
  const arms = treatments.map((t) => data.ipd.filter((row) => row.treatment === t));
  const random = seededRandom(seed);
  const bootstrapContrasts = [];
  for (let i = 0; i < bootstrap; i++) {
    const rows = arms.flatMap((arm) => arm.map(() => arm[Math.floor(random() * arm.length)]));
    try { const value = estimate(rows).contrast; if (Number.isFinite(value)) bootstrapContrasts.push(value); } catch { /* Bootstrap resamples can lose overlap; failures are counted below. */ }
  }
  const bootstrapMean = mean(bootstrapContrasts);
  const se = bootstrapContrasts.length > 1 ? Math.sqrt(bootstrapContrasts.reduce((sum, x) => sum + (x - bootstrapMean) ** 2, 0) / (bootstrapContrasts.length - 1)) : null;
  const agdA = data.agd.find((row) => row.treatment === data.reference);
  const agdC = agdA && data.agd.find((row) => row.study === agdA.study && row.treatment !== data.reference);
  let anchored = null;
  if (agdC) {
    const matching = [agdA, agdC].every((arm) => {
      const points = populationPoints(arm.population, 128).map(vector);
      if (points.length !== targetPoints.length) return false;
      const ordered = points.map((x) => [...x]).sort((a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] - b[j]; return 0; });
      const targetOrdered = targetPoints.map((x) => [...x]).sort((a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] - b[j]; return 0; });
      return ordered.every((x, i) => x.every((v, j) => Math.abs(v - targetOrdered[i][j]) < 1e-8));
    });
    if (matching) {
      if (family === "binary" && [agdA, agdC].some((arm) => arm.events === 0 || arm.events === arm.n)) return { ...result, se, bootstrapSuccessful: bootstrapContrasts.length, bootstrapRequested: bootstrap, anchored: null, anchoredUnavailable: "Aggregate arms need events and non-events for a finite anchored log odds ratio." };
      const agdContrast = family === "binary" ? logit(agdC.events / agdC.n) - logit(agdA.events / agdA.n) : agdC.mean - agdA.mean;
      const variance = family === "binary" ? 1 / agdA.events + 1 / (agdA.n - agdA.events) + 1 / agdC.events + 1 / (agdC.n - agdC.events) : agdA.se ** 2 + agdC.se ** 2;
      anchored = { treatment: agdC.treatment, comparator: treatments[1], contrast: agdContrast - result.contrast, se: se === null ? null : Math.sqrt(variance + se ** 2) };
    }
  }
  return { ...result, se, bootstrapSuccessful: bootstrapContrasts.length, bootstrapRequested: bootstrap, anchored };
}

// Midpoint quadrature for an explicitly specified uniform covariate population.
export function populationPoints(population, n = 64) {
  if (population?.marginals) return populationIntegrationPoints({ ...population, points: n });
  if (Array.isArray(population?.points)) {
    if (!population.points.length || population.points.length > 2048 || !population.points.every((point) => Array.isArray(point) && point.length > 0 && point.every(Number.isFinite) && point.length === population.points[0].length))
      throw new Error("Empirical integration points must be equally sized finite vectors (at most 2048).");
    return population.points;
  }
  const { mean: center, width } = population ?? {};
  if (!Number.isFinite(center) || !Number.isFinite(width) || width < 0 || !Number.isInteger(n) || n < 2 || n > 2048)
    throw new Error("Population requires a finite mean, nonnegative half-width and 2 to 2048 integration points.");
  return Array.from({ length: n }, (_, i) => center + width * (2 * (i + 0.5) / n - 1));
}

export function conditionalLikelihood(family, outcome, eta, { sigma = 1, cutpoints = [-1, 1], shape = 1.3 } = {}) {
  if (!Number.isFinite(eta)) throw new Error("The linear predictor must be finite.");
  if (family === "binary") {
    if (outcome !== 0 && outcome !== 1) throw new Error("Binary outcomes must be zero or one.");
    return logistic(outcome ? eta : -eta);
  }
  if (family === "normal") {
    if (!Number.isFinite(outcome) || !(sigma > 0) || !Number.isFinite(sigma)) throw new Error("Normal outcomes require finite y and positive sigma.");
    return Math.exp(-0.5 * ((outcome - eta) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
  }
  if (family === "ordinal") {
    if (!Array.isArray(cutpoints) || !cutpoints.every((v, i) => Number.isFinite(v) && (!i || v > cutpoints[i - 1])) || !Number.isInteger(outcome) || outcome < 0 || outcome > cutpoints.length)
      throw new Error("Ordinal categories start at zero and cutpoints must increase.");
    const upper = outcome === cutpoints.length ? 1 : logistic(cutpoints[outcome] - eta);
    const lower = outcome === 0 ? 0 : logistic(cutpoints[outcome - 1] - eta);
    return upper - lower;
  }
  if (family === "survival") {
    if (!outcome || !(outcome.time > 0) || !Number.isFinite(outcome.time) || ![0, 1].includes(outcome.event) || !(shape > 0) || !Number.isFinite(shape))
      throw new Error("Survival requires positive time and shape, with event zero or one.");
    const rate = Math.exp(eta);
    return Math.exp(-rate * outcome.time ** shape) * (outcome.event ? shape * rate * outcome.time ** (shape - 1) : 1);
  }
  throw new Error("Unknown likelihood family.");
}

export function conditionalLogLikelihood(family, outcome, eta, parameters = {}) {
  if (family === "binary") return outcome * eta - softplus(eta);
  if (family === "normal") {
    const sigma = parameters.sigma ?? 1;
    return -0.5 * ((outcome - eta) / sigma) ** 2 - Math.log(sigma) - 0.5 * Math.log(2 * Math.PI);
  }
  if (family === "survival") {
    const shape = parameters.shape ?? 1.3;
    return outcome.event * (Math.log(shape) + eta + (shape - 1) * Math.log(outcome.time)) - Math.exp(eta) * outcome.time ** shape;
  }
  if (family === "ordinal") {
    const cuts = parameters.cutpoints ?? [-1, 1];
    if (!outcome) return -softplus(eta - cuts[0]);
    if (outcome === cuts.length) return -softplus(cuts.at(-1) - eta);
    const lower = cuts[outcome - 1] - eta, upper = cuts[outcome] - eta;
    return upper + Math.log1p(-Math.exp(lower - upper)) - softplus(lower) - softplus(upper);
  }
  throw new Error("Unknown likelihood family.");
}

export function integratedLikelihood(family, outcome, intercept, slope, population, n = 64, parameters = {}) {
  return mean(populationPoints(population, n).map((x) => conditionalLikelihood(family, outcome, intercept + slope * x, parameters)));
}

export function validatePopulationData(data) {
  if (!data || !Array.isArray(data.ipd) || !Array.isArray(data.agd) || data.ipd.length < 8 || data.ipd.length > 2000 || data.agd.length > 100)
    throw new Error("Provide 8 to 2000 IPD records and at most 100 aggregate records.");
  const family = data.family ?? "binary";
  if (!["binary", "normal", "ordinal", "survival"].includes(family)) throw new Error("Unsupported outcome family.");
  if (data.binomialApproximation && !["one", "two"].includes(data.binomialApproximation)) throw new Error("Choose one- or two-parameter binomial approximation.");
  const dimension = Array.isArray(data.ipd[0].x) ? data.ipd[0].x.length : 1;
  if (dimension < 1 || dimension > 5) throw new Error("Use one to five covariates.");
  for (const row of [...data.ipd, ...data.agd]) {
    if (typeof row.study !== "string" || !row.study || row.study.length > 50 || typeof row.treatment !== "string" || !row.treatment || row.treatment.length > 50)
      throw new Error("Every record needs a study and treatment name (1 to 50 characters).");
  }
  for (const row of data.ipd) {
    const x = Array.isArray(row.x) ? row.x : [row.x];
    if (x.length !== dimension || !x.every((v) => Number.isFinite(v) && Math.abs(v) <= 100)) throw new Error("IPD require equal-length covariate vectors with finite values within ±100.");
    conditionalLikelihood(family, row.y, 0, data.parameters);
  }
  for (const row of data.agd) {
    const points = populationPoints(row.population, 2);
    if (points.some((x) => (Array.isArray(x) ? x.length : 1) !== dimension)) throw new Error("Aggregate integration dimensions must match IPD covariates.");
    if (family === "binary" && (!Number.isInteger(row.n) || row.n < 1 || row.n > 1e7 || !Number.isInteger(row.events) || row.events < 0 || row.events > row.n))
      throw new Error("Aggregate binary arms require integer events between zero and n.");
    if (family === "normal" && (!Number.isFinite(row.mean) || !(row.se > 0) || !Number.isFinite(row.se))) throw new Error("Aggregate normal arms require a finite mean and positive known SE.");
    if (family === "ordinal" && (!Array.isArray(row.counts) || row.counts.length !== (data.parameters?.cutpoints ?? [-1, 1]).length + 1 || !row.counts.every((c) => Number.isInteger(c) && c >= 0) || !row.counts.some((c) => c > 0))) throw new Error("Ordinal arms require nonnegative category counts matching cutpoints.");
    if (family === "survival") conditionalLikelihood(family, row.y, 0, data.parameters);
  }
  if (typeof data.reference !== "string" || !data.ipd.some((row) => row.treatment === data.reference)) throw new Error("The reference treatment must occur in the IPD.");
  const ipdStudies = new Set(data.ipd.map((row) => row.study));
  if (data.agd.some((row) => ipdStudies.has(row.study))) throw new Error("Use distinct study IDs for IPD and AgD to avoid double counting.");
  const studies = new Map();
  for (const row of [...data.ipd, ...data.agd]) {
    if (!studies.has(row.study)) studies.set(row.study, new Set());
    studies.get(row.study).add(row.treatment);
  }
  if ([...studies.values()].some((arms) => arms.size < 2)) throw new Error("Each trial needs at least two treatments.");
  const reached = new Set([data.reference]);
  for (let i = 0; i < studies.size; i++) for (const arms of studies.values()) if ([...arms].some((arm) => reached.has(arm))) for (const arm of arms) reached.add(arm);
  if ([...studies.values()].some((arms) => [...arms].some((arm) => !reached.has(arm)))) throw new Error("The treatment network is disconnected.");
  if (studies.size + reached.size > 15) throw new Error("This browser laboratory supports at most 15 study plus treatment parameters.");
  return data;
}

function minimize(fn, start) {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => v + (i === j ? 0.2 : 0)))].map((x) => ({ x, f: fn(x) }));
  let iteration = 0;
  for (; iteration < 6000; iteration++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.max(...simplex.map((p) => Math.abs(p.f - simplex[0].f))) < 1e-9 && Math.max(...simplex.flatMap((p) => p.x.map((v, j) => Math.abs(v - simplex[0].x[j])))) < 2e-5) break;
    const center = start.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const trial = (factor) => {
      const x = center.map((v, j) => v + factor * (v - simplex[n].x[j]));
      return { x, f: fn(x) };
    };
    const reflected = trial(1);
    if (reflected.f < simplex[0].f) {
      const expanded = trial(2);
      simplex[n] = expanded.f < reflected.f ? expanded : reflected;
    } else if (reflected.f < simplex[n - 1].f) simplex[n] = reflected;
    else {
      const contracted = trial(reflected.f < simplex[n].f ? 0.5 : -0.5);
      if (contracted.f < Math.min(reflected.f, simplex[n].f)) simplex[n] = contracted;
      else simplex = simplex.map((p, i) => {
        if (!i) return p;
        const x = p.x.map((v, j) => (v + simplex[0].x[j]) / 2);
        return { x, f: fn(x) };
      });
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return { coefficients: simplex[0].x, nll: simplex[0].f, iterations: iteration, converged: iteration < 6000 };
}

export function fitPopulation(data, { method = "mlnmr", n = 64, modifiers = data.modifiers ?? "shared" } = {}) {
  validatePopulationData(data);
  if (!["mlnmr", "stc"].includes(method)) throw new Error("Choose ML-NMR or STC.");
  if (!["shared", "independent", "none"].includes(modifiers)) throw new Error("Modifiers must be shared, independent, or none.");
  const family = data.family ?? "binary";
  const vector = (x) => Array.isArray(x) ? x : [x];
  const covariates = vector(data.ipd[0].x).map((_, i) => data.covariates?.[i] ?? `x${i + 1}`);
  const agd = method === "stc" ? [] : data.agd;
  const rows = [...data.ipd, ...agd];
  const studies = [...new Set(rows.map((r) => r.study))];
  const treatments = [data.reference, ...new Set(rows.filter((r) => r.treatment !== data.reference).map((r) => r.treatment))];
  const modifierGroups = modifiers === "shared" ? ["active"] : modifiers === "independent" ? treatments.slice(1) : [];
  const names = [...studies.map((s) => `baseline:${s}`), ...treatments.slice(1).map((t) => `effect:${t}`), ...covariates.map((c) => `prognostic:${c}`), ...modifierGroups.flatMap((g) => covariates.map((c) => `modifier:${g}:${c}`))];
  if (names.length > 24) throw new Error("This laboratory supports at most 24 fitted coefficients.");
  const design = (row, x) => [...studies.map((s) => +(row.study === s)), ...treatments.slice(1).map((t) => +(row.treatment === t)), ...vector(x), ...modifierGroups.flatMap((g) => vector(x).map((v) => v * +(g === "active" ? row.treatment !== data.reference : row.treatment === g)))];
  const individual = data.ipd.map((row) => ({ ...row, design: design(row, row.x) }));
  const aggregate = agd.map((row) => ({ ...row, design: populationPoints(row.population, n).map((x) => design(row, x)) }));
  const objective = (b, aggregateRows = aggregate) => {
    if (!b.every(Number.isFinite)) return Infinity;
    let value = individual.reduce((s, row) => {
      const eta = dot(row.design, b);
      return s - conditionalLogLikelihood(family, row.y, eta, data.parameters);
    }, 0);
    for (const row of aggregateRows) {
      if (family === "binary") {
        if (data.binomialApproximation === "two") value -= aggregateBinaryLogLikelihood(row.events, row.n, row.design.map((x) => logistic(dot(x, b))), "two");
        else {
          if (row.events) value -= row.events * logMeanExp(row.design.map((x) => conditionalLogLikelihood("binary", 1, dot(x, b))));
          if (row.n > row.events) value -= (row.n - row.events) * logMeanExp(row.design.map((x) => conditionalLogLikelihood("binary", 0, dot(x, b))));
          value -= logGamma(row.n + 1) - logGamma(row.events + 1) - logGamma(row.n - row.events + 1);
        }
      } else if (family === "normal") {
        const expected = mean(row.design.map((x) => dot(x, b)));
        value -= conditionalLogLikelihood("normal", row.mean, expected, { sigma: row.se });
      } else if (family === "ordinal") {
        row.counts.forEach((count, category) => { if (count) value -= count * logMeanExp(row.design.map((x) => conditionalLogLikelihood("ordinal", category, dot(x, b), data.parameters))); });
      } else value -= logMeanExp(row.design.map((x) => conditionalLogLikelihood(family, row.y, dot(x, b), data.parameters)));
    }
    return Number.isFinite(value) ? value : Infinity;
  };
  const fit = minimize(objective, names.map(() => 0));
  const b = fit.coefficients;
  const h = 1e-4;
  const hessian = b.map((_, i) => b.map((__, j) => {
    if (i === j) {
      const plus = [...b], minus = [...b]; plus[i] += h; minus[i] -= h;
      return (objective(plus) - 2 * fit.nll + objective(minus)) / h ** 2;
    }
    let value = 0;
    for (const si of [-1, 1]) for (const sj of [-1, 1]) { const at = [...b]; at[i] += si * h; at[j] += sj * h; value += si * sj * objective(at); }
    return value / (4 * h ** 2);
  }));
  const eigenvalues = eigenSymmetric(hessian).values;
  const identifiable = Math.min(...eigenvalues) > Math.max(...eigenvalues) * 1e-7;
  const gradientMax = Math.max(...b.map((_, i) => { const p = [...b], m = [...b]; p[i] += h; m[i] -= h; return Math.abs((objective(p) - objective(m)) / (2 * h)); }));
  const linearPredict = (treatment, x, study = studies[0], coefficients = b) => {
    if (!treatments.includes(treatment) || !studies.includes(study) || vector(x).length !== covariates.length || !vector(x).every(Number.isFinite)) throw new Error("Prediction requires a fitted treatment, study and matching finite covariates.");
    return dot(design({ treatment, study }, x), coefficients);
  };
  return { ...fit, family, parameters: data.parameters, covariates, modifiers, converged: fit.converged && gradientMax < 0.01, identifiable, gradientMax, names, studies, treatments, logLikelihood: (coefficients) => -objective(coefficients), integrationLogLikelihood: (coefficients, count) => -objective(coefficients, agd.map((row) => ({ ...row, design: populationPoints(row.population, count).map((x) => design(row, x)) }))), covariance: identifiable ? inverse(hessian) : null, linearPredict,
    predict: (treatment, x, study = studies[0], outcome = null, coefficients = b) => {
      const eta = linearPredict(treatment, x, study, coefficients);
      if (outcome !== null) return conditionalLikelihood(family, outcome, eta, data.parameters);
      return family === "binary" ? logistic(eta) : family === "normal" ? eta : family === "survival" ? Math.exp(-Math.exp(eta)) : conditionalLikelihood("ordinal", 0, eta, data.parameters);
    } };
}

export function standardizePopulation(fit, population, n = 128) {
  const points = populationPoints(population, n);
  const risks = Object.fromEntries(fit.treatments.map((t) => [t, mean(points.map((x) => fit.predict(t, x)))]));
  const reference = fit.treatments[0];
  const marginalLogits = fit.family === "binary" ? Object.fromEntries(fit.treatments.map((t) => [t, logMeanExp(points.map((x) => conditionalLogLikelihood("binary", 1, fit.linearPredict(t, x)))) - logMeanExp(points.map((x) => conditionalLogLikelihood("binary", 0, fit.linearPredict(t, x))))])) : null;
  return fit.treatments.map((t) => ({ treatment: t, risk: risks[t], marginalLogOR: marginalLogits ? marginalLogits[t] - marginalLogits[reference] : null, conditionalLogOR: mean(points.map((x) => fit.linearPredict(t, x) - fit.linearPredict(reference, x))) }));
}

export function populationExample(family = "binary") {
  // Synthetic, deterministic binary records. No source trial or clinical claim.
  let seed = 82311;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const ipd = [];
  for (const treatment of ["A", "B"]) for (let i = 0; i < 120; i++) {
    const x = -1.5 + 3 * (i + 0.5) / 120;
    const p = logistic(-0.5 + 0.7 * x + (treatment === "B" ? -0.8 + 0.9 * x : 0));
    ipd.push({ study: "AB", treatment, x, y: +(random() < p) });
  }
  const population = { mean: 0.8, width: 1.5 };
  const agd = ["A", "C"].map((treatment) => {
    const p = mean(populationPoints(population, 1024).map((x) => logistic(-0.3 + 0.7 * x + (treatment === "C" ? -0.4 + 0.9 * x : 0))));
    return { study: "AC", treatment, population, n: 200, events: Math.round(200 * p) };
  });
  if (family === "binary") return { reference: "A", family, ipd, agd };
  const parameters = { sigma: 1, cutpoints: [-1, 1], shape: 1.3 };
  const eta = (treatment, x, study) => (study === "AB" ? -0.5 : -0.3) + 0.7 * x + (treatment === "A" ? 0 : (treatment === "B" ? -0.8 : -0.4) + 0.9 * x);
  for (const row of ipd) {
    const linear = eta(row.treatment, row.x, row.study);
    if (family === "normal") row.y = linear + Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
    else if (family === "ordinal") { const u = random(); row.y = u < logistic(-1 - linear) ? 0 : u < logistic(1 - linear) ? 1 : 2; }
    else if (family === "survival") { const time = (-Math.log(Math.max(random(), 1e-12)) / Math.exp(linear)) ** (1 / parameters.shape); row.y = { time: Math.min(1, time), event: +(time <= 1) }; }
    else throw new Error("Unknown example family.");
  }
  const generalAgd = [];
  for (const treatment of ["A", "C"]) {
    const arm = { study: "AC", treatment, population };
    if (family === "normal") generalAgd.push({ ...arm, mean: eta(treatment, population.mean, "AC"), se: 0.15 });
    else if (family === "ordinal") {
      const probabilities = [0, 1, 2].map((category) => mean(populationPoints(population, 1024).map((x) => conditionalLikelihood(family, category, eta(treatment, x, "AC"), parameters))));
      const counts = probabilities.map((p) => Math.floor(200 * p)); counts[2] += 200 - counts.reduce((s, v) => s + v, 0);
      generalAgd.push({ ...arm, counts });
    } else for (let i = 0; i < 40; i++) {
      const x = population.mean + population.width * (2 * random() - 1);
      const time = (-Math.log(Math.max(random(), 1e-12)) / Math.exp(eta(treatment, x, "AC"))) ** (1 / parameters.shape);
      generalAgd.push({ ...arm, y: { time: Math.min(1, time), event: +(time <= 1) } });
    }
  }
  return { reference: "A", family, parameters, ipd, agd: generalAgd };
}
