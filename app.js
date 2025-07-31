const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');
const moment = require('moment');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_DIR = path.join(__dirname, 'config');
const SERVICES_FILE = path.join(CONFIG_DIR, 'services.json');
const NOTIFICATIONS_FILE = path.join(CONFIG_DIR, 'notifications.json');
const HISTORY_DIR = path.join(CONFIG_DIR, 'history');
const LOG_FILE = path.join(CONFIG_DIR, 'application.log');

// Encryption setup
const ENCRYPTION_KEY = crypto.randomBytes(32); // In production, this should be stored securely
const IV_LENGTH = 16; // For AES, this is always 16

// Middleware
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for service statuses and history
let serviceStatuses = {};
let serviceHistories = {};

// Custom logger that writes to both console and file
class Logger {
  constructor(logFile) {
    this.logFile = logFile;
  }
  
  async writeLog(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level}: ${message}\n`;
    
    // Write to console
    console.log(`[${timestamp}] ${level}: ${message}`);
    
    // Write to file
    try {
      await fs.appendFile(this.logFile, logEntry);
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }
  
  info(message) {
    return this.writeLog(message, 'INFO');
  }
  
  error(message) {
    return this.writeLog(message, 'ERROR');
  }
  
  warn(message) {
    return this.writeLog(message, 'WARN');
  }
  
  debug(message) {
    return this.writeLog(message, 'DEBUG');
  }
}

const logger = new Logger(LOG_FILE);

// Log service statuses periodically for debugging
setInterval(() => {
  logger.info('=== CURRENT SERVICE STATUSES ===');
  for (const [name, status] of Object.entries(serviceStatuses)) {
    logger.info(`${name}: ${status.status} (last checked: ${status.lastChecked})`);
  }
  logger.info('=================================');
}, 60000); // Every minute

// Ensure config directory exists
async function ensureConfigDir() {
  try {
    await fs.access(CONFIG_DIR);
  } catch (err) {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  }
  
  // Ensure history directory exists
  try {
    await fs.access(HISTORY_DIR);
  } catch (err) {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
  }
}

// Encryption functions
function encrypt(text) {
  if (!text) return text;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Load services from file
async function loadServices() {
  try {
    await fs.access(SERVICES_FILE);
    const data = await fs.readFile(SERVICES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // Return empty array if file doesn't exist
    return [];
  }
}

// Save services to file
async function saveServices(services) {
  await ensureConfigDir();
  await fs.writeFile(SERVICES_FILE, JSON.stringify(services, null, 2));
}

// Load notification settings
async function loadNotifications() {
  try {
    await fs.access(NOTIFICATIONS_FILE);
    const data = await fs.readFile(NOTIFICATIONS_FILE, 'utf8');
    const notifications = JSON.parse(data);
    
    // Decrypt sensitive fields
    if (notifications.email?.smtp?.auth?.pass) {
      notifications.email.smtp.auth.pass = decrypt(notifications.email.smtp.auth.pass);
    }
    
    if (notifications.sms?.accountSid) {
      notifications.sms.accountSid = decrypt(notifications.sms.accountSid);
    }
    
    if (notifications.sms?.authToken) {
      notifications.sms.authToken = decrypt(notifications.sms.authToken);
    }
    
    return notifications;
  } catch (err) {
    // Return default configuration if file doesn't exist
    return {
      email: {
        enabled: false,
        smtp: {
          host: '',
          port: 587,
          secure: false,
          requireTLS: true,
          auth: {
            user: '',
            pass: ''
          }
        },
        from: '',
        to: ''
      },
      teams: {
        enabled: false,
        webhookUrl: ''
      },
      sms: {
        enabled: false,
        accountSid: '',
        authToken: '',
        from: '',
        to: ''
      },
      iphone: {
        enabled: false,
        webhookUrl: '',
        description: 'iPhone Shortcuts webhook for SMS forwarding'
      }
    };
  }
}

// Save notification settings
async function saveNotifications(notifications) {
  await ensureConfigDir();
  
  // Create a copy to avoid modifying the original
  const notificationsToSave = JSON.parse(JSON.stringify(notifications));
  
  // Encrypt sensitive fields
  if (notificationsToSave.email?.smtp?.auth?.pass) {
    notificationsToSave.email.smtp.auth.pass = encrypt(notificationsToSave.email.smtp.auth.pass);
  }
  
  if (notificationsToSave.sms?.accountSid) {
    notificationsToSave.sms.accountSid = encrypt(notificationsToSave.sms.accountSid);
  }
  
  if (notificationsToSave.sms?.authToken) {
    notificationsToSave.sms.authToken = encrypt(notificationsToSave.sms.authToken);
  }
  
  await fs.writeFile(NOTIFICATIONS_FILE, JSON.stringify(notificationsToSave, null, 2));
}

// Initialize notification transports
async function initializeNotifications() {
  const notifications = await loadNotifications();
  logger.debug(`Loaded notifications config: ${JSON.stringify({
    ...notifications,
    email: {
      ...notifications.email,
      smtp: {
        ...notifications.email.smtp,
        auth: {
          ...notifications.email.smtp.auth,
          pass: notifications.email.smtp.auth.pass ? '***' : ''
        }
      }
    },
    sms: {
      ...notifications.sms,
      accountSid: notifications.sms.accountSid ? '***' : '',
      authToken: notifications.sms.authToken ? '***' : ''
    }
  })}`);
  
  // Initialize email transporter
  if (notifications.email.enabled && 
      notifications.email.smtp.host && 
      notifications.email.smtp.auth.user && 
      notifications.email.smtp.auth.pass) {
    logger.info('Initializing email transporter with settings: ' + JSON.stringify({
      host: notifications.email.smtp.host,
      port: notifications.email.smtp.port,
      secure: notifications.email.smtp.secure,
      requireTLS: notifications.email.smtp.requireTLS,
      authUser: notifications.email.smtp.auth.user ? '***' : 'NOT SET'
    }));
    
    transporter = nodemailer.createTransport({
      host: notifications.email.smtp.host,
      port: notifications.email.smtp.port,
      secure: notifications.email.smtp.secure,
      requireTLS: notifications.email.smtp.requireTLS,
      auth: {
        user: notifications.email.smtp.auth.user,
        pass: notifications.email.smtp.auth.pass
      }
    });
    
    // Log transporter configuration (mask sensitive data)
    logger.debug(`Transporter created with options: ${JSON.stringify({
      ...transporter.options,
      auth: {
        ...transporter.options.auth,
        pass: transporter.options.auth?.pass ? '***' : ''
      }
    })}`);
    
    // Verify the transporter configuration
    try {
      await transporter.verify();
      logger.info('Email transporter verified successfully');
    } catch (error) {
      logger.error('Email transporter verification failed: ' + error.message);
    }
    
    logger.info('Email transporter initialized successfully');
  } else {
    logger.info('Email notifications not fully configured, skipping transporter initialization');
    if (!notifications.email.enabled) {
      logger.info('Email notifications are disabled in config');
    }
    if (!notifications.email.smtp.host) {
      logger.info('SMTP host is not set in config');
    }
    if (!notifications.email.smtp.auth.user) {
      logger.info('SMTP auth user is not set in config');
    }
    if (!notifications.email.smtp.auth.pass) {
      logger.info('SMTP auth password is not set in config');
    }
  }
  
  // Initialize Twilio client
  if (notifications.sms.enabled && 
      notifications.sms.accountSid && 
      notifications.sms.authToken) {
    logger.info('Initializing Twilio client');
    const twilio = require('twilio');
    twilioClient = twilio(
      notifications.sms.accountSid, 
      notifications.sms.authToken
    );
    logger.info('Twilio client initialized successfully');
  } else {
    logger.info('SMS notifications not fully configured, skipping Twilio initialization');
  }
}

// Load service history from file
async function loadServiceHistory(serviceName) {
  const historyFile = path.join(HISTORY_DIR, `${serviceName}.json`);
  try {
    await fs.access(historyFile);
    const data = await fs.readFile(historyFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // Return empty array if file doesn't exist
    return [];
  }
}

// Save service history to file
async function saveServiceHistory(serviceName, history) {
  // Trim history to only include last 90 days
  const ninetyDaysAgo = moment().subtract(90, 'days');
  const trimmedHistory = history.filter(entry => 
    moment(entry.timestamp).isAfter(ninetyDaysAgo)
  );
  
  const historyFile = path.join(HISTORY_DIR, `${serviceName}.json`);
  await ensureConfigDir();
  await fs.writeFile(historyFile, JSON.stringify(trimmedHistory, null, 2));
  return trimmedHistory;
}

// Initialize service histories
async function initializeServiceHistories() {
  const services = await loadServices();
  for (const service of services) {
    serviceHistories[service.name] = await loadServiceHistory(service.name);
  }
}

// Calculate uptime percentage for a service
function calculateUptime(history) {
  if (!history || history.length === 0) return 100;
  
  const upEntries = history.filter(entry => entry.status === 'up');
  return (upEntries.length / history.length) * 100;
}

// Send email notification
async function sendEmailNotification(service, notifications) {
  logger.info(`sendEmailNotification called for service: ${service.name}`);
  
  if (!transporter) {
    logger.warn('Email transporter not initialized');
    return;
  }
  
  // Log transporter state (mask sensitive data)
  logger.debug(`Transporter state: ${JSON.stringify({
    ...transporter.options,
    auth: {
      ...transporter.options.auth,
      pass: transporter.options.auth?.pass ? '***' : ''
    }
  })}`);
  
  try {
    const statusIcon = service.status === 'up' ? '✅' : '❌';
    const statusColor = service.status === 'up' ? '#28a745' : '#dc3545';
    
    logger.info(`Sending email to ${notifications.email.to} about service ${service.name}`);
    logger.debug(`Email configuration: ${JSON.stringify({
      from: notifications.email.from,
      to: notifications.email.to,
      subject: `Service Alert: ${service.name} is ${service.status}`
    })}`);
    
    // Log transporter configuration (mask sensitive data)
    logger.debug(`Transporter configuration: ${JSON.stringify({
      ...transporter.options,
      auth: {
        ...transporter.options.auth,
        pass: transporter.options.auth?.pass ? '***' : ''
      }
    })}`);
    
    const mailOptions = {
      from: notifications.email.from,
      to: notifications.email.to,
      subject: `Service Alert: ${service.name} is ${service.status}`,
      text: `The service "${service.name}" is currently ${service.status}.\n\nURL: ${service.url}\nStatus Code: ${service.statusCode}\nError: ${service.error}\n\nTime: ${service.lastChecked}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Service Alert</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f8f9fa;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 20px auto;
              background-color: #ffffff;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              overflow: hidden;
            }
            .header {
              background-color: #007bff;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .content {
              padding: 30px;
            }
            .status-badge {
              display: inline-block;
              padding: 6px 12px;
              border-radius: 20px;
              font-weight: bold;
              color: white;
              background-color: ${statusColor};
            }
            .service-info {
              background-color: #f8f9fa;
              border-left: 4px solid ${statusColor};
              padding: 15px;
              margin: 20px 0;
            }
            .info-item {
              margin: 10px 0;
            }
            .info-label {
              font-weight: bold;
              color: #495057;
              display: inline-block;
              width: 120px;
            }
            .footer {
              background-color: #e9ecef;
              padding: 15px;
              text-align: center;
              font-size: 0.9em;
              color: #6c757d;
            }
            .icon {
              font-size: 24px;
              vertical-align: middle;
              margin-right: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1><span class="icon">${statusIcon}</span>Service Alert</h1>
            </div>
            <div class="content">
              <h2>${service.name} is ${service.status}</h2>
              <p>The monitoring system has detected a change in the status of <strong>${service.name}</strong>.</p>
              
              <div class="service-info">
                <div class="info-item">
                  <span class="info-label">Status:</span>
                  <span class="status-badge">${service.status}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">URL:</span>
                  <a href="${service.url}">${service.url}</a>
                </div>
                <div class="info-item">
                  <span class="info-label">Status Code:</span>
                  <span>${service.statusCode || 'N/A'}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Response Time:</span>
                  <span>${service.responseTime ? service.responseTime + 'ms' : 'N/A'}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Last Checked:</span>
                  <span>${service.lastChecked}</span>
                </div>
                ${service.error ? `
                <div class="info-item">
                  <span class="info-label">Error:</span>
                  <span style="color: #dc3545;">${service.error}</span>
                </div>` : ''}
              </div>
              
              <p>Please investigate this issue as soon as possible.</p>
            </div>
            <div class="footer">
              <p>This alert was generated by the Service Monitor application.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    logger.debug(`Mail options: ${JSON.stringify({
      ...mailOptions,
      // Don't log the actual content for security
    })}`);
    
    const info = await transporter.sendMail(mailOptions);
    
    logger.info(`Email notification sent successfully for service: ${service.name}`);
    logger.debug(`Email send info: ${JSON.stringify({
      messageId: info.messageId,
      recipient: info.accepted?.[0] || 'unknown'
    })}`);
  } catch (error) {
    logger.error('Error sending email notification: ' + error.message);
    logger.error('Error stack: ' + error.stack);
    logger.error('Error details: ' + JSON.stringify({
      code: error.code,
      command: error.command
      // Don't log the full response as it might contain sensitive data
    }, null, 2));
  }
}

