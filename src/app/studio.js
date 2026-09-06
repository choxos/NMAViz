/* The studio: one large canvas with the network on it, and every control
 * floating over it on a glass panel.
 *
 * The network is the subject, so it gets the window. The panels are the same
 * four in every lens, which is what lets a reader switch lens without
 * relearning the screen: what data is loaded (top left), which lens (top),
 * which comparison and which model (bottom left), and what the lens has to say
 * about the current selection (right).
 */

import { LAYOUTS, frame, relieveOverlap, stressOf } from "./layout.js";
import { describe, tipMarkup } from "./tips.js";
import { makeRig, releaseFrom, stepRig } from "./play.js";
import { LENSES } from "./lenses/index.js";
import { nodeRadii } from "./lenses/draw.js";
import { activeModel, load, setExcluded, state, subscribe, update } from "./state.js";
import { ICONS, escape, number, percent, shortLabel } from "./ui.js";
import examples from "../data/examples.json";
import { readNetwork, MEASURES } from "../nma/parse.js";

/* Three themes, cycled by the one button: paper, night, and the instrument.
 *
 * The third exists because Rücker's claim is that an evidence network is an
 * electrical network, and a bench instrument is what you would read one on. It
 * changes the palette and the numerals and nothing else: every number stays
 * exactly as legible, and no texture is laid over the plot. */
const THEME_KEY = "nmaviz-theme";
const THEMES = {
  light: { next: "dark", icon: "moon", label: "Switch to the night theme" },
  dark: { next: "mono", icon: "contrast", label: "Switch to the black and white theme" },
  mono: { next: "arcade", icon: "scope", label: "Switch to the instrument theme" },
  arcade: { next: "light", icon: "sun", label: "Switch back to the paper theme" },
};

const currentTheme = () => {
  const set = document.documentElement.dataset.theme;
  return set in THEMES ? set : "light";
};

function setTheme(theme) {
  const chosen = theme in THEMES ? theme : "light";
  document.documentElement.dataset.theme = chosen;
  try {
    localStorage.setItem(THEME_KEY, chosen);
  } catch {}
  const button = document.querySelector("#theme-toggle");
  if (!button) return;
  button.innerHTML = ICONS[THEMES[chosen].icon];
  button.title = THEMES[chosen].label;
  button.setAttribute("aria-label", button.title);
}

/* ---- The shell, written once ---------------------------------------------- */

function shell() {
  const lensButtons = LENSES.map(
    (lens) => `
      <button class="lens-button" type="button" data-lens="${lens.id}"
        aria-label="${escape(lens.name)}" title="${escape(lens.name)}. ${escape(lens.tagline)}">
        ${lens.mark}<span>${escape(lens.name)}</span>
      </button>`
  ).join("");

  return `
    <div class="studio">
      <svg class="stage" id="stage" aria-label="Network diagram"></svg>
      <div class="vignette"></div>

      <div class="identity">
        <a class="brand" href="./">
          <span class="brand-mark">${ICONS.network}</span>
          <span class="brand-word">NMA<span class="brand-light">Viz</span></span>
        </a>
        <span class="eyebrow"><span class="live-dot"></span><span id="dataset-name"></span></span>
        <h1 id="lens-title"></h1>
        <p id="lens-note"></p>
      </div>

      <nav class="panel lens-bar" id="lens-bar" aria-label="Lens">${lensButtons}</nav>

      <div class="top-actions">
        <button id="data-button" class="panel icon-button" type="button" title="Choose or upload data">
          ${ICONS.data}<span>Data</span>
        </button>
        <button id="about-button" class="panel icon-button" type="button" title="About this site">
          ${ICONS.info}
        </button>
        <button id="theme-toggle" class="panel icon-button square" type="button"></button>
      </div>

      <aside class="panel controls" id="controls"></aside>
      <aside class="panel inspector" id="inspector"></aside>
      <div class="panel console" id="console" hidden></div>
      <div class="panel readouts" id="readouts"></div>
      <div class="overlay" id="overlay" hidden></div>
      <div class="tip" id="tip" role="tooltip" hidden></div>
    </div>
  `;
}

/* ---- Controls -------------------------------------------------------------- */

/* The controls are rebuilt only when their structure changes, never on every
 * update.
 *
 * Replacing the markup takes the element out from under the pointer, and a
 * range input whose node is replaced mid-gesture moves once and then stops
 * following the mouse. So the panel is built when the treatments change and
 * afterwards only synchronized: values written back, active pills marked, and
 * the control the reader is currently holding left alone.
 */
let controlsKey = null;

function controlsMarkup(model) {
  const options = model.treatments
    .map((t) => `<option value="${escape(t)}">${escape(t)}</option>`)
    .join("");

  const layoutPills = Object.entries(LAYOUTS)
    .map(([id, l]) => `<button type="button" data-layout="${id}">${l.label}</button>`)
    .join("");

  return `
    <div class="control-block">
      <label class="control-label" for="treat1">Comparison of interest</label>
      <div class="contrast-picker">
        <select id="treat1" aria-label="First treatment">${options}</select>
        <button id="swap" type="button" title="Reverse the direction">${ICONS.swap}</button>
        <select id="treat2" aria-label="Second treatment">${options}</select>
      </div>
    </div>

    <div class="control-row">
      <div class="control-block">
        <span class="control-label">Model</span>
        <div class="pills" id="model-pills">
          <button type="button" data-model="common">Common effect</button>
          <button type="button" data-model="random">Random effects</button>
        </div>
      </div>
    </div>

    <div class="control-row">
      <div class="control-block">
        <span class="control-label">Arrangement</span>
        <div class="pills" id="layout-pills">${layoutPills}</div>
      </div>
    </div>

    <div class="control-block">
      <label class="control-label" for="separation">
        Separation <output id="separation-value">0%</output>
      </label>
      <input id="separation" type="range" min="0" max="1" step="0.01" value="0" />
      <p class="control-hint">Fan every comparison out into the individual studies behind it.</p>
    </div>

    <p class="control-hint" id="drag-hint">
      Drag a treatment to move it, or select one and use the arrow keys.
    </p>

    <div class="control-block" id="arrangement-state" hidden>
      <p class="control-hint" id="arrangement-note"></p>
      <button type="button" class="text-button" id="reset-arrangement">Put them back</button>
    </div>
  `;
}

