#!/usr/bin/env node

/**
 * Reset Rejected Posts
 *
 * Finds all rejected emails in user tabs, then:
 * 1. Removes those rows from ALL user tabs
 * 2. Removes those rows from the Posts tab
 * 3. Sets those posts to processed=false in extract.json
 *
 * This allows re-running `npm run generate` + `npm run emails` with a different model.
 */

import 'dotenv/config';
import {
  fetchUserEmails,
  listUserTabs,
  sheetId,
  sheetName,
} from '../services/googleSheets.js';
import { loadExtract } from '../services/extract-store.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_PATH = path.join(__dirname, '..', 'output', 'extract.json');

// ── Sheet auth (reuse from googleSheets.js internals) ──

const sheetCredentialsPath = path.join(__dirname, '..', 'services', 'gs-config.json');

const loadSheetCredentials = () => JSON.parse(fs.readFileSync(sheetCredentialsPath, 'utf8'));

const createJwtAssertion = (creds, scope) => {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.client_email,
    scope: Array.isArray(scope) ? scope.join(' ') : scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const toSign = `${encode(header)}.${encode(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(toSign);
  return `${toSign}.${signer.sign(creds.private_key, 'base64url')}`;
};

let _cachedToken = null;
let _tokenExpiry = 0;

const getToken = async () => {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;
  const creds = loadSheetCredentials();
  const assertion = createJwtAssertion(creds, ['https://www.googleapis.com/auth/spreadsheets']);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Token failed: ${await res.text()}`);
  const json = await res.json();
  _cachedToken = json.access_token;
  _tokenExpiry = Date.now() + 3500 * 1000;
  return _cachedToken;
};

const sheetsGet = async (range) => {
  const token = await getToken();
  const enc = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${enc}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read failed: ${await res.text()}`);
  return (await res.json()).values || [];
};

const getSpreadsheetProps = async () => {
  const token = await getToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Props failed: ${await res.text()}`);
  return res.json();
};

const sheetsBatchUpdate = async (requests) => {
  const token = await getToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  );
  if (!res.ok) throw new Error(`BatchUpdate failed: ${await res.text()}`);
  return res.json();
};

async function getSheetIdByName(tabName) {
  const props = await getSpreadsheetProps();
  const sheet = props.sheets.find(s => s.properties.title === tabName);
  return sheet ? sheet.properties.sheetId : null;
}

// ── Delete rows from a tab by row indices (0-based, sorted descending to avoid shifting) ──

async function deleteRows(tabSheetId, rowIndices) {
  if (rowIndices.length === 0) return;

  // Sort descending so deleting from bottom doesn't shift upper rows
  const sorted = [...rowIndices].sort((a, b) => b - a);

  const requests = sorted.map(rowIdx => ({
    deleteDimension: {
      range: {
        sheetId: tabSheetId,
        dimension: 'ROWS',
        startIndex: rowIdx,
        endIndex: rowIdx + 1,
      },
    },
  }));

  await sheetsBatchUpdate(requests);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n   RESET REJECTED POSTS\n');

  // Step 1: Find all rejected post IDs across all user tabs
  const userTabs = await listUserTabs();
  console.log(`   Found ${userTabs.length} user tab(s): ${userTabs.join(', ')}`);

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

  // Step 2: Remove rows from ALL user tabs
  console.log('\n   Removing from user tabs...');
  for (const tab of userTabs) {
    const tabSheetId = await getSheetIdByName(tab);
    if (tabSheetId == null) continue;

    const rows = await sheetsGet(`${tab}!A2:A`);
    const rowIndicesToDelete = [];

    for (let i = 0; i < rows.length; i++) {
      const postId = (rows[i][0] || '').trim();
      if (rejectedPostIds.has(postId)) {
        rowIndicesToDelete.push(i + 1); // +1 for header row (0-based sheet index)
      }
    }

    if (rowIndicesToDelete.length > 0) {
      await deleteRows(tabSheetId, rowIndicesToDelete);
      console.log(`     ${tab}: removed ${rowIndicesToDelete.length} row(s)`);
    } else {
      console.log(`     ${tab}: no matching rows`);
    }
  }

  // Step 3: Remove rows from Posts tab
  console.log('\n   Removing from Posts tab...');
  const postsSheetId = await getSheetIdByName(sheetName);
  if (postsSheetId != null) {
    const postRows = await sheetsGet(`${sheetName}!A2:A`);
    const postRowsToDelete = [];

    for (let i = 0; i < postRows.length; i++) {
      const postId = (postRows[i][0] || '').trim();
      if (rejectedPostIds.has(postId)) {
        postRowsToDelete.push(i + 1); // +1 for header row
      }
    }

    if (postRowsToDelete.length > 0) {
      await deleteRows(postsSheetId, postRowsToDelete);
      console.log(`     Posts: removed ${postRowsToDelete.length} row(s)`);
    } else {
      console.log(`     Posts: no matching rows`);
    }
  }

  // Step 4: Set processed=false in extract.json
  // step 5: Set is debt = true 
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
    fs.writeFileSync(EXTRACT_PATH, JSON.stringify(data, null, 2));
    console.log(`     Reset ${resetCount} post(s) to processed=false`);
  } else {
    console.log(`     No matching posts found in extract.json`);
  }

  // Summary
  console.log('\n   ' + '='.repeat(50));
  console.log('   RESET COMPLETE');
  console.log('   ' + '='.repeat(50));
  console.log(`   Rejected posts found:    ${rejectedPostIds.size}`);
  console.log(`   Posts tab rows removed:  yes`);
  console.log(`   User tab rows removed:   yes`);
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
