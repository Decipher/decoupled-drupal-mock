/** A deep copy of JSON data, where `structuredClone` is missing: Node 16, and Jest's jsdom environment on any Node. */
export const clone = <T>(value: T): T => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T)