// Send Teams webhook notification
async function sendTeamsNotification(service, notifications) {
  if (!notifications.teams.enabled || !notifications.teams.webhookUrl) {
    logger.debug('Teams notifications not enabled or webhook URL not set');
    return;
  }
  
  try {
    const statusColor = service.status === 'up' ? '2DC745' : 'DC3545';
    const statusText = service.status === 'up' ? 'Operational' : 'Degraded';
    
    await axios.post(notifications.teams.webhookUrl, {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": statusColor,
      "summary": `Service Alert: ${service.name}`,
      "sections": [{
        "activityTitle": `Service Alert: ${service.name}`,
        "activitySubtitle": `Status changed to ${service.status}`,
        "facts": [
          {
            "name": "Service",
            "value": service.name
          },
          {
            "name": "URL",
            "value": service.url
          },
          {
            "name": "Status",
            "value": statusText
          },
          {
            "name": "Status Code",
            "value": service.statusCode || 'N/A'
          },
          {
            "name": "Error",
            "value": service.error || 'None'
          },
          {
            "name": "Response Time",
            "value": service.responseTime ? `${service.responseTime}ms` : 'N/A'
          },
          {
            "name": "Time",
            "value": service.lastChecked
          }
        ],
        "markdown": true
      }]
    });
    
    logger.info(`Teams notification sent for service: ${service.name}`);
  } catch (error) {
    logger.error('Error sending Teams notification: ' + error.message);
  }
}

