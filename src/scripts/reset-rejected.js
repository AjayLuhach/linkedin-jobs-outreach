#!/usr/bin/env node

/**
 * Reset Rejected Posts
 *
 * Finds all rejected emails in user data, then:
 * 1. Removes those entries from ALL user data files
 * 2. Removes those entries from the posts DB
 * 3. Sets those posts to processed=false in extract.json
 *
 * This allows re-running `npm run generate` + `npm run emails` with a different model.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchUserEmails,
  listUserTabs,
} from '../services/db.js';
import { loadExtract, saveExtract } from '../services/extract-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const USERS_DIR = path.join(DATA_DIR, 'users');

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n   RESET REJECTED POSTS\n');

  // Step 1: Find all rejected post IDs across all user data
  const userTabs = await listUserTabs();
  console.log(`   Found ${userTabs.length} user(s): ${userTabs.join(', ')}`);

  const rejectedPostIds = new Set();

  for (const tab of userTabs) {
    const rejected = await fetchUserEmails(tab, 'rejected');
    for (const email of rejected) {
      if (email.postId) rejectedPostIds.add(email.postId);
    }
  }

  if (rejectedPostIds.size === 0) {
    console.log('\n   No rejected emails found. Nothing to reset.');
    return;
  }

  console.log(`\n   Found ${rejectedPostIds.size} rejected post ID(s):`);
  for (const id of rejectedPostIds) {
    console.log(`     - ${id}`);
  }

  // Step 2: Remove from ALL user data files
  console.log('\n   Removing from user data...');
  for (const tab of userTabs) {
    const userFile = path.join(USERS_DIR, `${tab}.json`);
    const data = readJSON(userFile);
    if (!data || !data.emails) continue;

    const before = data.emails.length;
    data.emails = data.emails.filter(e => !rejectedPostIds.has(e.postId));
    const removed = before - data.emails.length;

    if (removed > 0) {
      writeJSON(userFile, data);
      console.log(`     ${tab}: removed ${removed} entry(ies)`);
    } else {
      console.log(`     ${tab}: no matching entries`);
    }
  }

  // Step 3: Remove from posts DB
  console.log('\n   Removing from posts DB...');
  const postsData = readJSON(POSTS_FILE);
  if (postsData && postsData.posts) {
    const before = postsData.posts.length;
    postsData.posts = postsData.posts.filter(p => !rejectedPostIds.has(p.postId));
    const removed = before - postsData.posts.length;

    if (removed > 0) {
      writeJSON(POSTS_FILE, postsData);
      console.log(`     Posts: removed ${removed} entry(ies)`);
    } else {
      console.log(`     Posts: no matching entries`);
    }
  }

  // Step 4: Set processed=false in extract.json
  console.log('\n   Updating extract.json...');
  const data = loadExtract();
  let resetCount = 0;

  for (const post of data.posts) {
    if (rejectedPostIds.has(post.id)) {
      post.processed = false;
      resetCount++;
    }
  }

  if (resetCount > 0) {
    data.lastUpdated = new Date().toISOString();
    saveExtract(data);
    console.log(`     Reset ${resetCount} post(s) to processed=false`);
  } else {
    console.log(`     No matching posts found in extract.json`);
  }

  // Summary
  console.log('\n   ' + '='.repeat(50));
  console.log('   RESET COMPLETE');
  console.log('   ' + '='.repeat(50));
  console.log(`   Rejected posts found:    ${rejectedPostIds.size}`);
  console.log(`   Posts DB cleaned:        yes`);
  console.log(`   User data cleaned:       yes`);
  console.log(`   extract.json reset:      ${resetCount} post(s)`);
  console.log('\n   Next steps:');
  console.log('     1. npm run generate    (re-extract with new model)');
  console.log('     2. npm run emails      (re-score and re-draft emails)');
  console.log('');
}

main().catch(err => {
  console.error(`\n   ERROR: ${err.message}\n`);
  process.exit(1);
});
