/* Reading a file of network meta-analysis data.
 *
 * Two shapes are accepted, because those are the two shapes people have.
 *
 *   Contrast level, one row per comparison:
 *     study, treat1, treat2, TE, seTE
 *
 *   Arm level, one row per arm of each study:
 *     study, treatment, event, n              (binary)
 *     study, treatment, mean, sd, n           (continuous)
 *
 * Arm-level data is converted to contrasts here, on the same formulas the R
 * function netmeta::pairwise uses, and tests/parse.test.mjs checks the result
 * against netmeta's own output for two published datasets.
 *
 * A league table of pooled effects is deliberately not accepted. Every lens on
 * this site reads the hat matrix, which is built from the individual studies;
 * pooled results alone cannot reconstruct it.
 */

/* ---- Delimited text ------------------------------------------------------ */

/* Split one line of a delimited file, honoring double-quoted fields and the
 * doubled quote that escapes a quote inside one. */
function splitLine(line, delimiter) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      fields.push(field);
      field = "";
    } else field += c;
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/* The delimiter is whichever candidate splits the header into the most fields;
 * ties go to the earlier candidate, which puts comma first. */
function detectDelimiter(headerLine) {
  return [",", "\t", ";", "|"].reduce((best, candidate) =>
    splitLine(headerLine, candidate).length > splitLine(headerLine, best).length
      ? candidate
      : best
  );
}

export function parseTable(text) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length < 2)
    throw new Error("The file needs a header row and at least one row of data.");

  const delimiter = detectDelimiter(lines[0]);
  const columns = splitLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line, i) => {
    const fields = splitLine(line, delimiter);
    if (fields.length !== columns.length)
      throw new Error(
        `Line ${i + 2} has ${fields.length} fields but the header has ${columns.length}.`
      );
    return Object.fromEntries(columns.map((name, j) => [name, fields[j]]));
  });
  return { columns, rows, delimiter };
}

/* ---- Column detection ---------------------------------------------------- */

/* Column names people actually use, lower-cased and stripped of punctuation.
 * The first match in each list wins, so the netmeta names come first. */
const ALIASES = {
  studlab: ["studlab", "study", "studyid", "trial", "trialid", "id", "author", "citation"],
  treat1: ["treat1", "t1", "treatment1", "arm1", "trt1", "comparator1"],
  treat2: ["treat2", "t2", "treatment2", "arm2", "trt2", "comparator2"],
  TE: ["te", "effect", "yi", "y", "estimate", "lnor", "logor", "logrr", "lnrr", "smd", "md", "diff"],
  seTE: ["sete", "se", "sei", "standarderror", "stderr", "selnor", "selogor", "selnrr"],
  treatment: ["treatment", "treat", "arm", "trt", "intervention", "t"],
  event: ["event", "events", "r", "responders", "deaths", "death", "cases", "n_events"],
  n: ["n", "total", "ntotal", "sampsize", "samplesize", "randomized", "randomised", "nrand"],
  mean: ["mean", "m", "meanvalue"],
  sd: ["sd", "stddev", "standarddeviation", "s"],
};

const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function findColumn(columns, role) {
  const wanted = ALIASES[role];
  const normalized = columns.map(normalize);
  for (const alias of wanted) {
    const at = normalized.indexOf(alias);
    if (at !== -1) return columns[at];
  }
  return null;
}

/* Work out which of the two shapes a table is in, and which column plays which
 * part. The returned mapping is what the interface shows the reader so they can
 * correct a wrong guess rather than being told the file is unreadable. */
export function detectLayout(table) {
  const pick = (role) => findColumn(table.columns, role);
  const contrast = {
    studlab: pick("studlab"),
    treat1: pick("treat1"),
    treat2: pick("treat2"),
    TE: pick("TE"),
    seTE: pick("seTE"),
  };
  if (contrast.treat1 && contrast.treat2 && contrast.TE && contrast.seTE)
    return { layout: "contrast", columns: contrast };

  const arm = {
    studlab: pick("studlab"),
    treatment: pick("treatment"),
    event: pick("event"),
    n: pick("n"),
    mean: pick("mean"),
    sd: pick("sd"),
  };
  if (arm.studlab && arm.treatment && arm.n && (arm.event || (arm.mean && arm.sd)))
    return {
      layout: "arm",
      kind: arm.event ? "binary" : "continuous",
      columns: arm,
    };

  throw new Error(
    "The columns could not be recognized. Contrast-level data needs treat1, treat2, TE and seTE; " +
      "arm-level data needs study, treatment, n, and either event or mean and sd. " +
      `The file has: ${table.columns.join(", ")}.`
  );
}

