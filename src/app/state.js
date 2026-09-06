/* The one piece of application state, and the fitted model derived from it.
 *
 * Everything on the screen is a function of this object. Fitting is not free on
 * a ninety-trial network, so the fit is memoized against the rows it was
 * computed from and recomputed only when the data itself changes.
 */

import { fitNetwork } from "../nma/model.js";

const listeners = new Set();

export const state = {
  // The loaded data.
  dataset: null, // { id, name, summary, outcome, unit, measure, favors, source }
  rows: [], // contrast-level rows
  fit: null,
  error: null,

  // What is being looked at.
  lens: "network",
  model: "common", // "common" or "random"
  layout: "precision",
  contrast: null, // { treat1, treat2 }: the comparison of interest
  selection: null, // { kind: "treatment" | "edge" | "study", id }
  hover: null,
  search: "",
  panel: null, // an open overlay panel: "data", "about"
  // Settings that belong to one lens rather than to the whole studio. Lenses
  // read their own keys and ignore the rest.
  options: {},
  separation: 0, // 0 is the network, 1 is the exploded study inventory
};

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let scheduled = false;
export function update(changes = {}) {
  Object.assign(state, changes);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const listener of listeners) listener(state);
  });
}

/* Load a set of contrast rows, fit it, and pick a sensible starting contrast:
 * the comparison the network is least able to answer directly is the one worth
 * looking at first, so the default is the pair with the smallest direct
 * evidence proportion among those that have a direct comparison at all. */
export function load(dataset, rows) {
  try {
    const fit = fitNetwork(rows);
    const worst = [...fit.common.direct].sort((a, b) => a.proportion - b.proportion)[0];
    update({
      dataset,
      rows,
      fit,
      error: null,
      contrast: worst ? { treat1: worst.treat1, treat2: worst.treat2 } : null,
      selection: null,
      separation: 0,
      panel: null,
    });
  } catch (error) {
    update({ error: error.message, fit: null, dataset, rows, panel: "data" });
  }
}

/* The half of the fit the current model toggle selects. */
export const activeModel = () => (state.model === "random" ? state.fit?.random : state.fit?.common);

export const contrastIndices = () => {
  const model = activeModel();
  if (!model || !state.contrast) return null;
  const i = model.index.get(state.contrast.treat1);
  const j = model.index.get(state.contrast.treat2);
  return i == null || j == null ? null : { i, j };
};

/* The observed comparison between two treatments, if there is one. */
export const directEdge = (treat1, treat2) =>
  activeModel()?.direct.find(
    (edge) =>
      (edge.treat1 === treat1 && edge.treat2 === treat2) ||
      (edge.treat1 === treat2 && edge.treat2 === treat1)
  ) ?? null;
