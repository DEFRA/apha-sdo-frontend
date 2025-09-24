import convict from 'convict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import convictFormatWithValidator from 'convict-format-with-validator'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const fourHoursMs = 14400000
const oneWeekMs = 604800000

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

convict.addFormats(convictFormatWithValidator)

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT'
  },
  staticCacheTimeout: {
    doc: 'Static cache timeout in milliseconds',
    format: Number,
    default: oneWeekMs,
    env: 'STATIC_CACHE_TIMEOUT'
  },
  serviceName: {
    doc: 'Applications Service Name',
    format: String,
    default: 'APHA Surveillance data submission portal'
  },
  root: {
    doc: 'Project root',
    format: String,
    default: path.resolve(dirname, '../..')
  },
  assetPath: {
    doc: 'Asset path',
    format: String,
    default: '/public',
    env: 'ASSET_PATH'
  },
  isProduction: {
    doc: 'If this application running in the production environment',
    format: Boolean,
    default: isProduction
  },
  isDevelopment: {
    doc: 'If this application running in the development environment',
    format: Boolean,
    default: isDevelopment
  },
  isTest: {
    doc: 'If this application running in the test environment',
    format: Boolean,
    default: isTest
  },
  log: {
    enabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: process.env.NODE_ENV !== 'test',
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in.',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : []
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isSecureContextEnabled: {
    doc: 'Enable Secure Context',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_SECURE_CONTEXT'
  },
  isMetricsEnabled: {
    doc: 'Enable metrics reporting',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_METRICS'
  },
  session: {
    cache: {
      engine: {
        doc: 'backend cache is written to',
        format: ['redis', 'memory'],
        default: isProduction ? 'redis' : 'memory',
        env: 'SESSION_CACHE_ENGINE'
      },
      name: {
        doc: 'server side session cache name',
        format: String,
        default: 'session',
        env: 'SESSION_CACHE_NAME'
      },
      ttl: {
        doc: 'server side session cache ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_CACHE_TTL'
      }
    },
    cookie: {
      ttl: {
        doc: 'Session cookie ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_COOKIE_TTL'
      },
      password: {
        doc: 'session cookie password',
        format: String,
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'SESSION_COOKIE_PASSWORD',
        sensitive: true
      },
      secure: {
        doc: 'set secure flag on cookie',
        format: Boolean,
        default: isProduction,
        env: 'SESSION_COOKIE_SECURE'
      }
    }
  },
  redis: {
    host: {
      doc: 'Redis cache host',
      format: String,
      default: '127.0.0.1',
      env: 'REDIS_HOST'
    },
    username: {
      doc: 'Redis cache username',
      format: String,
      default: '',
      env: 'REDIS_USERNAME'
    },
    password: {
      doc: 'Redis cache password',
      format: '*',
      default: '',
      sensitive: true,
      env: 'REDIS_PASSWORD'
    },
    keyPrefix: {
      doc: 'Redis cache key prefix name used to isolate the cached results across multiple clients',
      format: String,
      default: 'cdp-node-frontend-template:',
      env: 'REDIS_KEY_PREFIX'
    },
    useSingleInstanceCache: {
      doc: 'Connect to a single instance of redis instead of a cluster.',
      format: Boolean,
      default: !isProduction,
      env: 'USE_SINGLE_INSTANCE_CACHE'
    },
    useTLS: {
      doc: 'Connect to redis using TLS',
      format: Boolean,
      default: isProduction,
      env: 'REDIS_TLS'
    }
  },
  nunjucks: {
    watch: {
      doc: 'Reload templates when they are changed.',
      format: Boolean,
      default: isDevelopment
    },
    noCache: {
      doc: 'Use a cache and recompile templates each time',
      format: Boolean,
      default: isDevelopment
    }
  },
  tracing: {
    header: {
      doc: 'Which header to track',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  cdpUploader: {
    baseUrl: {
      doc: 'CDP-Uploader service base URL',
      format: 'url',
      default: 'https://cdp-uploader-frontend.cdp-int.defra.cloud',
      env: 'CDP_UPLOADER_URL'
    },
    submissionUrl: {
      doc: 'Submission service URL for callbacks',
      format: 'url',
      default: 'https://apha-sdo-frontend.cdp-int.defra.cloud',
      env: 'SUBMISSION_URL'
    },
    callbackAuthToken: {
      doc: 'Authentication token for callback requests',
      format: String,
      default: '',
      env: 'CALLBACK_AUTH_TOKEN',
      sensitive: true
    },
    bucketName: {
      doc: 'Azure storage bucket name for uploads',
      format: String,
      default: 'apha-sdo-uploads',
      env: 'CDP_UPLOADER_BUCKET'
    },
    stagingPrefix: {
      doc: 'Staging path prefix for uploaded files',
      format: String,
      default: 'staging/',
      env: 'CDP_UPLOADER_STAGING_PREFIX'
    },
    maxFileSize: {
      doc: 'Maximum file size in bytes',
      format: Number,
      default: 25 * 1024 * 1024, // 25MB
      env: 'CDP_UPLOADER_MAX_FILE_SIZE'
    },
    timeout: {
      doc: 'Request timeout in milliseconds',
      format: Number,
      default: 30000,
      env: 'CDP_UPLOADER_TIMEOUT'
    },
    retryAttempts: {
      doc: 'Number of retry attempts for failed requests',
      format: Number,
      default: 3,
      env: 'CDP_UPLOADER_RETRY_ATTEMPTS'
    }
  },
  azureStorage: {
    enabled: {
      doc: 'Enable Azure Storage integration',
      format: Boolean,
      default: isProduction,
      env: 'AZURE_STORAGE_ENABLED'
    },
    connectionString: {
      doc: 'Azure Storage connection string',
      format: String,
      default: '',
      env: 'AZURE_STORAGE_CONNECTION_STRING',
      sensitive: true
    },
    accountName: {
      doc: 'Azure Storage account name',
      format: String,
      default: '',
      env: 'AZURE_STORAGE_ACCOUNT_NAME'
    },
    accountKey: {
      doc: 'Azure Storage account key',
      format: String,
      default: '',
      env: 'AZURE_STORAGE_ACCOUNT_KEY',
      sensitive: true
    },
    tenantId: {
      doc: 'Azure AD Tenant ID for Service Principal authentication',
      format: String,
      default: '',
      env: 'AZURE_TENANT_ID'
    },
    clientId: {
      doc: 'Azure AD Client ID for Service Principal authentication',
      format: String,
      default: '',
      env: 'AZURE_CLIENT_ID'
    },
    clientSecret: {
      doc: 'Azure AD Client Secret for Service Principal authentication',
      format: String,
      default: '',
      env: 'AZURE_CLIENT_SECRET',
      sensitive: true
    },
    containerName: {
      doc: 'Default Azure Blob container name',
      format: String,
      default: 'apha-sdo-uploads',
      env: 'AZURE_STORAGE_CONTAINER_NAME'
    },
    enableBackgroundProcessing: {
      doc: 'Enable background processing of uploads to Azure',
      format: Boolean,
      default: true,
      env: 'AZURE_STORAGE_BACKGROUND_PROCESSING'
    },
    processingTimeout: {
      doc: 'Timeout for Azure upload processing in milliseconds',
      format: Number,
      default: 300000, // 5 minutes
      env: 'AZURE_STORAGE_PROCESSING_TIMEOUT'
    }
  }
})

config.validate({ allowed: 'strict' })
