/**
 * JSON File Database — Replaces Google Sheets
 *
 * Posts stored in: data/posts.json
 * Per-user emails stored in: data/users/{username}.json
 *
 * Same API surface as the old googleSheets.js so callers need minimal changes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const USERS_DIR = path.join(DATA_DIR, 'users');

// ============================================================
// FILE HELPERS
// ============================================================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function userFilePath(username) {
  return path.join(USERS_DIR, `${username}.json`);
}

// ============================================================
// POSTS DB
// ============================================================

function loadPosts() {
  return readJSON(POSTS_FILE) || { posts: [] };
}

function savePosts(data) {
  writeJSON(POSTS_FILE, data);
}

// ============================================================
// USER DB
// ============================================================

function loadUserData(username) {
  return readJSON(userFilePath(username)) || { emails: [] };
}

function saveUserData(username, data) {
  writeJSON(userFilePath(username), data);
}

// ============================================================
// POSTS TAB — Shared pool
// ============================================================

/**
 * Fetch all Post IDs from the posts DB (for dedup).
 */
const fetchExistingPostIds = async () => {
  const data = loadPosts();
  return new Set(data.posts.map(p => p.postId));
};

/**
 * Push Phase 1 extraction results to the shared posts DB.
 * Only pushes hiring posts. Deduplicates by Post ID.
 */
const pushPhase1ToSheet = async (extracted, originalPosts, addedBy = 'CLI') => {
  const data = loadPosts();
  const existingIds = new Set(data.posts.map(p => p.postId));

  const postLookup = new Map();
  for (const p of originalPosts) {
    postLookup.set(p.id, p);
  }

  let added = 0;
  let skipped = 0;

  for (const ex of extracted) {
    const postId = ex.postId;
    if (existingIds.has(postId)) {
      skipped++;
      continue;
    }

    const original = postLookup.get(postId) || {};
    const now = new Date().toISOString();

    data.posts.push({
      postId,
      addedBy,
      addedAt: now,
      author: {
        name: ex.poster?.name || original.author?.name || '',
        headline: ex.poster?.headline || original.author?.headline || '',
        profileUrl: original.author?.profileUrl || '',
      },
      postText: original.post?.text || '',
      summary: ex.summary || '',
      hashtags: (original.post?.hashtags || []).join(', '),
      job: {
        title: ex.job?.title || '',
        company: ex.job?.company || '',
        type: ex.job?.type || '',
        location: original.job?.location || '',
        requirements: (ex.job?.requirements || []).join(', '),
        requiredExperience: ex.job?.requiredExperience != null ? `${ex.job.requiredExperience}` : '',
        salary: ex.job?.salary || (ex.job?.salaryMinLPA ? `${ex.job.salaryMinLPA}-${ex.job.salaryMaxLPA} LPA` : ''),
      },
      contactEmails: (ex.contacts?.emails || []).join(', '),
      jobUrl: original.job?.jobUrl || '',
      score: '',
      status: 'hiring',
      notes: '',
    });

    existingIds.add(postId);
    added++;
  }

  savePosts(data);

  console.log(`   Posts DB: ${added} post(s) added, ${skipped} duplicate(s) skipped`);
  return { added, skipped };
};

/**
 * Parse a stored post back into the structured format that scoring expects.
 */
function parseStoredPost(p) {
  const salaryMinLPA = null;
  const salaryMaxLPA = null;
  const salary = p.job?.salary || '';
  let parsedMin = null;
  let parsedMax = null;
  const lpaMatch = salary.match(/([\d.]+)\s*-\s*([\d.]+)\s*LPA/i);
  if (lpaMatch) {
    parsedMin = parseFloat(lpaMatch[1]);
    parsedMax = parseFloat(lpaMatch[2]);
  }

  return {
    postId: p.postId,
    addedBy: p.addedBy || '',
    addedAt: p.addedAt || '',
    poster: {
      name: p.author?.name || '',
      headline: p.author?.headline || '',
    },
    postText: p.postText || '',
    summary: p.summary || '',
    job: {
      title: p.job?.title || '',
      company: p.job?.company || '',
      type: p.job?.type || '',
      location: p.job?.location || '',
      requirements: (p.job?.requirements || '').split(',').map(s => s.trim()).filter(Boolean),
      requiredExperience: p.job?.requiredExperience ? parseFloat(p.job.requiredExperience) : null,
      salary: p.job?.salary || null,
      salaryMinLPA: parsedMin,
      salaryMaxLPA: parsedMax,
    },
    contacts: {
      emails: (p.contactEmails || '').split(',').map(s => s.trim()).filter(Boolean),
      method: (p.contactEmails || '').trim() ? 'email' : 'DM',
    },
    status: (p.status || 'hiring').toLowerCase(),
  };
}