const asNumber = (value, column, line) => {
  if (value === "" || value === "NA" || value === "NaN" || value == null) return NaN;
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new Error(`Line ${line} has "${value}" in column ${column}, which is not a number.`);
  return number;
};

/* ---- Effect measures ----------------------------------------------------- */

export const MEASURES = {
  MD: { label: "Mean difference", log: false, kind: "continuous" },
  SMD: { label: "Standardized mean difference", log: false, kind: "continuous" },
  RD: { label: "Risk difference", log: false, kind: "binary" },
  OR: { label: "Odds ratio", log: true, kind: "binary" },
  RR: { label: "Risk ratio", log: true, kind: "binary" },
  HR: { label: "Hazard ratio", log: true, kind: "binary" },
  IRR: { label: "Incidence rate ratio", log: true, kind: "binary" },
};

/* What scale a contrast-level file is on, guessed from the name of its effect
 * column.
 *
 * This matters more than it looks. A ratio measure is fitted on the log scale
 * and shown exponentiated, so guessing "odds ratio" for a file of mean
 * differences would exponentiate every number on the site and move the line of
 * no difference from zero to one. The guess therefore defaults to the identity
 * scale, which leaves the numbers as the file gave them, and the interface
 * offers the reader the choice rather than deciding silently.
 */
export function inferMeasure(column) {
  const name = normalize(column ?? "");
  if (/^(se)?(ln|log)?or$/.test(name) || name.includes("odds")) return "OR";
  if (/^(se)?(ln|log)?rr$/.test(name) || name.includes("riskratio")) return "RR";
  if (/^(se)?(ln|log)?hr$/.test(name) || name.includes("hazard")) return "HR";
  if (/^(se)?(ln|log)?irr$/.test(name) || name.includes("rate")) return "IRR";
  if (name.includes("smd")) return "SMD";
  return "MD";
}

/* Contrast between two binary arms. netmeta adds 0.5 to every cell of a study
 * that has a zero cell, not to every study, so the increment is decided for the
 * whole study before any pair is formed. */
function binaryContrast(a, b, measure, increment) {
  const e1 = a.event + increment;
  const n1 = a.n + 2 * increment;
  const e2 = b.event + increment;
  const n2 = b.n + 2 * increment;
  if (measure === "OR")
    return {
      TE: Math.log((e1 * (n2 - e2)) / ((n1 - e1) * e2)),
      seTE: Math.sqrt(1 / e1 + 1 / (n1 - e1) + 1 / e2 + 1 / (n2 - e2)),
    };
  if (measure === "RR")
    return {
      TE: Math.log((e1 / n1) / (e2 / n2)),
      seTE: Math.sqrt(1 / e1 - 1 / n1 + 1 / e2 - 1 / n2),
    };
  const p1 = e1 / n1;
  const p2 = e2 / n2;
  return {
    TE: p1 - p2,
    seTE: Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2),
  };
}

