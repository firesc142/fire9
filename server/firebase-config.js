const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Load .env file
const { CONFIG_DIR } = require('./config');

const FIREBASE_CREDS_FILE = path.join(CONFIG_DIR, 'firebase-credentials.json');

function loadFirebaseCredentialsFromEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;

  try {
    const content = fs.readFileSync(envPath, 'utf-8').replace(/\r\n/g, '\n');
    const prefix = 'FIREBASE_CREDENTIALS=';
    const startIndex = content.indexOf(prefix);
    if (startIndex === -1) return null;

    const tail = content.slice(startIndex + prefix.length);
    const lines = tail.split('\n');
    const valueLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!valueLines.length && !trimmed) {
        continue;
      }
      if (/^[A-Za-z0-9_]+(?:\s*)=/.test(trimmed)) {
        break;
      }
      valueLines.push(line);
    }

    const raw = valueLines.join('\n').trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      console.log('[firebase] Loaded credentials from .env file');
      return parsed;
    }
  } catch (err) {
    // Fall back to the environment variable or file-based credentials
  }

  return null;
}

// Load Firebase credentials from multiple sources
// Priority: 1) .env file (FIREBASE_CREDENTIALS) 2) .env individual vars 3) File-based
function loadFirebaseCredentials() {
  const envValue = process.env.FIREBASE_CREDENTIALS;

  // Try 1: Check for FIREBASE_CREDENTIALS environment variable (JSON string or .env-style block)
  if (envValue) {
    const raw = String(envValue).trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        console.log('[firebase] Loaded credentials from FIREBASE_CREDENTIALS env var');
        return parsed;
      }
    } catch (err) {
      // Fall through to the .env file fallback below.
    }
  }

  const envFileCreds = loadFirebaseCredentialsFromEnvFile();
  if (envFileCreds) {
    return envFileCreds;
  }

  if (envValue) {
    console.warn('[firebase] Ignoring invalid FIREBASE_CREDENTIALS value');
  }

  // Try 2: Check for individual Firebase env variables
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      const creds = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || 'key-id',
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID || '0',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        databaseURL: process.env.FIREBASE_DATABASE_URL
      };
      console.log('[firebase] Loaded credentials from individual env vars');
      return creds;
    } catch (err) {
      console.error('[firebase] Failed to load credentials from env vars:', err.message);
    }
  }

  // Try 3: Check for file-based credentials (backward compatibility)
  if (fs.existsSync(FIREBASE_CREDS_FILE)) {
    try {
      const creds = JSON.parse(fs.readFileSync(FIREBASE_CREDS_FILE, 'utf-8'));
      console.log('[firebase] Loaded credentials from file');
      return creds;
    } catch (err) {
      console.error('[firebase] Failed to load credentials from file:', err.message);
    }
  }

  return null;
}

// Initialize Firebase
let firebaseApp = null;
let isInitialized = false;

function initializeFirebase() {
  if (isInitialized) return;

  const credentials = loadFirebaseCredentials();
  if (!credentials) {
    isInitialized = true;
    return;
  }

  try {
    const databaseURL = credentials.databaseURL || process.env.FIREBASE_DATABASE_URL;
    const initOptions = {
      credential: admin.credential.cert(credentials)
    };

    if (databaseURL) {
      initOptions.databaseURL = databaseURL;
    }

    firebaseApp = admin.initializeApp(initOptions);
    console.log('[firebase] Initialized successfully');
    isInitialized = true;
  } catch (err) {
    console.warn('[firebase] Firebase unavailable; continuing without it');
    isInitialized = true;
  }
}

function getFirebaseApp() {
  if (!isInitialized) {
    initializeFirebase();
  }
  return firebaseApp;
}

function isFirebaseReady() {
  return firebaseApp !== null;
}

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  isFirebaseReady,
  FIREBASE_CREDS_FILE
};