function renderControls() {
  const node = document.querySelector("#controls");
  const model = activeModel();
  if (!model) {
    node.innerHTML = "";
    controlsKey = null;
    return;
  }

  const key = `${state.dataset?.id}\u0000${model.treatments.join("\u0000")}`;
  if (key !== controlsKey) {
    controlsKey = key;
    node.innerHTML = controlsMarkup(model);
  }

  const treat1 = node.querySelector("#treat1");
  const treat2 = node.querySelector("#treat2");
  if (treat1 && state.contrast) treat1.value = state.contrast.treat1;
  if (treat2 && state.contrast) treat2.value = state.contrast.treat2;

  node
    .querySelectorAll("[data-model]")
    .forEach((b) => b.classList.toggle("active", b.dataset.model === state.model));
  node
    .querySelectorAll("[data-layout]")
    .forEach((b) => b.classList.toggle("active", b.dataset.layout === state.layout));

  const separation = node.querySelector("#separation");
  // Writing to the slider the reader is holding would fight their gesture.
  if (separation && document.activeElement !== separation)
    separation.value = String(state.separation);
  const readout = node.querySelector("#separation-value");
  if (readout) readout.textContent = `${Math.round(state.separation * 100)}%`;

  const moved = Object.keys(state.pins).length;
  const placedBlock = node.querySelector("#arrangement-state");
  if (placedBlock) {
    placedBlock.hidden = moved === 0;
    const note = node.querySelector("#arrangement-note");
    if (note)
      note.textContent =
        moved === 1
          ? "One treatment is where you put it, not where the model put it."
          : `${moved} treatments are where you put them, not where the model put them.`;
  }
}

/* ---- Readouts -------------------------------------------------------------- */

