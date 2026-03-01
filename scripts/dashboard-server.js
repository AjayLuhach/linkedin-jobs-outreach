#!/usr/bin/env node

/**
 * Dashboard Server
 * Serves dashboard.html + sheet-backed API for cross-user email management.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listUserTabs,
  fetchUserEmails,
  approveUserEmail,
  rejectUserEmail,
  unapproveUserEmail,
  updateUserEmailContent,
  fetchAllPosts,
  updatePostStatus,
} from '../services/googleSheets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.DASHBOARD_PORT || 3456;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function parseUrl(url) {
  const [pathname, qs] = url.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  return { pathname, params };
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const { pathname, params } = parseUrl(req.url);

  try {
    // GET /api/users — list all user tabs
    if (req.method === 'GET' && pathname === '/api/users') {
      const users = await listUserTabs();
      return json(res, 200, { users });
    }

    // GET /api/emails?user=Ajay — fetch emails for a user
    if (req.method === 'GET' && pathname === '/api/emails') {
      const user = params.user;
      if (!user) return json(res, 400, { error: 'Missing ?user= parameter' });
      const emails = await fetchUserEmails(user, params.status || null);
      return json(res, 200, { user, emails });
    }

    // GET /api/emails/all — fetch emails for all users
    if (req.method === 'GET' && pathname === '/api/emails/all') {
      const users = await listUserTabs();
      const all = {};
      for (const user of users) {
        all[user] = await fetchUserEmails(user, params.status || null);
      }
      return json(res, 200, { users: all });
    }

    // POST /api/approve — { user, postId, approvedBy }
    if (req.method === 'POST' && pathname === '/api/approve') {
      const body = JSON.parse(await readBody(req));
      if (!body.user || !body.postId) return json(res, 400, { error: 'Missing user or postId' });
      const ok = await approveUserEmail(body.user, body.postId, body.approvedBy || 'Dashboard');
      if (!ok) return json(res, 404, { error: 'Email not found' });
      return json(res, 200, { ok: true });
    }

    // POST /api/reject — { user, postId }
    if (req.method === 'POST' && pathname === '/api/reject') {
      const body = JSON.parse(await readBody(req));
      if (!body.user || !body.postId) return json(res, 400, { error: 'Missing user or postId' });
      const ok = await rejectUserEmail(body.user, body.postId);
      if (!ok) return json(res, 404, { error: 'Email not found' });
      return json(res, 200, { ok: true });
    }

    // POST /api/emails/update — { user, postId, subject, body }
    if (req.method === 'POST' && pathname === '/api/emails/update') {
      const body = JSON.parse(await readBody(req));
      if (!body.user || !body.postId) return json(res, 400, { error: 'Missing user or postId' });
      if (body.subject == null || body.body == null) return json(res, 400, { error: 'Missing subject or body' });
      const ok = await updateUserEmailContent(body.user, body.postId, { subject: body.subject, body: body.body });
      if (!ok) return json(res, 404, { error: 'Email not found' });
      return json(res, 200, { ok: true });
    }

    // POST /api/unapprove — { user, postId }
    if (req.method === 'POST' && pathname === '/api/unapprove') {
      const body = JSON.parse(await readBody(req));
      if (!body.user || !body.postId) return json(res, 400, { error: 'Missing user or postId' });
      const ok = await unapproveUserEmail(body.user, body.postId);
      if (!ok) return json(res, 404, { error: 'Email not found' });
      return json(res, 200, { ok: true });
    }

    // GET /api/posts — fetch all posts from shared Posts tab
    if (req.method === 'GET' && pathname === '/api/posts') {
      const posts = await fetchAllPosts();
      return json(res, 200, { posts });
    }

    // POST /api/posts/skip — { postId }
    if (req.method === 'POST' && pathname === '/api/posts/skip') {
      const body = JSON.parse(await readBody(req));
      if (!body.postId) return json(res, 400, { error: 'Missing postId' });
      const ok = await updatePostStatus(body.postId, 'skipped');
      if (!ok) return json(res, 404, { error: 'Post not found' });
      return json(res, 200, { ok: true });
    }

    // POST /api/posts/restore — { postId }
    if (req.method === 'POST' && pathname === '/api/posts/restore') {
      const body = JSON.parse(await readBody(req));
      if (!body.postId) return json(res, 400, { error: 'Missing postId' });
      const ok = await updatePostStatus(body.postId, 'hiring');
      if (!ok) return json(res, 404, { error: 'Post not found' });
      return json(res, 200, { ok: true });
    }

    // Static file serving
    let filePath = pathname === '/' ? '/dashboard.html' : pathname;
    filePath = path.join(ROOT, decodeURIComponent(filePath));

    if (!filePath.startsWith(ROOT)) return json(res, 403, { error: 'Forbidden' });

    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return json(res, 404, { error: 'Not found' });
    }
    console.error('API error:', err.message);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n   Dashboard → http://localhost:${PORT}`);
  console.log('   Press Ctrl+C to stop\n');
});
