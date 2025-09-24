import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { bootstrap } from 'global-agent'
import { createLogger } from '../logging/logger.js'
import { config } from '../../../../config/config.js'
const logger = createLogger()

/**
 * If HTTP_PROXY is set setupProxy() will enable it globally
 * for a number of http clients.
 * Node Fetch will still need to pass a ProxyAgent in on each call.
 */
export function setupProxy() {
  const proxyUrl = config.get('httpProxy')

  if (proxyUrl) {
    logger.info('setting up global proxies')

    const noProxy = process.env.NO_PROXY || ''
    // Include all CDP domains and subdomains
    const cdpDomains =
      '.cdp-int.defra.cloud,cdp-uploader.ext-test.cdp-int.defra.cloud'
    const updatedNoProxy = noProxy ? `${noProxy},${cdpDomains}` : cdpDomains

    process.env.NO_PROXY = updatedNoProxy

    logger.info(`Proxy bypass configured for: ${updatedNoProxy}`)

    // Undici proxy with NO_PROXY support
    setGlobalDispatcher(
      new ProxyAgent({
        uri: proxyUrl
      })
    )

    // global-agent (axios/request/and others)
    bootstrap()
    global.GLOBAL_AGENT.HTTP_PROXY = proxyUrl
    global.GLOBAL_AGENT.NO_PROXY = updatedNoProxy
  }
}