// Send SMS notification via Twilio
async function sendSmsNotification(service, notifications) {
  if (!twilioClient) {
    logger.warn('Twilio client not initialized');
    return;
  }
  
  try {
    const message = `Service Alert: ${service.name} is ${service.status}. URL: ${service.url}. Error: ${service.error || 'None'}`;
    
    const result = await twilioClient.messages.create({
      body: message,
      from: notifications.sms.from,
      to: notifications.sms.to
    });
    
    logger.info(`SMS notification sent for service: ${service.name}, SID: ${result.sid}`);
  } catch (error) {
    logger.error('Error sending SMS notification: ' + error.message);
  }
}

// Send iPhone webhook notification
async function sendIphoneNotification(service, notifications) {
  if (!notifications.iphone.enabled || !notifications.iphone.webhookUrl) {
    logger.debug('iPhone notifications not enabled or webhook URL not set');
    return;
  }
  
  try {
    const payload = {
      title: `Service Monitor Alert`,
      text: `${service.name} is ${service.status.toUpperCase()}${service.error ? `\nError: ${service.error}` : `\nResponse time: ${service.responseTime}ms`}\nURL: ${service.url}`,
      input: {
        service: service.name,
        status: service.status,
        url: service.url,
        error: service.error || null,
        responseTime: service.responseTime,
        timestamp: service.lastChecked
      }
    };
    
    const response = await axios.post(notifications.iphone.webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ServiceMonitor/1.0'
      },
      timeout: 10000
    });
    
    logger.info(`iPhone webhook notification sent for service: ${service.name}, Status: ${response.status}`);
  } catch (error) {
    logger.error('Error sending iPhone webhook notification: ' + error.message);
  }
}