/**
 * Fetch all hiring posts (status != skipped).
 */
const fetchHiringPosts = async () => {
  const data = loadPosts();
  const posts = data.posts.map(parseStoredPost).filter(p => p.status !== 'skipped');
  console.log(`   Posts DB: ${posts.length} hiring post(s) fetched`);
  return posts;
};

/**
 * Fetch ALL posts (including skipped). Used by dashboard.
 */
const fetchAllPosts = async () => {
  const data = loadPosts();
  const posts = data.posts.map(parseStoredPost);
  console.log(`   Posts DB: ${posts.length} total post(s) fetched`);
  return posts;
};

/**
 * Update a post's status.
 */
const updatePostStatus = async (postId, status) => {
  const data = loadPosts();
  const post = data.posts.find(p => p.postId === postId);
  if (!post) return false;
  post.status = status;
  savePosts(data);
  return true;
};

// ============================================================
// USER TABS — Per-user email storage
// ============================================================

/**
 * Get Post IDs already in a user's data (for dedup).
 */
const fetchUserTabPostIds = async (username, opts = {}) => {
  const data = loadUserData(username);
  const { excludeStatuses } = opts;
  const ids = new Set();
  for (const e of data.emails) {
    if (!e.postId) continue;
    if (excludeStatuses && excludeStatuses.includes(e.status)) continue;
    ids.add(e.postId);
  }
  return ids;
};

/**
 * Push scored + drafted contacts to a user's data.
 */
const pushEmailsToUserTab = async (username, contacts, opts = {}) => {
  const data = loadUserData(username);
  const existingIds = new Set(data.emails.map(e => e.postId));

  let added = 0;
  let skipped = 0;
  let updated = 0;

  for (const c of contacts) {
    if (existingIds.has(c.postId)) {
      // Check if this is a drafted row we should update (redraft mode)
      if (opts.redraft && c.email?.body) {
        const existing = data.emails.find(e => e.postId === c.postId && e.status === 'drafted');
        if (existing) {
          existing.emailTo = c.email.to || '';
          existing.subject = c.email.subject || '';
          existing.body = c.email.body || '';
          existing.status = 'drafted';
          existing.approvedBy = '';
          existing.generatedAt = new Date().toISOString();
          updated++;
          continue;
        }
      }
      skipped++;
      continue;
    }

    data.emails.push({
      postId: c.postId,
      authorName: c.poster?.name || '',
      authorHeadline: c.poster?.headline || '',
      jobTitle: c.job?.title || '',
      company: c.job?.company || '',
      requirements: (c.job?.requirements || []).join(', '),
      score: c.match?.score ?? '',
      matchReason: c.match?.reason || '',
      emailTo: c.email?.to || '',
      subject: c.email?.subject || '',
      body: c.email?.body || '',
      status: c.email?.body ? 'drafted' : 'no_email',
      approvedBy: '',
      generatedAt: new Date().toISOString(),
      sentAt: '',
      postSummary: c.summary || '',
      jobType: c.job?.type || '',
      experience: c.job?.requiredExperience != null ? `${c.job.requiredExperience}` : '',
      salary: c.job?.salary || (c.job?.salaryMinLPA ? `${c.job.salaryMinLPA}-${c.job.salaryMaxLPA} LPA` : ''),
    });
    existingIds.add(c.postId);
    added++;
  }

  saveUserData(username, data);

  const parts = [`${added} added`, `${skipped} skipped`];
  if (updated > 0) parts.push(`${updated} re-drafted`);
  console.log(`   ${username}: ${parts.join(', ')}`);
  return { added, skipped, updated };
};

/**
 * Fetch emails from a user's data, optionally filtering by status.
 */
