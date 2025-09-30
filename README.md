# APHA Surveillance Data Submission Portal

A Node.js web application for the Animal and Plant Health Agency (APHA) surveillance data submission system. Built on DEFRA's Core Delivery Platform (CDP) frontend template v1.8.0.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

The APHA Surveillance Data Submission Portal provides a secure web interface for submitting surveillance data. The application is built using:

- **Framework**: Hapi.js v21.4.0
- **Template Engine**: Nunjucks v3.2.4
- **Session Management**: Redis/Memory-based caching via Catbox
- **File Storage**: Azure Blob Storage, AWS S3, or CDP Uploader
- **Styling**: GOV.UK Frontend v5.10.2

## Key Features

- **Secure File Upload**: Support for Excel (.xlsx, .xls) and CSV, up to 50MB
- **Multi-Storage Backend**: Flexible storage with Azure Blob, AWS S3, or CDP Uploader
- **Forms Engine Integration**: Dynamic form rendering using @defra/forms-engine-plugin
- **Session Management**: Redis-backed sessions in production, memory cache for development
- **Security**: CSRF protection with Crumb, secure cookie handling, environment-based security contexts
- **Observability**: Distributed tracing, structured logging (ECS format), and metrics reporting
- **GOV.UK Design System**: Fully compliant with GOV.UK design patterns

## Architecture

### High-Level Structure

```
├── src/
│   ├── client/           # Frontend assets (SCSS, JS)
│   ├── config/           # Application configuration
│   │   ├── config.js     # Main configuration using Convict
│   │   ├── upload-config.js  # File upload validation
│   │   └── nunjucks/     # Template engine setup
│   ├── server/
│   │   ├── common/       # Shared utilities, helpers, logging
│   │   ├── forms/        # Dynamic form definitions
│   │   ├── upload/       # File upload handlers
│   │   ├── services/     # Business logic and external integrations
│   │   ├── home/         # Home page routes
│   │   ├── portal/       # Main portal routes
│   │   ├── contact/      # Contact page
│   │   ├── health/       # Health check endpoints
│   │   ├── oidc-signin/  # Authentication flow
│   │   └── router.js     # Route definitions
│   └── index.js          # Application entry point
├── tests/                # Test files
├── compose/              # Docker Compose configurations
└── webpack.config.js     # Frontend build configuration
```

### Technology Stack

| Layer          | Technology                       |
| -------------- | -------------------------------- |
| **Runtime**    | Node.js ≥22.16.0                 |
| **Framework**  | Hapi.js 21.4.0                   |
| **Templating** | Nunjucks 3.2.4                   |
| **Styling**    | SASS, GOV.UK Frontend 5.10.2     |
| **Build**      | Webpack 5.99.9                   |
| **Testing**    | Vitest 3.2.4                     |
| **Session**    | Catbox (Redis/Memory)            |
| **Storage**    | Azure Blob, AWS S3, CDP Uploader |
| **Logging**    | Pino with ECS format             |
| **Proxy**      | Undici with ProxyAgent           |

## Prerequisites

### Required

- **Node.js** ≥ v22.16.0
- **npm** ≥ v9.0.0
- **Docker** (technically this is optional, but if using Docker, you can upload files to Azure as the callback works)

### Recommended

- **nvm** (Node Version Manager) for easy Node.js version switching
- **Redis** (for production-like session caching locally)

### Installation

