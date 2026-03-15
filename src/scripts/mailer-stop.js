#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PID_FILE = path.join(ROOT, '.mailer.pid');

if (!fs.existsSync(PID_FILE)) {
  console.log('  No mailer daemon running.');
  process.exit(0);
}

const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
try {
  process.kill(pid, 'SIGTERM');
  fs.unlinkSync(PID_FILE);
  console.log(`  Mailer daemon stopped (PID: ${pid})`);
} catch (err) {
  fs.unlinkSync(PID_FILE);
  console.log(`  Daemon (PID: ${pid}) was not running — cleaned up.`);
}