function renderReadouts() {
  const node = document.querySelector("#readouts");
  const fit = state.fit;
  if (!fit) {
    node.innerHTML = "";
    return;
  }
  const items = [
    ["Treatments", fit.treatments.length],
    ["Comparisons", fit.edges.length],
    ["Studies", fit.studies.length],
    ["Q", number(fit.Q, 1)],
    ["df", number(fit.df, 1)],
    ["I²", percent(fit.I2, 0)],
    ["τ", number(fit.tau, 3)],
  ];
  node.innerHTML = items
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

/* ---- Overlays: the data chooser and the about panel ------------------------ */

/* The open panel is rebuilt only when what it says changes, for the same reason
 * the controls are: an update that arrives while the reader is part way down a
 * long panel should not throw away their scroll position or the control they
 * are holding. */
let overlayKey = null;

function renderOverlay() {
  const node = document.querySelector("#overlay");
  if (!state.panel) {
    node.hidden = true;
    node.innerHTML = "";
    overlayKey = null;
    return;
  }
  const key = [state.panel, state.dataset?.id, state.dataset?.measure, state.error].join("\u0000");
  if (key === overlayKey) return;
  overlayKey = key;
  node.hidden = false;
  node.innerHTML = state.panel === "data" ? dataPanel() : aboutPanel();
}

/* What was made of an uploaded file, and the one thing the file cannot say.
 *
 * The columns are a guess and the scale is a guess. Both are shown, and the
 * scale is a control rather than a fact, because getting it wrong is not a
 * small error: a ratio measure is exponentiated everywhere on the site.
 */
function uploadSection() {
  const upload = state.dataset?.upload;
  if (!upload) return "";

  const columns = Object.entries(upload.columns)
    .filter(([, name]) => name)
    .map(([role, name]) => `<li><span>${escape(role)}</span><code>${escape(name)}</code></li>`)
    .join("");

  const options = Object.entries(MEASURES)
    .map(
      ([id, m]) =>
        `<option value="${id}"${id === state.dataset.measure ? " selected" : ""}>${escape(
          m.label
        )}${m.log ? " (shown exponentiated)" : ""}</option>`
    )
    .join("");

  const dropped = upload.dropped.length
    ? `<p class="sheet-note">Left out: ${escape(upload.dropped.join("; "))}.</p>`
    : "";

  return `
    <section>
      <h3>What was read from ${escape(state.dataset.name)}</h3>
      <p class="sheet-note">
        ${state.rows.length} comparisons, in the ${upload.layout} level layout.
      </p>
      <ul class="column-map">${columns}</ul>
      ${dropped}
      <label class="field">
        <span>Effect measure</span>
        <select id="measure-select">${options}</select>
      </label>
      <p class="sheet-note">
        A file carries numbers, not a scale. This was guessed from the name of the effect column;
        a ratio measure is fitted on the log scale and shown exponentiated, so correct it here if
        the guess is wrong.
      </p>
    </section>`;
}

function dataPanel() {
  const cards = examples
    .map(
      (e) => `
      <button class="example" type="button" data-example="${e.id}">
        <strong>${escape(e.name)}</strong>
        <span class="example-meta">${escape(e.outcome)}</span>
        <span class="example-summary">${escape(e.summary)}</span>
      </button>`
    )
    .join("");

  return `
    <div class="panel sheet" role="dialog" aria-label="Data">
      <div class="sheet-head">
        <h2>Data</h2>
        <button class="icon-button square" data-close type="button">${ICONS.close}</button>
      </div>
      ${state.error ? `<p class="error">${escape(state.error)}</p>` : ""}
      <div class="sheet-body">
        ${uploadSection()}
        <section>
          <h3>Your own file</h3>
          <p class="sheet-note">
            A CSV or tab separated file, read in this browser and never uploaded anywhere.
            Contrast level needs <code>treat1</code>, <code>treat2</code>, <code>TE</code> and
            <code>seTE</code>, with a study column. Arm level needs a study column, a
            <code>treatment</code> column, <code>n</code>, and either <code>event</code> or
            <code>mean</code> and <code>sd</code>.
          </p>
          <label class="file-drop" id="file-drop">
            ${ICONS.upload}
            <span>Choose a file, or drop one here</span>
            <input type="file" id="file-input" accept=".csv,.tsv,.txt,text/csv,text/plain" />
          </label>
          <p class="sheet-note">
            Pooled results alone are not enough: every lens here reads the hat matrix, which is
            built from the individual studies.
          </p>
        </section>
        <section>
          <h3>Example networks</h3>
          <p class="sheet-note">
            The ${examples.length} networks distributed with the R package netmeta, converted to
            contrast level.
          </p>
          <div class="examples">${cards}</div>
        </section>
      </div>
    </div>
  `;
}

function aboutPanel() {
  const lensList = LENSES.map(
    (lens) => `
      <li>
        <strong>${escape(lens.name)}</strong>
        <span>${escape(lens.tagline)}</span>
        <cite>${escape(lens.reference)}</cite>
      </li>`
  ).join("");

  return `
    <div class="panel sheet" role="dialog" aria-label="About">
      <div class="sheet-head">
        <h2>About</h2>
        <button class="icon-button square" data-close type="button">${ICONS.close}</button>
      </div>
      <div class="sheet-body">
        <section>
          <p class="sheet-note">
            NMAViz fits the frequentist graph-theoretical network meta-analysis model in your
            browser and then draws the same fitted model through the readings the methods
            literature has proposed for it. Nothing is uploaded: the file is parsed, analyzed and
            drawn on your own machine.
          </p>
          <p class="sheet-note">
            The engine is checked against the R package netmeta on six published networks, two of
            them with multi-arm studies: the Laplacian and its pseudoinverse, the hat matrix, the
            common and random effect estimates, the direct and indirect estimates, the direct
            evidence proportion, Q and tau squared all agree to eight decimal places.
          </p>
        </section>
        <section>
          <h3>The lenses</h3>
          <ul class="lens-list">${lensList}</ul>
        </section>
        <section>
          <h3>What this is not</h3>
          <p class="sheet-note">
            It does not fit Bayesian models, rank treatments, produce SUCRA or rankograms, assess
            risk of bias, or judge transitivity. Nothing here establishes transitivity, absence of
            bias, or a clinically meaningful ranking: zero inconsistency is not evidence of
            validity, and a large contribution is not evidence of quality.
          </p>
          <p class="sheet-note">
            Source, tests and the full account of the modeling choices are at
            <a href="https://github.com/choxos/NMAViz">github.com/choxos/NMAViz</a>.
          </p>
        </section>
      </div>
    </div>
  `;
}

/* ---- The canvas ------------------------------------------------------------ */

let cachedLayout = { key: null, points: null, meta: null };

/* Some lenses animate. They are driven from here rather than from inside the
 * lens, so that only the canvas is redrawn on a frame and the panels around it
 * are left alone. Twelve frames a second is enough for a process that is meant
 * to be read step by step, and it keeps a large network responsive. */
let frameCount = 0;
let animationTimer = null;

function setAnimation(active) {
  if (active && !animationTimer) {
    animationTimer = setInterval(() => {
      frameCount += 1;
      renderStage();
    }, 85);
  } else if (!active && animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
    frameCount = 0;
  }
}

/* Moving between arrangements.
 *
 * Switching from the precision arrangement to the circle rearranges every
 * treatment at once, and a network that teleports is a network a reader has to
 * re-read from scratch. Tweening the positions keeps identity: the eye follows
 * each treatment to its new place and the comparison being studied is never
 * lost. Anyone who has asked their system not to animate gets the jump instead.
 */
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let shownPoints = null;
let shownKey = null;
let tween = null;
let tweenFrame = null;

function runTween() {
  if (tweenFrame) return;
  const step = () => {
    tweenFrame = null;
    if (!tween) return;
    renderStage();
    if (tween) tweenFrame = requestAnimationFrame(step);
  };
  tweenFrame = requestAnimationFrame(step);
}

function framedPoints(model, box) {
  const built = layoutFor(model);
  const target = frame(built.points, box);
  const key = `${state.dataset?.id}|${state.model}|${state.layout}`;

  if (shownKey !== key) {
    if (shownKey !== null && shownPoints?.length === target.length && !reducedMotion()) {
      tween = { from: shownPoints, to: target, start: performance.now() };
      runTween();
    }
    shownKey = key;
  }
  shownPoints = target;

  if (!tween) return { points: target, meta: built.meta };

  const t = Math.min(1, (performance.now() - tween.start) / 460);
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const moving = tween.to.map((point, i) => ({
    x: tween.from[i].x + (point.x - tween.from[i].x) * eased,
    y: tween.from[i].y + (point.y - tween.from[i].y) * eased,
  }));
  if (t >= 1) tween = null;
  return { points: moving, meta: built.meta };
}

function layoutFor(model) {
  const key = `${state.dataset?.id}|${state.model}|${state.layout}`;
  if (cachedLayout.key !== key) {
    const built = LAYOUTS[state.layout].build(model);
    cachedLayout = { key, points: built.points, meta: built };
  }
  return cachedLayout;
}

/* The clear rectangle and the drawn positions of the last render, so a drag can
 * be expressed in the same coordinates the drawing uses. */
let lastBox = null;
let lastPoints = null;
let lastContext = null;

function currentFraction(index) {
  if (!lastBox || !lastPoints?.[index]) return { u: 0.5, v: 0.5 };
  return {
    u: (lastPoints[index].x - lastBox.left) / Math.max(1, lastBox.right - lastBox.left),
    v: (lastPoints[index].y - lastBox.top) / Math.max(1, lastBox.bottom - lastBox.top),
  };
}

function renderStage() {
  const stage = document.querySelector("#stage");
  const model = activeModel();
  const inspector = document.querySelector("#inspector");
  if (!model) {
    stage.innerHTML = "";
    inspector.innerHTML = "";
    return;
  }

  const width = stage.clientWidth || 1200;
  const height = stage.clientHeight || 800;
  stage.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Keep the network clear of the panels that float over it, so a treatment
  // never sits underneath the inspector and its label never runs off the edge.
  const wide = width > 900;
  const box = {
    left: wide ? 330 : 20,
    right: wide ? width - 372 : width - 20,
    top: wide ? 150 : 96,
    // On a narrow window every panel is stacked along the bottom, so the
    // network keeps the top of the screen to itself. A lens with a deck needs
    // another band cleared for it.
    bottom: wide
      ? height - (LENSES.find((l) => l.id === state.lens)?.deck ? 202 : 118)
      : Math.max(200, height * 0.36),
  };
  const framed = framedPoints(model, box);
  // A treatment the reader has dragged goes exactly where they put it. The
  // arrangement is a claim about standard errors, so moving a treatment by hand
  // makes the claim less true rather than differently true: the stress under
  // the title is recomputed on what is on screen, and it climbs as they push
  // the drawing away from the geometry.
  const held = new Set();
  const placed = framed.points.map((point, i) => {
    const pin = state.pins[model.treatments[i]];
    if (!pin) return point;
    held.add(i);
    return {
      x: box.left + pin.u * (box.right - box.left),
      y: box.top + pin.v * (box.bottom - box.top),
    };
  });
  // Separate any treatments whose circles would sit on top of each other, then
  // measure how much that cost, so the caption describes this drawing.
  const points = relieveOverlap(placed, nodeRadii(model), { fixed: held });
  lastBox = box;
  lastPoints = points;
  const meta =
    framed.meta.stress == null
      ? framed.meta
      : { ...framed.meta, stress: stressOf(points, model.resistance) };

  const lens = LENSES.find((l) => l.id === state.lens) ?? LENSES[0];
  syncRig(model);
  const context = {
    frame: frameCount,
    fit: state.fit,
    model,
    state,
    points,
    layoutMeta: meta,
    width,
    height,
    // The clear rectangle the panels leave behind, so a label can be turned
    // back inward rather than sliding under the inspector.
    box,
    pinned: held,
    rig,
    carrying,
    measure: state.dataset?.measure ?? "MD",
    dataset: state.dataset,
  };

  lastContext = context;
  setAnimation(Boolean(lens.animate));
  const drawn = lens.draw(context);
  stage.innerHTML = drawn.stage;
  // A lens can ask for a different skin. The circuit style restyles the shared
  // node drawing into junction dots, which is a CSS matter rather than a
  // different set of shapes.
  if (drawn.style) stage.dataset.style = drawn.style;
  else delete stage.dataset.style;
  // A new lens is a new statement about the network, so it arrives rather than
  // appearing. The class is set only when the lens actually changed, otherwise
  // an animated lens would restart its entrance on every frame.
  if (stage.dataset.lens !== lens.id) {
    stage.dataset.lens = lens.id;
    if (!reducedMotion()) {
      stage.classList.remove("entering");
      void stage.offsetWidth;
      stage.classList.add("entering");
    }
  }
  const reading = drawn.inspector ?? "";
  if (inspector.dataset.markup !== reading) {
    inspector.dataset.markup = reading;
    inspector.innerHTML = reading;
  }

  // The controls a lens offers for working its mechanism, rather than for
  // choosing what to look at. They sit on the deck under the canvas because
  // that is where the hands go.
  const deck = document.querySelector("#console");
  const controls = drawn.controls ?? "";
  // A swinging assembly or a running walk redraws many times a second, and the
  // deck's readings change every frame. Replacing its markup while a button is
  // held would take that button out from under the pointer, so the press would
  // land on one element and the release on its replacement, and no click would
  // ever arrive. The rebuild waits until the hand is off.
  if (deck.dataset.markup !== controls && !deckHeld) {
    deck.dataset.markup = controls;
    deck.innerHTML = controls;
  }
  deck.hidden = !controls;
  document.querySelector("#lens-title").textContent = lens.name;
  document.querySelector("#lens-note").textContent = drawn.note ?? lens.tagline;
  document.querySelector("#dataset-name").textContent = state.dataset?.name ?? "";

  document
    .querySelectorAll(".lens-button")
    .forEach((b) => b.classList.toggle("active", b.dataset.lens === state.lens));
}

/* ---- Events ---------------------------------------------------------------- */

function loadExample(id) {
  const example = examples.find((e) => e.id === id);
  shownKey = null;
  shownPoints = null;
  tween = null;
  const c = example.contrasts;
  const rows = c.studlab.map((_, i) => ({
    studlab: String(c.studlab[i]),
    treat1: c.treat1[i],
    treat2: c.treat2[i],
    TE: c.TE[i],
    seTE: c.seTE[i],
  }));
  cachedLayout = { key: null };
  load(example, rows);
}

async function loadFile(file) {
  try {
    const network = readNetwork(await file.text());
    cachedLayout = { key: null };
    load(
      {
        id: `upload:${file.name}`,
        name: file.name,
        summary: `${network.contrasts.length} comparisons read from your file.`,
        outcome: MEASURES[network.measure].label,
        unit: "",
        measure: network.measure,
        favors: "lower",
        source: "Uploaded in this browser.",
        // Kept so the data panel can show what was read and let the reader
        // correct the one guess that cannot be made from the numbers alone.
        upload: {
          layout: network.layout,
          columns: network.columns,
          dropped: network.dropped,
        },
      },
      network.contrasts
    );
  } catch (error) {
    update({ error: error.message, panel: "data" });
  }
}

/* ---- Props ----------------------------------------------------------------
 *
 * Things on the canvas the reader picks up. A prop is dragged like a treatment
 * but obeys different rules on release: it either seats in the one place it
 * belongs or it stays where it was dropped, and either way something about the
 * model changes rather than something about the drawing.
 */

let carrying = null;
let carryFrame = null;

function startProp(event) {
  const prop = event.target.closest?.("[data-prop]");
  if (!prop) return false;
  const at = boxFraction(event);
  if (!at) return false;
  carrying = {
    kind: prop.dataset.prop,
    pointerId: event.pointerId,
    moved: false,
    at,
    candidate: null,
    // A probe cannot be put on the treatment the other probe is already on:
    // there is no comparison of a treatment with itself.
    avoid:
      prop.dataset.prop === "probe-from"
        ? state.contrast?.treat2
        : prop.dataset.prop === "probe-to"
          ? state.contrast?.treat1
          : null,
  };
  hideTip();
  document.querySelector("#stage").classList.add("carrying");
  return true;
}

function moveProp(event) {
  if (!carrying || event.pointerId !== carrying.pointerId) return;
  const at = boxFraction(event);
  if (!at) return;
  carrying.moved = true;

  if (carrying.kind === "plug") {
    state.plug = clampPin(at);
  } else {
    carrying.at = at;
    // A probe commits nothing while it travels. It names the treatment it
    // would land on, and only a release decides. Refitting every lens each
    // time the pointer crossed a node would make the whole screen flicker
    // through questions nobody asked.
    carrying.candidate = nearestTreatment(at, carrying.kind === "dropper" ? null : carrying.avoid);
  }

  if (carryFrame) return;
  carryFrame = requestAnimationFrame(() => {
    carryFrame = null;
    renderStage();
  });
}

function endProp(event) {
  if (!carrying || (event && event.pointerId !== carrying.pointerId)) return;
  const { kind, moved, candidate, at: carriedAt } = carrying;
  carrying = null;
  document.querySelector("#stage").classList.remove("carrying");

  if (kind === "plug") {
    // Dropped close enough to its socket, a plug goes in. This is the only
    // place on the canvas with a magnet, and it needs one: hunting for a
    // pixel-exact seat is not a thing anyone enjoys twice.
    if (moved && state.plug && nearSocket(state.plug)) state.plug = null;
    return update({});
  }

  if (kind.startsWith("trial:")) {
    const label = kind.slice(6);
    if (!moved) return update({});
    // In the tray it comes out of the analysis; out of the tray it goes back
    // in. Nothing in between: a trial is either evidence or it is not.
    const inside = overTray(carriedAt);
    const already = state.excluded.includes(label);
    if (inside && !already) return setExcluded([...state.excluded, label]);
    if (!inside && already) return setExcluded(state.excluded.filter((s) => s !== label));
    return update({});
  }

  // A probe or a capsule released over nothing goes back where it was. There
  // is no such thing as measuring across empty space.
  if (!moved || !candidate) return update({});

  if (kind === "probe-from" && state.contrast)
    return update({ contrast: { ...state.contrast, treat1: candidate } });
  if (kind === "probe-to" && state.contrast)
    return update({ contrast: { ...state.contrast, treat2: candidate } });
  if (kind === "dropper")
    // The walk starts where the capsule lands, and starts over: the variance
    // series it drives is the series for that origin and no other.
    return update({ options: { ...state.options, origin: candidate, walk: undefined } });

  update({});
}

/* The treatment nearest a point, if one is near enough to have been meant.
 *
 * On a dense network the invisible hit areas overlap, so which node the reader
 * intended cannot be read off a hit test. The nearest centre within a generous
 * radius is the honest answer, and the drawing says out loud which one that is
 * before anything is committed.
 */
function nearestTreatment(fraction, avoid) {
  const model = activeModel();
  if (!model || !lastBox || !lastPoints) return null;
  const x = lastBox.left + fraction.u * (lastBox.right - lastBox.left);
  const y = lastBox.top + fraction.v * (lastBox.bottom - lastBox.top);
  let best = null;
  let bestDistance = 64;
  lastPoints.forEach((point, i) => {
    const name = model.treatments[i];
    if (name === avoid) return;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  });
  return best;
}

/* Whether a dropped trial landed in the tray, read off the drawing so the
 * target and the thing being aimed at can never drift apart. */
function overTray(fraction) {
  const tray = document.querySelector("#stage .tray-body");
  const box = lastBox;
  if (!tray || !box || !fraction) return false;
  const x = box.left + fraction.u * (box.right - box.left);
  const y = box.top + fraction.v * (box.bottom - box.top);
  const bounds = tray.getBBox?.();
  if (!bounds) return false;
  return (
    x >= bounds.x - 10 &&
    x <= bounds.x + bounds.width + 10 &&
    y >= bounds.y - 10 &&
    y <= bounds.y + bounds.height + 10
  );
}

/* Whether a hanging plug is over its socket, in box fractions. */
function nearSocket(plug) {
  const seat = socketFraction();
  if (!seat) return false;
  const box = lastBox;
  const dx = (plug.u - seat.u) * (box.right - box.left);
  const dy = (plug.v - seat.v) * (box.bottom - box.top);
  return Math.hypot(dx, dy) < 42;
}

/* Where the socket sits, read off the drawing rather than recomputed, so the
 * magnet cannot drift away from the thing it is snapping to. */
function socketFraction() {
  const socket = document.querySelector("#stage .socket");
  const box = lastBox;
  if (!socket || !box) return null;
  const bounds = socket.getBBox?.();
  if (!bounds) return null;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  return {
    u: (x - box.left) / Math.max(1, box.right - box.left),
    v: (y - box.top) / Math.max(1, box.bottom - box.top),
  };
}

/* ---- The springs rig -------------------------------------------------------
 *
 * The one piece of this interface that has state of its own rather than being a
 * function of the data. It is deliberately not in the shared state object: it
 * changes sixty times a second while a spring is swinging, and the rest of the
 * screen has no business being told about that.
 */

let rig = null;
let rigKey = null;
let rigFrame = null;
let rigLast = 0;

/* The springs of the parallel bundle for the comparison being looked at: the
 * studies that compared these two treatments directly, each with its own effect
 * as a natural length and its own precision as a stiffness.
 *
 * Under random effects each study spring gains a second spring in series, of
 * natural length zero and stiffness 1/tau², which is Papakonstantinou et al's
 * heterogeneity spring. Springs in series add their compliances, so the pair
 * behaves as one spring of stiffness 1/(se² + tau²), and the assembly then
 * rests at the random-effects pooled estimate rather than the common-effect
 * one. Without it the toy would settle in a place the panel beside it does not
 * report, which would be a lie told with a nice animation.
 */
function rigFor(model, contrast) {
  if (!contrast) return null;
  const edge = model.direct.find(
    (e) =>
      (e.treat1 === contrast.treat1 && e.treat2 === contrast.treat2) ||
      (e.treat1 === contrast.treat2 && e.treat2 === contrast.treat1)
  );
  // One study is not an assembly: there is nothing to balance against.
  if (!edge || edge.rows.length < 2) return null;
  const sign = edge.treat1 === contrast.treat1 ? 1 : -1;
  const tau2 = (model.tau ?? 0) ** 2;
  return makeRig(
    edge.rows.map((row) => ({
      k: 1 / (row.seTE ** 2 + tau2),
      y: sign * row.TE,
      label: row.studlab,
    }))
  );
}

function syncRig(model) {
  const wanted =
    state.lens === "springs" && state.contrast
      ? `${state.dataset?.id}\u0000${state.model}\u0000${state.contrast.treat1}\u0000${state.contrast.treat2}`
      : null;
  if (wanted === rigKey) return;
  rigKey = wanted;
  rig = wanted ? rigFor(model, state.contrast) : null;
  stopRig();
}

function stopRig() {
  if (rigFrame) cancelAnimationFrame(rigFrame);
  rigFrame = null;
}

function runRig() {
  if (rigFrame || !rig) return;
  rigLast = performance.now();
  const step = (now) => {
    rigFrame = null;
    if (!rig) return;
    const moving = stepRig(rig, (now - rigLast) / 1000);
    rigLast = now;
    renderStage();
    if (moving || rig.held) rigFrame = requestAnimationFrame(step);
    else renderControls();
  };
  rigFrame = requestAnimationFrame(step);
}

/* Pulling the bundle. The springs lens draws on its own effect axis, so it
 * publishes the two numbers needed to read a pointer position back as a value.
 */
let pulling = null;

function valueAtPointer(event) {
  const group = document.querySelector(".springs[data-middle]");
  const stage = document.querySelector("#stage");
  if (!group || !stage) return null;
  const middle = Number(group.dataset.middle);
  const scale = Number(group.dataset.scale);
  if (!Number.isFinite(middle) || !Number.isFinite(scale) || scale === 0) return null;
  const rect = stage.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * stage.clientWidth;
  return (x - middle) / scale;
}

function startPull(event) {
  if (!rig) return false;
  if (!event.target.closest?.("[data-bob]")) return false;
  const value = valueAtPointer(event);
  if (value == null) return false;
  pulling = event.pointerId;
  document.querySelector("#stage").classList.add("pulling");
  rig.held = true;
  rig.running = false;
  rig.v = 0;
  rig.x = value;
  hideTip();
  renderStage();
  return true;
}

let pullFrame = null;

function movePull(event) {
  if (pulling == null || event.pointerId !== pulling || !rig) return;
  const value = valueAtPointer(event);
  if (value == null) return;
  rig.x = value;
  if (pullFrame) return;
  pullFrame = requestAnimationFrame(() => {
    pullFrame = null;
    renderStage();
    renderControls();
  });
}

function endPull(event) {
  if (pulling == null || (event && event.pointerId !== pulling)) return;
  pulling = null;
  document.querySelector("#stage").classList.remove("pulling");
  if (!rig) return;
  rig.held = false;
  rig.running = true;
  runRig();
}

/* ---- The hover card --------------------------------------------------------
 *
 * One card, moved and refilled rather than created and destroyed, so a pointer
 * travelling across a dense network does not build and throw away a hundred
 * elements. It is placed beside the pointer and never under it, and it flips to
 * the other side rather than running off the window.
 */

let tipTarget = null;

function hideTip() {
  const tip = document.querySelector("#tip");
  if (!tip || tip.hidden) return;
  tip.hidden = true;
  tipTarget = null;
}

function targetOf(element) {
  const treatment = element.closest("[data-treatment]");
  if (treatment) return { kind: "treatment", id: treatment.dataset.treatment };
  const study = element.closest("[data-study]");
  if (study) return { kind: "study", id: study.dataset.study };
  const edge = element.closest("[data-edge]");
  if (edge) return { kind: "edge", id: edge.dataset.edge };
  return null;
}

function placeTip(event) {
  const tip = document.querySelector("#tip");
  const gap = 16;
  const { offsetWidth: width, offsetHeight: height } = tip;
  // Below and to the right of the pointer, unless that would leave the window.
  let x = event.clientX + gap;
  let y = event.clientY + gap;
  if (x + width > window.innerWidth - 8) x = event.clientX - gap - width;
  if (y + height > window.innerHeight - 8) y = event.clientY - gap - height;
  tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

function showTip(event) {
  if (dragging) return hideTip();
  const model = activeModel();
  const target = event.target instanceof Element ? targetOf(event.target) : null;
  if (!target || !model) return hideTip();

  const tip = document.querySelector("#tip");
  const key = `${target.kind}\u0000${target.id}`;
  if (key !== tipTarget) {
    const lens = LENSES.find((l) => l.id === state.lens);
    const card = describe(lastContext ?? { model, state, measure: state.dataset?.measure ?? "MD" }, target, lens);
    if (!card) return hideTip();
    tip.innerHTML = tipMarkup(card);
    tipTarget = key;
    tip.hidden = false;
  }
  placeTip(event);
}

/* ---- Dragging a treatment -------------------------------------------------
 *
 * The arrangement is a claim, not a picture, so a treatment moved by hand does
 * not silently become the new truth: it is recorded as a pin, the stress under
 * the title is recomputed on the drawing that results, and one button puts
 * everything back where the model wanted it.
 *
 * Only the node under the pointer moves. Relaxing the rest of the network
 * around a dragged treatment would be more faithful to the geometry and much
 * worse to use, because the drawing would keep sliding out from under the hand
 * that is arranging it.
 */

let dragging = null;
let dragFrame = null;
/* True while a deck control is under a pressed pointer. */
let deckHeld = false;

/* Where a pointer is, as a fraction of the clear rectangle. */
function boxFraction(event) {
  const stage = document.querySelector("#stage");
  const rect = stage.getBoundingClientRect();
  const box = lastBox;
  if (!box) return null;
  const x = ((event.clientX - rect.left) / rect.width) * stage.clientWidth;
  const y = ((event.clientY - rect.top) / rect.height) * stage.clientHeight;
  return {
    u: (x - box.left) / Math.max(1, box.right - box.left),
    v: (y - box.top) / Math.max(1, box.bottom - box.top),
  };
}

const clampPin = (pin) => ({
  // A treatment can be pushed a little past the clear rectangle but not off the
  // canvas, where it could not be picked up again.
  u: Math.min(1.06, Math.max(-0.06, pin.u)),
  v: Math.min(1.06, Math.max(-0.06, pin.v)),
});

function draggableLens() {
  return Boolean(LENSES.find((l) => l.id === state.lens)?.spatial);
}

/* Redraw at most once a frame while a treatment is being carried. */
function scheduleDragRender() {
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = null;
    renderStage();
    renderControls();
  });
}

