export function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    sensitivity: "base",
    numeric: true
  });
}

export function compareNumber(a, b) {
  const left = Number(a);
  const right = Number(b);
  const safeLeft = Number.isFinite(left) ? left : 0;
  const safeRight = Number.isFinite(right) ? right : 0;
  return safeLeft - safeRight;
}

export function compareDateIso(a, b) {
  const left = Date.parse(String(a || ""));
  const right = Date.parse(String(b || ""));
  if (Number.isFinite(left) && Number.isFinite(right)) {
    return left - right;
  }
  return compareText(a, b);
}
