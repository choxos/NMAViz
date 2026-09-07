supplement <- "documentation/refs/Path-Weights_Rucker2024_Supp"
for (file in list.files(supplement, pattern = "rda$", full.names = TRUE)) load(file)
edges <- colnames(L2$weights)
rows <- lapply(seq_len(nrow(L2$weights)), function(i) {
  z <- L2$zlist[[i]][, edges, drop = FALSE]
  list(contrast = rownames(L2$weights)[i],
       h = drop(crossprod(z, L2$phi[[i]])),
       shortest = shortest[i, ], randomwalk = randomwalk[i, ],
       l1 = L1$weights[i, ], l2 = L2$weights[i, ],
       paths = length(L2$phi[[i]]))
})
jsonlite::write_json(list(
  source = "Rucker et al. 2024 supplied four Linde2016 RDA matrices. h = transpose(Z) phi from supplied L2 result. Common-effect model.",
  edges = edges, rows = rows),
  "tests/fixtures/path-methods/linde2016.json", digits = 16, auto_unbox = TRUE)
