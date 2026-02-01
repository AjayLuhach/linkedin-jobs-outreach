#!/usr/bin/env node

/**
 * Email Sender CLI
 * Sends emails to contacts from output/contacts.json
 *
 * Usage:
 *   node scripts/send-emails.js                    # Send all unsent emails
 *   node scripts/send-emails.js --verify           # Test SMTP connection
 *   node scripts/send-emails.js --list             # List unsent emails
 */

import readline from "readline";
import {
  sendEmail,
  verifyConnection,
} from "../services/email-sender.js";
import { getUnsent, markSent, loadContacts } from "../services/contacts-store.js";
import { isValidEmail } from "../services/email-validator.js";

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

const args = process.argv.slice(2);
const mode = args[0];

async function main() {
  console.log("\n   EMAIL SENDER CLI\n");

  // Verify connection mode
  if (mode === "--verify") {
    console.log("   Testing SMTP connection...");
    const success = await verifyConnection();
    process.exit(success ? 0 : 1);
  }

  // List unsent emails
  if (mode === "--list") {
    const unsent = getUnsent();
    if (unsent.length === 0) {
      console.log("   No unsent emails found in contacts.json");
      process.exit(0);
    }

    console.log(`   Found ${unsent.length} unsent email(s):\n`);
    unsent.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.email.to}`);
      console.log(`      Job: ${c.job?.title || 'Unknown'} at ${c.job?.company || 'Unknown'}`);
      console.log(`      Match: ${c.match?.score || '?'}/10`);
      console.log(`      Subject: ${c.email?.subject || 'N/A'}`);
      console.log('');
    });

    process.exit(0);
  }

  // Default: Send all unsent emails
  console.log("   Sending unsent emails from output/contacts.json\n");

  const unsent = getUnsent();

  if (unsent.length === 0) {
    console.log("   No unsent emails found");
    process.exit(0);
  }

  console.log(`   Found ${unsent.length} unsent email(s)\n`);

  const connected = await verifyConnection();
  if (!connected) {
    throw new Error("SMTP connection failed - check your .env settings");
  }

  const results = { sent: 0, failed: 0, skipped: 0, invalid: 0, errors: [] };

  for (let i = 0; i < unsent.length; i++) {
    const contact = unsent[i];
    const to = contact.email?.to;

    if (!to || !isValidEmail(to)) {
      console.log(`   [INVALID] Skipping ${to || '(empty)'}`);
      results.invalid++;
      continue;
    }

    // Check if already sent to this email (different post)
    const allContacts = loadContacts();
    const previouslySent = allContacts.find(c => c.email?.to === to && c.sent);

    if (previouslySent) {
      console.log(`\n   DUPLICATE: Already sent to ${to}`);
      console.log(`   Previous: ${previouslySent.job?.title || '?'} @ ${previouslySent.job?.company || '?'}`);
      console.log(`   Current:  ${contact.job?.title || '?'} @ ${contact.job?.company || '?'}`);

      const shouldSend = await askConfirmation("   Send anyway? (y/n): ");
      if (!shouldSend) {
        console.log("   Skipped\n");
        markSent(to);
        results.skipped++;
        continue;
      }
    }

    // Build email data
    const emailData = {
      to,
      subject: contact.email.subject || `Application for ${contact.job?.title || 'open position'}`,
      body: contact.email.body || `Dear ${contact.poster?.name || 'Hiring Manager'},\n\nI am interested in the ${contact.job?.title || 'open position'}. Please find my resume attached.\n\nBest regards`,
    };

    try {
      const result = await sendEmail(emailData, true);
      if (result.success) {
        markSent(to);
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ to, error: result.error });
      }
    } catch (error) {
      console.error(`   [ERROR] ${to}: ${error.message}`);
      results.failed++;
      results.errors.push({ to, error: error.message });
    }

    if (i < unsent.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  console.log("\n   SUMMARY:");
  console.log(`   Sent:    ${results.sent}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`   Invalid: ${results.invalid}`);
  console.log(`   Failed:  ${results.failed}`);

  if (results.errors.length > 0) {
    console.log("\n   ERRORS:");
    results.errors.forEach((err) => console.log(`   ${err.to}: ${err.error}`));
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\n   FATAL ERROR:", error.message);
  process.exit(1);
});
