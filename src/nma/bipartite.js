/* Davies (2026), equations 9 and 23 to 27; Senn (2012), fixed-trial GLS.
 * Arm coefficients use the app's treat1-minus-treat2 sign convention.
 * Eliminating fixed trial intercepts gives diag(g) - g g' / sum(g).
 */
import { inverse, multiply, zeros } from "./matrix.js";

export function bipartiteFlow(model, treat1, treat2, { armVariances: supplied = {} } = {}) {
  const a = model.index.get(treat1);
  const b = model.index.get(treat2);
  if (a == null || b == null || a === b) return null;
  const voltage = model.Lplus.map((r) => r[a] - r[b]);
  const grouped = new Map();
  model.rows.forEach((r, i) => {
    if (!grouped.has(r.studlab)) grouped.set(r.studlab, []);
    grouped.get(r.studlab).push(i);
  });
  const studies = [...grouped].map(([studlab, indices]) => {
    const names = [...new Set(indices.flatMap((i) => [model.rows[i].treat1, model.rows[i].treat2]))];
    const variance = (x, y) => {
      const row = indices.map((i) => model.rows[i]).find((r) =>
        (r.treat1 === x && r.treat2 === y) || (r.treat1 === y && r.treat2 === x));
      return row?.seTE ** 2;
    };
    const coefficients = new Map(names.map((name) => [name, 0]));
    let contribution = 0;
    for (const i of indices) {
      const r = model.rows[i];
      const h = model.w[i] * (voltage[model.index.get(r.treat1)] - voltage[model.index.get(r.treat2)]);
      coefficients.set(r.treat1, coefficients.get(r.treat1) + h);
      coefficients.set(r.treat2, coefficients.get(r.treat2) - h);
      contribution += h * r.TE;
    }
    const equalSplit = names.length === 2 && !supplied[studlab];
    const armVariances = names.map((name) => {
      if (supplied[studlab]) return supplied[studlab][name];
      if (equalSplit) return variance(...names) / 2;
      const others = names.filter((x) => x !== name);
      return (variance(name, others[0]) + variance(name, others[1]) - variance(...others.slice(0, 2))) / 2;
    });
    const scale = Math.max(...indices.map((i) => model.rows[i].seTE ** 2));
    let supported = armVariances.every((v) => Number.isFinite(v) && v > scale * 1e-10);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
      supported &&= Math.abs(armVariances[i] + armVariances[j] - variance(names[i], names[j])) < scale * 1e-7;
    const arms = names.map((treatment, i) => ({
      treatment, coefficient: coefficients.get(treatment),
      variance: supported ? armVariances[i] + model.tau ** 2 / 2 : null,
      weight: supported ? 1 / (armVariances[i] + model.tau ** 2 / 2) : null,
    }));
    return { studlab, arms, supported, equalSplit, contribution,
      flow: arms.reduce((s, arm) => s + Math.max(0, arm.coefficient), 0) };
  });
  const supported = studies.every((s) => s.supported);
  const biadjacency = studies.map((s) => model.treatments.map((t) => s.arms.find((arm) => arm.treatment === t)?.weight ?? 0));
  let upward = null, downward = null, projected = null, blockError = null;
  if (supported) {
    downward = biadjacency.map((row) => row.map((g) => g / row.reduce((s, x) => s + x, 0)));
    upward = model.treatments.map((_, j) => {
      const degree = biadjacency.reduce((s, row) => s + row[j], 0);
      return biadjacency.map((row) => row[j] / degree);
    });
    projected = multiply(upward, downward);
    const transient = model.treatments.map((_, i) => i).filter((i) => i !== b);
    const fundamental = inverse(transient.map((i) => transient.map((j) => (i === j ? 1 : 0) - projected[i][j])));
    const visits = model.treatments.map((_, i) => i === b ? 0 : fundamental[transient.indexOf(a)][transient.indexOf(i)]);
    studies.forEach((study, i) => {
      const trialVisits = visits.reduce((s, count, j) => s + count * upward[j][i], 0);
      study.arms.forEach((arm) => {
        const j = model.index.get(arm.treatment);
        arm.netCrossings = visits[j] * upward[j][i] - trialVisits * downward[i][j];
      });
    });
    const block = zeros(model.n, model.n);
    for (const g of biadjacency) {
      const total = g.reduce((s, x) => s + x, 0);
      for (let i = 0; i < model.n; i++) for (let j = 0; j < model.n; j++)
        block[i][j] += (i === j ? g[i] : 0) - g[i] * g[j] / total;
    }
    blockError = Math.max(...block.flatMap((row, i) => row.map((x, j) => Math.abs(x - model.L[i][j]))));
  }
  return { studies, supported, biadjacency, upward, downward, projected, blockError,
    reconstructed: studies.reduce((s, trial) => s + trial.contribution, 0),
    equalSplit: studies.some((s) => s.equalSplit) };
}
