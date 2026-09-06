/* Dense linear algebra, in the sizes a network meta-analysis needs.
 *
 * Networks here are small: at most a few dozen treatments and a few hundred
 * pairwise comparisons, so plain arrays of arrays are used rather than a typed
 * flat buffer. Readability wins at this size, and the one cubic step (a single
 * n by n inverse) runs in well under a millisecond for any real network.
 */

export const zeros = (rows, cols) =>
  Array.from({ length: rows }, () => new Array(cols).fill(0));

export const identity = (n) => {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
};

export const diagonal = (values) => {
  const D = zeros(values.length, values.length);
  values.forEach((v, i) => (D[i][i] = v));
  return D;
};

export const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));

export function multiply(A, B) {
  const rows = A.length;
  const inner = B.length;
  const cols = B[0].length;
  const C = zeros(rows, cols);
  for (let i = 0; i < rows; i++) {
    const Ai = A[i];
    const Ci = C[i];
    for (let k = 0; k < inner; k++) {
      const a = Ai[k];
      if (a === 0) continue;
      const Bk = B[k];
      for (let j = 0; j < cols; j++) Ci[j] += a * Bk[j];
    }
  }
  return C;
}

export const apply = (A, x) => A.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));

export const scale = (A, f) => A.map((row) => row.map((a) => a * f));

export const add = (A, B) => A.map((row, i) => row.map((a, j) => a + B[i][j]));

export const subtract = (A, B) => A.map((row, i) => row.map((a, j) => a - B[i][j]));

export const trace = (A) => A.reduce((s, row, i) => s + row[i], 0);

/* Gauss-Jordan with partial pivoting. Throws rather than returning a matrix of
 * infinities, because every caller here treats a singular matrix as a data
 * problem worth reporting (a disconnected network, or a zero-variance edge). */
export function inverse(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...identity(n)[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    if (Math.abs(M[pivot][col]) < 1e-12)
      throw new Error("Matrix is singular or nearly singular.");
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    for (let j = col; j < 2 * n; j++) M[col][j] /= p;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      if (f === 0) continue;
      for (let j = col; j < 2 * n; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

/* Moore-Penrose pseudoinverse of a symmetric matrix whose null space is exactly
 * the constant vector: every Laplacian of a connected graph. This is the same
 * identity netmeta uses (invmat), so the two agree to machine precision:
 *
 *     X plus = (X - J/n)^-1 + J/n
 *
 * where J is the all ones matrix. It is valid only when the graph is connected;
 * on a disconnected graph the shifted matrix is singular and inverse() throws,
 * which is the behavior we want.
 */
export function pseudoinverse(X) {
  const n = X.length;
  const shifted = X.map((row, i) => row.map((x, j) => x - 1 / n));
  const inv = inverse(shifted);
  return inv.map((row) => row.map((x) => x + 1 / n));
}

/* netmeta rounds values that are zero up to rounding error to exactly zero
 * before they reach a user; matching that keeps fixture comparisons clean and
 * stops "-0.0000000001" from appearing in a table. */
export const clean = (A, tol = 1e-10) =>
  A.map((row) => row.map((x) => (Math.abs(x) < tol ? 0 : x)));

/* Eigendecomposition of a symmetric matrix by the cyclic Jacobi method.
 *
 * Networks are small, so the simplest reliable algorithm is the right one:
 * Jacobi needs no tridiagonalization step, is accurate on the small eigenvalues
 * that a Laplacian pseudoinverse has, and converges in a handful of sweeps at
 * these sizes. Returns eigenvalues in descending order with matching columns of
 * the eigenvector matrix.
 */
export function eigenSymmetric(A, { sweeps = 60, tolerance = 1e-12 } = {}) {
  const n = A.length;
  const M = A.map((row) => [...row]);
  let V = identity(n);

  for (let sweep = 0; sweep < sweeps; sweep++) {
    let offDiagonal = 0;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) offDiagonal += M[p][q] ** 2;
    if (Math.sqrt(offDiagonal) < tolerance) break;

    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-300) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = M[k][p];
          const mkq = M[k][q];
          M[k][p] = c * mkp - s * mkq;
          M[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = M[p][k];
          const mqk = M[q][k];
          M[p][k] = c * mpk - s * mqk;
          M[q][k] = s * mpk + c * mqk;
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }

  const order = M.map((row, i) => i).sort((a, b) => M[b][b] - M[a][a]);
  return {
    values: order.map((i) => M[i][i]),
    vectors: V.map((row) => order.map((i) => row[i])),
  };
}

/* Moore-Penrose pseudoinverse of any symmetric matrix, through its
 * eigendecomposition. The Laplacian shortcut above needs the null space to be
 * exactly the constant vector; this one makes no such assumption, which is what
 * the Hodge projections need, since the null space there is whatever the
 * network's loop structure happens to make it. */
export function pseudoinverseSymmetric(A, { tolerance = 1e-10 } = {}) {
  const { values, vectors } = eigenSymmetric(A);
  const largest = Math.max(...values.map(Math.abs), 0);
  const cutoff = largest * tolerance;
  const n = A.length;
  const out = zeros(n, n);
  for (let k = 0; k < n; k++) {
    if (Math.abs(values[k]) <= cutoff) continue;
    const scale = 1 / values[k];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) out[i][j] += scale * vectors[i][k] * vectors[j][k];
  }
  return out;
}
