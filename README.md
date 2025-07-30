# Service Monitor

A containerized web application for monitoring the health and availability of multiple services on your server.

## Features

- **Real-time Monitoring**: Checks service health every 30 seconds
- **Web Dashboard**: Beautiful, responsive interface to view service status
- **HTTP Health Checks**: Monitors HTTP/HTTPS endpoints
- **Response Time Tracking**: Measures and displays response times
- **Status Code Monitoring**: Tracks HTTP status codes
- **Error Reporting**: Shows detailed error messages for failed checks
- **Service Management**: Add/remove services through the web interface
- **Containerized**: Runs in Docker for easy deployment
- **Persistent Configuration**: Service configurations are saved to disk
- **Notifications**: Send alerts via email, Microsoft Teams, or SMS when service status changes
- **Uptime Tracking**: Calculates and displays service uptime percentages
- **History Logging**: Maintains a 90-day history of service status changes
- **Automatic Cleanup**: Automatically trims history files to retain only the last 90 days of data
- **Credential Encryption**: Automatically encrypts sensitive notification credentials for security

## Quick Start

### Prerequisites

- Docker and Docker Compose (recommended)
- Node.js (if running without Docker)

### Option 1: Using Docker Compose (Recommended)

1. Build and run the application:
```bash
docker-compose up --build -d
```

2. Access the dashboard at `http://localhost:3000`

### Option 2: Using Docker directly

1. Build the image:
```bash
docker build -t service-monitor .
```

2. Run the container:
```bash
docker run -d \
  --name service-monitor \
  -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  service-monitor
```

### Option 3: Running without Docker

1. Install dependencies:
```bash
npm install
```

2. Start the application:
```bash
npm start
```

3. Access the dashboard at `http://localhost:3000`

## Usage

### Adding Services

1. Click "Add Service" in the dashboard
2. Fill in the service details:
   - **Service Name**: A friendly name for your service
   - **Service URL**: The full URL to monitor (e.g., `https://example.com`)
   - **Timeout**: Maximum time to wait for a response (in milliseconds)
   - **Expected Status Code**: The HTTP status code that indicates success
3. Click "Add Service"

### Monitoring Services

- Services are automatically checked every 30 seconds
- Click "Check Now" to perform an immediate check
- Green status indicates the service is healthy
- Red status indicates the service is down or not responding correctly
- Uptime percentage is displayed for each service

### Viewing Service History

1. Click the "History" button on any service card
2. View the 90-day history of status changes for that service
3. See detailed information including status codes, response times, and error messages
4. Uptime percentage for the service is displayed at the top of the history view

### Configuring Notifications

1. Click the "Notifications" button in the dashboard
2. Configure one or more notification methods:
   - **Email**: Configure SMTP settings to send email notifications
   - **Microsoft Teams**: Add a webhook URL to send notifications to a Teams channel
   - **SMS**: Configure Twilio credentials to send SMS notifications
3. Enable the notification methods you want to use
4. Save your settings
5. Optionally test each notification method to verify it's working correctly

### Security

All sensitive notification credentials (SMTP password, Twilio Account SID, and Twilio Auth Token) are automatically encrypted before being stored on disk. The encryption key is randomly generated at application startup and is not stored persistently. This ensures that even if someone gains access to the configuration files, they won't be able to see your credentials.

Note: In a production environment, you would want to implement a more robust key management system that persists the encryption key securely.

### Notification Triggers

Notifications are sent when a service's status changes (from up to down or from down to up). This helps avoid notification spam while ensuring you're alerted to important status changes.

## API Endpoints

### GET /api/services
Returns the current status of all monitored services, including uptime percentages.

### GET /api/services/check
Performs an immediate check of all services and returns the results.

### POST /api/services
Adds a new service to monitor.

### DELETE /api/services/:name
Removes a service from monitoring.

### GET /api/services/:name/history
Returns the 90-day history of status changes for a specific service, including uptime percentage.

### GET /api/notifications
Returns the current notification settings (with sensitive data masked).

### PUT /api/notifications
Updates the notification settings.

### POST /api/notifications/test/email
Sends a test email notification.

### POST /api/notifications/test/teams
Sends a test Microsoft Teams notification.

### POST /api/notifications/test/sms
Sends a test SMS notification.

## Configuration

### Services Configuration

Services are stored in `config/services.json`. The application will create this file automatically when you add services through the web interface.

Example configuration:
```json
[
  {
    "name": "My Web App",
    "url": "https://myapp.example.com",
    "timeout": 5000,
    "expectedStatus": 200
  }
]
```

### Notifications Configuration

Notification settings are stored in `config/notifications.json`. The application will create this file with default values when first run. Sensitive data is encrypted before storage.

Example configuration (with encrypted values):
```json
{
  "email": {
    "enabled": true,
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false,
      "requireTLS": true,
      "auth": {
        "user": "your-email@gmail.com",
        "pass": "17c4520f685a19d786f020010a1fc1a9:..."
      }
    },
    "from": "your-email@gmail.com",
    "to": "recipient@example.com"
  },
  "teams": {
    "enabled": true,
    "webhookUrl": "https://outlook.office.com/webhook/..."
  },
  "sms": {
    "enabled": true,
    "accountSid": "17c4520f685a19d786f020010a1fc1a9:...",
    "authToken": "17c4520f685a19d786f020010a1fc1a9:...",
    "from": "+1234567890",
    "to": "+0987654321"
  }
}
```

### History Data

Service history is stored in individual JSON files in the `config/history` directory. Each file is named after the service it tracks (e.g., `My Web App.json`). History files are automatically trimmed to retain only the last 90 days of data.

## Customization

You can extend this application with additional features:
- Database support
- User authentication
- More check types (TCP, ping, etc.)
- Additional notification integrations
- Grafana/Prometheus metrics export
- Mobile app support

## License

This project is released under the MIT License.