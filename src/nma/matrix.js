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
