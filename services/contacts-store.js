/**
 * Contacts Store - Manages persistent output/contacts.json
 * Stores AI-generated email data with match scoring and sent status.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTACTS_PATH = path.join(__dirname, '..', 'output', 'contacts.json');

function ensureOutputDir() {
  const dir = path.dirname(CONTACTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load existing contacts or return empty array.
 */
export function loadContacts() {
  ensureOutputDir();
  if (!fs.existsSync(CONTACTS_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Save contacts array to file.
 */
function saveContacts(contacts) {
  ensureOutputDir();
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
}

/**
 * Append new contacts, skipping duplicates by postId.
 * @param {object[]} newContacts
 * @returns {{ added: number, skipped: number, total: number }}
 */
export function appendContacts(newContacts) {
  const contacts = loadContacts();
  const existingPostIds = new Set(contacts.map(c => c.postId));

  let added = 0;
  let skipped = 0;

  for (const contact of newContacts) {
    if (existingPostIds.has(contact.postId)) {
      skipped++;
    } else {
      contacts.push(contact);
      existingPostIds.add(contact.postId);
      added++;
    }
  }

  saveContacts(contacts);
  return { added, skipped, total: contacts.length };
}

/**
 * Get all unsent contacts that have valid emails.
 */
export function getUnsent() {
  const contacts = loadContacts();
  return contacts.filter(c =>
    !c.sent &&
    c.email?.to &&
    c.match?.isGoodMatch
  );
}

/**
 * Mark a contact as sent by email address.
 */
export function markSent(email) {
  const contacts = loadContacts();
  for (const contact of contacts) {
    if (contact.email?.to === email) {
      contact.sent = true;
      contact.sentAt = new Date().toISOString();
    }
  }
  saveContacts(contacts);
}