```bash
# Install Node.js version manager (if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Use the correct Node.js version
cd apha-sdo-frontend
nvm install
nvm use
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your local configuration (see [Configuration](#configuration)).

### 3. Start Development Server

```bash
npm run dev
```

The application will be available at **http://localhost:3000**

### 4. Build for Production

```bash
npm run build:frontend
npm start
```

## Configuration

Configuration is managed via environment variables using Convict. See `src/config/config.js` for all options.

### Essential Environment Variables

| Variable                       | Description                        | Default (Dev)      |
| ------------------------------ | ---------------------------------- | ------------------ |
| `NODE_ENV`                     | Environment mode                   | `development`      |
| `PORT`                         | Server port                        | `3000`             |
| `HOST`                         | Server host                        | `0.0.0.0`          |
| `SESSION_CACHE_ENGINE`         | Session backend (`redis`/`memory`) | `memory`           |
| `SESSION_COOKIE_PASSWORD`      | Cookie encryption key (32+ chars)  | (see config)       |
| `REDIS_HOST`                   | Redis hostname                     | `127.0.0.1`        |
| `REDIS_PASSWORD`               | Redis password                     | -                  |
| `AZURE_STORAGE_ACCOUNT_NAME`   | Azure storage account              | -                  |
| `AZURE_STORAGE_CONTAINER_NAME` | Azure blob container               | `uploads`          |
| `AWS_ACCESS_KEY_ID`            | AWS access key                     | -                  |
| `AWS_SECRET_ACCESS_KEY`        | AWS secret key                     | -                  |
| `S3_BUCKET_NAME`               | S3 bucket name                     | `apha-sdo-uploads` |
| `CDP_UPLOADER_ENDPOINT`        | CDP uploader URL                   | -                  |
| `MAX_FILE_SIZE`                | Max upload size (bytes)            | `52428800` (50MB)  |

### Server-Side Caching

The application uses **Catbox** for session caching:

- **Production**: Uses `CatboxRedis` (shared across instances)
- **Development**: Uses `CatboxMemory` (single instance only)

Override with `SESSION_CACHE_ENGINE=redis` or `SESSION_CACHE_ENGINE=memory`.

⚠️ **Warning**: `CatboxMemory` is **NOT** suitable for production as sessions are not shared between instances.

## Development

### Available Scripts

View all scripts:

```bash
npm run
```

#### Common Commands

| Command                   | Description                              |
| ------------------------- | ---------------------------------------- |
| `npm run dev`             | Start development server with hot reload |
| `npm run dev:debug`       | Start with Node.js debugger attached     |
| `npm start`               | Run production build                     |
| `npm test`                | Run test suite with coverage             |
| `npm run test:watch`      | Run tests in watch mode                  |
| `npm run lint`            | Lint JavaScript and SCSS                 |
| `npm run lint:js:fix`     | Auto-fix linting issues                  |
| `npm run format`          | Format code with Prettier                |
| `npm run format:check`    | Check code formatting                    |
| `npm run build:frontend`  | Build frontend assets                    |
| `npm run config:validate` | Validate upload configuration            |

### Code Style

- **Linting**: ESLint with Neostandard config
- **Styling**: Stylelint with GDS config
- **Formatting**: Prettier with custom rules

#### Windows Prettier Issue

If you experience line break formatting issues on Windows:

```bash
git config --global core.autocrlf false
```

### Updating Dependencies

Use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

```bash
ncu --interactive --format group
```

## Testing

### Test Framework

- **Test Runner**: Vitest 3.2.4
- **Coverage**: V8 coverage provider
- **Mocking**: vitest-fetch-mock for HTTP requests
- **DOM Testing**: Cheerio for HTML parsing

### Running Tests

```bash
# Run all tests with coverage
npm test

# Watch mode for TDD
npm run test:watch

# Coverage report location
open coverage/index.html
```

### Writing Tests

Example test structure:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'

describe('MyComponent', () => {
  beforeEach(() => {
    // Setup
  })

  it('should do something', () => {
    // Test implementation
    expect(result).toBe(expected)
  })
})
```

## Deployment

### Docker

### Docker Compose

Local environment with all dependencies:

```bash
docker compose up --build -d
```

Includes:

- Redis (session storage)
- LocalStack (AWS S3/SQS emulation)
- This frontend application

### CDP Platform Deployment

The application is designed for DEFRA's Core Delivery Platform:

1. **Service Version**: Injected via `SERVICE_VERSION` env var
2. **Health Checks**: Available at `/health`
3. **Metrics**: Enabled in production via `ENABLE_METRICS`
4. **Tracing**: Uses `x-cdp-request-id` header
5. **Logging**: Structured ECS format for centralized logging

## API Documentation

### Endpoints

#### Public Endpoints

| Method | Path       | Description              |
| ------ | ---------- | ------------------------ |
| `GET`  | `/`        | Home page                |
| `GET`  | `/health`  | Health check endpoint    |
| `GET`  | `/contact` | Contact information page |

#### Authenticated Endpoints

| Method | Path             | Description            |
| ------ | ---------------- | ---------------------- |
| `GET`  | `/portal`        | Main portal dashboard  |
| `GET`  | `/upload`        | File upload form       |
| `POST` | `/upload`        | Process file upload    |
| `GET`  | `/forms/:formId` | Dynamic form rendering |
| `POST` | `/forms/:formId` | Form submission        |

### Health Check Response

```json
{
  "status": "ok",
  "timestamp": "2025-09-30T12:00:00.000Z",
  "version": "0.15.0"
}
```

### Debug Mode

Run with debugger attached:

```bash
npm run dev:debug
```

Then connect with Chrome DevTools or VS Code debugger at `localhost:9229`.

### Logs

Development logs are pretty-printed with `pino-pretty`:

```bash
npm run dev | grep ERROR
```

Production logs use ECS format for structured logging.

## Contributing

### Git Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass and code is formatted
4. Submit a pull request

### Pre-commit Hooks

Husky automatically runs:

- Code formatting checks
- Linting
- Tests

### Dependabot

Dependabot is configured to automatically check for dependency updates. Enable by renaming:

```bash
mv .github/example.dependabot.yml .github/dependabot.yml
```

### SonarCloud

Quality metrics are tracked via SonarCloud. Configuration is in `sonar-project.properties`.

## Additional Documentation

- [CDP Template Documentation](https://github.com/DEFRA/cdp-node-frontend-template) - Upstream template docs

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
