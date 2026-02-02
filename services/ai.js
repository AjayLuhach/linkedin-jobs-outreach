/**
 * AI Service - Gemini API for batch post analysis, match scoring & email generation
 * Processes posts in batches of 5: extract hiring info → score match → generate emails
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';

// ============================================================
// GEMINI CLIENT
// ============================================================

function initializeClient() {
  if (!config.ai.geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set.\n' +
      'Get your key from: https://makersuite.google.com/app/apikey\n' +
      'Add to .env: GEMINI_API_KEY=your_key'
    );
  }
  return new GoogleGenerativeAI(config.ai.geminiApiKey);
}

// ============================================================
// MODEL DISCOVERY & ROTATION
// ============================================================

async function fetchAvailableModels() {
  const apiKey = config.ai.geminiApiKey;
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!response.ok) return [];

    const data = await response.json();
    return (data.models || [])
      .filter(m =>
        m.name.includes('gemini') &&
        m.supportedGenerationMethods?.includes('generateContent')
      )
      .map(m => m.name.replace('models/', ''))
      .filter(name =>
        !name.includes('vision') &&
        !name.includes('embedding') &&
        !name.includes('aqa')
      );
  } catch {
    return [];
  }
}

let cachedModels = null;

async function getModels() {
  if (cachedModels === null) {
    cachedModels = await fetchAvailableModels();
    if (cachedModels.length > 0) {
      console.log(`   Available models: ${cachedModels.slice(0, 5).join(', ')}`);
    }
  }

  const preferred = config.ai.models;

  if (cachedModels.length === 0) return preferred;

  const available = preferred.filter(m =>
    cachedModels.some(cached => cached.startsWith(m) || cached === m)
  );

  const extras = cachedModels.filter(m =>
    !available.some(a => m.startsWith(a) || m === a) &&
    (m.includes('flash') || m.includes('pro'))
  );

  const result = [...available, ...extras];
  return result.length > 0 ? result : preferred;
}

// ============================================================
// MODEL ROTATION
// ============================================================

const modelManager = {
  rateLimitedUntil: {},

  getAvailableModel(models) {
    const now = Date.now();
    for (const model of models) {
      if (now >= (this.rateLimitedUntil[model] || 0)) return model;
    }
    // All rate-limited — return the one with shortest wait
    let best = models[0];
    let shortest = Infinity;
    for (const model of models) {
      const remaining = (this.rateLimitedUntil[model] || 0) - now;
      if (remaining < shortest) { shortest = remaining; best = model; }
    }
    return best;
  },

  markRateLimited(model) {
    this.rateLimitedUntil[model] = Date.now() + config.ai.rateLimitCooldown;
    console.log(`   ${model} rate-limited, cooling down ${config.ai.rateLimitCooldown / 1000}s`);
  },

  isRateLimitError(error) {
    const msg = error.message?.toLowerCase() || '';
    return msg.includes('429') || msg.includes('rate limit') ||
           msg.includes('quota') || msg.includes('resource exhausted');
  },
};

async function executeWithRotation(genAI, prompt, stepName) {
  const models = await getModels();
  const triedModels = new Set();

  while (triedModels.size < models.length) {
    const modelName = modelManager.getAvailableModel(models);

    if (triedModels.has(modelName)) {
      const waitTime = Math.min(
        ...models.map(m => Math.max(0, (modelManager.rateLimitedUntil[m] || 0) - Date.now()))
      );
      if (waitTime > 0) {
        console.log(`   All models rate-limited, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime + 1000));
      }
      triedModels.clear();
    }

    triedModels.add(modelName);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 8192,
        },
      });

      console.log(`   Using model: ${modelName}`);
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      if (modelManager.isRateLimitError(error)) {
        modelManager.markRateLimited(modelName);
        console.log(`   Rotating to next model...`);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`All models exhausted for ${stepName}. Wait and try again.`);
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
// BATCH PROMPT BUILDER
// ============================================================

function buildBatchPrompt(posts, candidate) {
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

  return `Analyze these ${posts.length} LinkedIn posts. For each, determine if it's a hiring/job post and evaluate candidate fit.

POSTS:
${JSON.stringify(postsData, null, 2)}

CANDIDATE PROFILE (use ONLY this data — NEVER claim skills not listed here):
- Name: ${candidate.name}
- Role: Full Stack ${candidate.stack} Developer
- Experience: ${candidate.experience} (since ${candidate.experienceStart})
- Location: ${candidate.location}
- Skills: ${candidate.skills.join(', ')}
- Summary: ${candidate.summary}
- Key Projects: ${candidate.projects.map(p => `${p.name}: ${p.desc}`).join(' | ')}
- Portfolio: ${candidate.portfolio} | LinkedIn: ${candidate.linkedin} | GitHub: ${candidate.github}

FOR EACH POST:
1. Set isHiring: Is this a hiring/job/referral post? (true/false)
2. If isHiring=true:
   a. Extract ALL email addresses from the post text into contacts.emails array
      - Match formats: user@domain.com, name [at] company [dot] com, name(at)company(dot)com
      - ONLY valid emails (must have @ and domain). NEVER put URLs, phone numbers, or sentences in emails
   b. Set contacts.method: "email" if emails found, "DM" if no emails
   c. Fill job: title, company, type (full-time/contract/intern/remote), requirements (max 3)
   d. Fill poster: name and headline from the post author
   e. Score match (1-10) based on candidate's ACTUAL listed skills vs job requirements
      - Set match.isGoodMatch = true if score >= 5
   f. CRITICAL — Email generation rules:
      - If contacts.emails has at least one email AND score >= 5:
        → Set email.to = first email from contacts.emails array (MUST be a valid email address)
        → Set email.subject = personalized subject line
        → Set email.body = personalized email (max 150 words, professional but warm)
        → In body: ONLY mention skills from candidate profile, reference their LinkedIn post, mention attaching resume
        → Sign off with: ${candidate.name} | ${candidate.portfolio} | ${candidate.linkedin} | ${candidate.github}
      - If contacts.emails is empty: leave email.to, email.subject, email.body as empty strings
      - If score < 5: leave email fields empty

RESPOND WITH ONLY A JSON OBJECT (no markdown, no code fences, no explanation):
{"results":[{"postId":"the-post-id","isHiring":true,"poster":{"name":"Author Name","headline":"Author Headline"},"job":{"title":"Role","company":"Company","type":"full-time","requirements":["req1","req2"]},"contacts":{"emails":["extracted@email.com"],"method":"email"},"match":{"isGoodMatch":true,"score":8,"reason":"Strong match because..."},"email":{"to":"extracted@email.com","subject":"Subject line","body":"Email body here"}}]}

RULES:
- Non-hiring posts: isHiring=false, all other fields empty/default, score=0
- email.to MUST equal contacts.emails[0] when emails exist and score>=5. Never put URLs or non-email text in email.to
- EVERY hiring post with emails and score>=5 MUST have a complete email (to + subject + body)
- Keep requirements to max 3 items
- Email body max 150 words
- Email body MUST be plain text only. NO markdown, NO square brackets [], NO angle brackets around URLs
- Email greeting MUST address the poster by their first name (e.g. "Dear Ravi," or "Hi Priya,"). NEVER use "Dear Hiring Manager" or "Dear Sir/Madam" — always use the poster's actual name from the post
- URLs in sign-off must be plain text without any formatting (e.g. https://ajayluhach.in/ not [https://ajayluhach.in/])`;
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/**
 * Process posts in batches of 5 through AI.
 * @param {object[]} posts - Array of normalized posts to process
 * @param {object} candidate - Candidate profile from config
 * @returns {object[]} - Array of contact objects for contacts.json
 */
