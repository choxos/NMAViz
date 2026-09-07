import { fitPopulation, populationExample, populationPoints, standardizePopulation, maicContrast, logit, validatePopulationData } from "../../nma/population.js";
import { escape, number, percent } from "../ui.js";

const fits = new Map();
const datasets = new Map();
const calibrations = new Map();
const posteriors = new WeakMap();
const advancedResults = new Map();
let sampling = null;
const average = (values) => values.reduce((s, v) => s + v, 0) / values.length;
const vector = (x) => Array.isArray(x) ? x : [x];

function dataFor(state) {
  let data;
  if (state.options.populationData) data = JSON.parse(state.options.populationData);
  else {
    const family = state.options.populationFamily ?? "binary";
    if (!datasets.has(family)) datasets.set(family, populationExample(family));
    data = datasets.get(family);
  }
  return state.options.populationBinaryApproximation ? { ...data, binomialApproximation: state.options.populationBinaryApproximation } : data;
}

function experiment(state) {
  const data = dataFor(state);
  const method = state.options.populationMethod ?? "mlnmr";
  const modifiers = state.options.populationModifiers ?? data.modifiers ?? "shared";
  const key = JSON.stringify([data, method === "maic" ? "mlnmr" : method, modifiers]);
  if (!fits.has(key)) {
    if (fits.size > 10) fits.clear();
    fits.set(key, fitPopulation(data, { method: method === "maic" ? "mlnmr" : method, modifiers }));
  }
  const fit = fits.get(key);
  const population = data.target ?? data.agd[0]?.population ?? { points: data.ipd.map((row) => vector(row.x)) };
  const points = populationPoints(population, 128).map(vector);
  const originalMean = average(points.map((x) => x[0]));
  const targetMean = Number(state.options.populationTarget ?? originalMean);
  const target = { points: points.map((x) => x.map((v, j) => j ? v : v + targetMean - originalMean)) };
  let standardized = standardizePopulation(fit, target);
  const sourceMean = average(data.ipd.map((row) => vector(row.x)[0]));
  const source = { points: target.points.map((x) => x.map((v, j) => j ? v : v + sourceMean - targetMean)) };
  let sourceResult = standardizePopulation(fit, source);
  let calibration;
  if (method === "maic") {
    const calibrationKey = JSON.stringify([data, target]);
    if (!calibrations.has(calibrationKey)) {
      if (calibrations.size > 10) calibrations.clear();
      calibrations.set(calibrationKey, maicContrast(data, target));
    }
    calibration = calibrations.get(calibrationKey);
    const sourceRisks = calibration.treatments.map((t) => average(data.ipd.filter((r) => r.treatment === t).map((r) => r.y)));
    const sourceContrast = fit.family === "binary" ? logit(sourceRisks[1]) - logit(sourceRisks[0]) : sourceRisks[1] - sourceRisks[0];
    standardized = calibration.treatments.map((treatment, i) => ({ treatment, risk: calibration.risks[i], conditionalLogOR: i ? calibration.contrast : 0, marginalLogOR: i ? calibration.contrast : 0 }));
    sourceResult = calibration.treatments.map((treatment, i) => ({ treatment, risk: sourceRisks[i], conditionalLogOR: i ? sourceContrast : 0 }));
  }
  const delta = standardized[1].conditionalLogOR - sourceResult[1].conditionalLogOR;
  const answer = Math.abs(delta) < 1e-6 ? "same" : delta > 0 ? "higher" : "lower";
  const response = state.options.populationPrediction;
  const revealed = !!response;
  return { data, method, fit, target, targetMean, sourceMean, standardized, sourceResult, delta, answer, response, revealed, calibration };
}

function advancedOptions(state, target) {
  return { modifiers: state.options.populationHierarchy ?? "exchangeable", randomEffects: state.options.populationRandom !== "no", consistency: state.options.populationConsistency ?? "consistent", draws: Number(state.options.populationDraws ?? 1000), warmup: dataFor(state).sampling?.warmup ?? 500, seed: dataFor(state).sampling?.seed ?? 817, n: 64, target, priors: dataFor(state).priors };
}

function button(option, value, label, selected) {
  return `<button type="button" class="deck-button${selected ? " primary" : ""}" data-option="${option}" data-value="${escape(value)}" aria-pressed="${!!selected}">${escape(label)}</button>`;
}

