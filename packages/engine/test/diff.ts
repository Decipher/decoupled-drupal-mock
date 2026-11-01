/** The first path where two values differ, with both sides, for a report. */
export const diff = (a: unknown, b: unknown, path = '$'): string | undefined => {
  if (a === b) return undefined
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: engine ${JSON.stringify(a)?.slice(0, 160)} | drupal ${JSON.stringify(b)?.slice(0, 160)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length engine ${a.length} | drupal ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d }
    return undefined
  }
  const x = a as Record<string, unknown>; const y = b as Record<string, unknown>
  for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])]) {
    if (!(key in x)) return `${path}.${key}: missing in engine (drupal ${JSON.stringify(y[key])?.slice(0, 120)})`
    if (!(key in y)) return `${path}.${key}: extra in engine (${JSON.stringify(x[key])?.slice(0, 120)})`
    const d = diff(x[key], y[key], `${path}.${key}`); if (d) return d
  }
  return undefined
}
