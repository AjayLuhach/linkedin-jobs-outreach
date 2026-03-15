#!/usr/bin/env node

/**
 * Feed Email Extractor CLI
 *
 * Commands:
 *   node src/cli.js parse [--file <path>]   Parse LinkedIn data → output/extract.json
 *   node src/cli.js generate                Phase 1: AI extract → push to posts DB
 *   node src/cli.js emails [--redraft]       Phase 2+3: Score posts → draft emails → user DB
 *   node src/cli.js send                    List unsent emails
 */

import fs from 'fs';
import path from 'path';
import config from './config.js';
import { readClipboard, detectAndParse } from './services/clipboard.js';
import { validateProvider, getProviderInfo } from './services/ai-provider.js';
import { appendPosts, getUnprocessedPosts, markProcessed } from './services/extract-store.js';
import {
  pushPhase1ToSheet,
  fetchExistingPostIds,
  fetchHiringPosts,
  fetchUserTabPostIds,
  pushEmailsToUserTab,
  fetchUserEmails,
} from './services/db.js';

// -- Temp file helpers for caching AI responses --
const TEMP_DIR = config.paths.outputDir;
const TEMP_PHASE1 = path.join(TEMP_DIR, '.ai-phase1.json');
const TEMP_PHASE23 = path.join(TEMP_DIR, '.ai-phase23.json');

function saveTempAI(filePath, data) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`   Cached AI response → ${path.basename(filePath)}`);
}

function loadTempAI(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`   Found cached AI response ← ${path.basename(filePath)}`);
    return data;
  } catch { return null; }
}

function removeTempAI(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

// AI pipeline imports (provider-agnostic — routed by AI_PROVIDER in .env)
async function getPhase1Provider() {
  const mod = await import('./services/ai-bedrock.js');
  return mod.extractPhase1;
}

async function getPhase23Provider() {
  const mod = await import('./services/ai-bedrock.js');
  return mod.scoreAndDraftEmails;
}

/**
 * Get the user's full name from config.
 */
function getUsername() {
  return config.candidate.name || 'User';
}

// ============================================================
// CLI ARGUMENT PARSING
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options = { file: null, redraft: false };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      options.file = args[i + 1];
      i++;
    } else if (args[i] === '--redraft') {
      options.redraft = true;
    }
  }

  return { command, options };
}

// ============================================================
// COMMAND: parse
// ============================================================

async function cmdParse(options) {
  console.log('\n   PARSE — Extract LinkedIn posts\n');

  let text;
  if (options.file) {
    console.log(`   Reading from file: ${options.file}`);
    if (!fs.existsSync(options.file)) {
      throw new Error(`File not found: ${options.file}`);
    }
    text = fs.readFileSync(options.file, 'utf-8');
  } else {
    text = await readClipboard();
  }

  const result = detectAndParse(text);

  if (result.posts.length === 0) {
    console.log('\n   No posts found in the input.');
    if (result.source === 'raw' || result.source === 'unknown') {
      console.log('   Tip: Copy LinkedIn feed HTML or API JSON response to clipboard.');
    }
    return;
  }

  const { added, skipped, total } = appendPosts(result.posts);

  console.log(`\n   Source:     ${result.source}`);
  console.log(`   Parsed:     ${result.posts.length} posts`);
  console.log(`   New added:  ${added}`);
  console.log(`   Duplicates: ${skipped}`);
  console.log(`   Total:      ${total} posts in extract.json`);
}

// ============================================================
// COMMAND: generate — Phase 1 only → push to posts DB
// ============================================================

async function cmdGenerate() {
  console.log('\n   GENERATE — Phase 1: AI Extract → Posts DB\n');

  const { label, name: providerName } = validateProvider();
  const { model } = getProviderInfo();
  console.log(`   AI Provider: ${label} (${model})`);

  const unprocessed = getUnprocessedPosts();

  if (unprocessed.length === 0) {
    console.log('   No unprocessed posts found.');
    console.log('   Run "npm run parse" first to add posts to extract.json.');
    return;
  }

  console.log(`   Found ${unprocessed.length} unprocessed post(s)`);

  // Pre-filter: skip posts already in the DB (saves AI calls)
  const existingIds = await fetchExistingPostIds();
  const newPosts = unprocessed.filter(p => !existingIds.has(p.id));
  const alreadyInDB = unprocessed.length - newPosts.length;

  if (alreadyInDB > 0) {
    console.log(`   ${alreadyInDB} post(s) already in DB — skipping`);
  }

  // Mark ALL unprocessed as processed locally (including ones already in DB)
  const processedIds = unprocessed.map(p => p.id);
  markProcessed(processedIds);

  if (newPosts.length === 0) {
    console.log(`\n   All ${unprocessed.length} post(s) already in the DB. Nothing to extract.`);
    console.log(`   ${processedIds.length} post(s) marked as processed.`);
    return;
  }

  console.log(`   ${newPosts.length} new post(s) to process with AI`);

  // Phase 1: AI extraction — use cached response if available
  let extracted = loadTempAI(TEMP_PHASE1);

  if (!extracted) {
    const extractPhase1 = await getPhase1Provider();
    extracted = await extractPhase1(newPosts);

    if (extracted.length > 0) {
      saveTempAI(TEMP_PHASE1, extracted);
    }
  }

  if (extracted.length === 0) {
    console.log('\n   No hiring posts found in this batch.');
    console.log(`   ${processedIds.length} post(s) marked as processed.`);
    removeTempAI(TEMP_PHASE1);
    return;
  }

  // Push hiring posts to DB
  console.log('\n   Pushing to posts DB...');
  const { added, skipped } = await pushPhase1ToSheet(
    extracted,
    unprocessed,
    config.candidate.name || 'CLI'
  );

  removeTempAI(TEMP_PHASE1);

  console.log('\n   ' + '='.repeat(50));
  console.log('   PHASE 1 RESULTS');
  console.log('   ' + '='.repeat(50));
  console.log(`   Posts processed:   ${processedIds.length}`);
  console.log(`   Hiring posts:      ${extracted.length}`);
  console.log(`   Added to DB:       ${added}`);
  console.log(`   Already in DB:     ${skipped}`);
  console.log('\n   Next: npm run emails');
}

