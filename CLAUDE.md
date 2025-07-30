# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Running the Application
- `npm start` - Start the application using Node.js
- `npm run dev` - Start in development mode with nodemon for auto-restart
- `docker-compose up --build -d` - Build and run using Docker Compose (recommended)
- `docker build -t service-monitor .` - Build Docker image manually

### Testing Deployments
- Access the dashboard at `http://localhost:3000`
- Use the API endpoints at `/api/services`, `/api/notifications`, etc.

## Architecture Overview

### Core Application Structure
- **app.js**: Main Express server with all API routes, service monitoring logic, and notification system
- **public/index.html**: Single-page web dashboard with embedded JavaScript for UI
- **config/**: Directory for persistent configuration and data
  - `services.json`: Service definitions (URL, timeout, expected status)
  - `notifications.json`: Notification settings (email, Teams, SMS) with encrypted credentials
  - `history/`: JSON files containing 90-day status history per service
  - `application.log`: Application logging output

### Key Components

**Service Monitor Engine** (`app.js:675-788`):
- Checks all services every 30 seconds using axios HTTP requests
- Stores results in memory (`serviceStatuses`, `serviceHistories`) and persists to JSON files
- Compares current vs previous status to trigger notifications only on status changes

**Notification System** (`app.js:352-672`):
- Supports email (nodemailer), Microsoft Teams (webhooks), and SMS (Twilio)
- Automatically encrypts sensitive credentials (passwords, tokens) using AES-256-CBC
- Only sends notifications when service status changes (up ↔ down)

**Configuration Management**:
- All configuration stored as JSON files in `config/` directory
- Automatic encryption/decryption of sensitive notification credentials
- History files automatically trimmed to 90 days
- Docker volume mounts `./config:/app/config` for persistence

### API Architecture
RESTful endpoints in `app.js:790-1126`:
- `GET /api/services` - Current status of all services with uptime percentages
- `POST /api/services` - Add new service (validates uniqueness, immediately checks)
- `DELETE /api/services/:name` - Remove service and its history
- `GET /api/services/:name/history` - 90-day history for specific service
- `PUT /api/notifications` - Update notification settings
- `POST /api/notifications/test/*` - Test notification methods

### Data Flow
1. **Initialization**: Load services and notification config from JSON files
2. **Monitoring Loop**: Every 30 seconds, check all services in parallel
3. **Status Processing**: Compare results with previous status, update history
4. **Notifications**: Send alerts only for status changes via configured methods
5. **Persistence**: Save updated history and configurations back to JSON files

### Security Features
- Credential encryption using randomly generated keys at startup
- Non-root Docker user (nextjs:1001)
- Input validation on API endpoints
- Sensitive data masking in logs and API responses

### Dependencies
- **express**: Web server and API framework
- **axios**: HTTP client for service health checks  
- **nodemailer**: Email notifications via SMTP
- **twilio**: SMS notifications
- **moment**: Date/time handling for history management
- **crypto**: Built-in encryption for sensitive credentials