const fetchUserEmails = async (username, statusFilter = null) => {
  const data = loadUserData(username);

  const emails = [];
  for (const e of data.emails) {
    const status = (e.status || '').toLowerCase();
    if (statusFilter && status !== statusFilter.toLowerCase()) continue;

    emails.push({
      postId: e.postId,
      poster: { name: e.authorName || '', headline: e.authorHeadline || '' },
      job: {
        title: e.jobTitle || '',
        company: e.company || '',
        type: e.jobType || '',
        experience: e.experience || '',
        salary: e.salary || '',
      },
      requirements: e.requirements || '',
      score: e.score ? parseInt(e.score) : 0,
      matchReason: e.matchReason || '',
      email: {
        to: e.emailTo || '',
        subject: e.subject || '',
        body: e.body || '',
      },
      status,
      approvedBy: e.approvedBy || '',
      generatedAt: e.generatedAt || '',
      sentAt: e.sentAt || '',
      postSummary: e.postSummary || '',
    });
  }

  return emails;
};

/**
 * Internal: find and update a user email entry.
 */
function _updateUserEmail(username, postId, updateFn) {
  const data = loadUserData(username);
  const entry = data.emails.find(e => e.postId === postId);
  if (!entry) return false;
  updateFn(entry);
  saveUserData(username, data);
  return true;
}

const approveUserEmail = async (username, postId, approvedBy) =>
  _updateUserEmail(username, postId, e => {
    e.status = 'approved';
    e.approvedBy = approvedBy || '';
  });

const rejectUserEmail = async (username, postId) =>
  _updateUserEmail(username, postId, e => {
    e.status = 'rejected';
    e.approvedBy = '';
  });

const unapproveUserEmail = async (username, postId) =>
  _updateUserEmail(username, postId, e => {
    e.status = 'drafted';
    e.approvedBy = '';
  });

const markUserEmailSent = async (username, postId) =>
  _updateUserEmail(username, postId, e => {
    e.status = 'sent';
    e.sentAt = new Date().toISOString();
  });

/**
 * Update email content (subject + body) for a user's email.
 */
const updateUserEmailContent = async (username, postId, { subject, body }) =>
  _updateUserEmail(username, postId, e => {
    e.subject = subject;
    e.body = body;
  });

/**
 * Batch reject emails for a user.
 */
const batchRejectUserEmails = async (username, postIds) => {
  const data = loadUserData(username);
  const idSet = new Set(postIds);
  const succeeded = [];
  const failed = [];

  for (const postId of postIds) {
    const entry = data.emails.find(e => e.postId === postId);
    if (entry) {
      entry.status = 'rejected';
      entry.approvedBy = '';
      succeeded.push(postId);
    } else {
      failed.push(postId);
    }
  }

  saveUserData(username, data);
  return { succeeded, failed };
};

/**
 * Batch approve emails for a user.
 */
const batchApproveUserEmails = async (username, postIds, approvedBy = 'Dashboard') => {
  const data = loadUserData(username);
  const succeeded = [];
  const failed = [];

  for (const postId of postIds) {
    const entry = data.emails.find(e => e.postId === postId);
    if (entry) {
      entry.status = 'approved';
      entry.approvedBy = approvedBy;
      succeeded.push(postId);
    } else {
      failed.push(postId);
    }
  }

  saveUserData(username, data);
  return { succeeded, failed };
};

/**
 * Batch update email contents for a user.
 */
const batchUpdateUserEmailContents = async (username, updates) => {
  const data = loadUserData(username);
  const succeeded = [];
  const failed = [];

  for (const { postId, subject, body } of updates) {
    const entry = data.emails.find(e => e.postId === postId);
    if (entry) {
      entry.subject = subject;
      entry.body = body;
      succeeded.push(postId);
    } else {
      failed.push(postId);
    }
  }

  saveUserData(username, data);
  return { succeeded, failed };
};

/**
 * List all user data files (equivalent to listing user tabs).
 */
const listUserTabs = async () => {
  ensureDir(USERS_DIR);
  const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => f.replace('.json', ''));
};

export {
  // Posts
  pushPhase1ToSheet,
  fetchExistingPostIds,
  fetchHiringPosts,
  fetchAllPosts,
  updatePostStatus,
  // User emails
  fetchUserTabPostIds,
  pushEmailsToUserTab,
  fetchUserEmails,
  approveUserEmail,
  rejectUserEmail,
  unapproveUserEmail,
  updateUserEmailContent,
  markUserEmailSent,
  batchRejectUserEmails,
  batchApproveUserEmails,
  batchUpdateUserEmailContents,
  listUserTabs,
};
