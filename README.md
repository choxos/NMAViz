# NMAViz

**Read the evidence structure of a network meta-analysis, through the lenses the methods literature
has proposed for it.**

Upload the data behind an NMA and the site fits the frequentist graph-theoretical model in your
browser, then draws that fitted model through eight linked lenses: as a map whose distances are
standard errors, as trials rather than comparisons, as a flow of evidence, as a contribution
matrix, as a signed reconstruction of the estimate trial by trial, as a decomposition of its
inconsistency, as a diffusion, and as a system of springs.

A ninth, separate population laboratory fits editable individual and aggregate data for population
adjustment. All analysis runs locally in the browser; selected files are not sent to a backend.

**[Open it at nmaviz.xera.ac](https://nmaviz.xera.ac)**

![The network arrangement, where the distance between two treatments is the standard error of comparing them](screenshots/network.png)

|  |  |
| --- | --- |
| ![Evidence flow for one comparison, with the current animating along each arrow](screenshots/flow.png) | ![The reconstruction waterfall, walking to the network estimate one trial at a time](screenshots/reconstruction.png) |
| Where one estimate comes from | What each trial did to it |
| ![The Hodge split of inconsistency in the dark theme](screenshots/inconsistency-dark.png) | ![The springs lens in the dark theme](screenshots/springs-dark.png) |
| Inconsistency triangles can see, and cannot | Studies in parallel, routes in series |

## What it does

Most network meta-analysis software answers what the estimates are. This answers where they came
from. The first eight lenses share the fitted contrast network and selected comparison. The Population
lens has its own synthetic or imported individual and aggregate data; selecting it does not
population-adjust the contrast network.

| Lens | What it shows | After |
| --- | --- | --- |
| **Network** | Every comparison, with the studies behind it, in an arrangement where the distance between two treatments is the standard error of comparing them. A separation control fans each comparison out into its individual studies. | Rücker 2012 |
| **Trials** | Trial nodes, signed arm coefficients, trial-level reconstruction, and supported treatment-trial random-walk transitions with a block-model identity check. | Drawing after Davies 2026; block reading after Senn 2013; influence shading is Wang 2026 |
| **Flow** | Directed evidence currents, routes, study/design flow, mean path length, and study/design minimal parallelism. | König, Krahn and Binder 2013 |
| **Contributions** | Comparison and trial shares under shortest-path, random-walk, minimum-L1, and minimum-L2 path weights, including signed L2 shares. | Davies et al 2022, Rücker et al 2024 |
| **Reconstruction** | Signed study contributions, covariance-aware direct/indirect uncertainty, canonical direct-first edges and widest-first routes, with any route residual reported. | Wang et al 2026 |
| **Inconsistency** | Gradient, triangular and harmonic components, topology-changing teaching examples, and Hodge/Borda/Kemeny ordering comparisons. | Jiang et al 2011 |
| **Diffusion** | Variance diffusion, a Jacobi effect-estimate solver with convergence diagnostics, and absorbing random-walk crossings compared with the hat matrix. | Rücker, Davies and Schwarzer 2026 |
| **Springs** | The mechanism: studies in parallel, routes in series, on the effect axis. Pull the parallel bundle, inspect heterogeneity compliance, or predict a hidden resting point and check it. | Papakonstantinou et al 2021 for the pairwise mechanism; routes in series are an extension of it |
| **Population** | Editable ML-NMR, STC and MAIC experiments; target-population predictions, integration checks and Bayesian sampling diagnostics. | Phillippo thesis; see scope below |

## Learn by doing

Each lens offers two numeric prediction challenges with corrective explanations and a session score
(18 challenges total). These use stated teaching examples independently of imported research data.
The spring wager hides the resting answer before submission; the population mission asks for the
direction of a transported effect before revealing fitted outcomes. Hodge examples let learners
compare a chordless cycle with a triangulated network.

Keyboard controls support trial exclusion and spring interaction. Dialogs trap focus, close with
Escape, and restore focus to their opener. Practice feedback uses live status text; the mobile
layout can expand the diagram within a scrollable region. These are implemented learning and
accessibility features, not evidence that the app is universally accessible or educationally optimal.

## Data it accepts

A CSV or tab separated file, in either of the two shapes people have.

**Contrast level**, one row per comparison:

```
study,treat1,treat2,TE,seTE
Trial A,drug,placebo,-0.42,0.19
```

**Arm level**, one row per arm, either binary or continuous:

```
study,treatment,event,n            study,treatment,mean,sd,n
```

Arm-level data is converted with the same formulas `netmeta::pairwise` uses, including the
continuity correction for a study with a zero cell. Common column names are recognized
automatically (`t1`, `lnOR`, `selnOR`, `trial`, `author`, and so on), and the data panel shows the
mapping it settled on.

A contrast-level file carries numbers but not the scale they are on, so the effect measure is
guessed from the name of the effect column and defaults to the identity scale, where the numbers
are shown exactly as the file gave them. The data panel names the guess and lets you correct it;
correcting it matters, because a ratio measure is fitted on the log scale and shown exponentiated.

Pooled results alone cannot reconstruct the contrast-network evidence: its hat matrix requires
study-level data. Population adjustment additionally requires the covariate and outcome inputs
described below.

Thirteen example networks ship with the site, the full set distributed with the R package
`netmeta`: three treatments to twenty-two, three studies to ninety-three, two-arm only to heavily
multi-arm, and mean differences through odds and incidence rate ratios.

## Verification

The JavaScript engine is checked against committed fixtures from `netmeta` 3.6.1 for six networks,
including multi-arm studies. `scripts/fixtures.R` regenerates those model fixtures. Tests cover
Laplacians, pseudoinverses, hat matrices, common/random estimates and SEs, direct/indirect estimates,
heterogeneity, design Q decomposition, sorting, and multi-arm adjustments. Tolerances are specified
in the tests; passing fixtures do not establish correctness for every possible input.

The supplied Linde2016 path-method matrices provide a separate reference for all L2 and random-walk
entries. Shortest-path ties and nonunique L1 optima can give different valid allocations. L1 tests
therefore certify flow reconstruction, nonnegativity and the minimum objective rather than require
one solver's particular answer.

Structural and regression checks cover contrast reversal, covariance-aware random-effects
reconstruction, canonical routes, flow conservation, bipartite block identities, Hodge orthogonality,
spring equilibrium/energy, diffusion convergence, and input validation. Population tests include
synthetic fits; numerical integration is checked against analytic moments, and posterior sampling
against known normal and beta targets. These are not independent reproductions of every thesis case
study or clinical validation.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser script starts its own local Vite server. It exercises nine lenses, practice feedback,
keyboard dialog focus and trial exclusion, four contribution methods, Hodge examples, diffusion,
the spring wager, population fitting, and mobile expansion. Screenshots are written under
`documentation/implementation/browser/`. Browser coverage is a set of concrete scenarios, not a
complete accessibility or usability evaluation.

## Run

Node.js 22.13 or newer.

```sh
npm ci
npm run dev      # http://127.0.0.1:3021
npm run build
npm run preview
```

Regenerating the fixtures and the bundled examples needs R with `netmeta` and `jsonlite`:

```sh
Rscript scripts/fixtures.R
Rscript scripts/examples.R
```

## Choices worth knowing about

**Multi-arm studies.** The model uses netmeta's reduce-weights adjustment, with τ² added before the
adjustment. For coherent complete multi-arm contrasts and their covariance, this is equivalent to
reduced-dimension GLS. Reconstruction uses the fitted weights and the full within-study covariance,
including heterogeneity. Direct and indirect contributions remain correlated. Design-based Q
components use compatible adjusted weights. Input validation rejects invalid or materially
incoherent multi-arm data; rounded contrasts may leave a reported canonical-route effect residual.

**Bipartite information flow.** Signed treatment-trial coefficients reconstruct the contrast fit.
Positive arm-precision transitions and the fixed-trial block identity require an independent-arm
variance representation. Unsupported cases are identified instead of assigning invented transition
probabilities. A two-arm contrast does not identify separate arm variances; its default equal split
is an explicit convention, not recovered arm information.

**Path optimization.** L1/L2 enumerate at most 5,000 directed paths across at most 150 active
comparisons. L1 uses a maximum of 10,000 iterations and requires a certified feasible optimum.
Bounds or nonconvergence produce an error; choose shortest path or random walk for those networks.
L2 can yield negative shares, which are retained. Canonical projection routes use a separate
study-based direct-first and widest-first decomposition, not these contribution percentages.

**The arrangement.** The Laplacian pseudoinverse is a Gram matrix, so its principal coordinates
place treatments where the straight-line distance between two of them is the standard error of the
network estimate comparing them. Two dimensions cannot generally hold that, so stress majorization
fits it as closely as a plane allows, overlapping circles are nudged apart, and the residual stress
is measured on the drawing that is actually on screen and printed under the title.

**Inconsistency.** The Hodge split is computed on one pooled estimate per comparison. Disagreement
between studies of the same comparison is heterogeneity, not inconsistency, and is not part of it.
It is a diagnostic to read alongside a design-by-treatment interaction model, not a replacement for
one. Its residual is the between-comparison Q, which need not equal netmeta's between-design Q;
the interface names which quantity it is showing.

**Harmonic dimension is structural.** The harmonic space depends on network topology. When triangle
boundaries span the cycle space, its dimension is zero and the lens says "none possible". That is
not evidence that observed comparisons agree. The chordless four-cycle example demonstrates a
network where harmonic inconsistency is possible.

**What Papakonstantinou et al actually cover.** Their paper is about pairwise meta-analysis, and
says extending the spring system to a network is future work. Studies in parallel, the pooled
estimate as the resting point, and the energy identity are theirs; routes in series, drawn from the
flow decomposition, are this site's extension of the idea and are labeled as such.

**Flow measures.** The interface distinguishes comparison-edge path summaries from study/design
measures. Design mean path length sums design flows; study and design minimal parallelism use the
reciprocal of the corresponding maximum flow. They need not equal edge-based measures when
multi-arm studies are present.

**Ranking.** Hodge potential and Borda scores are descriptive orderings. Exact Kemeny optimization
is bounded to 12 treatments; the interface reports when it is unavailable. These are not SUCRA,
rankograms, probabilities of being best, or a clinical recommendation.

## Population laboratory and limits

The population editor accepts JSON containing IPD (`study`, `treatment`, `x`, `y`), aggregate records,
a reference treatment and an optional target population. Covariates may be scalar or vectors.
Aggregate binary records use `n/events`, normal records `mean/se`, ordinal records category counts,
and survival records event/censoring times with covariates marginalized. Use the editable examples
and JSON export for the full schema. Population data are separate from the CSV contrast import.

ML-NMR integrates individual response probabilities in the aggregate likelihood. Binary aggregate
arms offer a one-parameter binomial approximation using E[p], or a two-parameter approximation
matching the Poisson-binomial mean and variance with N* = n E[p]²/E[p²] and p* = E[p²]/E[p].
The latter uses a continuous-N binomial likelihood with gamma-function coefficients; it is an
approximation, not the exact Poisson-binomial likelihood. Parameter proposals with N* below the
observed event count have zero support.

STC fits IPD
outcome regression and standardizes predictions. MAIC balances covariate means and reports effective
sample size, weighted outcomes and bootstrap uncertainty with weights re-estimated in each resample;
anchored comparison is conditional on matching the supplied aggregate target. MAIC requires overlap,
and its bootstrap conditions on supplied target moments. MAIC supports binary and normal outcomes;
it does not estimate ordinal or survival contrasts.

Population distributions may use empirical points, a uniform midpoint shortcut, or Sobol points
with a Gaussian copula and normal, lognormal, uniform or Bernoulli marginals. Copula correlation is
on the latent Gaussian scale. Integration diagnostics compare finite approximations, not guaranteed
absolute error bounds. Unknown covariate distributions and measurement error are not inferred.

The fixed-effects fitter supports binary, normal, ordinal and Weibull survival likelihoods with
one to five covariates and shared, independent or no effect modification. Normal sigma, ordinal
cutpoints, Weibull shape and aggregate normal SEs are supplied as known. Limits are 2,000 IPD
records, 100 aggregate records and 24 fitted coefficients. Approximate Wald SEs come from numerical
observed information; nonidentifiability and optimizer diagnostics are displayed.

After a prediction, the inspector offers background Bayesian sampling with cancellation. Both fixed
and hierarchical sampling default to four chains with 500 warmup and 1,000 retained draws per chain.
The controls also offer 4,000 or 12,000 retained draws; JSON `sampling.warmup` and `sampling.seed`
set warmup and reproducibility. Fixed-model sampling uses independent Normal(0, 2.5²) coefficient
priors. Hierarchical controls select random/fixed effects, modifier structure and consistency/UME.
Both sample the specified likelihood or aggregate approximation using Metropolis chains.

The hierarchical model supports a common heterogeneity SD with multi-arm covariance τ²/2 and
shared, independent, exchangeable or no modifiers. Exchangeability uses one global class of active
treatments. Normal coefficient and half-normal SD priors are proper and depend on covariate units.
The backend is bounded to 40 parameters and two to eight chains. UME (unrelated mean effects) is
available only for closed networks of two-arm trials; tree and multi-arm inputs are rejected.

Posterior target summaries include response, conditional-effect and binary marginal-log-OR
intervals. Absolute predictions borrow an observed study baseline; they do not estimate a new
target baseline or include a new-study random effect. Deviance omits data-only constants and is
comparable only on the same data. Integration and posterior intervals condition on supplied
population distributions and nuisance parameters.

Sampling reports classical split-R̂, ESS, MCSE and acceptance diagnostics. Short teaching runs can
fail those checks; these are not rank-normalized diagnostics or a guarantee of convergence. The
sampler is not a replacement for a validated production Bayesian workflow, and the examples do not
reproduce the thesis's clinical trials or simulation studies.

## Interpretation limits

The reference collection guides the implementations; this is not complete reproduction of every
paper, thesis chapter, simulation and clinical case study. The app does not assess risk of bias,
establish transitivity, identify all effect modifiers, or establish causal transportability. Zero
inconsistency does not validate a network; large contribution does not mean high-quality evidence.

## Privacy

The app is static, with no account or login. Analysis files and population JSON are processed in
the browser; the app does not send them to an analysis server. The theme choice is kept in local
storage. Hosting infrastructure may separately log ordinary page requests.

## License

MIT. Inter is licensed under the SIL Open Font License. The example networks are redistributed from
the R package `netmeta`, which is GPL-2 licensed, with each network's original source cited in the
data panel.

## References

Method sources include:

- Rücker G. Network meta-analysis, electrical networks and graph theory. *Res Synth Methods*
  2012;3(4):312-324.
- Senn S, Gavini F, Magrez D, Scheen A. Issues in performing a network meta-analysis.
  *Stat Methods Med Res* 2013;22(2):169-189.
- König J, Krahn U, Binder H. Visualizing the flow of evidence in network meta-analysis and
  characterizing mixed treatment comparisons. *Stat Med* 2013;32(30):5414-5429.
- Jiang X, Lim LH, Yao Y, Ye Y. Statistical ranking and combinatorial Hodge theory.
  *Math Program* 2011;127(1):203-244.
- Papakonstantinou T, Nikolakopoulou A, Egger M, Salanti G. Meta-analysis as a system of springs.
  *Res Synth Methods* 2021;12(2):176-186.
- Davies AL, Papakonstantinou T, Nikolakopoulou A, Rücker G, Galla T. Network meta-analysis and
  random walks. *Stat Med* 2022;41(12):2091-2114.
- Rücker G, Papakonstantinou T, Nikolakopoulou A, Schwarzer G, Galla T, Davies AL. Shortest path or
  random walks? A framework for path weights in network meta-analysis. *Stat Med*
  2024;43(22):4287-4304.
- Davies AL. The bipartite structure of treatment-trial networks reveals the flow of information in
  network meta-analysis. *J R Stat Soc Ser A* 2026.
- Rücker G, Davies AL, Schwarzer G. Network meta-analysis and diffusion. *Res Synth Methods* 2026.
- Wang C, Zhang Y, Jin Z, O'Connor A. Contrast-space projection for network meta-analysis: an exact
  and invariant study-based decomposition of direct and indirect contributions. 2026.

The reference implementation this engine is tested against is Schwarzer G, Carpenter JR, Rücker G.
*netmeta: Network Meta-Analysis using Frequentist Methods*, R package version 3.6.1.

The separate population laboratory draws on Phillippo DM, *Population adjustment methods for
indirect comparisons: a review and development of multilevel network meta-regression*, PhD thesis.
Its implemented scope and inference limits are described above.
