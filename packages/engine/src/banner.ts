import type { Dump } from './types.js'

/**
 * What a server over a preset answers, as the lines `serve` prints under the one that says where it listens: the
 * JSON:API index under each language, Decoupled Router, the main menu and the token endpoint when the preset recorded
 * them, and the accounts a test signs in as. Each link names the base URL the answers name.
 *
 * @param dump - The preset's dump.
 * @param baseUrl - The URL the answers' links name.
 * @param color - Whether to dim the labels, for a terminal.
 * @returns The lines, without the one before them.
 */
export const bannerLines = (dump: Dump, baseUrl: string, color = false): string[] => {
  const { languages, defaultLanguage, drupal } = dump.manifest
  const under = (prefix: string): string => `${baseUrl}${prefix ? `/${prefix}` : ''}`
  const rows: Array<[string, string]> = []
  // The default language first, then the rest as the site lists them.
  for (const langcode of [defaultLanguage, ...Object.keys(languages).filter((code) => code !== defaultLanguage)]) rows.push([`JSON:API (${langcode})`, `${under(languages[langcode]!)}/jsonapi`])
  if (drupal.modules.decoupled_router) rows.push(['Decoupled Router', `${baseUrl}/router/translate-path?path=/`])
  const menu = Object.keys(dump.recorded).find((key) => /^GET (\/[^ ]*)?\/jsonapi\/menu_items\/main$/.test(key))
  if (menu) rows.push(['Main menu', `${baseUrl}${menu.slice('GET '.length)}`])
  if (dump.identities) {
    rows.push(['OAuth token', `${baseUrl}/oauth/token`])
    if (dump.identities.accounts.length) rows.push(['Accounts', dump.identities.accounts.map((account) => account.name).join(', ')])
  }
  const width = Math.max(...rows.map(([label]) => label.length))
  const dim = (text: string): string => (color ? `\x1b[2m${text}\x1b[22m` : text)
  return rows.map(([label, value]) => `  ${dim(label.padEnd(width))}  ${value}`)
}
