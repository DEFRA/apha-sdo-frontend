// Form metadata
const now = new Date()
const user = { id: 'system', displayName: 'System' }

const author = {
  createdAt: now,
  createdBy: user,
  updatedAt: now,
  updatedBy: user
}

export const metadata = {
  id: 'b1a2c3d4-e5f6-7890-1234-567890fedcba',
  slug: 'bat-rabies',
  title: 'Bat Rabies Surveillance Report',
  organisation: 'Defra',
  teamName: 'Rabies Surveillance Unit',
  teamEmail: 'rabies.surveillance@apha.gov.uk',
  submissionGuidance:
    'Thank you for submitting your bat rabies surveillance data. We will process your submission and contact you if additional information is required.',
  notificationEmail: 'rabies.surveillance@apha.gov.uk',
  ...author,
  live: author
}

export const definition = {
  engine: 'V2',
  name: 'Bat Rabies Surveillance Report',
  schema: 2,
  startPage: '/sample-details',
  sections: [
    {
      name: 'sample-information',
      title: 'Sample Information'
    },
    {
      name: 'documentation',
      title: 'Supporting Documentation'
    }
  ],
  pages: [
    {
      id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb1',
      path: '/sample-details',
      title: 'Sample details',
      section: 'sample-information',
      components: [
        {
          id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb5',
          type: 'Html',
          name: 'sampleInfo',
          title: 'Sample Information',
          content:
            '<p class="govuk-body">Please provide details about the bat sample being submitted for rabies surveillance testing.</p>'
        },
        {
          id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb7',
          type: 'DatePartsField',
          name: 'receiptDate',
          title: 'Receipt date',
          hint: 'Date when the bat sample was collected',
          options: {
            maxDaysInFuture: 0
          },
          schema: { required: true }
        }
      ],
      next: [{ path: '/file-upload' }]
    },
    {
      id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb2',
      path: '/file-upload',
      title: 'Upload documentation',
      section: 'documentation',
      components: [
        {
          id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb8',
          type: 'Html',
          name: 'uploadInfo',
          title: 'Upload Information',
          content:
            '<p class="govuk-body">Please upload any supporting documentation for this bat rabies surveillance submission.</p>'
        },
        {
          id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb9',
          type: 'FileUploadField',
          name: 'supportingDocuments',
          title: 'Supporting documents',
          hint: 'Upload laboratory results spreadsheet',
          options: {
            required: false,
            accept:
              'text/csv, application/vnd.openxmlformats, officedocument.spreadsheetml.sheet, application/vnd.oasis.opendocument.spreadsheet'
          }
        }
      ],
      next: [{ path: '/summary' }]
    },
    {
      id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb3',
      path: '/summary',
      title: 'Check your answers',
      controller: 'SummaryPageController'
    }
  ],
  lists: [],
  conditions: []
}