function editor(data, state) {
  return `<details class="inspector-section"><summary>Edit the population experiment</summary>
    <p>Data stay in this browser. IPD use study, treatment, x (number or vector), y. Aggregate binary arms use n/events; normal arms use mean/se; ordinal arms use category counts; survival records use y:{time,event} with covariates marginalized. Each aggregate record specifies population.</p>
    <p>Population accepts {mean,width} for uniform midpoint integration, {points:[[x1,x2],…]} for an empirical distribution, or {marginals:[{type:"normal",mean:0,sd:1},{type:"bernoulli",probability:0.4}],correlation:[[1,0.2],[0.2,1]]} for Sobol/copula integration. Correlation is on the latent Gaussian scale. Optional target uses the same schema.</p>
    <p>Normal sigma, ordinal cutpoints, and Weibull shape are supplied in parameters and treated as known. Up to five covariates; modifiers may be shared, independent, or none. Covariates are assumed measured without error.</p>
    <label for="population-data">Experiment JSON</label><textarea id="population-data" rows="12" spellcheck="false">${escape(JSON.stringify(data, null, 2))}</textarea>
    <button type="button" class="deck-button" data-population-action="import">Validate and fit data</button>
    <button type="button" class="deck-button" data-population-action="export">Export experiment JSON</button>
    <button type="button" class="deck-button" data-population-action="reset">Reset example</button>
    ${state.options.populationError ? `<p role="alert">${escape(state.options.populationError)}</p>` : ""}</details>`;
}

