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
import { nodeRadii, separable, setDrawScale } from "./lenses/draw.js";
import { activeModel, directEdge, load, setExcluded, state, subscribe, update } from "./state.js";
import { beep, setSound, soundIsOn } from "./sound.js";
import { ICONS, escape, number, percent, shortLabel } from "./ui.js";
import examples from "../data/examples.json";
import { readNetwork, MEASURES } from "../nma/parse.js";
import { hodgeCycleRows } from "../nma/hodge.js";
import { learningMarkup, answerPractice, nextPractice } from "./learning.js";

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
  // The lenses are the games on the cartridge, so they are numbered the way a
  // machine like this numbers them, and the number is printed on the button.
  const lensButtons = LENSES.map(
    (lens, index) => `
      <button class="game-key" type="button" data-lens="${lens.id}"
        aria-label="${escape(lens.name)}" title="${escape(lens.name)}. ${escape(lens.tagline)}">
        <span class="game-key-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="game-key-name">${escape(lens.name)}</span>
      </button>`
  ).join("");

  const functionKeys = [
    ["power", "ON/OFF", "Cut the power to the machine"],
    ["sound", "SOUND", "Blips on and off"],
    ["play", "S/P", "Start and pause whatever this game runs"],
    ["reset", "RESET", "Put everything back where it started"],
  ]
    .map(
      ([id, label, title]) => `
        <div class="function">
          <button type="button" class="key round" data-key="${id}" title="${escape(title)}"
            aria-label="${escape(label)}"></button>
          <span class="key-label">${label}</span>
        </div>`
    )
    .join("");

  const pad = ["up", "left", "right", "down"]
    .map(
      (way) =>
        `<button type="button" class="key pad ${way}" data-pad="${way}"
           aria-label="Move ${way}"></button>`
    )
    .join("");

  return `
    <div class="bench">
      <div class="handheld" id="handheld">
        <div class="plate">
          <span class="plate-mark">${ICONS.network}</span>
          <span class="plate-word">NMA<span class="brand-light">Viz</span></span>
        </div>

        <div class="screen-house">
          <span class="bolt left" aria-hidden="true"></span>
          <span class="bolt right" aria-hidden="true"></span>
          <div class="lcd">
            <div class="lcd-head">
              <span class="lcd-game" id="lens-title"></span>
              <span class="lcd-cart" id="dataset-name"></span>
            </div>
            <div class="lcd-body">
              <svg class="stage" id="stage" aria-label="Network diagram"></svg>
              <div class="readouts" id="readouts"></div>
            </div>
            <div class="lcd-status" id="status"></div>
            <div class="lcd-grid" aria-hidden="true"></div>
            <div class="lcd-sheen" aria-hidden="true"></div>
            <div class="vignette"></div>
          </div>
        </div>

        <div class="console" id="console" hidden></div>
        <div class="view-tools"><button type="button" id="diagram-size" aria-pressed="false">Enlarge diagram</button></div>

        <div class="band">CLASSICAL</div>

        <nav class="game-bar" id="lens-bar" aria-label="Game">${lensButtons}</nav>

        <div class="functions">${functionKeys}</div>

        <div class="pads">
          <div class="dpad">${pad}<span class="dpad-hub" aria-hidden="true"></span></div>
          <div class="action">
            <button type="button" class="key big" data-key="rotate" aria-label="Rotate the arrangement"></button>
            <span class="key-label">ROTATE</span>
          </div>
        </div>

        <div class="decal">
          <span class="decal-mouse" aria-hidden="true">${ICONS.network}</span>
          <span class="decal-name">LAB MOUSE</span>
          <span class="decal-title">NETWORK GAME</span>
          <span class="decal-count">${LENSES.length}&#8202;IN&#8202;1</span>
        </div>
      </div>

      <div class="manual" id="manual">
        <header class="manual-head">
          <span class="manual-kicker">Instructions</span>
          <div class="manual-tabs">
            <button id="data-button" class="tab" type="button" title="Choose or upload data">
              ${ICONS.data}<span>Data</span>
            </button>
            <button id="about-button" class="tab" type="button" title="About this site">
              ${ICONS.info}<span>About</span>
            </button>
            <button id="theme-toggle" class="tab square" type="button"></button>
          </div>
        </header>
        <p class="manual-note" id="lens-note"></p>
        <div id="learning"></div>
        <aside class="controls" id="controls"></aside>
        <aside class="inspector" id="inspector"></aside>
      </div>

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
      <p class="control-hint" id="separation-hint"></p>
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

/* Whether fanning a comparison into its studies says anything on this lens.
 *
 * It says something wherever what the lens draws on a comparison is a sum over
 * the studies on it: precision, a share of the current, a share of the credit,
 * the crossings of a walker. Where it is not a sum over studies, the control
 * stays where it is and is disabled with the reason, because a control that
 * disappears between lenses reads as a fault rather than as an answer.
 */
function separationOf(model) {
  const lens = LENSES.find((entry) => entry.id === state.lens);
  if (lens?.separates !== true)
    return {
      live: false,
      hint:
        typeof lens?.separates === "string"
          ? lens.separates
          : "Nothing here is drawn one study at a time.",
    };
  if (model && !separable(model))
    return {
      live: false,
      hint: `${model.direct.length} comparisons is too many to fan apart without the strands of one running through the next.`,
    };
  return { live: true, hint: "Fan every comparison out into the individual studies behind it." };
}

function renderControls() {
  const node = document.querySelector("#controls");
  node.hidden = state.lens === "population";
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

  // Which lens is showing is not part of the key the controls are rebuilt on,
  // deliberately: rebuilding the panel under the pointer is what broke this
  // slider once already. So the state of the control follows the lens the same
  // way its value does, by being set rather than by being redrawn.
  const fan = separationOf(model);
  if (separation) separation.disabled = !fan.live;
  const block = separation?.closest(".control-block");
  if (block) block.classList.toggle("inert", !fan.live);
  const fanHint = node.querySelector("#separation-hint");
  if (fanHint) fanHint.textContent = fan.hint;

  const dragHint = node.querySelector("#drag-hint");
  if (dragHint)
    dragHint.textContent = draggableLens()
      ? "Drag a treatment to move it, or use the pad on the machine."
      : "Nothing here is dragged. Left and right on the pad change the comparison, up and down change the game.";

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

/* The score column.
 *
 * The counters down the side of the glass. A count gets digits over the ghost
 * of the unlit segments behind them, which is what a panel like this looks
 * like; a proportion gets a bar of cells, because a bar is what a proportion
 * is and no number of digits makes 81% easier to compare at a glance.
 */
const cells = (share, count = 10) =>
  `<div class="lcd-bar">${Array.from(
    { length: count },
    (_, i) => `<i class="${i < Math.round(share * count) ? "lit" : ""}"></i>`
  ).join("")}</div>`;

function renderReadouts() {
  const node = document.querySelector("#readouts");
  node.hidden = state.lens === "population";
  const fit = state.fit;
  if (!fit) {
    node.innerHTML = "";
    return;
  }
  const digits = (value, ghost) =>
    `<dd data-ghost="${ghost}">${escape(String(value))}</dd>`;

  const items = [
    ["Treat", digits(fit.treatments.length, "88")],
    ["Comp", digits(fit.edges.length, "88")],
    ["Studies", digits(fit.studies.length, "88")],
    // Q means nothing without the degrees of freedom it is being judged
    // against, so they share a reading rather than a row each.
    ["Q on df", digits(`${number(fit.Q, 1)}/${number(fit.df, 0)}`, "888.8/88")],
    ["τ", digits(number(fit.tau, 3), "8.888")],
    ["I²", cells(Math.max(0, Math.min(1, fit.I2)))],
  ];
  node.innerHTML = items.map(([label, value]) => `<div><dt>${label}</dt>${value}</div>`).join("");
}

/* ---- Overlays: the data chooser and the about panel ------------------------ */

/* The open panel is rebuilt only when what it says changes, for the same reason
 * the controls are: an update that arrives while the reader is part way down a
 * long panel should not throw away their scroll position or the control they
 * are holding. */
let overlayKey = null;
let overlayReturnFocus = null;

function renderOverlay() {
  const node = document.querySelector("#overlay");
  if (!state.panel) {
    const wasOpen = !node.hidden;
    node.hidden = true;
    node.innerHTML = "";
    overlayKey = null;
    document.querySelector("#handheld").inert = false;
    document.querySelector("#manual").inert = false;
    if (wasOpen && overlayReturnFocus?.isConnected) overlayReturnFocus.focus();
    overlayReturnFocus = null;
    return;
  }
  const key = [state.panel, state.dataset?.id, state.dataset?.measure, state.error].join("\u0000");
  if (key === overlayKey) return;
  if (node.hidden) overlayReturnFocus = document.activeElement;
  overlayKey = key;
  node.hidden = false;
  node.innerHTML = state.panel === "data" ? dataPanel() : aboutPanel();
  node.querySelector('[role="dialog"]').setAttribute("aria-modal", "true");
  node.querySelector("[data-close]").setAttribute("aria-label", "Close dialog");
  document.querySelector("#handheld").inert = true;
  document.querySelector("#manual").inert = true;
  node.querySelector("[data-close]").focus();
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
            NMAViz fits a graph-theoretical network meta-analysis and explores its evidence through
            linked visual methods. The separate Population laboratory fits editable individual and
            aggregate data for population adjustment. Calculations and data stay in your browser.
          </p>
          <p class="sheet-note">
            Regression checks compare the graph engine with netmeta on six published networks,
            including multi-arm designs. Additional checks cover published path-weight results,
            canonical projection, bipartite flow, and analytic population-model examples.
            The README describes the tolerances and supported model assumptions.
          </p>
        </section>
        <section>
          <h3>The lenses</h3>
          <ul class="lens-list">${lensList}</ul>
        </section>
        <section>
          <h3>What this is not</h3>
          <p class="sheet-note">
            Descriptive Hodge rankings and small population-model posterior experiments are learning
            tools. They do not assess risk of bias, establish transitivity or provide a clinically
            meaningful treatment ranking. Check model assumptions, integration error and inference
            diagnostics; zero inconsistency does not establish validity.
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

function replaceMarkup(container, markup) {
  const active = document.activeElement;
  const inside = active && container.contains(active);
  const values = inside && active.matches("input, textarea") ? active.value : null;
  const data = inside ? Object.entries(active.dataset) : [];
  container.innerHTML = markup;
  if (!inside) return;
  const replacement = [...container.querySelectorAll("button, input, select, textarea, summary, a[href]")]
    .find((el) => el.tagName === active.tagName && (active.id ? el.id === active.id
      : data.length ? data.every(([key, value]) => el.dataset[key] === value)
        : el.textContent === active.textContent));
  if (replacement) {
    if (values !== null) replacement.value = values;
    replacement.focus({ preventScroll: true });
  }
}

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

  // The mains switch. A panel with no power behind it shows nothing but the
  // words etched into the glass, which is exactly what these do.
  document.querySelector(".lcd")?.classList.toggle("dark", state.power === false);
  document.querySelector(".bench")?.classList.toggle("paused", Boolean(state.paused));
  document.querySelector(".handheld")?.classList.toggle("population-mode", state.lens === "population");
  if (!model) {
    stage.innerHTML = "";
    inspector.innerHTML = "";
    return;
  }

  const width = stage.clientWidth || 1200;
  const height = stage.clientHeight || 800;
  stage.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // The panels no longer float over the network: the settings and the tables
  // are on the sheet beside the machine, and the counters are a column of the
  // screen rather than a card on top of it. So the clear rectangle is the glass
  // itself, less the room a treatment's label needs under its circle and the
  // room the source branch needs to bow into.
  // The floor is the biggest circle a treatment is drawn as, plus the ring a
  // lens may put around it: at 16 the leftmost node had its outline shaved off
  // by the edge of the glass on a phone.
  const margin = Math.max(24, Math.min(34, width * 0.05));
  // A game that draws something standing above a treatment, such as the pipette
  // the walk is released from, needs the room for it inside the glass.
  const headroom = LENSES.find((entry) => entry.id === state.lens)?.headroom ?? 0;
  const box = {
    left: margin,
    right: width - margin,
    top: margin + headroom,
    bottom: height - margin - 12,
  };
  // How big a treatment is drawn follows how much room the drawing has.
  setDrawScale(box);
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
    const openSections = [...inspector.querySelectorAll("details[open]")].map((el) => el.querySelector("summary")?.textContent);
    inspector.dataset.markup = reading;
    replaceMarkup(inspector, reading);
    inspector.querySelectorAll("details").forEach((el) => {
      if (openSections.includes(el.querySelector("summary")?.textContent)) el.open = true;
    });
  }
  const learning = document.querySelector("#learning");
  const lesson = learningMarkup(lens.id);
  if (learning.dataset.markup !== lesson) {
    learning.dataset.markup = lesson;
    replaceMarkup(learning, lesson);
  }

  // The controls a lens offers for working its mechanism, rather than for
  // choosing what to look at. They sit on the deck under the canvas because
  // that is where the hands go.
  const deck = document.querySelector("#console");
  let controls = drawn.controls ?? "";
  if (state.lens === "springs" && state.wager && !state.wager.settled) {
    controls += `<label class="wager-field" for="wager-value">Your predicted effect (analysis scale)
      <input id="wager-value" type="number" step="any" value="${escape(state.wager.guess)}" /></label>`;
  }
  if (state.lens === "springs" && !rig && model.direct.some((edge) => edge.rows.length > 1)) {
    controls += '<button type="button" data-spring-example>Try a comparison with multiple studies</button>';
  }
  // A swinging assembly or a running walk redraws many times a second, and the
  // deck's readings change every frame. Replacing its markup while a button is
  // held would take that button out from under the pointer, so the press would
  // land on one element and the release on its replacement, and no click would
  // ever arrive. The rebuild waits until the hand is off.
  if (deck.dataset.markup !== controls && !deckHeld) {
    deck.dataset.markup = controls;
    replaceMarkup(deck, controls);
  }
  deck.hidden = !controls;
  const game = LENSES.findIndex((entry) => entry.id === lens.id) + 1;
  document.querySelector("#lens-title").textContent = `Game ${String(game).padStart(2, "0")} ${
    lens.name
  }`;
  document.querySelector("#lens-note").textContent = drawn.note ?? lens.tagline;
  document.querySelector("#dataset-name").textContent = state.lens === "population"
    ? "Separate population experiment" : state.dataset?.name ?? "";

  document
    .querySelectorAll(".game-key")
    .forEach((b) => b.classList.toggle("active", b.dataset.lens === state.lens));
  renderStatus();
}

/* ---- The status words ------------------------------------------------------ */

/* The words printed into the panel, lit when they hold.
 *
 * A real one of these has GAME OVER and SPEED LEVEL etched into the glass,
 * visible faintly whether or not they apply. That is worth copying exactly,
 * because the unlit words tell a reader the whole vocabulary of states the
 * machine has. Every word here is a condition of the fit or of the machine, and
 * none of them is decoration.
 */
function statusWords() {
  if (state.lens === "population") return [["Power", state.power !== false], ["Sound", soundIsOn()], ["Local data", true]];
  const fit = state.fit;
  const edge = state.contrast
    ? directEdge(state.contrast.treat1, state.contrast.treat2)
    : null;
  return [
    ["Power", state.power !== false],
    ["Sound", soundIsOn()],
    ["Random", state.model === "random"],
    // Whether anything is actually driven around the network right now.
    ["Open circuit", state.openCircuit],
    // No study compared these two directly, so everything shown is indirect.
    ["Indirect only", Boolean(state.contrast) && !edge],
    ["Heterogeneous", Boolean(fit) && fit.I2 > 0.5],
    ["Moved", Object.keys(state.pins).length > 0],
    ["Trial out", state.excluded.length > 0],
  ];
}

function renderStatus() {
  const node = document.querySelector("#status");
  if (!node) return;
  const markup = statusWords()
    .map(([word, lit]) => `<span class="${lit ? "lit" : ""}">${escape(word)}</span>`)
    .join("");
  if (node.dataset.markup === markup) return;
  node.dataset.markup = markup;
  node.innerHTML = markup;
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

  carrying.at = at;
  // A probe commits nothing while it travels. It names the treatment it would
  // land on, and only a release decides. Refitting every lens each time the
  // pointer crossed a node would make the whole screen flicker through
  // questions nobody asked.
  carrying.candidate = nearestTreatment(at, carrying.kind === "dropper" ? null : carrying.avoid);

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
 * intended cannot be read off a hit test. The nearest center within a generous
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

let movingStop = null;

function startStop(event) {
  if (!state.wager || state.wager.settled) return false;
  if (!event.target.closest?.('[data-prop="wager"]')) return false;
  const value = valueAtPointer(event);
  if (value == null) return false;
  movingStop = event.pointerId;
  state.wager = { ...state.wager, guess: value };
  hideTip();
  renderStage();
  return true;
}

function moveStop(event) {
  if (movingStop == null || event.pointerId !== movingStop) return;
  const value = valueAtPointer(event);
  if (value == null) return;
  state.wager = { ...state.wager, guess: value };
  if (pullFrame) return;
  pullFrame = requestAnimationFrame(() => {
    pullFrame = null;
    renderStage();
    renderControls();
  });
}

function endStop(event) {
  if (movingStop == null || (event && event.pointerId !== movingStop)) return;
  movingStop = null;
  update({});
}

function startPull(event) {
  if (!rig) return false;
  if (state.wager && !state.wager.settled) return false;
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

/* ---- The keys -------------------------------------------------------------- */

/* Every key on the shell moves something the model has.
 *
 * The rule the props on the canvas follow applies here too: a control that
 * looks physical and changes nothing is worse than no control, so ON/OFF really
 * cuts the power, S/P really starts and stops whatever this game runs, RESET
 * really puts back everything a reader can move, and the pad and the big button
 * really move and rearrange the network.
 */
function pressKey(id) {
  if (id === "power") {
    const on = state.power === false;
    beep(on ? "power" : "off");
    if (!on) stopRig();
    return update({ power: on });
  }
  // With the power off the only key that answers is the one that turns it on.
  if (state.power === false) return beep("deny");

  beep("press");
  if (id === "sound") {
    setSound(!soundIsOn());
    return update({});
  }
  if (id === "rotate") {
    const ids = Object.keys(LAYOUTS);
    return update({ layout: ids[(ids.indexOf(state.layout) + 1) % ids.length] });
  }
  if (id === "reset") {
    // Everything a reader can knock out of place, and nothing they chose on
    // purpose: the game, the data, the comparison and the model all stay.
    update({ pins: {}, openCircuit: false, wager: null, separation: 0, paused: false });
    if (state.excluded.length) setExcluded([]);
    return;
  }
  if (id === "play") return pressPlay();
}

/* Start and pause, meaning whatever this game actually runs. */
function pressPlay() {
  if (state.lens === "springs") {
    if (!rig) return beep("deny");
    if (state.wager && !state.wager.settled) return beep("deny");
    if (rig.running) {
      stopRig();
      rig.running = false;
      rig.v = 0;
      renderStage();
      return renderControls();
    }
    releaseFrom(rig, rig.equilibrium + rig.span * 0.9);
    return runRig();
  }
  if (state.lens === "diffusion") {
    // The walk is either running on its own clock or being held at a step.
    const options = { ...state.options };
    if (options.walk == null) options.walk = String(diffusionStep());
    else delete options.walk;
    return update({ options });
  }
  // Everywhere else what runs is the current sliding along the wires.
  return update({ paused: !state.paused });
}

/* Which step the diffusion animation is showing right now.
 *
 * Pausing has to hold the picture the reader is looking at, so the step comes
 * from the same frame counter the lens draws from rather than from a second
 * clock that happens to run at a similar rate.
 */
function diffusionStep() {
  const held = state.options.walk;
  if (held != null) return Number(held);
  return frameCount;
}

/* The pad moves the selected treatment, and when nothing is selected it picks
 * one: on a machine with four directions and no pointer, the first press has to
 * do something. */
const PAD_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

function pressPad(way) {
  if (state.power === false) return beep("deny");
  beep("press");
  const model = activeModel();
  if (!model) return;

  if (state.selection?.kind !== "treatment" && draggableLens()) {
    const start = state.contrast?.treat1 ?? model.treatments[0];
    return update({ selection: { kind: "treatment", id: start } });
  }

  // Two of the games draw no network to move a treatment around in. There the
  // pad moves through the lists instead: up and down change the game, left and
  // right walk the comparison being asked about along the treatments, which is
  // the one thing that changes what those two games show. Four directions and
  // none of them dead.
  if (!draggableLens()) {
    if (way === "up" || way === "down") {
      const at = LENSES.findIndex((entry) => entry.id === state.lens);
      const next = LENSES[(at + (way === "down" ? 1 : LENSES.length - 1)) % LENSES.length];
      return update({ lens: next.id, selection: null });
    }
    const order = model.treatments.filter((t) => t !== state.contrast?.treat1);
    if (!order.length) return;
    const at = order.indexOf(state.contrast?.treat2);
    const step = way === "right" ? 1 : order.length - 1;
    const next = order[(Math.max(0, at) + step) % order.length];
    return update({
      contrast: { treat1: state.contrast.treat1, treat2: next },
      selection: { kind: "treatment", id: next },
    });
  }

  nudgeSelected({ key: PAD_KEYS[way], shiftKey: false });
  renderStage();
}

function wire() {
  const app = document.querySelector("#app");

  app.addEventListener("submit", (event) => {
    if (event.target.id !== "practice-form") return;
    event.preventDefault();
    answerPractice(state.lens, new FormData(event.target).get("prediction"));
    update({});
  });

  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-spring-example]")) {
      const edge = activeModel()?.direct.find((item) => item.rows.length > 1);
      if (edge) update({ contrast: { treat1: edge.treat1, treat2: edge.treat2 }, wager: null });
      return;
    }
    const key = event.target.closest("[data-key]");
    if (key) return pressKey(key.dataset.key);
    const pad = event.target.closest("[data-pad]");
    if (pad) return pressPad(pad.dataset.pad);
  });

  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-practice]")) {
      nextPractice(state.lens);
      return update({});
    }
    if (event.target.closest("#diagram-size")) {
      const enlarged = document.querySelector(".lcd-body").classList.toggle("enlarged");
      const button = document.querySelector("#diagram-size");
      button.setAttribute("aria-pressed", String(enlarged));
      button.textContent = enlarged ? "Fit diagram" : "Enlarge diagram";
      renderStage();
      return;
    }
    const exclude = event.target.closest("[data-exclude-study]");
    if (exclude) {
      const label = exclude.dataset.excludeStudy;
      return setExcluded(state.excluded.includes(label)
        ? state.excluded.filter((study) => study !== label) : [...state.excluded, label]);
    }
    const cycle = event.target.closest("[data-hodge-example]");
    if (cycle) {
      const chord = cycle.dataset.hodgeExample === "chord";
      cachedLayout = { key: null };
      shownKey = null;
      shownPoints = null;
      tween = null;
      load({ id: `hodge-${chord}`, name: chord ? "Four-cycle with a chord" : "Chordless four-cycle",
        measure: "MD", outcome: "Teaching example", source: "Constructed Hodge cycle", unit: "effect units" }, hodgeCycleRows(chord));
      return;
    }
    const populationAction = event.target.closest("[data-population-action]");
    if (populationAction) {
      const lens = LENSES.find((item) => item.id === "population");
      if (lens?.handleAction?.(populationAction.dataset.populationAction, app, state, () => update({}))) update({});
      return;
    }
    // The rocker on the source lead and the deck button beside it are the same
    // control, so they carry the same attribute and the state they would leave
    // the circuit in. It is read before the lens buttons because the stage
    // itself carries the lens it is drawing, so anything clicked on the canvas
    // would otherwise be answered as a request for the game already running.
    const switchTarget = event.target.closest("[data-switch]");
    if (switchTarget) return update({ openCircuit: switchTarget.dataset.switch === "off" });

    const lensButton = event.target.closest("[data-lens]");
    if (lensButton) return update({ lens: lensButton.dataset.lens, selection: null });

    const modelButton = event.target.closest("[data-model]");
    if (modelButton) return update({ model: modelButton.dataset.model });

    const layoutButton = event.target.closest("[data-layout]");
    if (layoutButton) return update({ layout: layoutButton.dataset.layout });

    const option = event.target.closest("[data-option]");
    if (option) {
      const options = { ...state.options };
      if (["populationMethod", "populationFamily", "populationModifiers", "populationBinaryApproximation", "populationTarget", "populationData"].includes(option.dataset.option)) {
        delete options.populationPrediction;
      }
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

    if (event.target.closest("[data-restore]")) return setExcluded([]);

    if (event.target.closest("#reset-arrangement")) return update({ pins: {} });

    const wagerButton = event.target.closest("[data-wager]");
    if (wagerButton && rig && state.contrast) {
      const key = `${state.contrast.treat1}\u0000${state.contrast.treat2}`;
      if (wagerButton.dataset.wager === "open") {
        stopRig();
        rig.running = false;
        rig.v = 0;
        // The guess starts where the reader would have to move it from, well
        // clear of the answer, so that leaving it untouched is not a guess.
        return update({
          wager: {
            contrast: key,
            model: state.model,
            guess: rig.equilibrium + rig.span * 0.8,
            settled: false,
          },
        });
      }
      if (wagerButton.dataset.wager === "clear") return update({ wager: null });
      // Letting go tests the guess: the assembly is pulled to it and released,
      // and where it stops is the answer.
      releaseFrom(rig, state.wager.guess);
      runRig();
      return update({ wager: { ...state.wager, settled: true } });
    }

    const play = event.target.closest("[data-play]");
    if (play && rig) {
      if (state.wager && !state.wager.settled) return;
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
    if (event.target.id === "wager-value" && state.wager && !state.wager.settled) {
      const guess = Number(event.target.value);
      if (event.target.value.trim() && Number.isFinite(guess)) update({ wager: { ...state.wager, guess } });
      return;
    }
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
    if (startStop(event)) return;
    if (startProp(event)) return;
    if (startPull(event)) return;
    startDrag(event);
  });
  stage.addEventListener("pointermove", (event) => {
    moveStop(event);
    moveProp(event);
    movePull(event);
    moveDrag(event);
  });
  const release = (event) => {
    endStop(event);
    endProp(event);
    endPull(event);
    endDrag(event);
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  // A pointer released outside the canvas still ends the drag.
  window.addEventListener("pointerup", (event) => {
    endStop(event);
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
    if (state.panel) {
      if (event.key === "Tab") {
        const items = [...document.querySelectorAll('#overlay button:not(:disabled), #overlay input:not(:disabled), #overlay select, #overlay a[href], #overlay textarea')].filter((el) => el.getClientRects().length);
        const index = items.indexOf(document.activeElement);
        if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1)) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0]?.focus();
        }
      }
      return;
    }
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
  if (active && active !== document.body && active.closest("input, select, textarea, button, #controls, #overlay")) return false;

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
