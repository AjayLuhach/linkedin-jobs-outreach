/**
 * Clipboard Service - Read and auto-detect LinkedIn data format
 */

import clipboardy from 'clipboardy';
import { parseFeedJSON } from './parse-linkedin-feed.js';
import { parseHTML } from './parse-linkedin-html.js';

/**
 * Read text from system clipboard
 * @returns {Promise<string>} clipboard contents
 */
export async function readClipboard() {
  console.log('   Reading from clipboard...');
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
      'Copy LinkedIn feed data (HTML or API JSON) to your clipboard and try again.'
    );
  }
}

/**
 * Auto-detect format and parse into normalized posts.
 * Supports: LinkedIn HTML, LinkedIn API JSON, raw text.
 * @param {string} text - raw input text
 * @returns {{ posts: object[], source: string }}
 */
export function detectAndParse(text) {
  if (text.length < 20) {
    throw new Error('Input is too short to be feed data.');
  }

  // Check if it looks like HTML
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<') || trimmed.includes('role="article"') || trimmed.includes('data-urn="urn:li:activity:')) {
    console.log('   Detected: LinkedIn HTML');
    const result = parseHTML(text);
    return { ...result, source: 'html' };
  }

  // Try to parse as JSON
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON, not HTML — raw text
    console.log('   Detected: Raw text (not JSON or HTML)');
    return { posts: [], source: 'raw', rawText: text };
  }

  // Check if it's a LinkedIn API response
  const data = parsed?.data?.data;
  if (data && (data.searchDashClustersByAll || data.feedDashMainFeedByMainFeed) && parsed.included) {
    console.log('   Detected: LinkedIn API JSON');
    const result = parseFeedJSON(parsed);
    return { ...result, source: 'api' };
  }

  // Check if it's already a posts array or object with posts
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
    console.log('   Detected: Posts array JSON');
    const now = new Date().toISOString();
    const posts = parsed.map(p => ({
      id: p.id,
      source: 'json',
      extractedAt: now,
      processed: false,
      author: p.author || { name: null, headline: null, profileUrl: null },
      post: { text: p.content || p.text || null, postedAgo: null, hashtags: [] },
      job: p.job || null,
      engagement: { reactions: p.reactions || 0, comments: p.comments || 0, reposts: p.reposts || 0 },
    }));
    return { posts, source: 'json' };
  }

  if (parsed.posts && Array.isArray(parsed.posts)) {
    console.log('   Detected: Posts object JSON');
    const now = new Date().toISOString();
    const posts = parsed.posts.map(p => ({
      id: p.id,
      source: 'json',
      extractedAt: now,
      processed: false,
      author: p.author || { name: null, headline: null, profileUrl: null },
      post: { text: p.content || p.text || null, postedAgo: null, hashtags: [] },
      job: p.job || null,
      engagement: { reactions: p.reactions || 0, comments: p.comments || 0, reposts: p.reposts || 0 },
    }));
    return { posts, source: 'json' };
  }

  // Unknown JSON
  console.log('   Detected: Unknown JSON format');
  return { posts: [], source: 'unknown', rawJson: parsed };
}
