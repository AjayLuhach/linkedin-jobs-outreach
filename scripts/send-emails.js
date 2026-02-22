#!/usr/bin/env node

/**
 * Email Sender CLI
 * Sends approved emails from Google Sheets user tabs.
 *
 * Usage:
 *   node scripts/send-emails.js                    # Send all approved unsent emails
 *   node scripts/send-emails.js --verify           # Test SMTP connection
 *   node scripts/send-emails.js --list             # List approved unsent emails
 */

import config from "../config.js";
import {
  sendEmail,
  verifyConnection,
} from "../services/email-sender.js";
import {
  fetchUserEmails,
  markUserEmailSent,
} from "../services/googleSheets.js";
import { isValidEmail } from "../services/email-validator.js";
import { verifyEmail } from "../services/email-verifier.js";

const args = process.argv.slice(2);
const mode = args[0];

/** Current user's full name — only sends emails from their own tab. */
const USERNAME = config.candidate.name || 'User';

/**
 * Fetch approved, unsent emails for the current user only.
 */
async function getApprovedUnsent() {
  const emails = await fetchUserEmails(USERNAME, 'approved');
  return emails
    .filter(e => !e.sentAt && e.email?.to)
    .map(e => ({ ...e, _user: USERNAME }));
}

async function main() {
  console.log("\n   EMAIL SENDER CLI\n");

  // Verify connection mode
  if (mode === "--verify") {
    console.log("   Testing SMTP connection...");
    const success = await verifyConnection();
    process.exit(success ? 0 : 1);
  }

  // List approved unsent emails
  if (mode === "--list") {
    const unsent = await getApprovedUnsent();
    if (unsent.length === 0) {
      console.log("   No approved unsent emails found");
      process.exit(0);
    }

    console.log(`   Found ${unsent.length} approved unsent email(s):\n`);
    unsent.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.email.to} (${c._user})`);
      console.log(`      Job: ${c.job?.title || 'Unknown'} at ${c.job?.company || 'Unknown'}`);
      console.log(`      Score: ${c.score || '?'}/10`);
      console.log(`      Subject: ${c.email?.subject || 'N/A'}`);
      console.log('');
    });

    process.exit(0);
  }

  // Default: Send approved unsent emails for current user
  console.log(`   Sending approved unsent emails for "${USERNAME}"\n`);

  const unsent = await getApprovedUnsent();

  if (unsent.length === 0) {
    console.log("   No approved unsent emails found");
    process.exit(0);
  }

  console.log(`   Found ${unsent.length} approved unsent email(s)\n`);

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

    // Inline MX + junk check before sending
    const check = await verifyEmail(to);
    if (!check.verified) {
      console.log(`   [SKIP] ${to}: ${check.error}`);
      results.skipped++;
      continue;
    }

    // Build email data
    const emailData = {
      to,
      subject: contact.email.subject || `Application for ${contact.job?.title || 'open position'}`,
      body: contact.email.body || `Dear Hiring Manager,\n\nI am interested in the ${contact.job?.title || 'open position'}. Please find my resume attached.\n\nBest regards`,
    };

    try {
      const result = await sendEmail(emailData);
      if (result.success) {
        await markUserEmailSent(contact._user, contact.postId);
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
      const delaySec = Math.floor(Math.random() * 51) + 100; // 100-150 seconds
      console.log(`   Waiting ${delaySec}s before next email...`);
      await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
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