export const populationLens = {
  id: "population", name: "Population", tagline: "Transport an effect to the people who need it",
  reference: "Phillippo DM. Population adjustment methods for indirect comparisons: a review and development of multilevel network meta-regression. PhD thesis. Chapters 2, 4, 5 and 7.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="6" r="3"/><circle cx="17" cy="6" r="3"/><path d="M2 20v-5a5 5 0 0 1 10 0v5M12 20v-5a5 5 0 0 1 10 0v5"/></svg>',
  spatial: false, animate: false, deck: true,

  handleAction(action, rootElement, state, onUpdate = () => {}) {
    if (!["import", "export", "reset", "posterior", "hierarchical", "cancel"].includes(action)) return false;
    try {
      if (action === "import") {
        const text = rootElement.querySelector("#population-data")?.value;
        if (!text || text.length > 500000) throw new Error("Provide JSON below 500 KB.");
        const data = validatePopulationData(JSON.parse(text));
        fitPopulation(data);
        state.options.populationData = JSON.stringify(data);
        delete state.options.populationTarget;
        delete state.options.populationModifiers;
        delete state.options.populationPrediction;
      } else if (action === "cancel") {
        sampling?.worker.terminate(); sampling = null;
      } else if (action === "posterior" || action === "hierarchical") {
        if (sampling) throw new Error("A sampler is already running; cancel it before starting another.");
        const run = experiment(state);
        const options = action === "hierarchical" ? advancedOptions(state, run.target) : { method: run.method === "stc" ? "stc" : "mlnmr", modifiers: run.fit.modifiers, draws: Number(state.options.populationDraws ?? 1000), warmup: run.data.sampling?.warmup ?? 500, seed: run.data.sampling?.seed ?? 7213 };
        const key = JSON.stringify([run.data, options]);
        const worker = new Worker(new URL("../../nma/population-worker.js", import.meta.url), { type: "module" });
        sampling = { worker, key, action, fit: run.fit };
        worker.onmessage = ({ data: message }) => {
          if (message.error) state.options.populationError = message.error;
          else if (action === "hierarchical") { if (advancedResults.size > 10) advancedResults.clear(); advancedResults.set(key, message.result); }
          else posteriors.set(run.fit, message.result);
          worker.terminate(); sampling = null; onUpdate();
        };
        worker.onerror = (error) => { state.options.populationError = error.message; worker.terminate(); sampling = null; onUpdate(); };
        worker.postMessage({ mode: action === "posterior" ? "fixed" : "hierarchical", dataset: run.data, options });
      } else if (action === "reset") {
        for (const key of Object.keys(state.options)) if (key.startsWith("population")) delete state.options[key];
      } else {
        const blob = new Blob([JSON.stringify(dataFor(state), null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "population-experiment.json"; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      delete state.options.populationError;
    } catch (error) { state.options.populationError = error.message; }
    return true;
  },

  draw({ state, box }) {
    let run;
    try { run = experiment(state); }
    catch (error) {
      return { stage: `<text x="80" y="160" fill="var(--lcd-ink)">Population experiment needs correction</text>`, inspector: `<h2>Could not fit this experiment</h2><p role="alert">${escape(error.message)}</p>${editor(dataFor(state), state)}`, controls: `${button("populationMethod", "mlnmr", "ML-NMR", false)}${button("populationMethod", "stc", "STC", false)}${button("populationTarget", "0", "Target 0", false)}${button("populationFamily", "binary", "Binary example", false)}`, note: "Correct the data, change method, or reset the example." };
    }
    const { data, method, fit, targetMean, sourceMean, standardized, sourceResult, delta, answer, response, revealed, calibration } = run;
    const storedPosterior = posteriors.get(fit);
    const posterior = storedPosterior?.draws === Number(state.options.populationDraws ?? 1000) && storedPosterior?.warmup === (data.sampling?.warmup ?? 500) && storedPosterior?.seed === (data.sampling?.seed ?? 7213) ? storedPosterior : null;
    const hierarchyOptions = advancedOptions(state, run.target);
    const hierarchyKey = JSON.stringify([data, hierarchyOptions]);
    const hierarchy = advancedResults.get(hierarchyKey);
    const advancedMarkup = hierarchy ? `<p role="status">${hierarchy.diagnostics.converged ? "Displayed sampler diagnostic thresholds passed." : "Sampler diagnostics failed; posterior summaries are exploratory and must not be used as reliable inference."}</p>
      <p>${escape(hierarchy.priorDescription)}. Posterior mean deviance: ${number(hierarchy.deviance?.mean, 2)}. This is fit to these observations, not cross-validation.</p>
      <table class="study-table"><thead><tr><th>Parameter</th><th>Posterior mean</th><th>95% interval</th><th>R̂</th><th>ESS</th></tr></thead><tbody>${hierarchy.parameters.map((p, i) => `<tr><td>${escape(p.name)}</td><td>${number(p.mean, 3)}</td><td>${number(p.lower, 3)} to ${number(p.upper, 3)}</td><td>${number(hierarchy.diagnostics.parameters[i].rhat, 3)}</td><td>${number(hierarchy.diagnostics.parameters[i].ess, 0)}</td></tr>`).join("")}</tbody></table>
      ${hierarchy.target ? `<p>Target standardized with study ${escape(hierarchy.targetBaselineStudy)} baseline.</p><table class="study-table"><thead><tr><th>Treatment</th><th>Target response</th><th>95% interval</th></tr></thead><tbody>${hierarchy.target.map((r) => `<tr><td>${escape(r.treatment)}</td><td>${number(r.response.mean, 3)}</td><td>${number(r.response.lower, 3)} to ${number(r.response.upper, 3)}</td></tr>`).join("")}</tbody></table>` : "<p>The unrelated-effects model has no coherent network-wide target ranking.</p>"}
      <p>${escape(Array.isArray(hierarchy.limitations) ? hierarchy.limitations.join(" ") : hierarchy.limitations)}</p>` : "";
    const integrationDifference = fit.integrationLogLikelihood(fit.coefficients, 128) - fit.logLikelihood(fit.coefficients);
    const posteriorMarkup = posterior ? `<p role="status">${posterior.diagnostics.converged ? "The displayed diagnostic thresholds passed." : "Sampling diagnostics have not passed; do not treat these draws as reliable posterior inference."} Four chains, ${posterior.warmup} warmup and ${posterior.draws} retained draws per chain. Classical split-R̂ must be below 1.01, ESS at least 400, and acceptance within 0.05 to 0.95.</p><table class="study-table"><thead><tr><th>Coefficient</th><th>Posterior mean</th><th>R̂</th><th>ESS</th><th>MCSE</th></tr></thead><tbody>${posterior.diagnostics.parameters.map((p, i) => `<tr><td>${escape(fit.names[i])}</td><td>${number(p.mean, 3)}</td><td>${number(p.rhat, 3)}</td><td>${number(p.ess, 0)}</td><td>${number(p.mcse, 3)}</td></tr>`).join("")}</tbody></table><p>These are genuine Metropolis posterior draws with independent Normal(0, 2.5²) coefficient priors, not the likelihood estimates in the chart. Diagnostics are classical rather than rank-normalized. Short chains can fail, particularly with correlated coefficients.</p>` : "";
    const width = (box?.right ?? 850) - (box?.left ?? 70);
    const left = (box?.left ?? 70) + 20;
    const top = (box?.top ?? 90) + 16;
    const bottom = (box?.bottom ?? top + 340) - 16;
    const firstRow = top + Math.min(82, (bottom - top) * 0.4);
    const rowGap = Math.min(70, (bottom - firstRow) / Math.max(1, standardized.length - 1));
    const rowFont = Math.min(16, Math.max(8, rowGap * 0.65));
    const familyLabel = { binary: "event probability", normal: "mean outcome", ordinal: "category 0 probability", survival: "survival at time 1" }[fit.family];
    const minimum = fit.family === "normal" ? Math.min(0, ...standardized.map((row) => row.risk)) : 0;
    const maximum = fit.family === "normal" ? Math.max(1, ...standardized.map((row) => row.risk)) : 1;
    const bars = standardized.map((row, i) => {
      const y = firstRow + i * rowGap;
      const barWidth = revealed ? Math.max(2, (row.risk - minimum) / (maximum - minimum) * Math.max(60, width - 170)) : 70;
      return `<g><text x="${left}" y="${y}" fill="var(--lcd-ink)" font-size="${rowFont}">${escape(row.treatment)}</text><rect x="${left + 40}" y="${y - rowFont}" width="${barWidth}" height="${Math.min(24, rowGap * 0.6)}" rx="4" fill="${i ? "var(--lcd-accent)" : "var(--lcd-ink)"}" opacity="${revealed ? 0.8 : 0.18}"/><text x="${left + width - 90}" y="${y}" fill="var(--lcd-ink)" font-size="${rowFont}">${revealed ? number(row.risk, 3) : "?"}</text></g>`;
    }).join("");
    const feedback = revealed ? response === "reveal" ? "Results revealed without a scored prediction." : response === answer ? "Correct. You transported the comparison to the target population." : `Try the next target: the fitted average conditional contrast is ${answer}.` : "Predict before revealing the fitted results.";
    const coefficientRows = fit.names.map((name, i) => `<tr><td>${escape(name)}</td><td>${number(fit.coefficients[i], 3)}</td><td>${fit.covariance ? number(Math.sqrt(fit.covariance[i][i]), 3) : "not identified"}</td></tr>`).join("");
    const estimates = standardized.map((row) => `<tr><td>${escape(row.treatment)}</td><td>${number(row.risk, 3)}</td><td>${number(row.conditionalLogOR, 3)}</td>${fit.family === "binary" ? `<td>${number(row.marginalLogOR, 3)}</td>` : ""}</tr>`).join("");
    const maicResult = method === "maic" ? `<p>Balanced effective sample size: <strong>${number(calibration.ess, 1)} of ${data.ipd.length}</strong>; maximum weight ${percent(Math.max(...calibration.weights), 1)}. Bootstrap SE of the transported contrast: ${number(calibration.se, 3)} (${calibration.bootstrapSuccessful}/${calibration.bootstrapRequested} valid stratified resamples; weights re-estimated each time).</p>
      ${calibration.anchored ? `<p>Anchored ${escape(calibration.anchored.treatment)} versus ${escape(calibration.anchored.comparator)} in the aggregate-trial target: ${number(calibration.anchored.contrast, 3)}, SE ${number(calibration.anchored.se, 3)}. This subtracts weighted B−A from observed C−A on the same scale.</p>` : "<p>An anchored comparison is available only when the target covariate distribution matches both aggregate arms and binary arms have events and non-events.</p>"}<p>MAIC balances supplied means, not the entire distribution. It requires overlap and all relevant effect modifiers. Bootstrap inference conditions on supplied target moments.</p>` : "";
    return {
      stage: `<g class="population-stage"><text x="${left}" y="${top}" fill="var(--lcd-ink)" font-size="${Math.min(23, (width - 35) / 18)}">Population transport laboratory</text><text x="${left}" y="${top + 24}" fill="var(--lcd-ink)" font-size="${Math.min(15, (width - 35) / 30)}">Source x₁ mean ${number(sourceMean)} → target ${number(targetMean)}</text><text x="${left}" y="${top + 45}" fill="var(--lcd-ink)" font-size="${Math.min(13, (width - 35) / 37)}">${!revealed ? "Make a prediction to reveal" : `${escape(familyLabel)} · ${method === "maic" ? "MAIC weighted IPD outcomes" : `${escape(fit.studies[0])} baseline`}`}</text>${bars}</g>`,
      inspector: `<header class="inspector-head"><span class="inspector-kind">Synthetic population experiment</span><h2>Transport the comparison</h2><p>This laboratory uses its own editable IPD and aggregate outcomes, separate from the contrast dataset in the other lenses.</p></header>
        <section class="inspector-section"><h3>Mission: predict, then check</h3><p>When x₁ shifts from ${number(sourceMean)} to ${number(targetMean)}, will ${escape(fit.treatments[1])} versus ${escape(fit.treatments[0])} have a higher, lower, or unchanged ${method === "maic" ? "weighted marginal contrast" : "average conditional contrast"}?</p>
        ${button("populationPrediction", "lower", "Lower", response === "lower")}${button("populationPrediction", "same", "Unchanged", response === "same")}${button("populationPrediction", "higher", "Higher", response === "higher")}
        <p role="status">${escape(feedback)}</p>${revealed ? `<p>Source ${number(sourceResult[1].conditionalLogOR, 3)} → target ${number(standardized[1].conditionalLogOR, 3)}; change ${number(delta, 3)} on the ${fit.family === "binary" ? "log odds" : fit.family === "survival" ? "log hazard" : fit.family === "normal" ? "mean" : "ordinal linear predictor"} scale.</p>` : ""}</section>
        ${revealed ? `<section class="inspector-section"><h3>${method === "maic" ? "MAIC transported arm outcomes" : method === "stc" ? "STC outcome regression and standardization" : "ML-NMR joint likelihood fit"}</h3><table class="study-table"><thead><tr><th>Treatment</th><th>${escape(familyLabel)}</th><th>${method === "maic" ? "Weighted contrast" : "Average conditional contrast"}</th>${fit.family === "binary" ? "<th>Marginal log OR</th>" : ""}</tr></thead><tbody>${estimates}</tbody></table>${method === "maic" ? "" : "<p>Conditional contrasts average differences of linear predictors. Marginal log ORs first average risks, then take logits. They differ through noncollapsibility. Absolute predictions use the first IPD study baseline, not a separately estimated target baseline.</p>"}${maicResult}</section>` : ""}
        <section class="inspector-section"><h3>${method === "maic" ? "Supplementary ML-NMR fit and assumptions" : "Fit and assumptions"}</h3><p>${fit.converged ? "Optimizer converged" : "Optimizer did not converge"}; ${fit.identifiable ? "observed information is full rank" : "parameters are not identified"}. Maximum score component ${number(fit.gradientMax, 5)}. ${data.ipd.length} IPD records; ${method === "stc" ? 0 : data.agd.length} aggregate records used.</p><p>Fixed treatment effects, ${escape(fit.modifiers)} effect modification, ${fit.covariates.length} covariate(s). All prognostic variables and effect modifiers must be correctly specified. Binary AgD uses the ${data.binomialApproximation === "two" ? "two-parameter mean/variance-matched Binomial approximation to Poisson-binomial (N* and p* from E[p] and E[p²]); parameter proposals with N* below observed events are rejected" : "one-parameter Binomial approximation with integrated mean probability"}. Ordinal multinomial likelihoods use integrated category probabilities. Normal aggregate SE and distribution parameters are treated as known. Survival integrates each event/censoring likelihood, assuming independent censoring.</p>
        ${revealed ? `<details><summary>Fitted coefficients and approximate Wald SEs</summary><table class="study-table"><thead><tr><th>Coefficient</th><th>MLE</th><th>SE</th></tr></thead><tbody>${coefficientRows}</tbody></table><p>Wald SEs invert the numerical observed information. They exclude uncertainty in supplied covariate distributions and fixed shape/scale/cutpoints.</p></details>` : ""}
        <p>Integration check: doubling aggregate integration from 64 to 128 points changes the fitted-coefficient log likelihood by ${number(integrationDifference, 6)}. This empirical difference is not an absolute error bound. Explicit empirical populations are summed exactly; continuous marginals use fixed Sobol/copula points or midpoint quadrature for the uniform shortcut.</p>
        ${revealed ? `<details><summary>Bayesian sampling experiment</summary><p>Sample the same likelihood with independent Normal(0, 2.5²) priors on all coefficients. Priors depend on covariate units; rescale covariates deliberately. Sampling may take several seconds.</p><div>${[1000, 4000, 12000].map((d) => button("populationDraws", d, `${d} draws`, Number(state.options.populationDraws ?? 1000) === d)).join("")}</div><button type="button" class="deck-button" data-population-action="posterior">Run four posterior chains</button>${posteriorMarkup}</details>` : ""}
        ${revealed ? `<details><summary>Hierarchical ML-NMR experiment</summary><p>Fit treatment heterogeneity and exchangeable effect modifiers with genuine posterior sampling. Multi-arm random effects use correlation 0.5. An unrelated mean effects model needs a loop of two-arm trials. Four chains each retain ${hierarchyOptions.draws} draws after ${hierarchyOptions.warmup} warmup iterations. Priors and sampling warmup/seed can be edited in the JSON; use appropriately scaled covariates.</p><div>${[1000, 4000, 12000].map((d) => button("populationDraws", d, `${d} draws`, hierarchyOptions.draws === d)).join("")}</div>
          <div>${button("populationRandom", "yes", "Random effects", hierarchyOptions.randomEffects)}${button("populationRandom", "no", "Fixed effects", !hierarchyOptions.randomEffects)}</div>
          <div>${["shared", "independent", "exchangeable", "none"].map((m) => button("populationHierarchy", m, m, hierarchyOptions.modifiers === m)).join("")}</div>
          <div>${button("populationConsistency", "consistent", "Consistency", hierarchyOptions.consistency === "consistent")}${button("populationConsistency", "ume", "Unrelated effects", hierarchyOptions.consistency === "ume")}</div>
          <button type="button" class="deck-button" data-population-action="hierarchical" ${sampling ? "disabled" : ""}>Sample hierarchical model</button>${advancedMarkup}</details>` : ""}
        ${sampling ? `<p role="status">Posterior sampling is running in a background worker. Results will be matched to the settings used to start it.</p><button type="button" class="deck-button" data-population-action="cancel">Cancel sampling</button>` : ""}
        <p>This does not reproduce the thesis clinical datasets. The laboratory reports numerical and model assumptions explicitly.</p></section>${editor(data, state)}`,
      controls: `<div class="console-group"><span class="console-label">Method</span>${["mlnmr", "stc", "maic"].map((m) => button("populationMethod", m, { mlnmr: "ML-NMR", stc: "STC", maic: "MAIC weights" }[m], method === m)).join("")}</div>
        <div class="console-group"><span class="console-label">Outcome</span>${["binary", "normal", "ordinal", "survival"].map((f) => button("populationFamily", f, f, fit.family === f)).join("")}${data.family !== (state.options.populationFamily ?? "binary") && state.options.populationData ? "<span>Imported data override example family</span>" : ""}</div>
        ${fit.family === "binary" ? `<div class="console-group"><span class="console-label">Aggregate binary</span>${button("populationBinaryApproximation", "one", "One parameter", data.binomialApproximation !== "two")}${button("populationBinaryApproximation", "two", "Two parameters", data.binomialApproximation === "two")}</div>` : ""}<div class="console-group"><span class="console-label">Target x₁</span>${[0, 0.8, 1.3].map((x) => button("populationTarget", x, String(x), Math.abs(targetMean - x) < 1e-8)).join("")}${button("populationPrediction", "auto", "New prediction", false)}</div>
        <div class="console-group"><span class="console-label">Modifier</span>${["shared", "independent", "none"].map((m) => button("populationModifiers", m, m, fit.modifiers === m)).join("")}</div>`,
      note: "Predict the transport, inspect the fitted evidence, then change the target. All examples are synthetic; imported population data stay local.",
    };
  },
};
