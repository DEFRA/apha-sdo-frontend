export const oidcSigninController = {
  handler(_request, h) {
    return h.view('oidc-signin/index', {
      pageTitle: 'Sign In',
      heading: 'Sign In'
    })
  }
}
