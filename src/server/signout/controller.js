export const signoutController = {
  handler(_request, h) {
    return h.view('signout/index', {
      pageTitle: 'Sign Out',
      heading: 'Sign Out',
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Sign Out'
        }
      ]
    })
  }
}
