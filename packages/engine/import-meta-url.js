/* global __filename */
import { pathToFileURL } from 'node:url'

// The CommonJS bundle has no import.meta, so the build gives it this file's URL in its place.
export const importMetaUrl = pathToFileURL(__filename).href
