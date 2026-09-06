# Gold-standard fixtures.
#
# The browser engine in src/nma/ reimplements the graph-theoretical NMA model
# from scratch in JavaScript. This script writes what netmeta computes for the
# same data, so tests/engine.test.mjs can compare number for number rather than
# only checking the engine against itself.
#
# Run:  Rscript scripts/fixtures.R
# Needs: netmeta (>= 3.0), jsonlite.

suppressMessages(library(netmeta))
suppressMessages(library(jsonlite))

out_dir <- file.path("tests", "fixtures")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

# netmeta orders treatments alphabetically; the engine must do the same, so the
# fixture records the order it used rather than leaving it implicit.
#
# The m by m matrices grow with the square of the number of comparisons, so for
# the two large networks only the treatment-sized matrices are written. Those
# are enough to catch a wrong multi-arm adjustment, which is what the large
# networks are in the set for; the per-comparison matrices are checked on the
# small networks where they cost a few kilobytes.
capture <- function(net, data, heavy = TRUE) {
  measures <- netmeasures(net, random = FALSE)
  decomp <- decomp.design(net)

  # netmeta sorts the comparisons internally and adjusts multi-arm variances
  # before it builds any matrix, so the row order of the hat matrix is this
  # order, not the order of the input data. The engine has to reproduce both,
  # and comparing against them directly is the only way to see which of the two
  # is wrong when a hat matrix disagrees.
  prep <- netmeta:::prepare(net$TE, net$seTE, net$treat1, net$treat2, net$studlab,
    tau = 0, correlated = FALSE, func.inverse = netmeta:::invmat)

  list(
    treatments = net$trts,
    prepared = data.frame(
      studlab = as.character(prep$data$studlab),
      treat1 = prep$data$treat1,
      treat2 = prep$data$treat2,
      TE = prep$data$TE,
      seTE = prep$data$seTE,
      variance.adjusted = 1 / prep$data$weights,
      narms = prep$data$narms,
      stringsAsFactors = FALSE
    ),
    comparisons = data.frame(
      treat1 = net$treat1,
      treat2 = net$treat2,
      studlab = as.character(net$studlab),
      TE = net$TE,
      seTE = net$seTE,
      stringsAsFactors = FALSE
    ),
    n = net$n,
    m = net$m,
    k = net$k,
    df.Q = net$df.Q,
    Q = net$Q,
    tau2 = net$tau2,
    tau = net$tau,
    I2 = net$I2,
    common = list(
      TE = net$TE.common,
      seTE = net$seTE.common,
      TE.direct = net$TE.direct.common,
      seTE.direct = net$seTE.direct.common,
      TE.indirect = net$TE.indirect.common,
      seTE.indirect = net$seTE.indirect.common,
      L.matrix = net$L.matrix.common,
      Lplus.matrix = net$Lplus.matrix.common,
      H.matrix = if (heavy) net$H.matrix.common else NULL,
      hat.full = if (heavy) hatmatrix(net, method = "Davies", type = "full")$common else NULL
    ),
    random = list(
      TE = net$TE.random,
      seTE = net$seTE.random,
      TE.direct = net$TE.direct.random,
      seTE.direct = net$seTE.direct.random
    ),
    measures = list(
      proportion.direct = measures$proportion,
      meanpath = measures$meanpath,
      minpar = measures$minpar
    ),
    contrib = if (heavy) {
      sp <- netcontrib(net, method = "shortestpath")$common
      rw <- netcontrib(net, method = "randomwalk")$common
      list(
        target = rownames(sp),
        comparison = colnames(sp),
        shortestpath = sp,
        randomwalk = rw
      )
    } else NULL,
    decomp = list(
      Q.decomp = decomp$Q.decomp,
      Q.het.design = decomp$Q.het.design,
      Q.inc.detach = decomp$Q.inc.detach
    )
  )
}

write_fixture <- function(name, net, data, heavy = TRUE) {
  path <- file.path(out_dir, paste0(name, ".json"))
  write_json(capture(net, data, heavy), path,
    digits = 14, auto_unbox = TRUE, matrix = "rowmajor", dataframe = "columns",
    na = "null"
  )
  cat(sprintf("%-16s n=%2d m=%3d k=%3d -> %s\n", name, net$n, net$m, net$k, path))
}

# ---- 1. Senn2013: the diabetes network of Senn et al, contrast level, no
#         multi-arm study. The reference network for the incomplete block
#         design reading of NMA.
data(Senn2013)
write_fixture(
  "senn2013",
  netmeta(TE, seTE, treat1, treat2, studlab, data = Senn2013, sm = "MD"),
  Senn2013
)

# ---- 2. Linde2016: depression, contrast level, with three-arm studies. This is
#         the fixture that catches a wrong multi-arm variance adjustment.
data(Linde2016)
write_fixture(
  "linde2016",
  netmeta(lnOR, selnOR, treat1, treat2, id, data = Linde2016, sm = "OR"),
  Linde2016,
  heavy = FALSE
)

# ---- 3. Woods2010: arm level binary data, so it also exercises the arm to
#         contrast conversion (log odds ratio, multi-arm).
data(Woods2010)
p_woods <- pairwise(treatment, event = r, n = N, studlab = author,
  data = Woods2010, sm = "OR")
write_fixture("woods2010", netmeta(p_woods), p_woods)

# ---- 4. Dong2013: mortality in COPD, arm level, many multi-arm studies.
data(Dong2013)
p_dong <- pairwise(treatment, death, randomized, studlab = id,
  data = Dong2013, sm = "OR", allstudies = TRUE)
write_fixture("dong2013", netmeta(p_dong), p_dong, heavy = FALSE)

# ---- 5 and 6. The two fictitious networks from Ruecker et al 2024, where every
#         effect is fixed and every standard error is 1, so the path weights are
#         readable by hand and the published values can be checked directly.
ex1 <- data.frame(
  treat1 = c("A", "A", "B", "B", "C"),
  treat2 = c("B", "C", "C", "D", "D"),
  TE = rep(1, 5), seTE = rep(1, 5), stringsAsFactors = FALSE
)
ex1$studlab <- paste0(ex1$treat1, ex1$treat2)
write_fixture("example1",
  netmeta(TE, seTE, treat1, treat2, studlab, data = ex1), ex1)

ex2 <- data.frame(
  treat1 = c("A", "A", "E", "E", "B", "B", "D"),
  treat2 = c("E", "B", "B", "D", "D", "C", "C"),
  TE = rep(0, 7), seTE = rep(1, 7), stringsAsFactors = FALSE
)
ex2$studlab <- paste0(ex2$treat1, ex2$treat2)
write_fixture("example2",
  netmeta(TE, seTE, treat1, treat2, studlab, data = ex2), ex2)
