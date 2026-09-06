/* What a thing on the canvas says when the pointer rests on it.
 *
 * Every lens draws shapes that carry real quantities, and until now those
 * quantities were only reachable by clicking, which changes what the whole
 * screen is about. A hover should answer a smaller question without moving the
 * reader anywhere: what is this, and what number is it.
 *
 * The describers here work from the fitted model alone, so a treatment, a
 * comparison and a trial say the same thing in every lens. A lens that knows
 * something extra about the shape it drew adds it by exporting `describe`,
 * whose rows are appended to these.
 */

import { effect, escape, number, percent } from "./ui.js";

const heterogeneity = (edge) => {
  if (edge.df <= 0) return null;
  const I2 = Math.max(0, (edge.Q - edge.df) / edge.Q);
  return Number.isFinite(I2) ? I2 : null;
};

/* The comparison a pair of treatments makes, whichever way round it is drawn. */
export const findEdge = (model, treat1, treat2) =>
  model.direct.find(
    (e) =>
      (e.treat1 === treat1 && e.treat2 === treat2) ||
      (e.treat1 === treat2 && e.treat2 === treat1)
  ) ?? null;

function treatmentTip(context, name) {
  const { model, state, measure } = context;
  const index = model.index.get(name);
  if (index == null) return null;

  const comparisons = model.direct.filter((e) => e.treat1 === name || e.treat2 === name);
  const studies = new Set();
  for (const edge of comparisons) for (const row of edge.rows) studies.add(row.studlab);

  const rows = [
    ["Compared directly with", `${comparisons.length} treatment${comparisons.length === 1 ? "" : "s"}`],
    ["Studies including it", studies.size],
  ];

  // The comparison of interest is the question the whole screen is answering,
  // so a treatment says where it stands in that question.
  const other =
    state.contrast?.treat1 === name
      ? state.contrast.treat2
      : state.contrast?.treat2 === name
        ? state.contrast.treat1
        : null;
  if (other) {
    const i = model.index.get(other);
    rows.push([
      `Network estimate vs ${other}`,
      effect(model.TE[index][i], model.seTE[index][i], measure),
    ]);
  } else if (state.contrast) {
    const a = model.index.get(state.contrast.treat1);
    const b = model.index.get(state.contrast.treat2);
    if (a != null && b != null) {
      rows.push([
        `vs ${state.contrast.treat1}`,
        effect(model.TE[index][a], model.seTE[index][a], measure),
      ]);
      rows.push([
        `vs ${state.contrast.treat2}`,
        effect(model.TE[index][b], model.seTE[index][b], measure),
      ]);
    }
  }

  return {
    kicker: "Treatment",
    title: name,
    rows,
    note: "Drag to move it. Click to bring it into the comparison of interest.",
  };
}

function edgeTip(context, key) {
  const { model, measure } = context;
  const [treat1, treat2] = key.split(" ");
  const edge = findEdge(model, treat1, treat2);
  const i = model.index.get(treat1);
  const j = model.index.get(treat2);
  if (i == null || j == null) return null;

  const rows = [["Network", effect(model.TE[i][j], model.seTE[i][j], measure)]];

  if (!edge)
    return {
      kicker: "Comparison",
      title: `${treat1} vs ${treat2}`,
      rows,
      note: "No study compared these two directly. Everything here is indirect.",
    };

  const flip = edge.treat1 === treat1 ? 1 : -1;
  rows.push(["Direct", effect(flip * edge.TE, edge.seTE, measure)]);
  rows.push(["Indirect", effect(flip * edge.indirectTE, edge.indirectSe, measure)]);
  rows.push(["Direct evidence", percent(edge.proportion, 1)]);
  rows.push(["Studies", edge.studies]);

  const I2 = heterogeneity(edge);
  if (I2 != null) rows.push(["I² across them", percent(I2, 0)]);

  return {
    kicker: "Comparison",
    title: `${treat1} vs ${treat2}`,
    rows,
    note:
      edge.studies === 1
        ? "One study carries this comparison."
        : "Click to make this the comparison of interest.",
  };
}

function studyTip(context, label) {
  const { model, measure } = context;
  const rows = model.rows.filter((r) => r.studlab === label);
  if (!rows.length) return null;

  const arms = new Set();
  for (const row of rows) {
    arms.add(row.treat1);
    arms.add(row.treat2);
  }

  const listed = rows
    .slice(0, 4)
    .map((row) => [`${row.treat1} vs ${row.treat2}`, effect(row.TE, row.seTE, measure)]);
  if (rows.length > 4) listed.push(["and more", `${rows.length - 4} further contrasts`]);

  return {
    kicker: arms.size > 2 ? `Trial, ${arms.size} arms` : "Trial",
    title: label,
    rows: listed,
    note:
      arms.size > 2
        ? "A multi-arm trial contributes correlated contrasts, which the model corrects for."
        : null,
  };
}

const DESCRIBERS = {
  treatment: treatmentTip,
  edge: edgeTip,
  study: studyTip,
};

/* The card for one target, or null when there is nothing worth saying. */
export function describe(context, target, lens) {
  const base = DESCRIBERS[target.kind]?.(context, target.id) ?? null;
  const extra = lens?.describe?.(context, target) ?? null;
  if (!base && !extra) return null;
  return {
    kicker: extra?.kicker ?? base?.kicker ?? "",
    title: extra?.title ?? base?.title ?? "",
    rows: [...(extra?.rows ?? []), ...(base?.rows ?? [])],
    note: extra?.note ?? base?.note ?? null,
  };
}

export function tipMarkup(card) {
  const rows = card.rows
    .map(
      ([label, value]) =>
        `<div><dt>${escape(String(label))}</dt><dd>${escape(String(value))}</dd></div>`
    )
    .join("");
  return `
    <div class="tip-kicker">${escape(card.kicker)}</div>
    <div class="tip-title">${escape(card.title)}</div>
    ${rows ? `<dl class="tip-rows">${rows}</dl>` : ""}
    ${card.note ? `<p class="tip-note">${escape(card.note)}</p>` : ""}
  `;
}

export { number };
