export const oidcSigninController = {
  handler(_request, h) {
    return h.view('oidc-signin/index', {
      pageTitle: 'Sign In',
      heading: 'Sign In',
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Sign In'
        }
      ]
    })
  }
}
