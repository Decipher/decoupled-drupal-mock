/** Whether a path on the site is one Drupal would answer: JSON:API, the router, OAuth, the session and the menus. */
export const isDrupalPath = (pathname: string, languages: string[]): boolean => {
  const prefix = languages.length ? `(?:/(?:${languages.map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))?` : ''
  return new RegExp(`^${prefix}/(?:jsonapi|router|oauth|session|system/menu|user/(?:login|logout|register|password))(?:/|$)`).test(pathname)
}
