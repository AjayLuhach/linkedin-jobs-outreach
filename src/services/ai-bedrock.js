/**
 * AI Pipeline — 3-phase extraction, scoring, and email drafting
 * Phase 1: AI extraction — structured data + post summary
 * Phase 2: Code scoring — deterministic skill/experience/salary matching
 * Phase 3: AI email drafting — only for qualifying contacts
 *
 * Uses ai-provider.js for AI calls (supports Bedrock, Gemini, OpenAI)
 * Uses prompts.js for prompt templates
 */

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { checkRawPost, checkExtractedPost } from './location-filter.js';
import { invokeAI, parseJSON, getProviderInfo } from './ai-provider.js';
import { buildExtractionPrompt, buildEmailPrompt } from './prompts.js';

const OUTPUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'output');

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

function buildSkillLookup(candidate) {
  const lookup = new Set();
  const skillsMap = candidate.skillsWithAliases || {};

  for (const [skillName, aliases] of Object.entries(skillsMap)) {
    lookup.add(normalizeSkill(skillName));
    for (const alias of aliases) {
      lookup.add(alias.toLowerCase().replace(/\s+/g, ''));
    }
  }

  return lookup;
}

function buildCannotClaimSet(candidate) {
  const blocked = new Set();
  for (const skill of (candidate.cannotClaim || [])) {
    blocked.add(normalizeSkill(skill));
  }
  return blocked;
}

function matchesSkill(normReq, skillLookup, cannotClaimSet) {
  if (cannotClaimSet.has(normReq)) return false;
  if (skillLookup.has(normReq)) return true;

  for (const s of skillLookup) {
    if (s.length < 3 && normReq.length < 3) continue;

    const shorter = s.length <= normReq.length ? s : normReq;
    const longer = s.length <= normReq.length ? normReq : s;

    if (shorter.length < 3) continue;

    if (longer === shorter) return true;
    if (longer.startsWith(shorter) || longer.endsWith(shorter)) {
      if (!cannotClaimSet.has(normReq)) return true;
    }
  }

  return false;
}

function scoreContact(extracted, candidate) {
  const maxExp = Math.ceil(parseFloat(candidate.experience) + 1);
  const reqExp = extracted.job?.requiredExperience;

  if (reqExp != null && reqExp > maxExp) {
    return {
      isGoodMatch: false,
      score: 0,
      reason: `Experience requirement too high (needs ${reqExp}yr, max ${maxExp}yr)`,
    };
  }

  const salaryMax = extracted.job?.salaryMaxLPA;
  if (salaryMax != null && salaryMax < 7) {
    return {
      isGoodMatch: false,
      score: 0,
      reason: `Salary below 7 LPA (${salaryMax} LPA)`,
    };
  }

  const locationReject = checkExtractedPost(extracted);
  if (locationReject) {
    return {
      isGoodMatch: false,
      score: 0,
      reason: locationReject,
    };
  }

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
// PHASE 1 — AI Extraction
// ============================================================

export async function extractPhase1(posts) {
  const batchSize = parseInt(process.env.BATCH_SIZE) || 7;
  const { label, model } = getProviderInfo();

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
      console.log(`   [x] ${r.author || '?'} — ${r.reason}`);
    }
  }

  console.log(`\n   PHASE 1: AI Extraction`);
  console.log(`   Provider: ${label} (${model}) | Posts: ${filtered.length}/${posts.length} (${locationRejected.length} pre-filtered) | Batch: ${batchSize}\n`);

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
    return invokeAI(prompt, `Extract-${batchNum}`)
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
    console.log(`   ${extractFailed}/${totalBatches} extraction batch(es) failed — continuing with ${extracted.length} results`);
  }

  console.log(`\n   Phase 1 complete: ${extracted.length} hiring posts extracted\n`);
  return extracted;
}

// ============================================================
// PHASE 2+3 — Score + Email
// ============================================================

export async function scoreAndDraftEmails(extracted, candidate) {
  console.log(`\n   === PHASE 2: Code Scoring (${extracted.length} posts) ===\n`);

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

  // Deduplicate contacts by email
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

  // Save scoring log
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

  // -- PHASE 3: AI EMAIL DRAFTING --
  if (goodWithEmail.length === 0) {
    console.log(`   === PHASE 3: Skipped (no qualifying contacts) ===\n`);
    return allContacts;
  }

  const { label, model } = getProviderInfo();
  console.log(`   === PHASE 3: AI Email Drafting (${goodWithEmail.length} contacts) ===`);
  console.log(`   Provider: ${label} (${model})\n`);

  const emailBatchSize = 7;
  const emailBatches = [];
  for (let i = 0; i < goodWithEmail.length; i += emailBatchSize) {
    emailBatches.push(goodWithEmail.slice(i, i + emailBatchSize));
  }

  const emailPromises = emailBatches.map((batch, i) => {
    console.log(`   [Email] Batch ${i + 1}/${emailBatches.length} (${batch.length} emails) — sending`);
    const prompt = buildEmailPrompt(batch, candidate);
    return invokeAI(prompt, `Email-${i + 1}`)
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
    console.log(`   ${emailFailed}/${emailBatches.length} email batch(es) failed — ${allContacts.filter(c => c.email?.body).length} emails still drafted`);
  }

  const emailCount = allContacts.filter(c => c.email?.body).length;
  console.log(`\n   Phase 3 complete: ${emailCount} emails drafted\n`);

  return allContacts;
}

// ============================================================
// LEGACY — Full 3-phase pipeline
// ============================================================

export async function processInBatches(posts, candidate) {
  const extracted = await extractPhase1(posts);
  if (extracted.length === 0) return [];
  return scoreAndDraftEmails(extracted, candidate);
}
