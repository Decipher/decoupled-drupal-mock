// What JSON:API Node Preview adds, as Druxt Node Preview reads it: `/jsonapi/node/{bundle}/{uuid}/preview`, an unsaved
// node for the signed-in editor. The route and the document's shape are from the module and from what the frontend
// checks: not recorded from a real Drupal, so the mock's fidelity claim does not cover them.
const JSONAPI = { 'content-type': 'application/vnd.api+json' }

/**
 * The extension.
 *
 * @param {Record<string, object>} unsaved - The unsaved attributes by node UUID. A node with none has no preview.
 * @param {object[]} [included] - The unsaved paragraphs and other included resources.
 * @returns {import('decoupled-drupal-mock').Extension} The extension.
 */
export const nodePreview = (unsaved, included = []) => ({
  name: 'node-preview',
  routes: {
    'GET /jsonapi/node/:bundle/:uuid/preview': ({ params, headers, url, drupal }) => {
      // The module's access check reads the editor's session. A visitor is refused.
      if (!headers.cookie && !headers.authorization) return { status: 403, headers: JSONAPI, body: { errors: [{ status: '403', title: 'Forbidden' }] } }
      if (!unsaved[params.uuid]) return { status: 404, headers: JSONAPI, body: { errors: [{ status: '404', title: 'Not Found' }] } }
      const saved = drupal.handle('GET', `${url.origin}/jsonapi/node/${params.bundle}/${params.uuid}`, { authorization: headers.authorization || '' }).body
      return { headers: JSONAPI, body: { ...saved, data: { ...saved.data, attributes: { ...saved.data.attributes, ...unsaved[params.uuid] } }, ...(url.searchParams.has('include') ? { included } : {}) } }
    },
  },
})
