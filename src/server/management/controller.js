export const managementController = {
  handler(_request, h) {
    return h.view('management/index', {
      pageTitle: 'Account Management',
      heading: 'Account Management',
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Dashboard',
          href: '/dashboard'
        },
        {
          text: 'Account Management'
        }
      ]
    })
  }
}
