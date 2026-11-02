import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { drupal } from '../../lib-drupal.js'

export default async function Page({ params }) {
  const { slug } = await params
  const { isEnabled } = await draftMode()
  const path = `/${slug.join('/')}`
  let translated
  try {
    translated = await drupal.translatePath(path, { cache: 'no-store' })
  } catch {
    return <h1 id="error">Drupal is not answering</h1>
  }
  if (!translated) notFound()
  const node = await drupal.getResource(translated.jsonapi.resourceName, translated.entity.uuid, {
    cache: 'no-store',
    params: isEnabled ? { resourceVersion: 'rel:latest-version' } : {},
    withAuth: false,
  })
  return <h1 id="title">{node.title}</h1>
}