// Send all enabled notifications
async function sendNotifications(service, previousStatus) {
  logger.info(`sendNotifications called for service: ${service.name}`);
  const notifications = await loadNotifications();
  logger.debug(`Loaded notifications config: ${JSON.stringify({
    ...notifications,
    email: {
      ...notifications.email,
      smtp: {
        ...notifications.email.smtp,
        auth: {
          ...notifications.email.smtp.auth,
          pass: notifications.email.smtp.auth.pass ? '***' : ''
        }
      }
    },
    sms: {
      ...notifications.sms,
      accountSid: notifications.sms.accountSid ? '***' : '',
      authToken: notifications.sms.authToken ? '***' : ''
    }
  })}`);
  
  // Only send notifications for status changes (up to down or down to up)
  logger.info(`Checking notification for ${service.name}: previous status = ${previousStatus}, current status = ${service.status}`);
  
  if (previousStatus === service.status) {
    logger.info(`No status change for ${service.name}, not sending notifications`);
    return; // No status change, don't send notifications
  }
  
  logger.info(`Status changed for ${service.name} from ${previousStatus} to ${service.status}, sending notifications`);
  
  // Send email notification
  if (notifications.email.enabled) {
    logger.info(`Email notifications enabled, attempting to send email notification for ${service.name}`);
    await sendEmailNotification(service, notifications);
  } else {
    logger.info(`Email notifications disabled, skipping email notification for ${service.name}`);
  }
  
  // Send Teams notification
  if (notifications.teams.enabled) {
    logger.info(`Teams notifications enabled, attempting to send Teams notification for ${service.name}`);
    await sendTeamsNotification(service, notifications);
  } else {
    logger.info(`Teams notifications disabled, skipping Teams notification for ${service.name}`);
  }
  
  // Send SMS notification
  if (notifications.sms.enabled) {
    logger.info(`SMS notifications enabled, attempting to send SMS notification for ${service.name}`);
    await sendSmsNotification(service, notifications);
  } else {
    logger.info(`SMS notifications disabled, skipping SMS notification for ${service.name}`);
  }
  
  // Send iPhone webhook notification
  if (notifications.iphone.enabled) {
    logger.info(`iPhone notifications enabled, attempting to send iPhone webhook notification for ${service.name}`);
    await sendIphoneNotification(service, notifications);
  } else {
    logger.info(`iPhone notifications disabled, skipping iPhone webhook notification for ${service.name}`);
  }
}

