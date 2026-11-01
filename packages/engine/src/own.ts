/** A record's own member, never one inherited from `Object.prototype`, such as `__proto__` or `constructor`. */
export const own = <T>(record: Record<string, T> | undefined | null, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined

/** The names a request or a dump may not use as a key: each would reach the prototype of every object. */
export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
