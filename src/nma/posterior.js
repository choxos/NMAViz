import { seededRandom } from './integration.js';

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const variance = values => { const m = mean(values); return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1); };

/** Classical split-Rhat and Geyer initial monotone sequence ESS, not the
 * rank-normalized/folded diagnostics of current Stan. MCSE targets the mean.
 * https://mc-stan.org/docs/2_31/reference-manual/effective-sample-size.html */
export function posteriorDiagnostics(chains) {
  if (!Array.isArray(chains) || chains.length < 2 || !Array.isArray(chains[0]) || chains[0].length < 8)
    throw new Error('Diagnostics require at least two chains of eight draws.');
  const draws = chains[0].length, dimension = chains[0][0]?.length;
  if (!dimension || chains.some(chain => chain.length !== draws || chain.some(row => !Array.isArray(row) || row.length !== dimension || row.some(x => !Number.isFinite(x)))))
    throw new Error('Posterior chains must have equal dimensions and finite draws.');
  const half = Math.floor(draws / 2);
  const split = chains.flatMap(chain => [chain.slice(0, half), chain.slice(-half)]);
  const parameters = Array.from({ length: dimension }, (_, parameter) => {
    const series = split.map(chain => chain.map(row => row[parameter]));
    const means = series.map(mean), within = mean(series.map(variance));
    const between = half * variance(means);
    const marginalVariance = (half - 1) / half * within + between / half;
    const rhat = within > 0 ? Math.sqrt(marginalVariance / within) : Infinity;
    const all = chains.flatMap(chain => chain.map(row => row[parameter]));
    const sd = Math.sqrt(variance(all));
    if (!(within > 0) || !(marginalVariance > 0))
      return { mean: mean(all), sd, rhat: Infinity, ess: 0, mcse: Infinity };
    const rho = lag => {
      if (lag === 0) return 1;
      let covariance = 0;
      series.forEach((values, chain) => {
        for (let i = 0; i < half - lag; i++) covariance += (values[i] - means[chain]) * (values[i + lag] - means[chain]);
      });
      covariance /= series.length * half;
      return 1 - (within - covariance) / marginalVariance;
    };
    let pairSum = 0, previousPair = Infinity;
    // ponytail: direct autocovariances suit short teaching chains; use FFT for long chains.
    for (let lag = 0; lag + 1 < half; lag += 2) {
      const pair = Math.min(previousPair, rho(lag) + rho(lag + 1));
      if (pair <= 0) break;
      pairSum += pair;
      previousPair = pair;
    }
    const ess = Math.min(all.length, all.length / Math.max(1, -1 + 2 * pairSum));
    return { mean: mean(all), sd, rhat, ess, mcse: sd / Math.sqrt(ess) };
  });
  return { parameters, rhat: parameters.map(p => p.rhat), ess: parameters.map(p => p.ess),
    mcse: parameters.map(p => p.mcse),
    converged: parameters.every(p => p.rhat < 1.01 && p.ess >= 400),
    method: 'Classical split-Rhat; Geyer initial monotone ESS; mean MCSE',
    warning: 'Diagnostics cannot prove convergence. This teaching sampler is not Stan/NUTS; inspect traces and sensitivity to initialization.' };
}

/** Componentwise random-walk Metropolis. Proposal adaptation ends at warmup;
 * retained draws target the supplied log density, including its actual prior. */
export function samplePosterior(logDensity, { initial, draws = 500, warmup = 500, seed = 1, proposalScale = 0.5 } = {}) {
  if (typeof logDensity !== 'function' || !Array.isArray(initial) || initial.length < 2 || initial.length > 8)
    throw new Error('Supply a log density and 2 to 8 dispersed initial chain vectors.');
  const dimension = initial[0]?.length;
  if (!dimension || dimension > 40 || initial.some(row => !Array.isArray(row) || row.length !== dimension || row.some(value => !Number.isFinite(value))))
    throw new Error('Initial chains must contain 1 to 40 finite parameters with matching dimensions.');
  if (!Number.isInteger(draws) || draws < 8 || draws > 20000 || !Number.isInteger(warmup) || warmup < 0 || warmup > 20000)
    throw new Error('Use 8 to 20000 retained draws and 0 to 20000 warmup iterations.');
  const scales = Array.isArray(proposalScale) ? proposalScale : new Array(dimension).fill(proposalScale);
  if (scales.length !== dimension || scales.some(x => !Number.isFinite(x) || x <= 0)) throw new Error('Proposal scales must be finite and positive.');
  const random = seededRandom(seed);
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  let evaluations = 0, invalidProposals = 0;
  const evaluate = x => {
    const value = logDensity(x);
    evaluations++;
    if (Number.isNaN(value) || value === Infinity || typeof value !== 'number')
      throw new Error('Log density must return a finite number or -Infinity outside its support.');
    return value;
  };
  const acceptance = [], finalProposalScales = [];
  const chains = initial.map(start => {
    let state = [...start], density = evaluate(state);
    if (!Number.isFinite(density)) throw new Error('Every initial vector must have finite log density.');
    const logScales = scales.map(Math.log), retained = [], accepted = new Array(dimension).fill(0);
    for (let iteration = 0; iteration < warmup + draws; iteration++) {
      for (let j = 0; j < dimension; j++) {
        const candidate = [...state];
        candidate[j] += Math.exp(logScales[j]) * normal();
        const proposedDensity = candidate.every(Number.isFinite) ? evaluate(candidate) : -Infinity;
        if (proposedDensity === -Infinity) invalidProposals++;
        const accept = Math.log(random()) < proposedDensity - density;
        if (accept) { state = candidate; density = proposedDensity; }
        if (iteration < warmup) {
          const rate = 1 / (iteration + 10) ** 0.6;
          logScales[j] = Math.max(-20, Math.min(20, logScales[j] + rate * (Number(accept) - 0.44)));
        } else if (accept) accepted[j]++;
      }
      if (iteration >= warmup) retained.push([...state]);
    }
    acceptance.push(accepted.map(count => count / draws));
    finalProposalScales.push(logScales.map(Math.exp));
    return retained;
  });
  const diagnostics = posteriorDiagnostics(chains);
  diagnostics.acceptance = acceptance;
  diagnostics.converged &&= acceptance.every(row => row.every(value => value > 0.05 && value < 0.95));
  return { chains, diagnostics, evaluations, invalidProposals, finalProposalScales,
    method: 'Seeded componentwise random-walk Metropolis with warmup-only scale adaptation', warmup, draws, seed };
}
