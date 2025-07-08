export const contactController = {
  handler(_request, h) {
    return h.view('contact/index', {
      pageTitle: 'Contact',
      heading: 'Contact',
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Contact'
        }
      ]
    })
  }
}
