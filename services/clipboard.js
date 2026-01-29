/**
 * Clipboard Service - Read LinkedIn feed data from clipboard
 */

import clipboardy from 'clipboardy';
import { parseLinkedInResponse } from './parser.js';

/**
 * Read text from system clipboard
 * @returns {Promise<string>} clipboard contents
 */
export async function readClipboard() {
  console.log('   Reading feed data from clipboard...');

  try {
    const text = await clipboardy.read();
    if (!text || text.trim().length === 0) {
      throw new Error('Clipboard is empty');
    }
    return text.trim();
  } catch (error) {
    if (error.message === 'Clipboard is empty') throw error;
    throw new Error(
      'Could not read clipboard.\n' +
      'Copy the LinkedIn feed API response to your clipboard and try again.'
    );
  }
}

/**
 * Validate and parse clipboard content into clean feed data
 * @param {string} text - clipboard content
 * @returns {object} - parsed LinkedIn data (clean format)
 */
export function validateFeedData(text) {
  if (text.length < 20) {
    throw new Error(
      'Clipboard content is too short to be feed data.\n' +
      'Copy the full LinkedIn feed API response and try again.'
    );
  }

  // Try to parse as JSON
  let parsed;
  try {
    parsed = JSON.parse(text);
    console.log('   Valid JSON feed data detected');
  } catch {
    // Not JSON - return as raw text for Gemini to handle directly
    console.log('   Raw text feed data detected (not JSON)');
    return { source: 'raw', totalResults: 0, posts: [], rawText: text };
  }

  // Check if this is a LinkedIn API response we can parse
  const data = parsed?.data?.data;
  const included = parsed?.included;

  if (data && (data.searchDashClustersByAll || data.feedDashMainFeedByMainFeed) && included) {
    console.log('   LinkedIn API response detected, parsing...');
    return parseLinkedInResponse(parsed);
  }

  // Unknown JSON format — wrap it for Gemini to handle
  console.log('   Unknown JSON format, passing to AI as-is');
  return { source: 'unknown', totalResults: 0, posts: [], rawJson: parsed };
}

export default { readClipboard, validateFeedData };
