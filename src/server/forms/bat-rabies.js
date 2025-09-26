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
      title: 'Files Upload'
    }
  ],
  pages: [
    {
      id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb1',
      path: '/sample-details',
      title: 'Bat Rabies Submission Form',
      section: 'sample-information',
      components: [
        {
          id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb7',
          type: 'MonthYearField',
          name: 'reportDate',
          title: 'Report date',
          hint: 'Month and year when bat submissions were tested',
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
      title: 'Bat Rabies Submission Form',
      section: 'documentation',
      components: [
        {
          id: 'b1a2c3d4-e5f6-7890-1234-567890fedcb9',
          type: 'FileUploadField',
          name: 'supportingDocuments',
          title: 'Supporting documents',
          hint: 'Upload laboratory results spreadsheet',
          options: {
            required: true,
            accept:
              'text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.ms-excel.sheet.binary.macroEnabled.12'
          },
          schema: {
            min: 1,
            max: 1
          }
        }
      ],
      controller: 'FileUploadPageController',
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
