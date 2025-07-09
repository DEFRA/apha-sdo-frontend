export function buildNavigation(request) {
  return [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'Contact',
      href: '/contact',
      current: request?.path === '/contact'
    }
  ]
}
