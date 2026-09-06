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
import { LENSES } from "./lenses/index.js";
import { nodeRadii } from "./lenses/draw.js";
import { activeModel, load, state, subscribe, update } from "./state.js";
import { ICONS, escape, number, percent, shortLabel } from "./ui.js";
import examples from "../data/examples.json";
import { readNetwork, MEASURES } from "../nma/parse.js";

const THEME_KEY = "nmaviz-theme";
const currentTheme = () =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  const button = document.querySelector("#theme-toggle");
  if (!button) return;
  button.innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
  button.title = theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme";
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
      <div class="panel readouts" id="readouts"></div>
      <div class="overlay" id="overlay" hidden></div>
    </div>
  `;
}

/* ---- Controls -------------------------------------------------------------- */

function renderControls() {
  const node = document.querySelector("#controls");
  const model = activeModel();
  if (!model) {
    node.innerHTML = "";
    return;
  }
  const options = (selected) =>
    model.treatments
      .map(
        (t) =>
          `<option value="${escape(t)}"${t === selected ? " selected" : ""}>${escape(t)}</option>`
      )
      .join("");

  const layoutPills = Object.entries(LAYOUTS)
    .map(
      ([id, l]) =>
        `<button type="button" data-layout="${id}" class="${
          state.layout === id ? "active" : ""
        }">${l.label}</button>`
    )
    .join("");

  node.innerHTML = `
    <div class="control-block">
      <label class="control-label" for="treat1">Comparison of interest</label>
      <div class="contrast-picker">
        <select id="treat1" aria-label="First treatment">${options(state.contrast?.treat1)}</select>
        <button id="swap" type="button" title="Reverse the direction">${ICONS.swap}</button>
        <select id="treat2" aria-label="Second treatment">${options(state.contrast?.treat2)}</select>
      </div>
    </div>

    <div class="control-row">
      <div class="control-block">
        <span class="control-label">Model</span>
        <div class="pills" id="model-pills">
          <button type="button" data-model="common" class="${
            state.model === "common" ? "active" : ""
          }">Common effect</button>
          <button type="button" data-model="random" class="${
            state.model === "random" ? "active" : ""
          }">Random effects</button>
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
        Separation <output id="separation-value">${Math.round(state.separation * 100)}%</output>
      </label>
      <input id="separation" type="range" min="0" max="1" step="0.01" value="${state.separation}" />
      <p class="control-hint">Fan every comparison out into the individual studies behind it.</p>
    </div>
  `;
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

function renderOverlay() {
  const node = document.querySelector("#overlay");
  if (!state.panel) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  node.hidden = false;
  node.innerHTML =
    state.panel === "data" ? dataPanel() : aboutPanel();
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
    // network keeps the top of the screen to itself.
    bottom: wide ? height - 118 : Math.max(200, height * 0.36),
  };
  const framed = framedPoints(model, box);
  // Separate any treatments whose circles would sit on top of each other, then
  // measure how much that cost, so the caption describes this drawing.
  const points = relieveOverlap(framed.points, nodeRadii(model));
  const meta =
    framed.meta.stress == null
      ? framed.meta
      : { ...framed.meta, stress: stressOf(points, model.resistance) };

  const lens = LENSES.find((l) => l.id === state.lens) ?? LENSES[0];
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
    measure: state.dataset?.measure ?? "MD",
    dataset: state.dataset,
  };

  setAnimation(Boolean(lens.animate));
  const drawn = lens.draw(context);
  stage.innerHTML = drawn.stage;
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
  inspector.innerHTML = drawn.inspector ?? "";
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
    if (option)
      return update({
        options: { ...state.options, [option.dataset.option]: option.dataset.value },
      });

    const example = event.target.closest("[data-example]");
    if (example) return loadExample(example.dataset.example);

    if (event.target.closest("[data-close]")) return update({ panel: null, error: null });
    if (event.target.closest("#data-button")) return update({ panel: "data" });
    if (event.target.closest("#about-button")) return update({ panel: "about" });
    if (event.target.closest("#theme-toggle"))
      return setTheme(currentTheme() === "dark" ? "light" : "dark");

    if (event.target.closest("#swap") && state.contrast)
      return update({
        contrast: { treat1: state.contrast.treat2, treat2: state.contrast.treat1 },
      });

    // Clicking a node or an edge on the canvas selects it; clicking a pair of
    // nodes in turn sets the comparison of interest.
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
    if (event.key === "Escape") update({ panel: null, selection: null, error: null });
  });

  addEventListener("resize", () => renderStage());
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
