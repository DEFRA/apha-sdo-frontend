export const dashboardController = {
  handler(_request, h) {
    // Define all available demo services
    const allServices = [
      {
        id: 'bat-rabies-submission',
        title: 'Bat Rabies',
        description:
          'Submit species occurrence and monitoring data through guided forms',
        href: '/bat-rabies',
        status: 'Available',
        category: 'Data Submission'
      },
      {
        id: 'example-service-1',
        title: 'Example Service',
        description: 'Example description',
        href: '/example-form',
        status: 'Coming Soon',
        category: 'Data Submission'
      },
      {
        id: 'example-service-2',
        title: 'Example Service',
        description: 'Example description',
        href: '/example-form',
        status: 'Available',
        category: 'Another Category'
      }
    ]

    // Group services by category
    const servicesByCategory = allServices.reduce((acc, service) => {
      if (!acc[service.category]) {
        acc[service.category] = []
      }
      acc[service.category].push(service)
      return acc
    }, {})

    return h.view('dashboard/index', {
      pageTitle: 'Dashboard',
      heading: 'Dashboard',
      servicesByCategory,
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Dashboard'
        }
      ]
    })
  }
}
