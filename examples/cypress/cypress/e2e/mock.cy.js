describe('the mock', () => {
  afterEach(() => cy.task('drupal:reset'))

  it('answers', () => {
    cy.request('/en/jsonapi/node/recipe').its('body.data').should('have.length.greaterThan', 0)
  })

  it('takes a signed-in write, gone after a reset', () => {
    cy.task('drupal:token', { name: 'admin' }).then(({ access }) => {
      cy.request('/en/jsonapi/node/recipe').its('body.data.0').then((recipe) => {
        cy.request({
          method: 'PATCH',
          url: `/en/jsonapi/node/recipe/${recipe.id}`,
          headers: { authorization: `Bearer ${access}`, 'content-type': 'application/vnd.api+json' },
          body: { data: { type: recipe.type, id: recipe.id, attributes: { title: 'Changed' } } },
        }).its('status').should('eq', 200)
        cy.task('drupal:reset')
        cy.request(`/en/jsonapi/node/recipe/${recipe.id}`).its('body.data.attributes.title').should('eq', recipe.attributes.title)
      })
    })
  })
})
