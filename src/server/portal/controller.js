export const portalController = {
  handler(_request, h) {
    return h.view('portal/index', {
      pageTitle: 'Submission Portal',
      heading: 'Submit Your Data'
    })
  }
}
