#!/usr/bin/env node

/**
 * Simple HTTP server to view OpenAPI documentation
 * Usage: node docs/view-api-docs.js
 * Then open: http://localhost:1234
 */

import { createServer } from 'http'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 1234
const openapiPath = join(__dirname, 'openapi.yaml')

const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>APHA SDO API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body {
      margin: 0;
      padding: 0;
    }
    .topbar {
      display: none;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: 'BaseLayout',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>
`

const server = createServer((req, res) => {
  const url = req.url

  try {
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(swaggerHtml)
    } else if (url === '/openapi.yaml') {
      const content = readFileSync(openapiPath, 'utf8')
      res.writeHead(200, {
        'Content-Type': 'text/yaml',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(content)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    }
  } catch (error) {
    console.error('Error:', error.message)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')
  }
})

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║  APHA Surveillance Data Submission Portal API Docs        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  Server running at: http://localhost:${PORT}                  ║`
  )
  console.log('║                                                            ║')
  console.log('║  Open your browser to view interactive API documentation   ║')
  console.log('║                                                            ║')
  console.log('║  Press Ctrl+C to stop                                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
})
