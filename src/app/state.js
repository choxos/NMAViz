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

  // The machine itself. Power is the mains switch on the shell, not the rocker
  // in the circuit: one turns the display off, the other opens the source
  // branch.
  power: true,
  paused: false,
  // Treatments the reader has placed by hand, as fractions of the clear box so
  // that a pinned treatment stays where it was put when the window resizes.
  pins: {}, // treatment -> { u, v }
  // Whether the switch on the source lead is pressed off, which breaks the
  // branch so that no current is driven through the network at all.
  openCircuit: false,
  // Trials pulled out of the analysis, and the refit without them. This is the
  // one control on the site that changes the evidence rather than the question
  // or the drawing, so it is kept apart: the original fit stays in `fit` and is
  // shown beside the sensitivity one, never replaced by it.
  excluded: [], // study labels
  sensitivity: null, // { fit, error } | null
  // A prediction the reader has placed and not yet tested. Kept apart from
  // everything else on purpose: it is a wager about the arithmetic, and it must
  // never be able to change the arithmetic.
  wager: null, // { contrast, model, guess, settled } | null
};

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/* State that belongs to one comparison, and to the model it was placed under.
 *
 * A wager is a guess about where one comparison's springs come to rest, and a
 * released walk is released somewhere inside the comparison it is drawn under.
 * Neither means anything once what it was about has moved, and a wager that
 * merely stops matching is worse than one that is cleared: the springs lens
 * hides its numbers only while a matching wager is open, so a stale wager
 * silently hands over the answer it was asking for.
 *
 * Doing this here rather than at each of the six places a comparison can
 * change (the two menus, the swap, an edge, a node, a probe dropped on a
 * treatment) is the only way to be sure none of them is missed.
 */
function invalidate(changes) {
  if (changes.model && changes.model !== state.model) state.wager = null;
  // Pause is about what was running, and every game runs a different thing.
  // Carried across it would leave the key and the flag disagreeing about which
  // of them is holding the picture still.
  if (changes.lens && changes.lens !== state.lens) state.paused = false;
  const next = changes.contrast;
  if (!next || !state.contrast) return;
  // The wager is placed on an axis that runs from one treatment to the other,
  // so even reversing the comparison invalidates it.
  if (next.treat1 !== state.contrast.treat1 || next.treat2 !== state.contrast.treat2)
    state.wager = null;
  // A walk survives as long as it is still released inside the comparison it
  // is drawn under, which a swap does not change.
  const origin = state.options.origin;
  if (origin && origin !== next.treat1 && origin !== next.treat2) {
    const options = { ...state.options };
    delete options.origin;
    state.options = options;
  }
}

let scheduled = false;
export function update(changes = {}) {
  invalidate(changes);
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
      pins: {},
      openCircuit: false,
      excluded: [],
      sensitivity: null,
      wager: null,
      // Machine settings belong to the network they were set on: a held walk
      // step or a switched-off source means nothing on the next dataset.
      options: {},
      panel: null,
    });
  } catch (error) {
    update({
      error: error.message,
      fit: null,
      dataset,
      rows,
      pins: {},
      openCircuit: false,
      excluded: [],
      sensitivity: null,
      wager: null,
      panel: "data",
    });
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

/* Leave a set of trials out and refit without them.
 *
 * A trial is removed whole, arms and all, because a multi-arm trial is one
 * correlated object and dropping one of its contrasts would be dropping a piece
 * of evidence that does not exist on its own.
 *
 * Removing enough trials can break the network into pieces that no longer share
 * a comparison, and that is a different outcome from a wide interval rather than
 * an extreme case of one: there is no estimate at all, not a bad one. So the
 * failure is kept as a message rather than smuggled in as a very large standard
 * error.
 *
 * Tau squared is re-estimated on what is left, which is the usual convention for
 * a leave-one-out analysis and is worth stating because the other convention,
 * holding it fixed at the full-network value, gives different intervals.
 */
export function setExcluded(labels) {
  const excluded = [...new Set(labels)];
  if (!excluded.length) return update({ excluded, sensitivity: null });

  const left = new Set(excluded);
  const kept = state.rows.filter((row) => !left.has(row.studlab));
  if (!kept.length)
    return update({ excluded, sensitivity: { fit: null, error: "Nothing is left to analyze." } });

  try {
    update({ excluded, sensitivity: { fit: fitNetwork(kept), error: null } });
  } catch (error) {
    update({ excluded, sensitivity: { fit: null, error: error.message } });
  }
}

/* The comparison of interest under both fits, for a lens that wants to show
 * what leaving those trials out did. */
export function sensitivityOf(contrast, model = "common") {
  if (!contrast || !state.fit) return null;
  const pick = (fit) => {
    const half = model === "random" ? fit?.random : fit?.common;
    const i = half?.index.get(contrast.treat1);
    const j = half?.index.get(contrast.treat2);
    if (i == null || j == null) return null;
    return { TE: half.TE[i][j], seTE: half.seTE[i][j] };
  };
  return {
    full: pick(state.fit),
    without: state.sensitivity?.fit ? pick(state.sensitivity.fit) : null,
    error: state.sensitivity?.error ?? null,
    excluded: state.excluded,
  };
}
