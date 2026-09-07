import { apply, identity, zeros } from './matrix.js';

// Joe-Kuo D(6), dimensions 2 to 8: https://web.maths.unsw.edu.au/~fkuo/sobol/
const DIRECTIONS = [[1, 0, [1]], [2, 1, [1, 3]], [3, 1, [1, 3, 1]],
  [3, 2, [1, 1, 1]], [4, 1, [1, 1, 3, 3]], [4, 4, [1, 3, 5, 13]],
  [5, 2, [1, 1, 5, 5, 17]]];

export function seededRandom(seed = 1) {
  if (!Number.isSafeInteger(seed)) throw new Error('Seed must be a safe integer.');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

// Acklam's rational normal quantile approximation (absolute error ~1e-8).
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new Error('Normal quantile requires 0 < p < 1.');
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const poly = (coefficients, x) => coefficients.reduce((v, coefficient) => v * x + coefficient, 0);
  if (p < 0.02425 || p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
    const value = poly(c, q) / (poly(d, q) * q + 1);
    return p < 0.5 ? value : -value;
  }
  const q = p - 0.5, r = q * q;
  return q * poly(a, r) / (poly(b, r) * r + 1);
}

export function normalCDF(x) {
  if (x === 0) return 0.5;
  const z = Math.abs(x), t = 1 / (1 + 0.2316419 * z);
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - tail : tail;
}

/** Full Sobol net including the zero point. Random digital shifting places
 * integration points strictly inside (0,1); seed=null exposes the raw fixture. */
export function sobolPoints(count, dimensions, { seed = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 1048576 || (count & (count - 1)))
    throw new Error('Sobol count must be a power of two between 1 and 1048576.');
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 8)
    throw new Error('Sobol integration supports 1 to 8 covariates.');
  const random = seed === null ? null : seededRandom(seed);
  const shifts = Array.from({ length: dimensions }, () => random ? Math.floor(random() * 4294967296) : 0);
  const directions = Array.from({ length: dimensions }, (_, dimension) => {
    const v = new Uint32Array(33);
    if (dimension === 0) {
      for (let bit = 1; bit <= 32; bit++) v[bit] = 2 ** (32 - bit);
    } else {
      const [degree, polynomial, initial] = DIRECTIONS[dimension - 1];
      for (let bit = 1; bit <= degree; bit++) v[bit] = initial[bit - 1] * 2 ** (32 - bit);
      for (let bit = degree + 1; bit <= 32; bit++) {
        v[bit] = v[bit - degree] ^ (v[bit - degree] >>> degree);
        for (let k = 1; k < degree; k++)
          if ((polynomial >>> (degree - 1 - k)) & 1) v[bit] ^= v[bit - k];
      }
    }
    return v;
  });
  const state = new Uint32Array(dimensions);
  return Array.from({ length: count }, (_, i) => {
    if (i > 0) {
      let bit = 1, index = i;
      while ((index & 1) === 0) { bit++; index >>>= 1; }
      for (let j = 0; j < dimensions; j++) state[j] ^= directions[j][bit];
    }
    return Array.from(state, (value, j) => (((value ^ shifts[j]) >>> 0) + (random ? 0.5 : 0)) / 4294967296);
  });
}

function correlationFactor(correlation, dimension) {
  const C = correlation ?? identity(dimension), L = zeros(dimension, dimension);
  if (!Array.isArray(C) || C.length !== dimension || C.some(row => !Array.isArray(row) || row.length !== dimension))
    throw new Error('Correlation matrix dimensions do not match the marginals.');
  for (let i = 0; i < dimension; i++) for (let j = 0; j <= i; j++) {
    if (!Number.isFinite(C[i][j]) || !Number.isFinite(C[j][i]) || Math.abs(C[i][j]) > 1 || Math.abs(C[i][j] - C[j][i]) > 1e-10 ||
        (i === j && Math.abs(C[i][i] - 1) > 1e-10)) throw new Error('Invalid symmetric correlation matrix.');
    let residual = C[i][j];
    for (let k = 0; k < j; k++) residual -= L[i][k] * L[j][k];
    if (i === j) {
      if (residual <= 1e-12) throw new Error('Correlation matrix must be positive definite.');
      L[i][j] = Math.sqrt(residual);
    } else L[i][j] = residual / L[j][j];
  }
  return L;
}

