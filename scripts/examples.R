# The example networks the site ships with.
#
# Someone arriving without a file of their own should still be able to use every
# lens, so every network bundled with the R package netmeta is included here,
# converted to contrast level with netmeta::pairwise. They span the useful range:
# three treatments to twenty-two, three studies to ninety-three, two-arm only to
# heavily multi-arm, and mean differences, odds ratios and incidence rate ratios.
#
# The networks that come as one row per arm are also written in that original
# shape, so that tests/parse.test.mjs can check the browser's arm-to-contrast
# conversion against what pairwise() produces, and so the site can demonstrate
# the arm-level upload path on real data.
#
# Run:  Rscript scripts/examples.R
# Needs: netmeta, jsonlite.

suppressMessages(library(netmeta))
suppressMessages(library(jsonlite))

# Rows with a missing effect are dropped, as netmeta does. A multi-arm study
# that loses one of its contrasts that way no longer has the p(p-1)/2 rows the
# variance adjustment needs, so the whole study goes with it rather than being
# silently treated as if it had fewer arms.
contrasts_of <- function(p) {
  out <- data.frame(
    studlab = as.character(p$studlab),
    treat1 = as.character(p$treat1),
    treat2 = as.character(p$treat2),
    TE = p$TE,
    seTE = p$seTE,
    stringsAsFactors = FALSE
  )
  out <- out[is.finite(out$TE) & is.finite(out$seTE) & out$seTE > 0, ]
  counts <- table(out$studlab)
  triangular <- function(m) {
    p <- (1 + sqrt(8 * m + 1)) / 2
    abs(p - round(p)) < 1e-8
  }
  keep <- names(counts)[vapply(as.integer(counts), triangular, logical(1))]
  dropped <- setdiff(names(counts), keep)
  if (length(dropped))
    cat(sprintf("  dropped incomplete multi-arm studies: %s\n",
      paste(dropped, collapse = ", ")))
  out[out$studlab %in% keep, ]
}

arms_of <- function(studlab, treatment, event, n) {
  data.frame(
    studlab = as.character(studlab),
    treatment = as.character(treatment),
    event = as.numeric(event),
    n = as.numeric(n),
    stringsAsFactors = FALSE
  )
}

examples <- list()
add <- function(...) {
  e <- list(...)
  examples[[e$id]] <<- e
}

# ---- Contrast level to begin with ----------------------------------------

data(Senn2013)
add(
  id = "senn2013",
  name = "Diabetes: glucose lowering agents",
  summary = "Ten oral treatments for type 2 diabetes on the change in HbA1c. Contrast level, one multi-arm study, and the network behind the incomplete block design reading of network meta-analysis.",
  outcome = "Mean difference in HbA1c",
  unit = "percentage points",
  measure = "MD",
  favors = "lower",
  source = "Senn S, Gavini F, Magrez D, Scheen A. Issues in performing a network meta-analysis. Stat Methods Med Res. 2013;22(2):169-189.",
  contrasts = contrasts_of(Senn2013)
)

data(Linde2016)
add(
  id = "linde2016",
  name = "Depression in primary care",
  summary = "Ninety-three trials of twenty-two treatments, the largest network here, and the network worked through in the path weights paper.",
  outcome = "Odds ratio for early response",
  unit = "odds ratio",
  measure = "OR",
  favors = "higher",
  source = "Linde K, Rucker G, Schneider A, Kriston L. Questionable assumptions hampered interpretation of a network meta-analysis of primary care depression treatments. J Clin Epidemiol. 2016;71:86-96.",
  contrasts = data.frame(
    studlab = as.character(Linde2016$id),
    treat1 = Linde2016$treat1,
    treat2 = Linde2016$treat2,
    TE = Linde2016$lnOR,
    seTE = Linde2016$selnOR,
    stringsAsFactors = FALSE
  )
)

# ---- One row per arm ------------------------------------------------------

data(Woods2010)
add(
  id = "woods2010",
  name = "COPD: mortality on inhaled treatments",
  summary = "Three trials, one of them four-armed, on mortality in chronic obstructive pulmonary disease. Small enough to follow every path by eye, which makes it the network to learn the lenses on.",
  outcome = "Odds ratio for mortality",
  unit = "odds ratio",
  measure = "OR",
  favors = "lower",
  source = "Woods BS, Hawkins N, Scott DA. Network meta-analysis on the log-hazard scale. BMC Med Res Methodol. 2010;10:54.",
  contrasts = contrasts_of(
    pairwise(treatment, event = r, n = N, studlab = author, data = Woods2010, sm = "OR")
  ),
  arms = arms_of(Woods2010$author, Woods2010$treatment, Woods2010$r, Woods2010$N)
)