// Check the health of a single service
async function checkService(service) {
  const startTime = Date.now();
  
  try {
    logger.debug(`[CHECK] Checking service: ${service.name} at ${service.url}`);
    const response = await axios.get(service.url, {
      timeout: service.timeout || 5000,
      headers: {
        'User-Agent': 'ServiceMonitor/1.0'
      }
    });
    
    const responseTime = Date.now() - startTime;
    const isHealthy = response.status === (service.expectedStatus || 200);
    
    logger.debug(`[RESULT] Service ${service.name} returned status ${response.status}, expected ${service.expectedStatus || 200}, isHealthy: ${isHealthy}`);
    
    const result = {
      name: service.name,
      url: service.url,
      status: isHealthy ? 'up' : 'down',
      statusCode: response.status,
      responseTime,
      lastChecked: new Date().toISOString(),
      error: isHealthy ? null : `Expected status ${service.expectedStatus || 200}, got ${response.status}`
    };
    
    logger.debug(`[RESULT] Final result for ${service.name}: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.debug(`[ERROR] Service ${service.name} encountered an error: ${error.message}`);
    
    const result = {
      name: service.name,
      url: service.url,
      status: 'down',
      statusCode: error.response?.status || null,
      responseTime,
      lastChecked: new Date().toISOString(),
      error: error.message
    };
    
    logger.debug(`[RESULT] Final error result for ${service.name}: ${JSON.stringify(result)}`);
    return result;
  }
}

// Check all services
async function checkAllServices() {
  logger.info('===== CHECKING ALL SERVICES =====');
  const services = await loadServices();
  logger.info(`[LOAD] Loaded ${services.length} services to check`);
  
  const promises = services.map(service => checkService(service));
  const results = await Promise.all(promises);
  
  logger.info(`[COMPLETE] Completed checking all services, got ${results.length} results`);
  
  // Log all results
  logger.debug('[RESULTS] All check results:');
  results.forEach(result => {
    logger.debug(`  ${result.name}: ${result.status} (${result.statusCode})`);
  });
  
  // Update in-memory status and send notifications for status changes
  logger.info('[UPDATE] Updating service statuses:');
  for (const result of results) {
    const previousEntry = serviceStatuses[result.name];
    const previousStatus = previousEntry ? previousEntry.status : 'unknown';
    
    logger.info(`  ${result.name}: previous=${previousStatus}, current=${result.status}`);
    
    // Add to history
    if (!serviceHistories[result.name]) {
      serviceHistories[result.name] = [];
    }
    
    serviceHistories[result.name].push({
      timestamp: result.lastChecked,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error
    });
    
    // Save history to file (this also trims old entries)
    serviceHistories[result.name] = await saveServiceHistory(result.name, serviceHistories[result.name]);
    
    // Store the new status
    serviceStatuses[result.name] = result;
    
    // Send notifications if status changed
    if (previousStatus !== result.status) {
      logger.info(`  [NOTIFY] Status changed for ${result.name} from ${previousStatus} to ${result.status}`);
      await sendNotifications(result, previousStatus);  // Pass previous status
    } else {
      logger.info(`  [NO NOTIFY] No status change for ${result.name}`);
    }
  }
  
  logger.info('==================================\n');
  return results;
}

// Initial service check and set up interval
async function initialize() {
  await ensureConfigDir();
  await initializeNotifications();
  await initializeServiceHistories();
  await checkAllServices();
  setInterval(checkAllServices, 30000); // Check every 30 seconds
}

// Routes

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoints

// Get all service statuses
app.get('/api/services', async (req, res) => {
  const services = await loadServices();
  const statuses = services.map(service => {
    const status = serviceStatuses[service.name] || {
      name: service.name,
      url: service.url,
      status: 'unknown',
      statusCode: null,
      responseTime: null,
      lastChecked: null,
      error: null
    };
    
    // Add uptime information
    const history = serviceHistories[service.name] || [];
    const uptime = calculateUptime(history);
    
    return {
      ...status,
      uptime: uptime.toFixed(2)
    };
  });
  
  res.json(statuses);
});

// Force check all services
app.get('/api/services/check', async (req, res) => {
  const results = await checkAllServices();
  res.json(results);
});

// Add a new service
app.post('/api/services', async (req, res) => {
  const newService = req.body;
  
  // Validate required fields
  if (!newService.name || !newService.url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }
  
  const services = await loadServices();
  
  // Check if service with same name already exists
  if (services.some(service => service.name === newService.name)) {
    return res.status(400).json({ error: 'A service with this name already exists' });
  }
  
  services.push(newService);
  await saveServices(services);
  
  // Initialize history for the new service
  serviceHistories[newService.name] = [];
  
  // Check the new service immediately
  const result = await checkService(newService);
  
  // Add to history
  serviceHistories[newService.name].push({
    timestamp: result.lastChecked,
    status: result.status,
    statusCode: result.statusCode,
    responseTime: result.responseTime,
    error: result.error
  });
  
  // Save history to file
  await saveServiceHistory(newService.name, serviceHistories[newService.name]);
  
  // Store the status
  serviceStatuses[result.name] = result;
  
  // Add uptime to response
  const history = serviceHistories[newService.name] || [];
  const uptime = calculateUptime(history);
  
  res.status(201).json({
    ...result,
    uptime: uptime.toFixed(2)
  });
});

// Remove a service
app.delete('/api/services/:name', async (req, res) => {
  const serviceName = req.params.name;
  const services = await loadServices();
  const updatedServices = services.filter(service => service.name !== serviceName);
  
  if (services.length === updatedServices.length) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  await saveServices(updatedServices);
  
  // Remove from in-memory status and history
  delete serviceStatuses[serviceName];
  delete serviceHistories[serviceName];
  
  // Remove history file
  const historyFile = path.join(HISTORY_DIR, `${serviceName}.json`);
  try {
    await fs.unlink(historyFile);
  } catch (err) {
    // Ignore if file doesn't exist
  }
  
  res.status(204).send();
});

// Get service history
app.get('/api/services/:name/history', async (req, res) => {
  const serviceName = req.params.name;
  const services = await loadServices();
  
  // Check if service exists
  if (!services.some(service => service.name === serviceName)) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  const history = serviceHistories[serviceName] || [];
  const uptime = calculateUptime(history);
  
  res.json({
    name: serviceName,
    history,
    uptime: uptime.toFixed(2)
  });
});

// Get notification settings (without sensitive data)
app.get('/api/notifications', async (req, res) => {
  const notifications = await loadNotifications();
  
  // Remove sensitive data before sending to client
  const safeNotifications = {
    ...notifications,
    email: {
      ...notifications.email,
      smtp: {
        ...notifications.email.smtp,
        auth: {
          ...notifications.email.smtp.auth,
          pass: notifications.email.smtp.auth.pass ? '***' : ''
        }
      }
    },
    sms: {
      ...notifications.sms,
      accountSid: notifications.sms.accountSid ? '***' : '',
      authToken: notifications.sms.authToken ? '***' : ''
    },
    iphone: {
      ...notifications.iphone
    }
  };
  
  res.json(safeNotifications);
});

// Update notification settings
app.put('/api/notifications', async (req, res) => {
  try {
    const notifications = req.body;
    logger.info('Saving notification settings');
    await saveNotifications(notifications);
    await initializeNotifications(); // Reinitialize transports with new settings
    res.json({ message: 'Notification settings updated successfully' });
  } catch (error) {
    logger.error('Error saving notification settings: ' + error.message);
    res.status(500).json({ error: 'Failed to save notification settings: ' + error.message });
  }
});

// Test email notification
app.post('/api/notifications/test/email', async (req, res) => {
  const notifications = await loadNotifications();
  
  if (!transporter) {
    return res.status(400).json({ error: 'Email notifications are not properly configured' });
  }
  
  try {
    const info = await transporter.sendMail({
      from: notifications.email.from,
      to: notifications.email.to,
      subject: 'Service Monitor - Test Email',
      text: 'This is a test email from the Service Monitor application.',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Service Monitor Test</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f8f9fa;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 20px auto;
              background-color: #ffffff;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              overflow: hidden;
            }
            .header {
              background-color: #28a745;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .content {
              padding: 30px;
            }
            .icon {
              font-size: 48px;
              color: #28a745;
            }
            .footer {
              background-color: #e9ecef;
              padding: 15px;
              text-align: center;
              font-size: 0.9em;
              color: #6c757d;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Service Monitor Test</h1>
            </div>
            <div class="content">
              <div style="text-align: center; margin: 20px 0;">
                <div class="icon">📧</div>
              </div>
              <h2 style="text-align: center;">Test Email Successful</h2>
              <p>This is a test email from the Service Monitor application. If you're receiving this email, your email notifications are properly configured.</p>
              <p>You'll receive alerts like this when your monitored services change status.</p>
            </div>
            <div class="footer">
              <p>This is an automated test message from the Service Monitor application.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    
    logger.info('Test email sent successfully');
    logger.debug('Test email info: ' + JSON.stringify({
      messageId: info.messageId,
      recipient: info.accepted?.[0] || 'unknown'
    }));
    
    res.json({ message: 'Test email sent successfully' });
  } catch (error) {
    logger.error('Error sending test email: ' + error.message);
    logger.error('Error details: ' + JSON.stringify({
      code: error.code,
      command: error.command
      // Don't log the full response as it might contain sensitive data
    }));
    
    res.status(500).json({ error: 'Failed to send test email: ' + error.message });
  }
});

// Test Teams notification
app.post('/api/notifications/test/teams', async (req, res) => {
  const notifications = await loadNotifications();
  
  if (!notifications.teams.enabled || !notifications.teams.webhookUrl) {
    return res.status(400).json({ error: 'Teams notifications are not properly configured' });
  }
  
  try {
    await axios.post(notifications.teams.webhookUrl, {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": "0072C6",
      "summary": "Service Monitor - Test Notification",
      "sections": [{
        "activityTitle": "Service Monitor Test",
        "activitySubtitle": "Test notification from Service Monitor",
        "facts": [
          {
            "name": "Status",
            "value": "Connected"
          },
          {
            "name": "Time",
            "value": new Date().toISOString()
          }
        ],
        "markdown": true
      }]
    });
    
    logger.info('Test Teams notification sent successfully');
    res.json({ message: 'Test Teams notification sent successfully' });
  } catch (error) {
    logger.error('Error sending test Teams notification: ' + error.message);
    res.status(500).json({ error: 'Failed to send test Teams notification: ' + error.message });
  }
});

// Test SMS notification
app.post('/api/notifications/test/sms', async (req, res) => {
  const notifications = await loadNotifications();
  
  if (!twilioClient) {
    return res.status(400).json({ error: 'SMS notifications are not properly configured' });
  }
  
  try {
    const result = await twilioClient.messages.create({
      body: 'This is a test SMS from the Service Monitor application.',
      from: notifications.sms.from,
      to: notifications.sms.to
    });
    
    logger.info('Test SMS sent successfully, SID: ' + result.sid);
    res.json({ message: 'Test SMS sent successfully' });
  } catch (error) {
    logger.error('Error sending test SMS: ' + error.message);
    res.status(500).json({ error: 'Failed to send test SMS: ' + error.message });
  }
});

// Test iPhone webhook notification
app.post('/api/notifications/test/iphone', async (req, res) => {
  const notifications = await loadNotifications();
  
  if (!notifications.iphone.enabled || !notifications.iphone.webhookUrl) {
    return res.status(400).json({ error: 'iPhone notifications are not properly configured' });
  }
  
  try {
    const testPayload = {
      title: 'Service Monitor Test',
      text: 'This is a test notification from your Service Monitor app. If you receive this, the iPhone webhook is working correctly!',
      input: {
        service: 'Test Service',
        status: 'up',
        url: 'https://example.com',
        responseTime: 150,
        timestamp: new Date().toISOString()
      }
    };
    
    const response = await axios.post(notifications.iphone.webhookUrl, testPayload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ServiceMonitor/1.0'
      },
      timeout: 10000
    });
    
    logger.info('Test iPhone webhook sent successfully, Status: ' + response.status);
    res.json({ message: 'Test iPhone webhook sent successfully' });
  } catch (error) {
    logger.error('Error sending test iPhone webhook: ' + error.message);
    res.status(500).json({ error: 'Failed to send test iPhone webhook: ' + error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Service Monitor listening on port ${PORT}`);
  initialize().catch(logger.error);
});