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
      // The module's access check reads the editor's session, by token or cookie. A visitor, or a session the site
      // did not start, is refused.
      const session = { ...(headers.authorization ? { authorization: headers.authorization } : {}), ...(headers.cookie ? { cookie: headers.cookie } : {}) }
      if (drupal.handle('GET', `${url.origin}/oauth/userinfo`, session).status !== 200) return { status: 403, headers: JSONAPI, body: { errors: [{ status: '403', title: 'Forbidden' }] } }
      if (!unsaved[params.uuid]) return { status: 404, headers: JSONAPI, body: { errors: [{ status: '404', title: 'Not Found' }] } }
      // The saved node, as this editor may read it. A node they cannot read has no preview either.
      const answer = drupal.handle('GET', `${url.origin}/jsonapi/node/${params.bundle}/${params.uuid}`, session)
      if (answer.status !== 200) return { status: answer.status, headers: JSONAPI, body: answer.body }
      const saved = answer.body
      return { headers: JSONAPI, body: { ...saved, data: { ...saved.data, attributes: { ...saved.data.attributes, ...unsaved[params.uuid] } }, ...(url.searchParams.has('include') ? { included } : {}) } }
    },
  },
})
