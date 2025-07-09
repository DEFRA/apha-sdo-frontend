// Form metadata
const now = new Date()
const user = { id: 'example-user', displayName: 'Example user' }

const author = {
  createdAt: now,
  createdBy: user,
  updatedAt: now,
  updatedBy: user
}

export const metadata = {
  id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  slug: 'contact-form',
  title: 'Contact Us',
  organisation: 'Defra',
  teamName: 'Support Team',
  teamEmail: 'support@defra.gov.uk',
  submissionGuidance:
    "Thank you for contacting us. We'll respond within 2 working days.",
  notificationEmail: 'support@defra.gov.uk',
  ...author,
  live: author
}

export const definition = {
  engine: 'V2',
  name: 'Contact Us Form',
  schema: 2,
  startPage: '/contact-reason',
  sections: [
    {
      name: 'contact-details',
      title: 'Contact Details'
    }
  ],
  pages: [
    {
      id: 'a1b2c3d4-e5f6-7890-1234-567890abcde1',
      path: '/contact-reason',
      title: 'Why are you contacting us?',
      section: 'contact-details',
      components: [
        {
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcde5',
          type: 'Html',
          name: 'contactInfo',
          title: 'Contact Information',
          content:
            '<p class="govuk-body">Please tell us why you are contacting us and we will direct your enquiry to the right team.</p>'
        },
        {
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcde6',
          type: 'MultilineTextField',
          name: 'contactReason',
          title: 'What is your enquiry about?',
          hint: 'Please describe your enquiry',
          options: { rows: 3 },
          schema: { required: true }
        }
      ],
      next: [{ path: '/contact-details' }]
    },
    {
      id: 'a1b2c3d4-e5f6-7890-1234-567890abcde2',
      path: '/contact-details',
      title: 'Your contact details',
      section: 'contact-details',
      components: [
        {
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcde7',
          type: 'TextField',
          name: 'fullName',
          title: 'Full name',
          hint: 'Enter your first and last name',
          schema: { required: true, max: 100 }
        },
        {
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcde8',
          type: 'EmailAddressField',
          name: 'email',
          title: 'Email address',
          hint: 'We will use this to contact you',
          schema: { required: true }
        },
        {
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcde9',
          type: 'TelephoneNumberField',
          name: 'phoneNumber',
          title: 'Phone number (optional)',
          hint: 'Enter a UK phone number, like 01632 960 001 or 07700 900 982'
        }
      ],
      next: [{ path: '/message' }]
    },
    {
      id: 'a1b2c3d4-e5f6-7890-1234-567890abcde3',
      path: '/message',
      title: 'Your message',
      section: 'contact-details',
      components: [
        {
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcde0',
          type: 'MultilineTextField',
          name: 'message',
          title: 'Tell us more about your enquiry',
          hint: 'Please provide as much detail as possible',
          options: { rows: 5, maxWords: 500 },
          schema: { required: true, max: 2000 }
        }
      ],
      next: [{ path: '/summary' }]
    },
    {
      id: 'a1b2c3d4-e5f6-7890-1234-567890abcde4',
      path: '/summary',
      title: 'Check your answers',
      controller: 'SummaryPageController'
    }
  ],
  lists: [],
  conditions: []
}