export async function processInBatches(posts, candidate) {
  const genAI = initializeClient();
  const batchSize = 5;
  const allContacts = [];

  const totalBatches = Math.ceil(posts.length / batchSize);
  console.log(`\n   Processing ${posts.length} posts in ${totalBatches} batch(es) of ${batchSize}...\n`);

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`   --- Batch ${batchNum}/${totalBatches} (${batch.length} posts) ---`);

    const prompt = buildBatchPrompt(batch, candidate);
    const responseText = await executeWithRotation(genAI, prompt, `Batch ${batchNum}`);
    const parsed = parseJSON(responseText, `Batch ${batchNum}`);

    const results = parsed.results || parsed;

    for (const result of results) {
      if (!result.isHiring) continue;

      const contact = {
        postId: result.postId,
        generatedAt: new Date().toISOString(),
        poster: result.poster || {},
        job: result.job || {},
        match: result.match || { isGoodMatch: false, score: 0, reason: '' },
        email: result.email || {},
        contacts: result.contacts || { emails: [], method: '' },
        sent: false,
        sentAt: null,
      };

      allContacts.push(contact);

      // Display result
      const matchIcon = contact.match.isGoodMatch ? '+' : '-';
      console.log(`   [${matchIcon}] ${contact.poster.name || 'Unknown'} — ${contact.job.title || 'Unknown role'} @ ${contact.job.company || '?'} — Match: ${contact.match.score}/10`);
      if (contact.email.to) {
        console.log(`       Email: ${contact.email.to}`);
      }
    }

    // Small delay between batches to avoid rate limits
    if (i + batchSize < posts.length) {
      console.log('   Waiting 2s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return allContacts;
}
