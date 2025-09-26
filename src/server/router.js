import inert from '@hapi/inert'

import { home } from './home/index.js'
import { contact } from './contact/index.js'
import { health } from './health/index.js'
import { oidcSignin } from './oidc-signin/index.js'
import { portal } from './portal/index.js'
import { signout } from './signout/index.js'
import { management } from './management/index.js'
import { uploadPlugin } from './upload/index.js'
import { serveStaticFiles } from './common/helpers/serve-static-files.js'

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // Application specific routes, add your own routes here
      await server.register([
        home,
        contact,
        oidcSignin,
        portal,
        signout,
        management,
        uploadPlugin
      ])

      // Static assets
      await server.register([serveStaticFiles])
    }
  }
}
