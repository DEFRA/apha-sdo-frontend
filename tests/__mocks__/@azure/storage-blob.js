import { vi } from 'vitest'

export const mockBlockBlobClient = {
  upload: vi
    .fn()
    .mockResolvedValue({ etag: '"test-etag"', requestId: 'req-123' }),
  download: vi.fn().mockResolvedValue({
    readableStreamBody: 'mock-stream',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    contentLength: 2048,
    lastModified: new Date('2023-06-01'),
    metadata: { submissionId: 'sub-456' }
  }),
  deleteIfExists: vi.fn().mockResolvedValue({ succeeded: true }),
  url: 'https://test.blob.core.windows.net/container/file.xlsx'
}

export const mockContainerClient = {
  createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
  getBlockBlobClient: vi.fn(() => mockBlockBlobClient),
  listBlobsFlat: vi.fn(() => ({
    [Symbol.asyncIterator]: async function* () {
      yield* []
    }
  }))
}

export const mockBlobServiceClient = {
  getContainerClient: vi.fn(() => mockContainerClient),
  credential: { accountKey: 'test-key' }
}

export const BlobServiceClient = {
  fromConnectionString: vi.fn(() => mockBlobServiceClient)
}

export const generateBlobSASQueryParameters = vi.fn(
  (sasOptions, credential) => {
    if (!credential) {
      throw new Error('Invalid or missing credential')
    }
    return { toString: () => 'sas-token' }
  }
)

export const BlobSASPermissions = {
  parse: vi.fn(() => ({ read: true }))
}

// Support default export for dynamic imports
export default {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions
}
