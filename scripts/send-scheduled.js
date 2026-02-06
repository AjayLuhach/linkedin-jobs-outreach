#!/usr/bin/env node

/**
 * Scheduled Email Sender — one-shot send of all due approved emails.
 * Use `npm run mailer` for the background daemon instead.
 */

import { getScheduledReady, markSent } from '../services/contacts-store.js';
import { sendEmail, verifyConnection } from '../services/email-sender.js';
import { isValidEmail } from '../services/email-validator.js';

async function main() {
  console.log('\n   SCHEDULED EMAIL SENDER\n');

  const ready = getScheduledReady();

  if (ready.length === 0) {
    console.log('   No scheduled emails ready to send.');
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
      const result = await sendEmail(emailData, false);
      if (result.success) {
        markSent(to);
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
