import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
const output = "documentation/implementation/browser";
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.locator("#inspector h2").waitFor();
  assert.equal(await page.locator(".game-key").count(), 9);
  for (const lens of ["network", "bipartite", "flow", "contributions", "reconstruction", "hodge", "diffusion", "springs", "population"]) {
    await page.locator(`button[data-lens="${lens}"]`).click();
    await page.waitForFunction((id) => document.querySelector("#stage").dataset.lens === id, lens);
    assert.ok((await page.locator("#inspector").innerText()).length > 100);
    assert.equal(await page.locator("#practice-form").count(), 1);
  }
  await page.locator('button[data-lens="network"]').click();
  await page.locator("#practice-answer").fill("4");
  await page.locator("#practice-form button").click();
  await page.waitForFunction(() => document.querySelector(".practice-feedback").textContent.includes("The answer"));
  assert.equal(await page.locator(".practice-feedback.correct").count(), 0);
  await page.locator("#practice-answer").fill("1");
  await page.locator("#practice-form button").click();
  await page.locator(".practice-feedback.correct").waitFor();

  // The mains switch. It sits on the canvas over the wires, so this proves both
  // that it takes the press there and that the circuit state follows it.
  await page.locator("#stage .rocker.closed").waitFor();
  await page.locator("#stage .rocker").click();
  await page.locator(".source.off").waitFor();
  assert.equal(await page.locator("#stage .rocker.open").count(), 1);
  assert.equal(await page.locator(".wire-current").count(), 0);
  assert.equal(await page.locator("[data-switch].deck-button").innerText(), "Switch it on");
  await page.locator("[data-switch].deck-button").click();
  await page.waitForFunction(() => document.querySelectorAll(".source.off").length === 0);
  assert.equal(await page.locator("#stage .rocker.closed").count(), 1);
  await page.locator("#data-button").click();
  await page.locator('[role="dialog"]').waitFor();
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-close")), true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement.id === "data-button");

  await page.locator('button[data-lens="bipartite"]').click();
  const chooser = page.locator("details").filter({ has: page.locator("[data-exclude-study]") });
  await chooser.locator("summary").click();
  const trial = page.locator("[data-exclude-study]").first();
  await trial.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-exclude-study]").getAttribute("aria-pressed") === "true");
  assert.equal(await page.locator(".sensitivity").count(), 1);
  await trial.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-exclude-study]").getAttribute("aria-pressed") === "false");

  await page.locator('button[data-lens="contributions"]').click();
  for (const method of ["shortestpath", "randomwalk", "l1", "l2"]) {
    const button = page.locator(`[data-option="contributionMethod"][data-value="${method}"]`);
    await button.click();
    await page.waitForFunction((value) => document.querySelector(`[data-option="contributionMethod"][data-value="${value}"]`).getAttribute("aria-pressed") === "true", method);
    assert.equal(await page.locator("#inspector [role=alert]").count(), 0);
  }
  await page.locator('button[data-lens="reconstruction"]').click();
  await page.locator("#inspector details summary").first().click();
  assert.ok((await page.locator("#inspector details[open]").first().innerText()).length > 30);

  await page.locator('button[data-lens="hodge"]').click();
  await page.locator('[data-hodge-example="cycle"]').click();
  await page.waitForFunction(() => document.querySelector("#dataset-name").textContent === "Chordless four-cycle");
  assert.match(await page.locator("#inspector").innerText(), /dimension 1/);
  await page.locator('[data-hodge-example="chord"]').click();
  await page.waitForFunction(() => document.querySelector("#dataset-name").textContent === "Four-cycle with a chord");
  assert.match(await page.locator("#inspector").innerText(), /none possible|dimension zero/);

  await page.locator("#data-button").click();
  await page.locator('[data-example="senn2013"]').click();
  await page.locator('button[data-lens="diffusion"]').click();
  await page.locator('[data-option="diffusionMode"][data-value="estimates"]').click();
  await page.locator('[data-option="solverFull"][data-value="true"]').click();
  await page.waitForFunction(() => document.querySelector("#inspector").textContent.includes("Converged to tolerance."));
  await page.locator('[data-option="diffusionMode"][data-value="absorbing"]').click();
  await page.waitForFunction(() => document.querySelector("#inspector").textContent.includes("Net = hat"));
  assert.match(await page.locator("#inspector").innerText(), /Net = hat/i);

  await page.locator('button[data-lens="springs"]').click();
  await page.locator("[data-spring-example]").click();
  await page.locator('[data-wager="open"]').click();
  await page.locator("#wager-value").waitFor();
  assert.equal(await page.locator(".spring-yoke").count(), 0);
  assert.equal(await page.locator('[data-play="settle"]').isDisabled(), true);
  await page.locator("#wager-value").fill("0.4");
  await page.locator("#wager-value").press("Tab");
  await page.locator('[data-wager="settle"]').click();
  await page.locator(".wager-label.truth").waitFor();
  assert.match(await page.locator("#console").innerText(), /POOLED STANDARD ERRORS/i);
  await page.screenshot({ path: `${output}/springs.png`, fullPage: true });

  await page.locator('button[data-lens="population"]').click();
  await page.locator('[data-option="populationTarget"][data-value="1.3"]').click();
  await page.locator('[data-option="populationPrediction"][data-value="higher"]').click();
  await page.waitForFunction(() => document.querySelector("#inspector").textContent.includes("Optimizer converged"));
  assert.match(await page.locator("#inspector").innerText(), /Optimizer converged/);
  for (const family of ["normal", "ordinal", "survival", "binary"]) {
    await page.locator(`[data-option="populationFamily"][data-value="${family}"]`).click();
    await page.waitForFunction((value) => document.querySelector(`[data-option="populationFamily"][data-value="${value}"]`).getAttribute("aria-pressed") === "true", family);
    await page.locator('[data-option="populationPrediction"][data-value="higher"]').click();
    await page.waitForFunction(() => document.querySelector("#inspector").textContent.includes("ML-NMR joint likelihood fit"));
    assert.equal(await page.locator("#inspector [role=alert]").count(), 0);
  }
  await page.locator('[data-option="populationMethod"][data-value="maic"]').click();
  await page.locator('[data-option="populationPrediction"][data-value="higher"]').click();
  await page.waitForFunction(() => document.querySelector("#inspector").textContent.includes("Balanced effective sample size"));
  await page.locator('[data-option="populationMethod"][data-value="mlnmr"]').click();
  await page.locator('[data-option="populationPrediction"][data-value="higher"]').click();
  const populationEditor = page.locator("details").filter({ has: page.locator("#population-data") });
  await populationEditor.locator("summary").click();
  const validPopulation = await page.locator("#population-data").inputValue();
  await page.locator("#population-data").fill('{"family":"binary","ipd":[],"agd":[]}');
  await page.locator('[data-population-action="import"]').click();
  await page.locator("#inspector [role=alert]").waitFor();
  await page.locator("#population-data").fill(validPopulation);
  await page.locator('[data-population-action="import"]').click();
  await page.waitForFunction(() => !document.querySelector("#inspector [role=alert]"));
  await page.locator('[data-population-action="reset"]').click();
  await page.locator('[data-option="populationBinaryApproximation"][data-value="two"]').click();
  await page.waitForFunction(() => document.querySelector('[data-option="populationBinaryApproximation"][data-value="two"]').getAttribute("aria-pressed") === "true");
  await page.locator('[data-option="populationTarget"][data-value="1.3"]').click();
  await page.locator('[data-option="populationPrediction"][data-value="higher"]').click();
  const hierarchy = page.locator("details").filter({ has: page.locator('[data-population-action="hierarchical"]') });
  await hierarchy.locator("summary").click();
  await page.locator('[data-option="populationRandom"][data-value="no"]').click();
  await page.locator('[data-option="populationHierarchy"][data-value="shared"]').click();
  await page.locator('[data-population-action="hierarchical"]').click();
  await page.locator('[data-population-action="cancel"]').waitFor();
  await page.locator('[data-population-action="cancel"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-population-action="cancel"]'));
  assert.equal(await page.locator(".population-stage").evaluate((group) => {
    const bounds = group.ownerSVGElement.getBoundingClientRect();
    return [...group.querySelectorAll("text, rect")].every((item) => {
      const box = item.getBoundingClientRect();
      return box.top >= bounds.top && box.bottom <= bounds.bottom && box.left >= bounds.left && box.right <= bounds.right;
    });
  }), true, "All population labels and outcome bars must fit the display");
  await page.screenshot({ path: `${output}/population.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const group = document.querySelector(".population-stage");
    const bounds = group.ownerSVGElement.getBoundingClientRect();
    return [...group.querySelectorAll("text, rect")].every((item) => {
      const box = item.getBoundingClientRect();
      return box.top >= bounds.top && box.bottom <= bounds.bottom && box.left >= bounds.left && box.right <= bounds.right;
    });
  });
  await page.screenshot({ path: `${output}/population-mobile.png`, fullPage: true });
  await page.locator('button[data-lens="network"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await page.locator("#stage").evaluate((el) => el.clientWidth) > 270);
  await page.locator("#diagram-size").click();
  assert.ok(await page.locator("#stage").evaluate((el) => el.clientWidth) >= 680);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator("#diagram-size").click();
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Browser QA passed: nine lenses, practice feedback, mains switch, modal keyboard focus, trial exclusion, four path methods, canonical routes, Hodge topology, diffusion solver, spring wager, four population families, MAIC, binary approximations, invalid JSON data, sampler cancellation, mobile expansion.");
} finally {
  await browser.close();
  await server.close();
}
