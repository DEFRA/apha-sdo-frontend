#!/usr/bin/env node
/**
 * Basic Azure Storage Test
 *
 * Tests Azure Storage service without vitest to identify hanging issues
 */

import process from 'node:process'
import assert from 'node:assert'

// Set test environment
process.env.NODE_ENV = 'test'
process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key;EndpointSuffix=core.windows.net'
process.env.AZURE_CONTAINER_NAME = 'test-container'

console.log('🧪 Starting basic Azure Storage test...')

async function runBasicTests() {
  try {
    console.log('📦 Step 1: Importing Azure Storage service...')

    // Dynamic import to see if this is where it hangs
    const azureModule = await import('../../src/server/services/azure-storage.js')
    const { AzureStorageService } = azureModule

    console.log('✅ Step 1 completed: Import successful')

    console.log('🏗️  Step 2: Creating service instance...')

    const service = new AzureStorageService()

    console.log('✅ Step 2 completed: Service instance created')

    console.log('🔍 Step 3: Checking service properties...')

    assert(service.containerName === 'test-container', 'Container name should be test-container')
    assert(service.isTestMode === true, 'Should be in test mode')

    console.log('✅ Step 3 completed: Service properties validated')

    console.log('⚙️  Step 4: Testing method existence...')

    assert(typeof service.uploadFile === 'function', 'uploadFile should be a function')
    assert(typeof service.downloadFile === 'function', 'downloadFile should be a function')
    assert(typeof service.deleteFile === 'function', 'deleteFile should be a function')
    assert(typeof service.listFiles === 'function', 'listFiles should be a function')
    assert(typeof service.generateSasUrl === 'function', 'generateSasUrl should be a function')

    console.log('✅ Step 4 completed: All methods exist')

    console.log('🎉 All basic tests passed!')
    console.log('   - Service can be imported')
    console.log('   - Service can be instantiated')
    console.log('   - Service has correct properties')
    console.log('   - Service has all required methods')

    return true

  } catch (error) {
    console.error('❌ Test failed:')
    console.error('   Error:', error.message)
    console.error('   Stack:', error.stack)
    return false
  }
}

// Run tests with timeout
console.log('⏰ Setting 10-second timeout...')

const timeout = setTimeout(() => {
  console.error('💥 Test timed out after 10 seconds!')
  console.error('   This indicates the Azure Storage service import is hanging')
  process.exit(1)
}, 10000)

runBasicTests()
  .then((success) => {
    clearTimeout(timeout)
    if (success) {
      console.log('🏆 Basic Azure Storage test completed successfully!')
      process.exit(0)
    } else {
      console.error('💔 Basic Azure Storage test failed!')
      process.exit(1)
    }
  })
  .catch((error) => {
    clearTimeout(timeout)
    console.error('💥 Unexpected error in test execution:', error)
    process.exit(1)
  })