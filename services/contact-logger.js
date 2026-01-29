/**
 * Contact Logger
 * Logs extracted contacts from LinkedIn feed, tracks email sent status,
 * and provides duplicate detection.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { isValidEmail, classifyContact } from "./email-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, "..", "logs");
const CONTACT_LOG = path.join(LOG_DIR, "contacts.json");

/**
 * Load contacts from log file
 * @returns {Array} contacts array
 */
function loadContacts() {
  if (!fs.existsSync(CONTACT_LOG)) return [];
  try {
    return JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Save contacts to log file
 * @param {Array} contacts - contacts array
 */
function saveContacts(contacts) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
}

/**
 * Log a batch of extracted hiring posts with their generated emails
 * Skips entries where the email already exists in the log (unsent or sent)
 * @param {Array} hiringPosts - extracted hiring posts from AI
 * @param {Array} generatedEmails - generated email content for each post
 * @returns {object} { added, skippedDuplicate, skippedNoEmail }
 */
export function logExtractedContacts(hiringPosts, generatedEmails) {
  const contacts = loadContacts();
  let added = 0;
  let skippedDuplicate = 0;
  let skippedNoEmail = 0;

  for (const post of hiringPosts) {
    if (!post.emails || post.emails.length === 0) {
      skippedNoEmail++;
      continue;
    }

    for (const email of post.emails) {
      // Validate that this is actually an email address, not a phone number
      const contactType = classifyContact(email);

      if (contactType !== 'email') {
        console.log(`   [SKIP] ${email} is not a valid email (detected as: ${contactType})`);
        skippedNoEmail++;
        continue;
      }

      if (!isValidEmail(email)) {
        console.log(`   [SKIP] ${email} is not a valid email format`);
        skippedNoEmail++;
        continue;
      }

      // Check if this email already exists in the log
      const exists = contacts.some(entry =>
        entry.contacts.some(c => c.type === 'email' && c.value === email)
      );

      if (exists) {
        console.log(`   [SKIP] ${email} already in contacts log`);
        skippedDuplicate++;
        continue;
      }

      // Find the matching generated email content (match by email or by company+role)
      const emailContent = generatedEmails.find(e =>
        e.to === email ||
        (e.company === post.company && e.role === post.role)
      );

      const entry = {
        date: new Date().toISOString().split('T')[0],
        job: {
          title: post.role || null,
          company: post.company || null,
        },
        contacts: [
          {
            type: "email",
            value: email,
            name: post.posterName || null,
          }
        ],
        description: post.postSnippet || null,
        emailSent: false,
        emailSentDate: null,
        emailData: emailContent ? {
          subject: emailContent.subject,
          body: emailContent.body,
          notes: emailContent.notes || null,
          generatedAt: new Date().toISOString(),
        } : null,
      };

      contacts.push(entry);
      added++;
    }
  }

  saveContacts(contacts);

  if (added > 0) {
    console.log(`\n   Contacts saved to logs/contacts.json`);
  }

  return { added, skippedDuplicate, skippedNoEmail };
}

/**
 * Mark an email as sent in the contacts log
 * @param {string} email - Email address that was sent to
 * @returns {boolean} True if marked successfully
 */
export function markEmailAsSent(email) {
  const contacts = loadContacts();

  let found = false;
  for (const entry of contacts) {
    const emailContact = entry.contacts.find(
      c => c.type === 'email' && c.value === email
    );
    if (emailContact && !entry.emailSent) {
      entry.emailSent = true;
      entry.emailSentDate = new Date().toISOString().split('T')[0];
      found = true;
      break;
    }
  }

  if (found) {
    saveContacts(contacts);
    return true;
  }

  return false;
}

/**
 * Check if an email address has been sent to before
 * @param {string} email - Email address to check
 * @returns {Object|null} Previous sent entry info or null
 */
export function checkPreviouslySent(email) {
  const contacts = loadContacts();

  const previousEntry = contacts.find(entry => {
    const emailContact = entry.contacts.find(c => c.type === 'email' && c.value === email);
    return emailContact && entry.emailSent;
  });

  if (previousEntry) {
    return {
      email,
      jobTitle: previousEntry.job.title,
      company: previousEntry.job.company,
      sentDate: previousEntry.emailSentDate,
      emailData: previousEntry.emailData || null,
    };
  }

  return null;
}

/**
 * Get all unsent email contacts from the log
 * @returns {Array} Array of email objects with job info and email template
 */
export function getUnsentEmails() {
  const contacts = loadContacts();

  return contacts
    .filter(entry => !entry.emailSent)
    .map(entry => {
      const emailContact = entry.contacts.find(c => c.type === 'email');
      if (!emailContact) return null;

      return {
        to: emailContact.value,
        contactName: emailContact.name,
        jobTitle: entry.job.title,
        jobCompany: entry.job.company,
        description: entry.description,
        date: entry.date,
        emailData: entry.emailData || null,
      };
    })
    .filter(Boolean);
}

/**
 * Save/update email data for a specific email address
 * @param {string} email - Email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 * @returns {boolean} True if saved successfully
 */
export function saveEmailData(email, subject, body) {
  const contacts = loadContacts();

  for (let i = contacts.length - 1; i >= 0; i--) {
    const entry = contacts[i];
    const emailContact = entry.contacts.find(
      c => c.type === 'email' && c.value === email
    );
    if (emailContact) {
      entry.emailData = {
        subject,
        body,
        generatedAt: new Date().toISOString(),
      };
      saveContacts(contacts);
      return true;
    }
  }

  return false;
}

export default {
  logExtractedContacts,
  markEmailAsSent,
  checkPreviouslySent,
  getUnsentEmails,
  saveEmailData,
};
