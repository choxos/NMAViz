import "./style.css";

const THEME_KEY = "nmaviz-theme";

const ICONS = {
  network:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="4.5" r="2.2"/><circle cx="4.8" cy="16" r="2.2"/><circle cx="19.2" cy="16" r="2.2"/><path d="M10.6 6.4 6.2 14.1M13.4 6.4l4.4 7.7M7 16h10"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
};

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

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

function render() {
  document.querySelector("#app").innerHTML = `
    <div class="studio">
      <div class="stage"></div>
      <div class="vignette"></div>
      <div class="identity">
        <a class="brand" href="/">
          <span class="brand-mark">${ICONS.network}</span>
          <span class="brand-word">NMA<span class="brand-light">Viz</span></span>
        </a>
        <span class="eyebrow"><span class="live-dot"></span>Evidence structure studio</span>
      </div>
      <button id="theme-toggle" class="panel theme-toggle" type="button"></button>
      <div class="boot">
        <div>
          <h1>Reading the network</h1>
          <p>
            Upload the data behind a network meta-analysis and read its evidence structure through
            the lenses the methods literature has proposed: an electrical circuit, a flow of
            evidence, a random walk, a diffusion, a system of springs, and a Hodge decomposition of
            inconsistency. Nothing leaves the browser.
          </p>
        </div>
      </div>
    </div>
  `;
  setTheme(currentTheme());
  document.querySelector("#theme-toggle").addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  });
}

render();
