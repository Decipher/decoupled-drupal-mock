import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'
import { drupal } from '../../../lib-drupal.js'

export async function GET(request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const answer = await drupal.validateDraftUrl(new URLSearchParams(params))
  if (!answer.ok) return new Response((await answer.json()).message, { status: answer.status })
  // Only a path on this site: `https://elsewhere` or `//elsewhere` would send the editor off it.
  if (!params.path?.startsWith('/') || params.path.startsWith('//')) return new Response('Invalid path', { status: 400 })
  ;(await draftMode()).enable()
  redirect(params.path)
}