data(Dong2013)
add(
  id = "dong2013",
  name = "COPD: mortality on inhaled medications",
  summary = "Forty-one trials of six inhaled medications, many of them multi-arm, so the within-study correlation structure is visible throughout the network.",
  outcome = "Odds ratio for mortality",
  unit = "odds ratio",
  measure = "OR",
  favors = "lower",
  source = "Dong YH, Lin HH, Shau WY, et al. Comparative safety of inhaled medications in patients with COPD. Thorax. 2013;68(1):48-56.",
  contrasts = contrasts_of(
    pairwise(treatment, death, randomized, studlab = id, data = Dong2013,
      sm = "OR", allstudies = TRUE)
  ),
  arms = arms_of(Dong2013$id, Dong2013$treatment, Dong2013$death, Dong2013$randomized)
)

data(Baker2009)
add(
  id = "baker2009",
  name = "COPD: exacerbations",
  summary = "Thirty-nine trials of inhaled corticosteroids and bronchodilators, on whether a patient had an exacerbation.",
  outcome = "Odds ratio for an exacerbation",
  unit = "odds ratio",
  measure = "OR",
  favors = "lower",
  source = "Baker WL, Baker EL, Coleman CI. Pharmacologic treatments for chronic obstructive pulmonary disease: a mixed-treatment comparison meta-analysis. Pharmacotherapy. 2009;29(8):891-905.",
  contrasts = contrasts_of(
    pairwise(treatment, exac, total, studlab = study, data = Baker2009,
      sm = "OR", allstudies = TRUE)
  ),
  arms = arms_of(Baker2009$study, Baker2009$treatment, Baker2009$exac, Baker2009$total)
)

data(Dogliotti2014)
add(
  id = "dogliotti2014",
  name = "Atrial fibrillation: stroke prevention",
  summary = "Anticoagulants and antiplatelets for stroke prevention in atrial fibrillation. Several trials have a zero event count, so the continuity correction is visible in the widths.",
  outcome = "Odds ratio for stroke or systemic embolism",
  unit = "odds ratio",
  measure = "OR",
  favors = "lower",
  source = "Dogliotti A, Paolasso E, Giugliano RP. Current and new oral antithrombotics in non-valvular atrial fibrillation. Clin Cardiol. 2014;37(1):49-56.",
  contrasts = contrasts_of(
    pairwise(treatment, stroke, total, studlab = study, data = Dogliotti2014,
      sm = "OR", allstudies = TRUE)
  ),
  arms = arms_of(Dogliotti2014$study, Dogliotti2014$treatment,
    Dogliotti2014$stroke, Dogliotti2014$total)
)

data(Gurusamy2011)
add(
  id = "gurusamy2011",
  name = "Liver surgery: blood loss interventions",
  summary = "A sparse network of methods to reduce blood loss in liver resection, with very few events. A good demonstration of what a thin network does to the standard errors.",
  outcome = "Odds ratio for death",
  unit = "odds ratio",
  measure = "OR",
  favors = "lower",
  source = "Gurusamy KS, Pissanou T, Pikhart H, Vaughan J, Burroughs AK, Davidson BR. Methods to decrease blood loss and transfusion requirements for liver transplantation. Cochrane Database Syst Rev. 2011;(12):CD009052.",
  contrasts = contrasts_of(
    pairwise(treatment, death, n, studlab = study, data = Gurusamy2011,
      sm = "OR", allstudies = TRUE)
  ),
  arms = arms_of(Gurusamy2011$study, Gurusamy2011$treatment,
    Gurusamy2011$death, Gurusamy2011$n)
)

# ---- One row per study, arms side by side ---------------------------------

data(Franchini2012)
add(
  id = "franchini2012",
  name = "Parkinson's disease: dopamine agonists",
  summary = "Seven trials, two of them three-armed, on the reduction in off-time. A continuous outcome, so the scale is a mean difference rather than a ratio.",
  outcome = "Mean difference in off-time",
  unit = "hours per day",
  measure = "MD",
  favors = "lower",
  source = "Franchini AJ, Dias S, Ades AE, Jansen JP, Welton NJ. Accounting for correlation in network meta-analysis with multi-arm trials. Res Synth Methods. 2012;3(2):142-160.",
  contrasts = contrasts_of(
    pairwise(
      list(Treatment1, Treatment2, Treatment3),
      n = list(n1, n2, n3), mean = list(y1, y2, y3), sd = list(sd1, sd2, sd3),
      data = Franchini2012, studlab = Study, sm = "MD"
    )
  )
)

