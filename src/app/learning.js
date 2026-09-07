import { escape, number } from "./ui.js";

// Practice examples are separate from the uploaded analysis. Answers follow
// their stated data, so changing a research dataset cannot change a lesson.
export function practice(lens, round = 0) {
  const lessons = {
    network: [
      ["Two independent routes have variances 2 and 2. What is their combined variance?", 1,
        "Parallel precisions add: 1 / (1/2 + 1/2) = 1. The current splits equally."],
      ["Two independent comparisons in series have variances 2 and 3. What is the indirect variance?", 5,
        "Variances add along an independent route: 2 + 3 = 5. Precision does not add in series."],
    ],
    bipartite: [
      ["A trial compares four treatments and reports all six pairwise contrasts. How many contrasts are linearly independent?", 3,
        "A trial with k arms has k−1 independent contrasts. Its six pairwise comparisons share information."],
      ["Two three-arm trials produce six pairwise contrast rows. How many trial nodes belong in the bipartite graph?", 2,
        "Keep one node per randomized trial. Turning each comparison into a new trial would discard the shared-control structure."],
    ],
    flow: [
      ["A unit flow sends 0.4 directly and 0.6 along a two-edge route. What is its mean path length?", 1.6,
        "Weight each route length by its flow: 0.4 × 1 + 0.6 × 2 = 1.6."],
      ["An internal treatment receives 0.7 units of current. How much must leave it?", 0.7,
        "Kirchhoff conservation requires zero net injection at every internal treatment. Only the source and target inject or remove a unit."],
    ],
    contributions: [
      ["A path carries 0.6 of the directed flow over three edges. Under equal sharing, how much contribution does it give each edge?", 0.2,
        "Divide path weight by path length: 0.6 / 3 = 0.2. Edge contributions sum across all paths containing that edge."],
      ["A valid L2 solution has edge shares −0.02, 0.42, and 0.60. What is their sum?", 1,
        "The shares still sum to one. A minimum-L2 solution can have negative weights; deleting them changes the solution."],
    ],
    reconstruction: [
      ["Three signed study contributions are −0.3, 0.8, and 0.2. What estimate do they reconstruct?", 0.7,
        "Signed contributions add in effect units: −0.3 + 0.8 + 0.2 = 0.7. They are not nonnegative percentage shares."],
      ["Direct and indirect estimates have variances 1 and 4, with covariance 1. What is the variance of their difference?", 3,
        "Var(D−I) = Var(D) + Var(I) − 2 Cov(D,I) = 1 + 4 − 2 = 3. Shared trials make covariance essential."],
    ],
    hodge: [
      ["A connected four-treatment cycle has four edges and no triangles. How many independent harmonic cycles can it contain?", 1,
        "The cycle dimension is edges − vertices + 1 = 1. With no triangles, this cycle cannot be detected by triangle curls."],
      ["Add a diagonal to that four-cycle. Its two triangles now span the cycle space. What is the remaining harmonic dimension?", 0,
        "The two independent triangular boundaries span the two-dimensional cycle space. Zero harmonic dimension is a property of the graph, not proof of valid evidence."],
    ],
    diffusion: [
      ["The exact network standard error is 2. To what effective resistance should its variance series converge?", 4,
        "Effective resistance is variance, so square the standard error: 2² = 4. A finite animation step is not a convergence guarantee."],
      ["An absorbing walker departs the source and eventually reaches the target. What is the expected net current leaving the source?", 1,
        "Backtracking crossings cancel. Each absorbed walker contributes one net departure, giving the unit current used by the hat matrix."],
    ],
    springs: [
      ["Two independent springs represent effects 0 and 4 with variances 1 and 4. Predict the pooled resting effect.", 0.8,
        "Stiffness is precision: (0/1 + 4/4) / (1/1 + 1/4) = 0.8. The more precise study pulls harder."],
      ["A study has sampling variance 2 and heterogeneity variance 3. What is the combined spring stiffness?", 0.2,
        "The heterogeneity spring is in series: compliances add, so stiffness is 1 / (2 + 3) = 0.2."],
    ],
    population: [
      ["MAIC weights are 1, 1 and 2. What is their effective sample size?", 16 / 6,
        "ESS = (Σw)² / Σw² = 16/6. Balancing covariates can reduce information even if every patient remains in the dataset."],
      ["Two equally common strata have log odds −2 and 0. What is their average response probability?", (1 / (1 + Math.exp(2)) + 0.5) / 2,
        "Average the inverse-link responses: (logistic(−2) + logistic(0))/2 ≈ 0.310. Logistic of the mean log odds is about 0.269, a different quantity."],
    ],
  };
  const entry = lessons[lens]?.[round % 2];
  return entry ? { question: entry[0], answer: entry[1], explanation: entry[2] } : null;
}

export function assessPractice(challenge, value) {
  if (String(value).trim() === "" || !Number.isFinite(Number(value)))
    return { correct: false, message: "Enter a finite number before checking your prediction." };
  const error = Math.abs(Number(value) - challenge.answer);
  const correct = error <= 0.005 * Math.max(1, Math.abs(challenge.answer));
  return {
    correct,
    message: `${correct ? "Correct." : `The answer is ${number(challenge.answer, 3)}.`} ${challenge.explanation}`,
  };
}

const progress = new Map();
const completed = new Set();
const get = (lens) => {
  if (!progress.has(lens)) progress.set(lens, { round: 0, value: "", result: null });
  return progress.get(lens);
};

export function learningMarkup(lens) {
  const current = get(lens);
  const challenge = practice(lens, current.round);
  if (!challenge) return "";
  return `<section class="practice" aria-labelledby="practice-title">
    <div class="practice-heading"><h3 id="practice-title">Predict · check · explain</h3>
    <span>${completed.size}/18 solved this session</span></div>
    <p class="inspector-note">Practice ${current.round + 1}/2 · separate teaching example</p>
    <form id="practice-form">
      <label for="practice-answer">${escape(challenge.question)}</label>
      <div class="practice-entry"><input id="practice-answer" name="prediction" type="number" step="any"
        value="${escape(current.value)}" required autocomplete="off" inputmode="decimal" />
      <button type="submit">Check prediction</button></div>
    </form>
    <p role="status" class="practice-feedback${current.result?.correct ? " correct" : ""}">${escape(current.result?.message ?? "Commit to a number, then compare your reasoning.")}</p>
    <button type="button" data-practice="next">${current.round === 0 ? "Next practice" : "First practice"}</button>
  </section>`;
}

export function answerPractice(lens, value) {
  const current = get(lens);
  current.value = value;
  current.result = assessPractice(practice(lens, current.round), value);
  if (current.result.correct) completed.add(`${lens}:${current.round}`);
}

export function nextPractice(lens) {
  const current = get(lens);
  current.round = (current.round + 1) % 2;
  current.value = "";
  current.result = null;
}
