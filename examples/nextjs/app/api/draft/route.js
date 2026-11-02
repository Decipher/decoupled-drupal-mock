import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'
import { drupal } from '../../../lib-drupal.js'

export async function GET(request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const answer = await drupal.validateDraftUrl(new URLSearchParams(params))
  if (!answer.ok) return new Response((await answer.json()).message, { status: answer.status })
  ;(await draftMode()).enable()
  redirect(params.path)
}
