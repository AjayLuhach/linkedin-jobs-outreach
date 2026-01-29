#!/usr/bin/env node

/**
 * Feed Email Extractor CLI
 *
 * Extracts hiring emails from LinkedIn feed API responses and generates
 * personalized email content using Gemini AI.
 *
 * Usage:
 *   1. Copy LinkedIn feed API response to clipboard
 *   2. Run: node index.js (or npm start)
 *   3. Get extracted emails + generated email content
 *
 *   Or with a file:
 *   node index.js --file path/to/feed.json
 */

import fs from 'fs';
import config from './config.js';
import { readClipboard, validateFeedData } from './services/clipboard.js';
import { extractAndGenerate } from './services/ai.js';
import { saveResults, logToHistory, displayFinalSummary } from './services/output.js';
import { logExtractedContacts } from './services/contact-logger.js';

/**
 * Pre-flight checks
 */
function preflightChecks() {
  console.log('\n   Pre-flight checks...\n');

  const checks = [
    {
      name: 'Gemini API Key',
      pass: !!config.ai.geminiApiKey,
      required: true,
    },
    {
      name: 'Output Directory',
      pass: true, // Will be created automatically
      required: false,
    },
  ];

  const failures = [];

  for (const { name, pass, required } of checks) {
    if (pass) {
      console.log(`   [OK] ${name}`);
    } else if (required) {
      console.log(`   [FAIL] ${name}`);
      failures.push(name);
    } else {
      console.log(`   [WARN] ${name} (optional)`);
    }
  }

  console.log('');

  if (failures.length > 0) {
    throw new Error(`Missing required: ${failures.join(', ')}`);
  }
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = { file: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      options.file = args[i + 1];
      i++;
    }
  }

  return options;
}

/**
 * Get feed data from file or clipboard
 */
async function getFeedData(options) {
  if (options.file) {
    console.log(`   Reading feed data from file: ${options.file}`);

    if (!fs.existsSync(options.file)) {
      throw new Error(`File not found: ${options.file}`);
    }

    const text = fs.readFileSync(options.file, 'utf-8');
    return validateFeedData(text);
  }

  // Read from clipboard
  const text = await readClipboard();
  return validateFeedData(text);
}

/**
 * Main
 */
async function main() {
  console.log('\n');
  console.log('+----------------------------------------------------------+');
  console.log('|          FEED EMAIL EXTRACTOR                            |');
  console.log('|   Extract hiring emails from LinkedIn feed               |');
  console.log('+----------------------------------------------------------+');
  console.log('\n');

  try {
    // Pre-flight
    preflightChecks();

    // Parse CLI args
    const options = parseArgs();

    // Get feed data (parsed by parser.js if LinkedIn API response)
    const feedData = await getFeedData(options);
    console.log('   Feed data loaded successfully\n');

    // Show parsed summary
    if (feedData.posts && feedData.posts.length > 0) {
      console.log(`   Source: ${feedData.source} | Posts: ${feedData.posts.length} | Total available: ${feedData.totalResults}`);
      const preEmails = feedData.posts.flatMap(p => p.emailsFound || []);
      if (preEmails.length > 0) {
        console.log(`   Pre-extracted emails: ${preEmails.join(', ')}`);
      }
      console.log('');
    }

    // AI extraction & email generation
    console.log(`   Using AI: Gemini`);
    const results = await extractAndGenerate(feedData);

    // Log contacts to contacts.json (with duplicate prevention)
    if (results.extraction.hiringPosts && results.extraction.hiringPosts.length > 0) {
      console.log('\n   Logging contacts...');
      const logResult = logExtractedContacts(results.extraction.hiringPosts, results.emails);
      console.log(`   Added: ${logResult.added} | Duplicates skipped: ${logResult.skippedDuplicate} | No email: ${logResult.skippedNoEmail}`);
    }

    // Save results
    if (results.emails.length > 0 || results.extraction.hiringPostsFound > 0) {
      const outputPath = saveResults(results);
      logToHistory(results);
      displayFinalSummary(results, outputPath);

      if (results.emails.length > 0) {
        console.log('\n   To send emails run: npm run send');
        console.log('   To list unsent:    npm run send:list');
      }
    } else {
      console.log('\n   No hiring posts found in this feed. Try with different feed data.');
    }

    // Done
    console.log('\n');
    console.log('+----------------------------------------------------------+');
    console.log('|                    DONE!                                 |');
    console.log('+----------------------------------------------------------+');
    console.log('\n');

  } catch (error) {
    console.error('\n');
    console.error('+----------------------------------------------------------+');
    console.error('|                    ERROR                                 |');
    console.error('+----------------------------------------------------------+');
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

main();
