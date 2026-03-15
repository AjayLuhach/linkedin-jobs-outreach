/**
 * AI Service - AWS Bedrock + Gemma 3 27B (3-phase pipeline)
 * Phase 1: AI extraction — structured data + post summary
 * Phase 2: Code scoring — deterministic skill/experience/salary matching
 * Phase 3: AI email drafting — only for qualifying contacts
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { checkRawPost, checkExtractedPost } from './location-filter.js';

const OUTPUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'output');

// ============================================================
// BEDROCK CLIENT
// ============================================================

let client = null;

function getClient() {
  if (client) return client;

  const { accessKeyId, secretAccessKey, region } = config.bedrock;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS Bedrock credentials not set.\n' +
      'Add to .env:\n' +
      '  AWS_ACCESS_KEY_ID=your_key\n' +
      '  AWS_SECRET_ACCESS_KEY=your_secret\n' +
      '  AWS_REGION=us-east-1'
    );
  }

  client = new BedrockRuntimeClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

// ============================================================
// INVOKE MODEL (Gemma on Bedrock)
// ============================================================

async function invokeModel(prompt, stepName) {
  const bedrockClient = getClient();
  const modelId = config.bedrock.modelId;

  const body = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 8192,
    temperature: 0.1,
    top_p: 0.9,
  });

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  });

  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return extractText(responseBody);
  } catch (error) {
    const msg = error.message || '';

    if (msg.includes('ThrottlingException') || msg.includes('429') || msg.includes('Too many requests')) {
      console.log(`   Throttled, waiting 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      const retryResponse = await bedrockClient.send(command);
      const retryBody = JSON.parse(new TextDecoder().decode(retryResponse.body));
      return extractText(retryBody);
    }

    throw new Error(`Bedrock ${stepName} failed: ${msg}`);
  }
}

function extractText(responseBody) {
  // OpenAI-compatible (Gemma on Bedrock)
  if (responseBody.choices) {
    return responseBody.choices[0]?.message?.content || responseBody.choices[0]?.text || '';
  }
  // Google Vertex-style
  if (responseBody.candidates) {
    const parts = responseBody.candidates[0]?.content?.parts;
    if (parts?.length) return parts.map(p => p.text || '').join('');
  }
  console.warn(`   Unknown response format, keys: ${Object.keys(responseBody).join(', ')}`);
  return JSON.stringify(responseBody);
}

// ============================================================
// JSON PARSER (with truncation repair)
// ============================================================

function parseJSON(response, step = '') {
  let text = response.trim();
  if (text.startsWith('```json')) text = text.slice(7);
  else if (text.startsWith('```')) text = text.slice(3);
  if (text.endsWith('```')) text = text.slice(0, -3);
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch {
    console.log(`   Repairing truncated JSON in ${step}...`);
    let repaired = text;

    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      const lastQuoteIdx = repaired.lastIndexOf('"');
      const beforeLastQuote = repaired.substring(0, lastQuoteIdx);
      const lastComma = beforeLastQuote.lastIndexOf(',');
      if (lastComma > 0) repaired = repaired.substring(0, lastComma);
    }

    repaired = repaired.replace(/,\s*$/, '');

    const opens = (repaired.match(/\[/g) || []).length;
    const closes = (repaired.match(/\]/g) || []).length;
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;

    for (let i = 0; i < opens - closes; i++) repaired += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';

    try {
      const result = JSON.parse(repaired);
      console.log(`   JSON repaired successfully`);
      return result;
    } catch (error2) {
      console.error(`\n   JSON parse failed in ${step}:`);
      console.error(text.substring(0, 500));
      throw error2;
    }
  }
}

// ============================================================
// PHASE 1: EXTRACTION PROMPT
// ============================================================

function buildExtractionPrompt(posts) {
  const postsData = posts.map((p, i) => ({
    index: i + 1,
    id: p.id,
    author: p.author?.name || 'Unknown',
    authorHeadline: p.author?.headline || '',
    text: p.post?.text || '',
    jobTitle: p.job?.title || null,
    jobCompany: p.job?.company || null,
    hashtags: (p.post?.hashtags || []).join(', '),
  }));

  return `Extract structured job data from these ${posts.length} LinkedIn posts.
The candidate is a Full Stack MERN Developer (React, Node.js, Express, MongoDB, TypeScript, AWS) with ~3 years of experience based in India. Focus on extracting roles relevant to web development, backend, frontend, or full-stack engineering.

POSTS:
${JSON.stringify(postsData, null, 2)}

FOR EACH POST, extract:
1. isHiring: Is this post from someone HIRING or a company recruiting? (true/false)
2. If isHiring=true, extract:
   - poster: name and headline from the post author
   - summary: 3-4 line summary of the post — what the role needs, key responsibilities, any standout details (team, product, tech stack context)
   - job.title: job role being hired for
   - job.company: company name (null if not mentioned)
   - job.type: "full-time", "contract", "intern", or "remote"
   - job.requirements: 5 to 8 top TECHNICAL skills/technologies required (short strings like "React", "Node.js", "PostgreSQL", "Docker", "TypeScript"). Extract only technology/tool names, not soft skills
   - job.requiredExperience: years of experience required as a number (e.g. "5+ years" → 5, "3-5 years" → 3). null if not mentioned
   - job.salary: original salary text from the post (null if not mentioned)
   - job.salaryMinLPA: minimum salary normalized to Indian Lakhs Per Annum (number or null)
   - job.salaryMaxLPA: maximum salary normalized to Indian Lakhs Per Annum (number or null)
   - contacts.emails: array of email addresses found in post text
     - Match: user@domain.com, name [at] company [dot] com
     - ONLY valid emails with @ and domain. NEVER include URLs, phone numbers, or links
   - contacts.method: "email" if emails found, "DM" if none

3. If isHiring=false: set all fields to defaults (empty strings, null, empty arrays)

MULTI-ROLE POSTS: If a single post lists MULTIPLE distinct job roles (e.g. "Hiring: Node.js Developer, PHP Developer, IT Recruiter"), create a SEPARATE result entry for EACH role that is relevant to a MERN/full-stack/backend/frontend developer. Use the SAME postId for all entries from the same post but different job titles. Skip roles that are clearly non-tech (HR, recruiter, sales, etc.) unless the candidate context matches.

RESPOND WITH ONLY A JSON OBJECT (no markdown, no code fences):
{"results":[{"postId":"id","isHiring":true,"poster":{"name":"Name","headline":"Headline"},"summary":"Looking for a senior React dev to build a dashboard. Remote friendly, urgent hire.","job":{"title":"Role","company":"Co","type":"full-time","requirements":["React","Node.js","MongoDB","TypeScript","Docker","AWS"],"requiredExperience":3,"salary":"8-12 LPA","salaryMinLPA":8,"salaryMaxLPA":12},"contacts":{"emails":["a@b.com"],"method":"email"}}]}

RULES:
- Non-hiring posts: isHiring=false, empty defaults
- requirements: 5-8 short technical skill/technology names ONLY (not sentences, not soft skills)
- NEVER put URLs (http://, https://, lnkd.in) in contacts.emails
- requiredExperience: use the MINIMUM mentioned (e.g. "5-8 years" → 5) or if not mentioned in years derive from the words
- summary: 3-4 lines, capture what the role needs, key responsibilities,experience needed and any standout details (team size, product, tech stack context)
- Mark isHiring=false if the person is LOOKING FOR a job themselves (#OpenToWork, "actively looking", "seeking opportunities", "open to roles"). These are job SEEKERS, not employers hiring
- Mark isHiring=false if the minimum experience required is 4+ years (candidate has ~3 years)
- Mark isHiring=false if the role is primarily a TRAINER, TEACHING, or INSTRUCTOR position (not a developer/engineer role)
- Mark isHiring=false if the PRIMARY technology required is NOT related to web/frontend/backend/full-stack (e.g. Java-only, .NET-only, Python-only, AI/ML-only roles). The candidate is a MERN developer — only extract roles where JavaScript/TypeScript/Node.js/React is a core requirement

CRITICAL REJECTION RULES

Set isHiring=false if ANY of these apply:
1. Interview requires physical presence
   - walk-in, face-to-face, F2F, in-person interview.
2. Candidate location is restricted
   - phrases like "local candidates only", "only from <city>", "must be from Delhi/NCR".
   - mentioning an office or relocation is OK.
3. Job location is outside India
   - non-Indian cities or domains (.pk, .bd, .ae, .uk, .us, etc).
4. Role type or salary invalid
   - internship or contract roles
   - salary < 6 LPA (monthly ×12, hourly ×2080×₹85).

Remote, hybrid, on-site jobs in India without location restrictions are valid.

`;
}

// ============================================================
// PHASE 2: CODE-BASED SCORING (zero AI cost)
// ============================================================

function normalizeSkill(skill) {
  return skill
    .toLowerCase()
    .replace(/[.\-\/\\()]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// Build lookup from resumeData.json skillsWithAliases
function buildSkillLookup(candidate) {
  const lookup = new Set();
  const skillsMap = candidate.skillsWithAliases || {};

  for (const [skillName, aliases] of Object.entries(skillsMap)) {
    // Add the canonical name normalized
    lookup.add(normalizeSkill(skillName));
    // Add all aliases
    for (const alias of aliases) {
      lookup.add(alias.toLowerCase().replace(/\s+/g, ''));
    }
  }

  return lookup;
}

// Build blocklist from cannotClaim
function buildCannotClaimSet(candidate) {
  const blocked = new Set();
  for (const skill of (candidate.cannotClaim || [])) {
    blocked.add(normalizeSkill(skill));
  }
  return blocked;
}

// Check if a required skill matches any known skill (exact or safe word-boundary match)
function matchesSkill(normReq, skillLookup, cannotClaimSet) {
  // Block if skill is in cannotClaim (exact match)
  if (cannotClaimSet.has(normReq)) return false;

  // Exact match against skill lookup
  if (skillLookup.has(normReq)) return true;

  // Word-boundary safe matching: only match if the requirement IS a known skill
  // or a known skill IS the requirement (exact containment with length guard)
  // Minimum token length of 3 to avoid false positives like "go" in "mongo", "ai" in "restapi"
  for (const s of skillLookup) {
    // Skip very short tokens for substring matching (exact already checked above)
    if (s.length < 3 && normReq.length < 3) continue;

    // Only allow containment if the shorter string is at least 60% the length of the longer
    // This prevents "go" matching "mongo", "ai" matching "restapi"
    const shorter = s.length <= normReq.length ? s : normReq;
    const longer = s.length <= normReq.length ? normReq : s;

    if (shorter.length < 3) continue; // never substring-match 1-2 char tokens

    if (longer === shorter) return true; // exact
    if (longer.startsWith(shorter) || longer.endsWith(shorter)) {
      // Prefix/suffix match is OK for things like "nodejs" matching "node"
      // but verify it's not a cannotClaim skill
      if (!cannotClaimSet.has(normReq)) return true;
    }
  }

  return false;
}

function scoreContact(extracted, candidate) {
  const maxExp = Math.ceil(parseFloat(candidate.experience) + 1);
  const reqExp = extracted.job?.requiredExperience;

  // Experience filter
  if (reqExp != null && reqExp > maxExp) {
    return {
      isGoodMatch: false,
      score: 0,
      reason: `Experience requirement too high (needs ${reqExp}yr, max ${maxExp}yr)`,
    };
  }

  // Salary filter
  const salaryMax = extracted.job?.salaryMaxLPA;
  if (salaryMax != null && salaryMax < 7) {
    return {
      isGoodMatch: false,
      score: 0,
      reason: `Salary below 7 LPA (${salaryMax} LPA)`,
    };
  }

  // Location filter — safety net for posts that slipped through pre-filter
  const locationReject = checkExtractedPost(extracted);
  if (locationReject) {
    return {
      isGoodMatch: false,
      score: 0,
      reason: locationReject,
    };
  }

  // Skill matching
  const requirements = extracted.job?.requirements || [];
  if (requirements.length === 0) {
    return { isGoodMatch: false, score: 0, reason: 'No requirements extracted' };
  }

  const skillLookup = buildSkillLookup(candidate);
  const cannotClaimSet = buildCannotClaimSet(candidate);
  let matched = 0;
  const matchedSkills = [];
  const missingSkills = [];

  for (const req of requirements) {
    const normReq = normalizeSkill(req);

    if (matchesSkill(normReq, skillLookup, cannotClaimSet)) {
      matched++;
      matchedSkills.push(req);
    } else {
      missingSkills.push(req);
    }
  }

  const score = Math.round((matched / requirements.length) * 10);
  const isGoodMatch = score >= 8;

  let reason;
  if (isGoodMatch) {
    reason = `Strong match: ${matchedSkills.join(', ')}`;
  } else if (score >= 5) {
    reason = `Partial match: has ${matchedSkills.join(', ')}; missing ${missingSkills.join(', ')}`;
  } else {
    reason = `Low match: missing ${missingSkills.join(', ')}`;
  }

  return { isGoodMatch, score, reason, matchedSkills, missingSkills };
}

// ============================================================
// PHASE 3: EMAIL DRAFTING PROMPT
// ============================================================

function buildEmailPrompt(contacts, candidate) {
  const contactsData = contacts.map(c => ({
    postId: c.postId,
    posterName: c.poster?.name,
    posterHeadline: c.poster?.headline,
    postSummary: c.summary || '',
    jobTitle: c.job?.title,
    company: c.job?.company,
    requirements: c.job?.requirements,
    matchedSkills: c.match?.matchedSkills || [],
    emailTo: c.contacts?.emails?.[0],
  }));

  return `Write short personalized job application emails for these ${contacts.length} opportunities.

CONTACTS:
${JSON.stringify(contactsData, null, 2)}

CANDIDATE:
- Name: ${candidate.name}
- Role: Full Stack ${candidate.stack} Developer
- Experience: ${candidate.experience}
- Key Skills: ${candidate.skills.slice(0, 15).join(', ')}
- Summary: ${candidate.summary}
FOR EACH CONTACT, generate:
- subject: short natural subject line (not salesy)
- body: email (90-140 words, single flowing paragraph — NO sign-off):
  - Start with a generic greeting (e.g. "Hi," or "Hello,") followed by a newline (\\n\\n) BEFORE the rest of the email body — the greeting MUST be on its own line
  - Reference something specific from the postSummary that caught your eye, then naturally weave in 3-4 skills from matchedSkills with brief context from experience. ONLY mention skills from matchedSkills — never claim skills you don't have
  - End with a note about attached resume and interest in discussing further
  - Do NOT include any sign-off (name, portfolio, linkedin, github) — it is appended automatically
  - Keep it conversational, human, no corporate fluff
  - Plain text only, NO markdown, NO brackets
  - Do NOT split into more than 2 paragraphs — keep it as two cohesive paragraphs

RESPOND WITH ONLY JSON (no markdown, no code fences):
{"emails":[{"postId":"id","subject":"Subject","body":"Email body"}]}`;
}

// ============================================================
// PHASE 1 ONLY — AI Extraction (for pushing to shared sheet)
// ============================================================

export async function extractPhase1(posts) {
  const batchSize = parseInt(process.env.BATCH_SIZE) || 7;
  const modelId = config.bedrock.modelId;

  // Pre-filter: reject non-India / F2F posts before wasting API calls
  const filtered = [];
  const locationRejected = [];
  for (const post of posts) {
    const reason = checkRawPost(post);
    if (reason) {
      locationRejected.push({ id: post.id, author: post.author?.name, reason });
    } else {
      filtered.push(post);
    }
  }

  if (locationRejected.length > 0) {
    console.log(`\n   PRE-FILTER: ${locationRejected.length} posts rejected (location/F2F)`);
    for (const r of locationRejected) {
      console.log(`   [✗] ${r.author || '?'} — ${r.reason}`);
    }
  }

  console.log(`\n   PHASE 1: AI Extraction`);
  console.log(`   Model: ${modelId} | Posts: ${filtered.length}/${posts.length} (${locationRejected.length} pre-filtered) | Batch: ${batchSize}\n`);

  const totalBatches = Math.ceil(filtered.length / batchSize);

  const batches = [];
  for (let i = 0; i < filtered.length; i += batchSize) {
    batches.push({
      posts: filtered.slice(i, i + batchSize),
      batchNum: Math.floor(i / batchSize) + 1,
    });
  }

  const batchPromises = batches.map(({ posts: batchPosts, batchNum }) => {
    console.log(`   [Extract] Batch ${batchNum}/${totalBatches} (${batchPosts.length} posts) — sending`);
    const prompt = buildExtractionPrompt(batchPosts);
    return invokeModel(prompt, `Extract-${batchNum}`)
      .then(responseText => ({ batchNum, responseText, error: null }))
      .catch(error => ({ batchNum, responseText: null, error }));
  });

  const batchResults = await Promise.all(batchPromises);
  const extracted = [];

  let extractFailed = 0;
  for (const { batchNum, responseText, error } of batchResults) {
    if (error) {
      console.log(`   [Extract] Batch ${batchNum} FAILED (API): ${error.message}`);
      extractFailed++;
      continue;
    }

    try {
      const parsed = parseJSON(responseText, `Extract-${batchNum}`);
      const results = Array.isArray(parsed.results) ? parsed.results
        : Array.isArray(parsed) ? parsed : [];

      for (const result of results) {
        if (result.isHiring) {
          if (result.contacts?.emails) {
            result.contacts.emails = result.contacts.emails.filter(
              e => e.includes('@') && !e.startsWith('http')
            );
            result.contacts.method = result.contacts.emails.length > 0 ? 'email' : 'DM';
          }
          extracted.push(result);
        }
      }

      console.log(`   [Extract] Batch ${batchNum}: ${results.filter(r => r.isHiring).length} hiring posts found`);
    } catch (parseErr) {
      console.log(`   [Extract] Batch ${batchNum} FAILED (parse): ${parseErr.message}`);
      extractFailed++;
    }
  }

  if (extractFailed > 0) {
    console.log(`   ⚠ ${extractFailed}/${totalBatches} extraction batch(es) failed — continuing with ${extracted.length} results`);
  }

  console.log(`\n   Phase 1 complete: ${extracted.length} hiring posts extracted\n`);
  return extracted;
}

// ============================================================
// PHASE 2+3 — Score + Email from sheet data
// ============================================================

/**
 * Takes pre-extracted data (from sheet) and runs scoring + email drafting.
 * @param {object[]} extracted - Array of extraction objects (from sheet's approved rows)
 * @param {object} candidate - Candidate profile
 * @returns {object[]} contacts ready
 */
