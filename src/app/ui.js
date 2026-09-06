/* Small shared pieces: number formatting on the reader's scale, the icon set,
 * and the two DOM helpers the rest of the interface is built from. */

/* Effects are fitted on the log scale for ratio measures, but nobody reads a
 * log odds ratio, so anything shown to a reader goes back to the scale the
 * measure is named on. */
export const isRatio = (measure) => ["OR", "RR", "HR", "IRR", "ROM"].includes(measure);

export const onScale = (value, measure) =>
  isRatio(measure) ? Math.exp(value) : value;

export function number(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return "–";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  const rounded = value.toFixed(digits);
  // Avoid printing a signed zero, which reads as a real direction.
  return rounded === (0).toFixed(digits) ? (0).toFixed(digits) : rounded.replace("-", "−");
}

export const percent = (value, digits = 1) =>
  value == null || Number.isNaN(value) ? "–" : `${(value * 100).toFixed(digits)}%`;

/* A point estimate with its interval, already moved onto the reader's scale. */
export function effect(TE, seTE, measure, { digits = 2, level = 1.96 } = {}) {
  if (TE == null || Number.isNaN(TE)) return "–";
  const point = onScale(TE, measure);
  if (seTE == null || Number.isNaN(seTE)) return number(point, digits);
  const lower = onScale(TE - level * seTE, measure);
  const upper = onScale(TE + level * seTE, measure);
  return `${number(point, digits)} (${number(lower, digits)} to ${number(upper, digits)})`;
}

/* The value at which a measure means "no difference". */
export const nullValue = (measure) => (isRatio(measure) ? 1 : 0);

export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

/* Long treatment names are common and they wreck a network drawing, so labels
 * are shortened for the canvas but never in prose or in the inspector. */
export function shortLabel(name, limit = 18) {
  if (name.length <= limit) return name;
  return `${name.slice(0, limit - 1).trimEnd()}…`;
}

export const svgNode = (markup) => {
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
  holder.innerHTML = markup;
  return holder;
};

export const ICONS = {
  network:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="4.5" r="2.2"/><circle cx="4.8" cy="16" r="2.2"/><circle cx="19.2" cy="16" r="2.2"/><path d="M10.6 6.4 6.2 14.1M13.4 6.4l4.4 7.7M7 16h10"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 4 7l3 3M4 7h11a4 4 0 0 1 4 4M17 20l3-3-3-3M20 17H9a4 4 0 0 1-4-4"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.6"/></svg>',
  upload:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>',
  reset:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a8 8 0 1 1 1.2 6M4 5v5h5"/></svg>',
};