function startDrag(event) {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  if (!draggableLens()) return;
  const node = event.target.closest("[data-treatment]");
  if (!node) return;
  const at = boxFraction(event);
  if (!at) return;

  const treatment = node.dataset.treatment;
  const model = activeModel();
  const index = model?.index.get(treatment);
  if (index == null) return;

  // Where the treatment is now, so the drag carries it from where it was
  // grabbed rather than jumping its center to the pointer.
  const current = state.pins[treatment] ?? currentFraction(index);
  dragging = {
    treatment,
    origin: current,
    grabbed: { u: at.u - current.u, v: at.v - current.v },
    moved: false,
    pointerId: event.pointerId,
  };
  // Capture keeps the drag alive when the pointer outruns the small circle. It
  // is not available for every pointer, so a refusal is not a failed drag.
  try {
    node.setPointerCapture?.(event.pointerId);
  } catch {
    /* carry on without capture */
  }
  document.querySelector("#stage").classList.add("dragging");
}

function moveDrag(event) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const at = boxFraction(event);
  if (!at) return;
  const pin = clampPin({ u: at.u - dragging.grabbed.u, v: at.v - dragging.grabbed.v });
  // A press that never travels is a click, and a click selects rather than
  // rearranges.
  if (!dragging.moved) {
    const { origin } = dragging;
    if (Math.hypot(pin.u - origin.u, pin.v - origin.v) < 0.004) return;
    dragging.moved = true;
  }
  state.pins = { ...state.pins, [dragging.treatment]: pin };
  scheduleDragRender();
}

