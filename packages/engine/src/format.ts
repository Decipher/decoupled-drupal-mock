/** The dump layout this engine reads. A change to it is a new format, and a preset built in it says so. */
export const DUMP_FORMAT = 1

/**
 * The path the build asks Canvas Headless's content API for to record its answer to a path it does not know. No site has
 * it, so the answer is the one Canvas gives every unknown path, and the engine gives it for every path it has no
 * recording of.
 */
export const CANVAS_NOT_FOUND = '/decoupled-drupal-mock/not-found'

/** A `requestUri` Canvas Headless refuses, as it is not site-relative. The build records Canvas's answer to it. */
export const CANVAS_BAD_REQUEST = 'decoupled-drupal-mock'