data(Stowe2010)
add(
  id = "stowe2010",
  name = "Parkinson's disease: adjuvant treatment",
  summary = "Twenty-nine trials of adjuvant treatments in later Parkinson's disease, again on off-time, and a larger continuous network than Franchini.",
  outcome = "Mean difference in off-time",
  unit = "hours per day",
  measure = "MD",
  favors = "lower",
  source = "Stowe R, Ives N, Clarke CE, et al. Evaluation of the efficacy and safety of adjuvant treatment to levodopa therapy in Parkinson's disease patients with motor complications. Cochrane Database Syst Rev. 2010;(7):CD007166.",
  contrasts = contrasts_of(
    pairwise(
      list(t1, t2, t3), n = list(n1, n2, n3), mean = list(y1, y2, y3),
      sd = list(sd1, sd2, sd3), data = Stowe2010, studlab = study, sm = "MD"
    )
  )
)

data(Linde2015)
add(
  id = "linde2015",
  name = "Depression: psychological treatments",
  summary = "Sixty-six trials of psychological treatments for depression in primary care, on response. The companion network to Linde 2016.",
  outcome = "Odds ratio for response",
  unit = "odds ratio",
  measure = "OR",
  favors = "higher",
  source = "Linde K, Sigterman K, Kriston L, et al. Effectiveness of psychological treatments for depressive disorders in primary care. Ann Fam Med. 2015;13(1):56-68.",
  contrasts = contrasts_of(
    pairwise(
      list(treatment1, treatment2, treatment3),
      event = list(resp1, resp2, resp3), n = list(n1, n2, n3),
      data = Linde2015, studlab = id, sm = "OR", allstudies = TRUE
    )
  )
)

data(smokingcessation)
add(
  id = "smokingcessation",
  name = "Smoking cessation counselling",
  summary = "The twenty-four trial network from the NICE technical support documents, with four counselling strategies and several three-arm trials.",
  outcome = "Odds ratio for cessation",
  unit = "odds ratio",
  measure = "OR",
  favors = "higher",
  source = "Lu G, Ades AE. Combination of direct and indirect evidence in mixed treatment comparisons. Stat Med. 2004;23(20):3105-3124.",
  contrasts = contrasts_of(
    pairwise(
      list(treat1, treat2, treat3),
      event = list(event1, event2, event3), n = list(n1, n2, n3),
      data = smokingcessation, studlab = seq_len(nrow(smokingcessation)),
      sm = "OR", allstudies = TRUE
    )
  )
)

data(dietaryfat)
add(
  id = "dietaryfat",
  name = "Dietary fat and mortality",
  summary = "Trials of dietary fat modification, reported as events over person-years, so the scale here is an incidence rate ratio rather than an odds ratio.",
  outcome = "Incidence rate ratio for death",
  unit = "rate ratio",
  measure = "IRR",
  favors = "lower",
  source = "Hooper L, Summerbell CD, Higgins JPT, et al. Reduced or modified dietary fat for preventing cardiovascular disease. Cochrane Database Syst Rev. 2000;(2):CD002137.",
  contrasts = contrasts_of(
    pairwise(
      list(treat1, treat2, treat3), time = list(years1, years2, years3),
      event = list(d1, d2, d3), data = dietaryfat, studlab = ID, sm = "IRR"
    )
  )
)

# The fictitious network of Ruecker et al 2024, section 3. Every effect is 1 and
# every standard error is 1, so the path contributions are exactly the fractions
# printed in that paper and a reader can check this site against the article.
textbook <- data.frame(
  treat1 = c("A", "A", "B", "B", "C"),
  treat2 = c("B", "C", "C", "D", "D"),
  TE = rep(1, 5), seTE = rep(1, 5), stringsAsFactors = FALSE
)
textbook$studlab <- paste0(textbook$treat1, textbook$treat2)
add(
  id = "textbook",
  name = "Textbook network of four treatments",
  summary = "The worked example from the path weights paper: five single-study comparisons, every effect 1 and every standard error 1, so every number on this site can be checked by hand against the article.",
  outcome = "Effect",
  unit = "arbitrary units",
  measure = "MD",
  favors = "lower",
  source = "Rucker G, Papakonstantinou T, Nikolakopoulou A, Schwarzer G, Galla T, Davies AL. Shortest path or random walks? A framework for path weights in network meta-analysis. Stat Med. 2024;43(22):4287-4304.",
  contrasts = contrasts_of(textbook)
)

dir.create("src/data", recursive = TRUE, showWarnings = FALSE)
write_json(unname(examples), "src/data/examples.json",
  digits = 12, auto_unbox = TRUE, dataframe = "columns", na = "null")

for (e in examples) {
  net <- netmeta(e$contrasts$TE, e$contrasts$seTE, e$contrasts$treat1,
    e$contrasts$treat2, e$contrasts$studlab, random = FALSE)
  cat(sprintf("%-16s %2d treatments  %3d comparisons  %3d studies  %s\n",
    e$id, net$n, net$m, net$k, e$measure))
}
