#!/usr/bin/env node

/**
 * Mailer Daemon — runs detached, checks every 60s for approved unsent emails,
 * auto-exits at 1 PM IST. Start with: npm run mailer
 */

import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import {
  fetchUserEmails,
  markUserEmailSent,
} from '../services/db.js';
import { sendEmail, verifyConnection } from '../services/email-sender.js';
import { isValidEmail } from '../services/email-validator.js';
import { verifyEmail } from '../services/email-verifier.js';

const USERNAME = config.candidate.name || 'User';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PID_FILE = path.join(ROOT, '.mailer.pid');
const LOG_FILE = path.join(ROOT, 'logs', 'mailer.log');

// -- Self-detach: fork into background and exit parent --
if (!process.env.__MAILER_DAEMON) {
  // Kill any existing daemon first
  if (fs.existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
      process.kill(oldPid, 'SIGTERM');
    } catch {}
    fs.unlinkSync(PID_FILE);
  }

  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = fork(process.argv[1], [], {
    env: { ...process.env, __MAILER_DAEMON: '1' },
    detached: true,
    stdio: ['ignore', logFd, logFd, 'ipc'],
  });
  child.unref();
  child.disconnect();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`  Mailer daemon started (PID: ${child.pid})`);
  console.log(`  Log: ${LOG_FILE}`);
  console.log(`  Auto-stops at 1:00 PM IST`);
  console.log(`  Stop manually: npm run mailer:stop`);
  process.exit(0);
}

// -- Daemon process below --

function log(msg) {
  const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`[${ts}] ${msg}`);
}

function isPastCutoff() {
  const now = new Date();
  // 1 PM IST = 7:30 AM UTC
  const cutoffMinutes = 7 * 60 + 30;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMinutes >= cutoffMinutes;
}

function isBeforeWindow() {
  const now = new Date();
  // 9 AM IST = 3:30 AM UTC
  const startMinutes = 3 * 60 + 30;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMinutes < startMinutes;
}

async function getApprovedUnsent() {
  const emails = await fetchUserEmails(USERNAME, 'approved');
  return emails
    .filter(e => !e.sentAt && e.email?.to)
    .map(e => ({ ...e, _user: USERNAME }));
}

async function tick() {
  if (isPastCutoff()) {
    log('1 PM IST reached — shutting down.');
    cleanup();
    process.exit(0);
  }

  if (isBeforeWindow()) return; // too early, wait

  const ready = await getApprovedUnsent();
  if (ready.length === 0) return;

  log(`${ready.length} email(s) due — sending...`);

  for (const contact of ready) {
    const to = contact.email?.to;
    if (!to || !isValidEmail(to)) {
      log(`  [SKIP] Invalid: ${to || '(empty)'}`);
      continue;
    }

    const check = await verifyEmail(to);
    if (!check.verified) {
      log(`  [SKIP] ${to}: ${check.error}`);
      continue;
    }

    try {
      const result = await sendEmail({ to, subject: contact.email.subject, body: contact.email.body });
      if (result.success) {
        await markUserEmailSent(contact._user, contact.postId);
        log(`  [SENT] ${to}`);
      } else {
        log(`  [FAIL] ${to}: ${result.error}`);
      }
    } catch (err) {
      log(`  [ERROR] ${to}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }
}

function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

process.on('SIGTERM', () => { log('Received SIGTERM'); cleanup(); process.exit(0); });
process.on('SIGINT', () => { log('Received SIGINT'); cleanup(); process.exit(0); });

// -- Start --
log(`Mailer daemon started for "${USERNAME}" — checking every 60s`);

const connected = await verifyConnection();
if (!connected) {
  log('SMTP connection failed — exiting');
  cleanup();
  process.exit(1);
}

// Immediate first check, then every 60s
tick();
setInterval(tick, 60_000);
