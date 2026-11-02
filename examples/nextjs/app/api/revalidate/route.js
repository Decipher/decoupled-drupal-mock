import { revalidatePath } from 'next/cache'

export function GET(request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('secret') !== 'test-secret') return new Response('Invalid secret', { status: 401 })
  const path = searchParams.get('path')
  if (!path) return new Response('Missing path', { status: 400 })
  revalidatePath(path)
  return Response.json({ revalidated: true })
}
