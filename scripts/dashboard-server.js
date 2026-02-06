#!/usr/bin/env node

/**
 * Dashboard Server
 * Serves dashboard.html + handles approve/unapprove API endpoints.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { approveContact, unapproveContact, rejectContact, unrejectContact } from '../services/contacts-store.js';

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

  // API: POST /api/approve
  if (req.method === 'POST' && req.url === '/api/approve') {
    const body = JSON.parse(await readBody(req));
    const contact = approveContact(body.postId);
    if (!contact) return json(res, 404, { error: 'Contact not found' });
    return json(res, 200, { ok: true, scheduledAt: contact.scheduledAt });
  }

  // API: POST /api/unapprove
  if (req.method === 'POST' && req.url === '/api/unapprove') {
    const body = JSON.parse(await readBody(req));
    const contact = unapproveContact(body.postId);
    if (!contact) return json(res, 404, { error: 'Contact not found' });
    return json(res, 200, { ok: true });
  }

  // API: POST /api/reject
  if (req.method === 'POST' && req.url === '/api/reject') {
    const body = JSON.parse(await readBody(req));
    const contact = rejectContact(body.postId);
    if (!contact) return json(res, 404, { error: 'Contact not found' });
    return json(res, 200, { ok: true });
  }

  // API: POST /api/unreject
  if (req.method === 'POST' && req.url === '/api/unreject') {
    const body = JSON.parse(await readBody(req));
    const contact = unrejectContact(body.postId);
    if (!contact) return json(res, 404, { error: 'Contact not found' });
    return json(res, 200, { ok: true });
  }

  // Static file serving
  let filePath = req.url === '/' ? '/dashboard.html' : req.url;
  filePath = path.join(ROOT, decodeURIComponent(filePath));

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) return json(res, 403, { error: 'Forbidden' });

  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, () => {
  console.log(`\n   Dashboard → http://localhost:${PORT}`);
  console.log('   Press Ctrl+C to stop\n');
});
