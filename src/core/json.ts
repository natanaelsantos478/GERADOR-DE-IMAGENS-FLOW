/** Guards for rule 7 (state is pure JSON) and for the soak runner (no NaN/Infinity). */

export interface JsonIssue {
  path: string;
  problem: string;
}

/**
 * Walks a value and reports anything that would not survive `JSON.parse(JSON.stringify(x))`
 * unchanged: non-plain objects (Map, Set, class instances, typed arrays, Date), functions,
 * undefined values, symbols, bigint, NaN/±Infinity, shared references and cycles.
 */
export function findJsonIssues(value: unknown, maxIssues = 20): JsonIssue[] {
  const issues: JsonIssue[] = [];
  const seen = new Set<object>();
  const visit = (v: unknown, path: string): void => {
    if (issues.length >= maxIssues) return;
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return;
      case 'number':
        if (!Number.isFinite(v)) issues.push({ path, problem: String(v) });
        return;
      case 'undefined':
        issues.push({ path, problem: 'undefined' });
        return;
      case 'function':
      case 'symbol':
      case 'bigint':
        issues.push({ path, problem: typeof v });
        return;
    }
    if (v === null) return;
    const o = v as object;
    if (seen.has(o)) {
      issues.push({ path, problem: 'shared reference or cycle' });
      return;
    }
    seen.add(o);
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) visit(o[i], `${path}[${i}]`);
      return;
    }
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) {
      issues.push({ path, problem: `non-plain object (${o.constructor?.name ?? 'unknown'})` });
      return;
    }
    for (const [k, x] of Object.entries(o)) visit(x, path ? `${path}.${k}` : k);
  };
  visit(value, '');
  return issues;
}

/** Fast scan used every game month by the soak runner: only non-finite numbers. */
export function findNonFinite(value: unknown, maxIssues = 10): string[] {
  const out: string[] = [];
  const visit = (v: unknown, path: string): void => {
    if (out.length >= maxIssues) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${path} = ${v}`);
    } else if (v && typeof v === 'object') {
      if (Array.isArray(v)) for (let i = 0; i < v.length; i++) visit(v[i], `${path}[${i}]`);
      else for (const k in v) visit((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    }
  };
  visit(value, '');
  return out;
}

export function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
