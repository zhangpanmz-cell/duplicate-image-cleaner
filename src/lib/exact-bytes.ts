/** Full equality, including trailing bytes. Never samples or reuses a prior result. */
export function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const words = Math.floor(left.byteLength / 4);
  const a = new Uint32Array(left, 0, words);
  const b = new Uint32Array(right, 0, words);
  for (let i = 0; i < words; i++) if (a[i] !== b[i]) return false;
  const tailA = new Uint8Array(left, words * 4);
  const tailB = new Uint8Array(right, words * 4);
  for (let i = 0; i < tailA.length; i++) if (tailA[i] !== tailB[i]) return false;
  return true;
}
