/** A step of a write or sign-in scenario, as the build records it and the engine's test replays it. */
export interface Step {
  method: string
  path: string
  /** A JSON:API document, sent as `application/vnd.api+json`. */
  body?: unknown
  /** A form, sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>
  /** A JSON body, sent as `application/json`. */
  json?: unknown
  /** The account this step runs as, over the scenario's; `anonymous` sends no credentials. */
  as?: string
  /** A bearer token for this step: a placeholder such as `{1.access_token}`, or a literal. */
  bearer?: string
}

export interface Scenario { name: string, as: string, steps: Step[] }

/** What a step answered, as the build recorded it. */
export interface Answer { status: number, headers: Record<string, string>, body: unknown }

export interface RecordedScenario extends Scenario { answers: Answer[] }

/** The keys whose whole value Drupal generated. */
const GENERATED_KEYS = new Set(['id', 'uuid', 'sub'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A value at a dotted path in a step's answer, such as `data.id` or `access_token`. */
const at = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value)

/**
 * The placeholders a step may carry: `{3.data.id}` is a value of the third step's answer, and `{node--recipe:0}` the
 * id of the first resource of that type.
 */
export const resolve = <T>(value: T, answers: Answer[], resource: (type: string, index: number) => string | undefined): T => {
  if (typeof value === 'string') {
    return value.replace(/\{(\d+)\.([^}]+)\}/g, (whole, step: string, path: string) => {
      // A step that names what an earlier one did not give would ask something else, and its answer would mean nothing.
      const found = at(answers[Number(step) - 1]?.body, path)
      if (found === undefined || found === null) throw new Error(`${whole} is not in the answer of step ${step}.`)
      return String(found)
    }).replace(/\{([a-z0-9_]+--[a-z0-9_]+):(\d+)\}/g, (_whole, type: string, index: string) => resource(type, Number(index)) ?? `missing-${type}-${index}`) as T
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, answers, resource)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolve(item, answers, resource)])) as T
  return value
}

/** The headers a recorded answer keeps: the ones a client reads. */
export const KEPT_HEADERS = ['content-type', 'location', 'www-authenticate']

/**
 * An answer with its volatile values replaced, so a replay compares what Drupal decided and not what it generated:
 * uuids, internal ids, revisions, timestamps and tokens.
 */
export const volatile = (value: unknown, key?: string): unknown => {
  if (typeof value === 'string') {
    if (UUID.test(value) && key && GENERATED_KEYS.has(key)) return '<uuid>'
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value)) return '<time>'
    if (key && ['access_token', 'refresh_token', 'csrf_token', 'logout_token'].includes(key)) return '<token>'
    if (key === 'href' || key === 'location') return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/resourceVersion=id%3A\d+/g, 'resourceVersion=<rev>')
    // What Drupal generated is in identifiers and links, and in an error that names one. Authored text stays as it is.
    if (key === 'detail') return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    return value
  }
  if (typeof value === 'number' && key && /^drupal_internal__(nid|vid|tid|mid|revision_id|id|fid)$/.test(key)) return '<id>'
  if (typeof value === 'number' && key === 'updated_at') return '<time>'
  if (Array.isArray(value)) return value.map((item) => volatile(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, item]) => [k, volatile(item, k)]))
  return value
}
