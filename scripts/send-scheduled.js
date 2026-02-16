#!/usr/bin/env node

/**
 * Scheduled Email Sender — one-shot send of all approved unsent emails.
 * Use `npm run mailer` for the background daemon instead.
 */

import config from '../config.js';
import {
  fetchUserEmails,
  markUserEmailSent,
} from '../services/googleSheets.js';
import { sendEmail, verifyConnection } from '../services/email-sender.js';
import { isValidEmail } from '../services/email-validator.js';

const USERNAME = config.candidate.name || 'User';

async function getApprovedUnsent() {
  const emails = await fetchUserEmails(USERNAME, 'approved');
  return emails
    .filter(e => !e.sentAt && e.email?.to)
    .map(e => ({ ...e, _user: USERNAME }));
}

async function main() {
  console.log('\n   SCHEDULED EMAIL SENDER\n');

  const ready = await getApprovedUnsent();

  if (ready.length === 0) {
    console.log('   No approved emails ready to send.');
    process.exit(0);
  }

  console.log(`   ${ready.length} email(s) ready to send\n`);

  const connected = await verifyConnection();
  if (!connected) {
    throw new Error('SMTP connection failed');
  }

  const results = { sent: 0, failed: 0, skipped: 0 };

  for (const contact of ready) {
    const to = contact.email?.to;

    if (!to || !isValidEmail(to)) {
      console.log(`   [SKIP] Invalid email: ${to || '(empty)'}`);
      results.skipped++;
      continue;
    }

    const emailData = {
      to,
      subject: contact.email.subject,
      body: contact.email.body,
    };

    try {
      const result = await sendEmail(emailData);
      if (result.success) {
        await markUserEmailSent(contact._user, contact.postId);
        results.sent++;
      } else {
        results.failed++;
      }
    } catch (err) {
      console.error(`   [ERROR] ${to}: ${err.message}`);
      results.failed++;
    }

    // Small delay between sends
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n   Done — Sent: ${results.sent} | Failed: ${results.failed} | Skipped: ${results.skipped}`);
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('   FATAL:', err.message);
  process.exit(1);
});
