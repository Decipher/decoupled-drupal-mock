import type { createDrupal } from './engine.js'

/**
 * GraphQL's engine factory when the optional `graphql` package is installed, else none. Only that package being
 * absent is quiet: a `graphql` that is there and fails to load is an error to see, not a schema endpoint to lose.
 *
 * @returns The factory, or undefined.
 */
export const graphqlFactory = async (): Promise<typeof createDrupal | undefined> => {
  try {
    return (await import('./graphql.js')).createDrupal
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException
    if ((code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') && /['"]graphql['"]/.test(message)) return undefined
    throw error
  }
}
