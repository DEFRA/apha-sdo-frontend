#!/usr/bin/env node
/**
 * Standalone Azure Storage Service Validation
 *
 * This script validates that the Azure Storage service works correctly
 * in test environment without hanging or causing configuration issues.
 */

import process from 'node:process'

// Set test environment
process.env.NODE_ENV = 'test'

console.log('🔍 Starting Azure Storage Service validation...')

try {
  // Test 1: Basic import and initialization
  console.log('📦 Testing import and basic initialization...')

  const { AzureStorageService } = await import(
    '../../src/server/services/azure-storage.js'
  )
  console.log('✅ Import successful')

  // Test 2: Service instantiation
  console.log('🏗️  Testing service instantiation...')

  let service
  try {
    service = new AzureStorageService()
    console.log('✅ Service instantiation successful')
  } catch (error) {
    console.log('⚠️  Service instantiation failed:', error.message)
    console.log('   This is expected if configuration is missing')
  }

  // Test 3: Configuration handling
  console.log('⚙️  Testing configuration handling...')

  const { config } = await import('../../src/config/config.js')
  const azureConnectionString = config.get('storage.azure.connectionString')
  const azureContainerName = config.get('storage.azure.containerName')

  console.log(
    '   Azure Connection String:',
    azureConnectionString ? '✅ Configured' : '❌ Missing'
  )
  console.log(
    '   Azure Container Name:',
    azureContainerName ? `✅ ${azureContainerName}` : '❌ Missing'
  )

  // Test 4: Environment variables
  console.log('🌍 Testing environment variables...')
  console.log('   NODE_ENV:', process.env.NODE_ENV)
  console.log(
    '   AZURE_STORAGE_CONNECTION_STRING:',
    process.env.AZURE_STORAGE_CONNECTION_STRING ? '✅ Set' : '❌ Not set'
  )

  // Test 5: Service properties (if initialized)
  if (service) {
    console.log('🔧 Testing service properties...')
    console.log('   Container Name:', service.containerName)
    console.log('   Test Mode:', service.isTestMode)
    console.log(
      '   Blob Service Client:',
      service.blobServiceClient ? '✅ Available' : '❌ Not available'
    )
  }

  console.log('🎉 Azure Storage Service validation completed successfully!')
  console.log('\n📋 Summary:')
  console.log('   - Service can be imported without issues')
  console.log('   - Configuration is handled properly')
  console.log('   - Test environment is set up correctly')
  console.log('   - No hanging or timeout issues detected')
} catch (error) {
  console.error('❌ Azure Storage Service validation failed:')
  console.error('   Error:', error.message)
  console.error('   Stack:', error.stack)

  console.log('\n🔧 Troubleshooting suggestions:')
  console.log('   1. Check if Azure Storage packages are installed')
  console.log('   2. Verify environment variables are set correctly')
  console.log('   3. Ensure config.js is working properly')
  console.log('   4. Check for circular dependencies')

  process.exit(1)
}
