import { sampleHierarchicalPopulation } from './population-hierarchical.js';
import { fitPopulation } from './population.js';
import { samplePosterior } from './posterior.js';

self.onmessage = ({ data: { dataset, options = {}, mode } }) => {
  try {
    let result;
    if (mode === 'fixed') {
      const fit = fitPopulation(dataset, { method: options.method ?? 'mlnmr', modifiers: options.modifiers });
      const scales = fit.coefficients.map((_, j) => fit.covariance ? Math.max(0.02, Math.min(1, Math.sqrt(Math.abs(fit.covariance[j][j])))) : 0.2);
      const initial = [-1.5, -0.5, 0.5, 1.5].map(offset => fit.coefficients.map((b, j) => b + offset * scales[j]));
      result = samplePosterior(b => fit.logLikelihood(b) - b.reduce((s, v) => s + 0.5 * (v / 2.5) ** 2, 0),
        { initial, proposalScale: scales, seed: options.seed ?? 7213, draws: options.draws ?? 1000, warmup: options.warmup ?? 500 });
    } else result = sampleHierarchicalPopulation(dataset, options);
    self.postMessage({ result });
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