function endDrag(event) {
  if (!dragging || (event && event.pointerId !== dragging.pointerId)) return;
  const moved = dragging.moved;
  dragging = null;
  document.querySelector("#stage").classList.remove("dragging");
  if (!moved) return;

  // A press that travelled is a rearrangement, so the click that ends it must
  // not also change the comparison of interest. The guard is armed for exactly
  // one click and drops itself shortly after either way, so a drag released
  // outside the window cannot leave it armed against some later click.
  const swallow = (click) => {
    click.stopPropagation();
    click.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
  update({});
}

function wire() {
  const app = document.querySelector("#app");

  app.addEventListener("click", (event) => {
    const lensButton = event.target.closest("[data-lens]");
    if (lensButton) return update({ lens: lensButton.dataset.lens, selection: null });

    const modelButton = event.target.closest("[data-model]");
    if (modelButton) return update({ model: modelButton.dataset.model });

    const layoutButton = event.target.closest("[data-layout]");
    if (layoutButton) return update({ layout: layoutButton.dataset.layout });

    const option = event.target.closest("[data-option]");
    if (option) {
      const options = { ...state.options };
      // A control can hand the lens back to its own clock by choosing "auto".
      if (option.dataset.value === "auto") delete options[option.dataset.option];
      else options[option.dataset.option] = option.dataset.value;
      return update({ options });
    }

    const example = event.target.closest("[data-example]");
    if (example) return loadExample(example.dataset.example);

    if (event.target.closest("[data-close]")) return update({ panel: null, error: null });
    if (event.target.closest("#data-button")) return update({ panel: "data" });
    if (event.target.closest("#about-button")) return update({ panel: "about" });
    if (event.target.closest("#theme-toggle")) return setTheme(THEMES[currentTheme()].next);

    if (event.target.closest("#swap") && state.contrast)
      return update({
        contrast: { treat1: state.contrast.treat2, treat2: state.contrast.treat1 },
      });

    // Clicking a node or an edge on the canvas selects it; clicking a pair of
    // nodes in turn sets the comparison of interest.
    const plugButton = event.target.closest("[data-plug]");
    if (plugButton) {
      if (plugButton.dataset.plug === "in") return update({ plug: null });
      // Pulled by click rather than by hand, it lands a little below its
      // socket, where it is plainly out and plainly still reachable.
      const seat = socketFraction();
      return update({ plug: clampPin({ u: (seat?.u ?? 0.5) - 0.05, v: (seat?.v ?? 0.5) + 0.16 }) });
    }

    if (event.target.closest("[data-restore]")) return setExcluded([]);

    if (event.target.closest("#reset-arrangement")) return update({ pins: {} });

    const play = event.target.closest("[data-play]");
    if (play && rig) {
      if (play.dataset.play === "pull") {
        // Far enough to swing visibly, in the data's own units.
        releaseFrom(rig, rig.equilibrium + rig.span * 0.9);
        runRig();
      } else {
        stopRig();
        rig.x = rig.equilibrium;
        rig.v = 0;
        rig.running = false;
        renderStage();
        renderControls();
      }
      return;
    }

    const node = event.target.closest("[data-treatment]");
    if (node) return chooseTreatment(node.dataset.treatment);

    const edge = event.target.closest("[data-edge]");
    if (edge) {
      const [treat1, treat2] = edge.dataset.edge.split(" ");
      return update({ contrast: { treat1, treat2 }, selection: { kind: "edge", id: edge.dataset.edge } });
    }

    if (event.target.id === "overlay") return update({ panel: null, error: null });
  });

  app.addEventListener("change", (event) => {
    if (event.target.id === "treat1" || event.target.id === "treat2") {
      const treat1 = document.querySelector("#treat1").value;
      const treat2 = document.querySelector("#treat2").value;
      if (treat1 !== treat2) update({ contrast: { treat1, treat2 } });
      else renderControls();
    }
    if (event.target.id === "file-input" && event.target.files[0])
      loadFile(event.target.files[0]);
    if (event.target.id === "measure-select") {
      const measure = event.target.value;
      update({
        dataset: {
          ...state.dataset,
          measure,
          outcome: MEASURES[measure].label,
        },
      });
    }
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "separation") {
      const value = Number(event.target.value);
      document.querySelector("#separation-value").textContent = `${Math.round(value * 100)}%`;
      update({ separation: value });
    }
  });

  const stage = document.querySelector("#stage");
  stage.addEventListener("pointermove", showTip);
  stage.addEventListener("pointerleave", hideTip);
  // A card that outlived what it described would be worse than none.
  stage.addEventListener("pointerdown", hideTip);
  addEventListener("blur", hideTip);
  // A press picks up whichever thing it landed on, in order of specificity: a
  // prop first, then the springs bundle, then the treatment underneath.
  stage.addEventListener("pointerdown", (event) => {
    if (startProp(event)) return;
    if (startPull(event)) return;
    startDrag(event);
  });
  stage.addEventListener("pointermove", (event) => {
    moveProp(event);
    movePull(event);
    moveDrag(event);
  });
  const release = (event) => {
    endProp(event);
    endPull(event);
    endDrag(event);
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  // A pointer released outside the canvas still ends the drag.
  window.addEventListener("pointerup", (event) => {
    endProp(event);
    endPull(event);
    endDrag(event);
  });

  const deck = document.querySelector("#console");
  deck.addEventListener("pointerdown", () => {
    deckHeld = true;
  });
  addEventListener("pointerup", () => {
    if (!deckHeld) return;
    // The click a release produces is dispatched after this handler, so the
    // deck stays frozen for one more turn of the loop. Thawing it here would
    // replace the button between the release and the click, and the click
    // would land on nothing.
    setTimeout(() => {
      deckHeld = false;
      renderStage();
    }, 0);
  });

  const drop = () => document.querySelector("#file-drop");
  app.addEventListener("dragover", (event) => {
    if (!drop()?.contains(event.target)) return;
    event.preventDefault();
    drop().classList.add("dragging");
  });
  app.addEventListener("dragleave", (event) => {
    if (drop()?.contains(event.target)) drop().classList.remove("dragging");
  });
  app.addEventListener("drop", (event) => {
    if (!drop()?.contains(event.target)) return;
    event.preventDefault();
    drop().classList.remove("dragging");
    if (event.dataTransfer.files[0]) loadFile(event.dataTransfer.files[0]);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return update({ panel: null, selection: null, error: null });
    if (nudgeSelected(event)) event.preventDefault();
  });

  addEventListener("resize", () => renderStage());
}

/* Arrow keys move the selected treatment, so the arrangement can be changed
 * without a pointer. The step is a share of the clear rectangle rather than a
 * count of pixels, so it means the same thing on any window. */
const ARROWS = {
  ArrowLeft: { u: -1, v: 0 },
  ArrowRight: { u: 1, v: 0 },
  ArrowUp: { u: 0, v: -1 },
  ArrowDown: { u: 0, v: 1 },
};

function nudgeSelected(event) {
  const step = ARROWS[event.key];
  if (!step || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (state.selection?.kind !== "treatment") return false;
  if (!draggableLens()) return false;
  // Not while the reader is in a menu, a slider or a text field.
  const active = document.activeElement;
  if (active && active !== document.body && active.closest("#controls, #overlay")) return false;

  const treatment = state.selection.id;
  const model = activeModel();
  const index = model?.index.get(treatment);
  if (index == null) return false;

  const size = event.shiftKey ? 0.05 : 0.01;
  const at = state.pins[treatment] ?? currentFraction(index);
  update({
    pins: {
      ...state.pins,
      [treatment]: clampPin({ u: at.u + step.u * size, v: at.v + step.v * size }),
    },
  });
  return true;
}

/* Clicking treatments in turn walks the comparison of interest along: the
 * previous second treatment becomes the first, so a reader can travel the
 * network by clicking rather than using the two menus. */
function chooseTreatment(treatment) {
  if (!state.contrast) return update({ selection: { kind: "treatment", id: treatment } });
  if (treatment === state.contrast.treat1 || treatment === state.contrast.treat2)
    return update({ selection: { kind: "treatment", id: treatment } });
  update({
    contrast: { treat1: state.contrast.treat2, treat2: treatment },
    selection: { kind: "treatment", id: treatment },
  });
}

export function start() {
  document.querySelector("#app").innerHTML = shell();
  setTheme(currentTheme());
  wire();
  subscribe(() => {
    renderControls();
    renderReadouts();
    renderOverlay();
    renderStage();
  });
  loadExample("senn2013");
}
