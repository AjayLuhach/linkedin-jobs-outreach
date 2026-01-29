/**
 * Output Service - Save and display extraction results
 */

import fs from 'fs';
import path from 'path';
import config from '../config.js';

/**
 * Save extraction results to JSON file
 * @param {object} results - the full extraction + emails result
 * @returns {string} output file path
 */
export function saveResults(results) {
  const outputDir = config.paths.outputDir;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(outputDir, `extracted_${timestamp}.json`);

  const output = {
    extractedAt: new Date().toISOString(),
    totalPostsAnalyzed: results.extraction.totalPostsAnalyzed,
    hiringPostsFound: results.extraction.hiringPostsFound,
    emailsGenerated: results.emails.length,
    hiringPosts: results.extraction.hiringPosts,
    generatedEmails: results.emails,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  return outputPath;
}

/**
 * Log extraction to history file
 * @param {object} results - the full results
 */
export function logToHistory(results) {
  const logsDir = config.paths.logsDir;
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const historyFile = path.join(logsDir, 'extraction_history.json');

  let history = { entries: [], stats: { totalExtractions: 0, totalEmails: 0, totalHiringPosts: 0 } };
  if (fs.existsSync(historyFile)) {
    try {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    } catch {
      history = { entries: [], stats: { totalExtractions: 0, totalEmails: 0, totalHiringPosts: 0 } };
    }
  }

  history.entries.push({
    date: new Date().toISOString(),
    postsAnalyzed: results.extraction.totalPostsAnalyzed,
    hiringPostsFound: results.extraction.hiringPostsFound,
    emailsGenerated: results.emails.length,
    companies: results.emails.map(e => e.company).filter(Boolean),
  });

  history.stats.totalExtractions += 1;
  history.stats.totalEmails += results.emails.length;
  history.stats.totalHiringPosts += results.extraction.hiringPostsFound;

  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
}

/**
 * Display final summary
 */
export function displayFinalSummary(results, outputPath) {
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));

  console.log(`\n   Posts analyzed:     ${results.extraction.totalPostsAnalyzed}`);
  console.log(`   Hiring posts:      ${results.extraction.hiringPostsFound}`);
  console.log(`   Emails generated:  ${results.emails.length}`);

  if (results.emails.length > 0) {
    console.log('\n   Generated emails for:');
    results.emails.forEach((email, i) => {
      console.log(`   ${i + 1}. ${email.company} - ${email.role} -> ${email.to}`);
    });
  }

  // Show posts without emails (DM/apply only)
  const dmOnly = (results.extraction.hiringPosts || []).filter(
    p => !p.emails || p.emails.length === 0
  );
  if (dmOnly.length > 0) {
    console.log('\n   Hiring posts (DM/apply link only - no email):');
    dmOnly.forEach((post, i) => {
      console.log(`   ${i + 1}. ${post.company} - ${post.role} (${post.contactMethod})`);
    });
  }

  console.log(`\n   Results saved to: ${outputPath}`);
  console.log('='.repeat(60));
}

export default { saveResults, logToHistory, displayFinalSummary };
