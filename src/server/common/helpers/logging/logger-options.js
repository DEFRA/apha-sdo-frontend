import { ecsFormat } from '@elastic/ecs-pino-format'
import { getTraceId } from '@defra/hapi-tracing'

import { config } from '../../../../config/config.js'

const logConfig = config.get('log') || {
  enabled: true,
  level: 'info',
  format: 'pino-pretty',
  redact: []
}
const serviceName = config.get('serviceName') || 'cdp-node-frontend'
const serviceVersion = config.get('serviceVersion') || '0.0.0'

const formatters = {
  ecs: {
    ...ecsFormat({
      serviceVersion,
      serviceName
    })
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

export const loggerOptions = {
  enabled: logConfig?.enabled ?? true,
  ignorePaths: ['/health'],
  redact: {
    paths: logConfig?.redact || [],
    remove: true
  },
  level: logConfig?.level || 'info',
  ...formatters[logConfig?.format || 'pino-pretty'],
  nesting: true,
  mixin() {
    const mixinValues = {}
    const traceId = getTraceId()
    if (traceId) {
      mixinValues.trace = { id: traceId }
    }
    return mixinValues
  }
}
