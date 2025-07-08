import Boom from '@hapi/boom'
import {
  metadata as exampleMetadata,
  definition as exampleDefinition
} from './forms/example-form.js'
import {
  metadata as contactMetadata,
  definition as contactDefinition
} from './forms/contact-form.js'

const formsService = {
  getFormMetadata: function (slug) {
    switch (slug) {
      case exampleMetadata.slug:
        return Promise.resolve(exampleMetadata)
      case contactMetadata.slug:
        return Promise.resolve(contactMetadata)
      default:
        throw Boom.notFound(`Form '${slug}' not found`)
    }
  },
  getFormDefinition: function (id) {
    switch (id) {
      case exampleMetadata.id:
        return Promise.resolve(exampleDefinition)
      case contactMetadata.id:
        return Promise.resolve(contactDefinition)
      default:
        throw Boom.notFound(`Form '${id}' not found`)
    }
  }
}

// Mock form submission service
const formSubmissionService = {
  uploadFile: async (file, formId) => {
    console.log(`Mock file upload for form ${formId}:`, file.originalname)
    return {
      id: `file-${Date.now()}`,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      url: `/uploads/${file.originalname}`
    }
  },

  deleteFile: async (fileId) => {
    // Mock file deletion
    console.log(`Mock file deletion for file ${fileId}`)
    return { success: true }
  }
}

// Mock output service for form submissions
const outputService = {
  submitForm: async (formId, formData) => {
    console.log(`Mock form submission for form ${formId}:`, formData)
    return {
      id: `submission-${Date.now()}`,
      formId,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      data: formData
    }
  }
}

// Mock user service
const userService = {
  getUser: async (credentials) => {
    return {
      id: credentials?.userId || 'anonymous',
      username: credentials?.username || 'Anonymous User',
      email: credentials?.email || 'anonymous@example.com'
    }
  }
}

export default {
  formsService,
  formSubmissionService,
  outputService,
  userService
}
