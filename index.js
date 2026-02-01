#!/usr/bin/env node

/**
 * Feed Email Extractor CLI
 *
 * Commands:
 *   node index.js parse [--file <path>]   Parse LinkedIn data → output/extract.json
 *   node index.js generate                AI process posts → output/contacts.json
 *   node index.js send                    List unsent emails
 */

import fs from 'fs';
import config from './config.js';
import { readClipboard, detectAndParse } from './services/clipboard.js';
import { appendPosts, getUnprocessedPosts, markProcessed } from './services/extract-store.js';
import { appendContacts, getUnsent } from './services/contacts-store.js';
import { processInBatches } from './services/ai.js';

// ============================================================
// CLI ARGUMENT PARSING
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options = { file: null };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      options.file = args[i + 1];
      i++;
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
// COMMAND: generate
// ============================================================

async function cmdGenerate() {
  console.log('\n   GENERATE — AI process unprocessed posts\n');

  if (!config.ai.geminiApiKey) {
    throw new Error('GEMINI_API_KEY not set in .env');
  }

  const unprocessed = getUnprocessedPosts();

  if (unprocessed.length === 0) {
    console.log('   No unprocessed posts found.');
    console.log('   Run "npm run parse" first to add posts to extract.json.');
    return;
  }

  console.log(`   Found ${unprocessed.length} unprocessed post(s)`);

  const contacts = await processInBatches(unprocessed, config.candidate);

  // Mark all posts as processed
  const processedIds = unprocessed.map(p => p.id);
  markProcessed(processedIds);

  if (contacts.length === 0) {
    console.log('\n   No hiring posts found in this batch.');
    console.log(`   ${processedIds.length} post(s) marked as processed.`);
    return;
  }

  // Save contacts
  const { added, skipped, total } = appendContacts(contacts);

  // Summary
  const hiringCount = contacts.length;
  const withEmail = contacts.filter(c => c.email?.to).length;
  const goodMatch = contacts.filter(c => c.match?.isGoodMatch).length;

  console.log('\n   ' + '='.repeat(50));
  console.log('   RESULTS');
  console.log('   ' + '='.repeat(50));
  console.log(`   Posts processed:   ${processedIds.length}`);
  console.log(`   Hiring posts:     ${hiringCount}`);
  console.log(`   Good matches:     ${goodMatch}`);
  console.log(`   With email:       ${withEmail}`);
  console.log(`   Contacts added:   ${added} (${skipped} duplicates)`);
  console.log(`   Total contacts:   ${total}`);

  if (withEmail > 0) {
    console.log('\n   To send emails: npm run send');
  }
}

// ============================================================
// COMMAND: send
// ============================================================

async function cmdSend() {
  console.log('\n   SEND — Unsent emails\n');

  const unsent = getUnsent();

  if (unsent.length === 0) {
    console.log('   No unsent emails found.');
    console.log('   Run "npm run generate" first to create email content.');
    return;
  }

  console.log(`   ${unsent.length} unsent email(s) ready:\n`);
  unsent.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.job?.title || '?'} @ ${c.job?.company || '?'} → ${c.email.to}`);
    console.log(`      Match: ${c.match?.score || '?'}/10 — ${c.match?.reason || ''}`);
  });

  console.log('\n   To send these, use: node scripts/send-emails.js');
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
     npm run generate           AI process posts → contacts
     npm run send               List & send emails

   Workflow:
     1. Copy LinkedIn feed HTML or API JSON to clipboard
     2. npm run parse              → saves to output/extract.json
     3. npm run generate           → AI analyzes → output/contacts.json
     4. npm run send               → send emails
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
