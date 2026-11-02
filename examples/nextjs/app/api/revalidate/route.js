import { revalidatePath } from 'next/cache'

export function GET(request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('secret') !== 'test-secret') return new Response('Invalid secret', { status: 401 })
  revalidatePath(searchParams.get('path'))
  return Response.json({ revalidated: true })
}