export async function scoreAndDraftEmails(extracted, candidate) {
  // ── PHASE 2: CODE SCORING ──
  console.log(`\n   ═══ PHASE 2: Code Scoring (${extracted.length} posts) ═══\n`);

  const allContacts = [];

  for (const ex of extracted) {
    const match = scoreContact(ex, candidate);

    const contact = {
      postId: ex.postId,
      generatedAt: new Date().toISOString(),
      poster: ex.poster || {},
      summary: ex.summary || '',
      job: ex.job || {},
      match: {
        isGoodMatch: match.isGoodMatch,
        score: match.score,
        reason: match.reason,
      },
      email: { to: '', subject: '', body: '' },
      contacts: ex.contacts || { emails: [], method: 'DM' },
      sent: false,
      sentAt: null,
    };

    allContacts.push(contact);

    const icon = match.isGoodMatch ? '+' : '-';
    console.log(`   [${icon}] ${contact.poster.name || '?'} — ${contact.job.title || '?'} @ ${contact.job.company || '?'} — Score: ${match.score}/10${match.score === 0 ? ` (${match.reason})` : ''}`);
  }

  // Deduplicate contacts by email — keep the highest-scored contact per email
  const emailBestMap = new Map();
  for (const c of allContacts) {
    if (c.match.score < 7 || !c.contacts.emails?.length) continue;
    const primaryEmail = c.contacts.emails[0].toLowerCase();
    const existing = emailBestMap.get(primaryEmail);
    if (!existing || c.match.score > existing.match.score) {
      emailBestMap.set(primaryEmail, c);
    }
  }
  const goodWithEmail = [...emailBestMap.values()];
  const dedupedCount = allContacts.filter(c => c.match.score >= 7 && c.contacts.emails?.length > 0).length - goodWithEmail.length;

  const goodCount = allContacts.filter(c => c.match.isGoodMatch).length;
  const rejectedCount = allContacts.length - goodCount;
  console.log(`\n   Phase 2 complete: ${goodCount} good matches, ${goodWithEmail.length} qualify for email${dedupedCount > 0 ? ` (${dedupedCount} duplicate emails removed)` : ''}\n`);

  // Save scoring log for false-negative review
  const scoringLog = {
    runAt: new Date().toISOString(),
    summary: { total: allContacts.length, good: goodCount, rejected: rejectedCount, needEmail: goodWithEmail.length },
    accepted: allContacts.filter(c => c.match.isGoodMatch).map(c => ({
      poster: c.poster?.name || '?',
      jobTitle: c.job?.title || '?',
      company: c.job?.company || '?',
      score: c.match.score,
      reason: c.match.reason,
      emails: c.contacts?.emails || [],
    })),
    rejected: allContacts.filter(c => !c.match.isGoodMatch).map(c => {
      const src = extracted.find(e => e.postId === c.postId);
      return {
        poster: c.poster?.name || '?',
        headline: c.poster?.headline || '',
        jobTitle: c.job?.title || '?',
        company: c.job?.company || '?',
        score: c.match.score,
        reason: c.match.reason,
        requirements: c.job?.requirements || [],
        requiredExperience: c.job?.requiredExperience,
        type: c.job?.type,
        postText: src?.postText || '',
        summary: c.summary || '',
        emails: c.contacts?.emails || [],
      };
    }),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '.cc-scoring-log.json'), JSON.stringify(scoringLog, null, 2));

  // ── PHASE 3: AI EMAIL DRAFTING ──
  if (goodWithEmail.length === 0) {
    console.log(`   ═══ PHASE 3: Skipped (no qualifying contacts) ═══\n`);
    return allContacts;
  }

  console.log(`   ═══ PHASE 3: AI Email Drafting (${goodWithEmail.length} contacts) ═══\n`);

  const emailBatchSize = 7;
  const emailBatches = [];
  for (let i = 0; i < goodWithEmail.length; i += emailBatchSize) {
    emailBatches.push(goodWithEmail.slice(i, i + emailBatchSize));
  }

  const emailPromises = emailBatches.map((batch, i) => {
    console.log(`   [Email] Batch ${i + 1}/${emailBatches.length} (${batch.length} emails) — sending`);
    const prompt = buildEmailPrompt(batch, candidate);
    return invokeModel(prompt, `Email-${i + 1}`)
      .then(responseText => ({ batchNum: i + 1, responseText, error: null }))
      .catch(error => ({ batchNum: i + 1, responseText: null, error }));
  });

  const emailResults = await Promise.all(emailPromises);

  let emailFailed = 0;
  for (const { batchNum, responseText, error } of emailResults) {
    if (error) {
      console.log(`   [Email] Batch ${batchNum} FAILED (API): ${error.message}`);
      emailFailed++;
      continue;
    }

    try {
      const parsed = parseJSON(responseText, `Email-${batchNum}`);
      const emails = Array.isArray(parsed.emails) ? parsed.emails
        : Array.isArray(parsed) ? parsed : [];

      const ctcLine = candidate.currentCTC && candidate.expectedCTC
        ? `\n\nCurrent CTC: ${candidate.currentCTC} | Expected CTC: ${candidate.expectedCTC}` : '';
      const signoff = `${ctcLine}\n\nRegards,\n${candidate.name}\n${candidate.portfolio}\n${candidate.linkedin}\n${candidate.github}`;
      for (const emailResult of emails) {
        const contact = allContacts.find(c => c.postId === emailResult.postId);
        if (contact && emailResult.subject && emailResult.body) {
          contact.email = {
            to: contact.contacts.emails[0],
            subject: emailResult.subject,
            body: emailResult.body + signoff,
          };
          console.log(`   [Email] ${contact.poster.name} — drafted`);
        }
      }
    } catch (parseErr) {
      console.log(`   [Email] Batch ${batchNum} FAILED (parse): ${parseErr.message}`);
      emailFailed++;
    }
  }

  if (emailFailed > 0) {
    console.log(`   ⚠ ${emailFailed}/${emailBatches.length} email batch(es) failed — ${allContacts.filter(c => c.email?.body).length} emails still drafted`);
  }

  const emailCount = allContacts.filter(c => c.email?.body).length;
  console.log(`\n   Phase 3 complete: ${emailCount} emails drafted\n`);

  return allContacts;
}

// ============================================================
// LEGACY — Full 3-phase pipeline (kept for backward compat)
// ============================================================

export async function processInBatches(posts, candidate) {
  const extracted = await extractPhase1(posts);
  if (extracted.length === 0) return [];
  return scoreAndDraftEmails(extracted, candidate);
}
