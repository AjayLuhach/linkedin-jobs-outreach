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
    const data = JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf-8'));
    return Array.isArray(data) ? data : (data.contacts || []);
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

/**
 * Approve a contact for scheduled sending by postId.
 * Assigns a random time between 9 AM and 1 PM IST for the next day.
 */
export function approveContact(postId) {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.postId === postId);
  if (!contact) return null;

  // Random time between 9:00 AM and 1:00 PM IST tomorrow
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 9 AM IST = 3:30 AM UTC, 1 PM IST = 7:30 AM UTC
  const startMinutes = 3 * 60 + 30; // 3:30 UTC in minutes
  const endMinutes = 7 * 60 + 30;   // 7:30 UTC in minutes
  const randomMinutes = startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes));

  const scheduled = new Date(tomorrow);
  scheduled.setUTCHours(Math.floor(randomMinutes / 60), randomMinutes % 60, Math.floor(Math.random() * 60), 0);

  contact.approved = true;
  contact.approvedAt = now.toISOString();
  contact.scheduledAt = scheduled.toISOString();

  saveContacts(contacts);
  return contact;
}

/**
 * Unapprove a contact by postId.
 */
export function unapproveContact(postId) {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.postId === postId);
  if (!contact) return null;

  contact.approved = false;
  delete contact.approvedAt;
  delete contact.scheduledAt;

  saveContacts(contacts);
  return contact;
}

/**
 * Reject a contact by postId — hides it from sendable/default views.
 */
export function rejectContact(postId) {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.postId === postId);
  if (!contact) return null;

  contact.rejected = true;
  contact.rejectedAt = new Date().toISOString();
  contact.approved = false;
  delete contact.approvedAt;
  delete contact.scheduledAt;

  saveContacts(contacts);
  return contact;
}

/**
 * Unreject a contact by postId — restores it to sendable.
 */
export function unrejectContact(postId) {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.postId === postId);
  if (!contact) return null;

  contact.rejected = false;
  delete contact.rejectedAt;

  saveContacts(contacts);
  return contact;
}

/**
 * Get all approved but unsent contacts whose scheduled time has passed.
 */
export function getScheduledReady() {
  const contacts = loadContacts();
  const now = new Date();
  return contacts.filter(c =>
    c.approved && !c.sent && c.scheduledAt && new Date(c.scheduledAt) <= now
  );
}