function continuousContrast(a, b, measure) {
  if (measure === "MD")
    return {
      TE: a.mean - b.mean,
      seTE: Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n),
    };
  // Hedges' g: the pooled standard deviation, with the small sample correction.
  const df = a.n + b.n - 2;
  const pooled = Math.sqrt(((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / df);
  const correction = 1 - 3 / (4 * df - 1);
  const g = (correction * (a.mean - b.mean)) / pooled;
  return {
    TE: g,
    seTE: Math.sqrt(1 / a.n + 1 / b.n + g ** 2 / (2 * df)),
  };
}

/* ---- The two conversions ------------------------------------------------- */

function readContrasts(table, columns) {
  return table.rows.map((row, i) => {
    const line = i + 2;
    const studlab = columns.studlab ? String(row[columns.studlab]).trim() : String(line);
    const treat1 = String(row[columns.treat1]).trim();
    const treat2 = String(row[columns.treat2]).trim();
    if (!treat1 || !treat2)
      throw new Error(`Line ${line} is missing a treatment name.`);
    if (treat1 === treat2)
      throw new Error(`Line ${line} compares ${treat1} with itself.`);
    return {
      studlab,
      treat1,
      treat2,
      TE: asNumber(row[columns.TE], columns.TE, line),
      seTE: asNumber(row[columns.seTE], columns.seTE, line),
    };
  });
}

function readArms(table, columns, measure) {
  const kind = MEASURES[measure].kind;
  const byStudy = new Map();
  table.rows.forEach((row, i) => {
    const line = i + 2;
    const studlab = String(row[columns.studlab]).trim();
    const arm = {
      treatment: String(row[columns.treatment]).trim(),
      n: asNumber(row[columns.n], columns.n, line),
      line,
    };
    if (kind === "binary") arm.event = asNumber(row[columns.event], columns.event, line);
    else {
      arm.mean = asNumber(row[columns.mean], columns.mean, line);
      arm.sd = asNumber(row[columns.sd], columns.sd, line);
    }
    if (!studlab || !arm.treatment)
      throw new Error(`Line ${line} is missing a study or treatment name.`);
    if (!Number.isSafeInteger(arm.n) || arm.n <= 0)
      throw new Error(`Line ${line} needs a positive integer sample size.`);
    if (kind === "binary") {
      if (!Number.isSafeInteger(arm.event) || arm.event < 0 || arm.event > arm.n)
        throw new Error(`Line ${line} needs an integer event count between zero and n.`);
    } else {
      if (!Number.isFinite(arm.mean) || !Number.isFinite(arm.sd) || arm.sd < 0)
        throw new Error(`Line ${line} needs a finite mean and nonnegative standard deviation.`);
      if (measure === "SMD" && arm.n < 2)
        throw new Error(`Line ${line} needs at least two participants for a standardized mean difference.`);
    }
    if (!byStudy.has(studlab)) byStudy.set(studlab, []);
    if (byStudy.get(studlab).some(a => a.treatment === arm.treatment))
      throw new Error(`Line ${line} duplicates treatment ${arm.treatment} in study ${studlab}.`);
    byStudy.get(studlab).push(arm);
  });

  const contrasts = [];
  const dropped = [];
  for (const [studlab, arms] of byStudy) {
    if (arms.length < 2) {
      dropped.push(`${studlab} has only one arm`);
      continue;
    }
    // A study with a zero or full cell in any arm gets 0.5 added to every cell,
    // which is what netmeta does; the increment then applies to all of its
    // pairs, not only to the pair containing the zero.
    const increment =
      kind === "binary" && arms.some((a) => a.event === 0 || a.event === a.n) ? 0.5 : 0;
    for (let i = 0; i < arms.length - 1; i++)
      for (let j = i + 1; j < arms.length; j++) {
        const effect =
          kind === "binary"
            ? binaryContrast(arms[i], arms[j], measure, increment)
            : continuousContrast(arms[i], arms[j], measure);
        if (!Number.isFinite(effect.TE) || !Number.isFinite(effect.seTE)) {
          dropped.push(
            `${studlab}: ${arms[i].treatment} vs ${arms[j].treatment} has no finite effect`
          );
          continue;
        }
        contrasts.push({
          studlab,
          treat1: arms[i].treatment,
          treat2: arms[j].treatment,
          ...effect,
        });
      }
  }
  return { contrasts, dropped };
}

/* Read a file into the contrast rows the model wants. `measure` only matters
 * for arm-level data; contrast-level data is already on its own scale. */
export function readNetwork(text, { measure = "OR", overrides = {} } = {}) {
  const table = parseTable(text);
  const detected = detectLayout(table);
  const columns = { ...detected.columns, ...overrides };

  if (detected.layout === "contrast")
    return {
      layout: "contrast",
      columns,
      // The caller's measure only describes arm-level conversion; a
      // contrast-level file arrives already on its own scale, so the scale is
      // read from the column name rather than assumed.
      measure: inferMeasure(columns.TE),
      contrasts: readContrasts(table, columns),
      dropped: [],
    };

  const chosen =
    MEASURES[measure].kind === detected.kind
      ? measure
      : detected.kind === "binary"
        ? "OR"
        : "MD";
  const { contrasts, dropped } = readArms(table, columns, chosen);
  return { layout: "arm", kind: detected.kind, columns, measure: chosen, contrasts, dropped };
}