function marginalQuantile(marginal) {
  const { type, mean = 0, sd = 1, min, max, probability } = marginal ?? {};
  if (type === 'normal' || type === 'lognormal' || type === 'logitnormal') {
    if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd < 0) throw new Error('Invalid normal-scale marginal parameters.');
    return p => {
      const z = mean + sd * normalQuantile(p);
      return type === 'normal' ? z : type === 'lognormal' ? Math.exp(z) : 1 / (1 + Math.exp(-z));
    };
  }
  if (type === 'bernoulli') {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Bernoulli probability must be in [0,1].');
    return p => p > 1 - probability ? 1 : 0;
  }
  if (type === 'uniform') {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new Error('Uniform minimum must be below maximum.');
    return p => min + (max - min) * p;
  }
  if (type === 'custom' && typeof marginal.quantile === 'function') return marginal.quantile;
  throw new Error('Supported marginals: normal, lognormal, logitnormal, bernoulli, uniform, custom quantile.');
}

/** Phillippo thesis equations 5.3 to 5.6. Correlation is the latent Gaussian
 * copula parameter, NOT necessarily Pearson correlation after transformation.
 * Lognormal/logitnormal mean and sd parameterize the underlying normal. */
export function populationIntegrationPoints({ marginals, correlation, points = 1024, seed = 1 }) {
  if (!Array.isArray(marginals) || !marginals.length) throw new Error('Provide at least one covariate marginal.');
  const quantiles = marginals.map(marginalQuantile), L = correlationFactor(correlation, marginals.length);
  return sobolPoints(points, marginals.length, { seed }).map(u => {
    const z = apply(L, u.map(normalQuantile));
    return z.map((value, j) => {
      const p = Math.max(1e-15, Math.min(1 - 1e-15, normalCDF(value)));
      const x = quantiles[j](p);
      if (!Number.isFinite(x)) throw new Error('Marginal quantile returned a nonfinite value.');
      return x;
    });
  });
}

/** Replicate digital shifts estimate randomization error; prefix differences
 * implement equation 5.7 and are NOT an absolute error bound. */
export function integratePopulation(fn, { replicates = 8, seed = 1, ...options }) {
  if (typeof fn !== 'function' || !Number.isInteger(replicates) || replicates < 2 || replicates > 64)
    throw new Error('Provide an integrand and 2 to 64 replicate shifts.');
  const series = [];
  for (let r = 0; r < replicates; r++) {
    const values = populationIntegrationPoints({ ...options, seed: seed + r * 104729 }).map(fn);
    if (values.some(value => !Number.isFinite(value))) throw new Error('Integrand returned a nonfinite value.');
    let sum = 0;
    const prefixes = [];
    values.forEach((value, i) => { sum += value; if (((i + 1) & i) === 0) prefixes.push({ points: i + 1, estimate: sum / (i + 1) }); });
    series.push(prefixes);
  }
  const history = series[0].map((entry, j) => {
    const estimates = series.map(prefixes => prefixes[j].estimate);
    const estimate = estimates.reduce((a, b) => a + b, 0) / replicates;
    return { points: entry.points, estimate,
      standardError: Math.sqrt(estimates.reduce((sum, value) => sum + (value - estimate) ** 2, 0) / (replicates * (replicates - 1))) };
  });
  const result = history.at(-1);
  return { ...result, replicates, method: 'Digitally shifted Sobol Gaussian-copula QMC',
    history: history.map(row => ({ ...row, empiricalError: row.estimate - result.estimate })) };
}