// ============================================================
// COMMAND: emails — Phase 2+3: Score posts → draft → user DB
// ============================================================

async function cmdEmails(options = {}) {
  const username = getUsername();
  const redraft = options.redraft || false;
  validateProvider(); // fail fast if no AI configured
  console.log(`\n   EMAILS — Score & Draft for "${username}"${redraft ? ' (REDRAFT mode)' : ''}\n`);

  // Fetch all hiring posts from DB
  const hiringPosts = await fetchHiringPosts();

  if (hiringPosts.length === 0) {
    console.log('   No hiring posts in the DB.');
    console.log('   Run "npm run generate" first.');
    return;
  }

  // Filter out posts already in this user's data
  const fetchOpts = redraft ? { excludeStatuses: ["drafted"] } : {};
  const usedIds = await fetchUserTabPostIds(username, fetchOpts);
  const fresh = hiringPosts.filter(p => !usedIds.has(p.postId));

  if (fresh.length === 0) {
    console.log(`   ${hiringPosts.length} post(s) in DB, but all already processed for ${username}.`);
    return;
  }

  console.log(`   ${hiringPosts.length} post(s) in DB, ${fresh.length} ${redraft ? 'to process' : 'new'} for ${username}`);

  // Phase 2+3: Score and draft — use cached response if available
  let contacts = loadTempAI(TEMP_PHASE23);

  if (!contacts) {
    const scoreAndDraft = await getPhase23Provider();
    contacts = await scoreAndDraft(fresh, config.candidate);

    if (contacts.length > 0) {
      saveTempAI(TEMP_PHASE23, contacts);
    }
  }

  if (contacts.length === 0) {
    console.log('\n   No qualifying contacts from these posts.');
    removeTempAI(TEMP_PHASE23);
    return;
  }

  // Push to user's DB
  const { added, skipped, updated } = await pushEmailsToUserTab(username, contacts, { redraft });

  removeTempAI(TEMP_PHASE23);

  // Summary
  const withEmail = contacts.filter(c => c.email?.body).length;
  const goodMatch = contacts.filter(c => c.match?.isGoodMatch).length;

  console.log('\n   ' + '='.repeat(50));
  console.log('   RESULTS');
  console.log('   ' + '='.repeat(50));
  console.log(`   Posts scored:     ${fresh.length}`);
  console.log(`   Good matches:     ${goodMatch}`);
  console.log(`   Emails drafted:   ${withEmail}`);
  console.log(`   Added:            ${added} (${skipped} duplicates)`);
  if (updated > 0) console.log(`   Re-drafted:       ${updated}`);
  console.log('\n   Review emails in the dashboard: npm run dashboard');
}

// ============================================================
// COMMAND: send
// ============================================================

async function cmdSend() {
  const username = getUsername();
  console.log(`\n   SEND — Approved emails for "${username}"\n`);

  const approved = await fetchUserEmails(username, 'approved');

  if (approved.length === 0) {
    console.log('   No approved emails found.');
    console.log('   Approve emails in the dashboard first: npm run dashboard');
    return;
  }

  console.log(`   ${approved.length} approved email(s) ready:\n`);
  approved.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.job?.title || '?'} @ ${c.job?.company || '?'} → ${c.email.to}`);
    console.log(`      Score: ${c.score}/10 — ${c.matchReason || ''}`);
  });

  console.log('\n   To send these, use: npm run send:emails');
}

// ============================================================
// COMMAND: help
// ============================================================

function cmdHelp() {
  console.log(`
   Feed Email Extractor CLI

   Commands:
     npm run parse              Parse LinkedIn data from clipboard
     npm run parse:file <path>  Parse from file
     npm run generate           Phase 1: AI extract → posts DB
     npm run emails             Phase 2+3: Score posts → draft emails → your user DB
     npm run emails:redraft     Re-draft emails for posts with "drafted" status
     npm run send               List approved emails ready to send
     npm run dashboard          Review & approve emails for all users

   Workflow:
     1. Copy LinkedIn feed HTML or API JSON to clipboard
     2. npm run parse              → saves to output/extract.json
     3. npm run generate           → AI extracts hiring posts → data/posts.json
     4. npm run emails             → scores posts, drafts emails → data/users/{name}.json
     5. npm run dashboard          → review & approve emails
     6. npm run send:emails        → send approved emails

   Collaborative:
     - Multiple people can run parse + generate to contribute posts
     - Each person runs "emails" to get their own scored/drafted emails
     - One person can approve emails for everyone via the dashboard
  `);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const { command, options } = parseArgs();

  console.log('\n   +--------------------------------------------------+');
  console.log('   |          FEED EMAIL EXTRACTOR                     |');
  console.log('   +--------------------------------------------------+');

  try {
    switch (command) {
      case 'parse':
        await cmdParse(options);
        break;
      case 'generate':
        await cmdGenerate();
        break;
      case 'emails':
        await cmdEmails(options);
        break;
      case 'send':
        await cmdSend();
        break;
      case 'help':
      default:
        cmdHelp();
        break;
    }
  } catch (error) {
    console.error(`\n   ERROR: ${error.message}\n`);
    process.exit(1);
  }

  console.log('');
}

main();
