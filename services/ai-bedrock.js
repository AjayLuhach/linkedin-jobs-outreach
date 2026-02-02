/**
 * AI Service - AWS Bedrock for batch post analysis, match scoring & email generation
 * Drop-in replacement for ai.js (Gemini). Same processInBatches interface.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import config from '../config.js';

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
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return client;
}

// ============================================================
// INVOKE MODEL
// ============================================================

async function invokeModel(prompt, stepName) {
  const bedrockClient = getClient();
  const modelId = config.bedrock.modelId;

  console.log(`   Using model: ${modelId}`);

  // Build request body based on model provider
  let body;

  if (modelId.startsWith('anthropic.') || modelId.startsWith('us.anthropic.')) {
    body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 8192,
      temperature: 0.1,
      top_p: 0.9,
      messages: [{ role: 'user', content: prompt }],
    });
  } else if (modelId.startsWith('amazon.titan')) {
    body = JSON.stringify({
      inputText: prompt,
      textGenerationConfig: {
        maxTokenCount: 8192,
        temperature: 0.1,
        topP: 0.9,
      },
    });
  } else if (modelId.startsWith('meta.llama')) {
    body = JSON.stringify({
      prompt,
      max_gen_len: 8192,
      temperature: 0.1,
      top_p: 0.9,
    });
  } else if (modelId.startsWith('mistral.')) {
    body = JSON.stringify({
      prompt: `<s>[INST] ${prompt} [/INST]`,
      max_tokens: 8192,
      temperature: 0.1,
      top_p: 0.9,
    });
  } else if (modelId.startsWith('cohere.')) {
    body = JSON.stringify({
      message: prompt,
      max_tokens: 8192,
      temperature: 0.1,
      p: 0.9,
    });
  } else if (modelId.startsWith('google.')) {
    // Google models (Gemma, etc.) — OpenAI-compatible messages format on Bedrock
    body = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
      temperature: 0.1,
      top_p: 0.9,
    });
  } else {
    // Default: Anthropic messages API (safest fallback for newer models)
    body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 8192,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    });
  }

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  });

  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return extractText(responseBody, modelId);
  } catch (error) {
    const msg = error.message || '';

    // Retry once on throttling
    if (msg.includes('ThrottlingException') || msg.includes('429') || msg.includes('Too many requests')) {
      console.log(`   ${modelId} throttled, waiting 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      const retryResponse = await bedrockClient.send(command);
      const retryBody = JSON.parse(new TextDecoder().decode(retryResponse.body));
      return extractText(retryBody, modelId);
    }

    throw new Error(`Bedrock ${stepName} failed: ${msg}`);
  }
}

// Extract text from various Bedrock model response formats
function extractText(responseBody, modelId) {
  // OpenAI-compatible (Google Gemma on Bedrock, etc.)
  if (responseBody.choices) {
    return responseBody.choices[0]?.message?.content || responseBody.choices[0]?.text || '';
  }
  // Google Vertex-style (candidates → content → parts)
  if (responseBody.candidates) {
    const parts = responseBody.candidates[0]?.content?.parts;
    if (parts?.length) return parts.map(p => p.text || '').join('');
  }
  // Anthropic Claude (content array)
  if (Array.isArray(responseBody.content)) return responseBody.content[0]?.text || '';
  // Amazon Titan
  if (responseBody.results) return responseBody.results[0]?.outputText || '';
  // Meta Llama
  if (responseBody.generation) return responseBody.generation;
  // Mistral
  if (responseBody.outputs) return responseBody.outputs[0]?.text || '';
  // Cohere
  if (typeof responseBody.text === 'string') return responseBody.text;
  // Older Anthropic
  if (responseBody.completion) return responseBody.completion;

  console.warn(`   Unknown response format for ${modelId}, raw keys: ${Object.keys(responseBody).join(', ')}`);
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
// BATCH PROMPT BUILDER (same prompt as ai.js)
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
// MAIN PIPELINE (same interface as ai.js)
// ============================================================

/**
 * Process posts in batches of 5 through AWS Bedrock.
 * @param {object[]} posts - Array of normalized posts to process
 * @param {object} candidate - Candidate profile from config
 * @returns {object[]} - Array of contact objects for contacts.json
 */
export async function processInBatches(posts, candidate) {
  const batchSize = 5;
  const allContacts = [];

  const totalBatches = Math.ceil(posts.length / batchSize);
  console.log(`\n   Processing ${posts.length} posts in ${totalBatches} batch(es) of ${batchSize} — PARALLEL mode`);
  console.log(`   Provider: AWS Bedrock | Model: ${config.bedrock.modelId}\n`);

  // Build all batches
  const batches = [];
  for (let i = 0; i < posts.length; i += batchSize) {
    batches.push({
      posts: posts.slice(i, i + batchSize),
      batchNum: Math.floor(i / batchSize) + 1,
    });
  }

  // Fire all batches in parallel
  const batchPromises = batches.map(({ posts: batchPosts, batchNum }) => {
    console.log(`   --- Batch ${batchNum}/${totalBatches} (${batchPosts.length} posts) — sending ---`);
    const prompt = buildBatchPrompt(batchPosts, candidate);
    return invokeModel(prompt, `Batch ${batchNum}`)
      .then(responseText => ({ batchNum, responseText, error: null }))
      .catch(error => ({ batchNum, responseText: null, error }));
  });

  const batchResults = await Promise.all(batchPromises);

  // Process results in order
  for (const { batchNum, responseText, error } of batchResults) {
    if (error) {
      console.log(`   --- Batch ${batchNum} FAILED: ${error.message} ---`);
      continue;
    }

    console.log(`   --- Batch ${batchNum}/${totalBatches} results ---`);
    const parsed = parseJSON(responseText, `Batch ${batchNum}`);

    const results = Array.isArray(parsed.results) ? parsed.results
      : Array.isArray(parsed) ? parsed : [];

    if (results.length === 0) {
      console.log(`   No results parsed from batch ${batchNum} response`);
      continue;
    }

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

      const matchIcon = contact.match.isGoodMatch ? '+' : '-';
      console.log(`   [${matchIcon}] ${contact.poster.name || 'Unknown'} — ${contact.job.title || 'Unknown role'} @ ${contact.job.company || '?'} — Match: ${contact.match.score}/10`);
      if (contact.email.to) {
        console.log(`       Email: ${contact.email.to}`);
      }
    }
  }

  return allContacts;
}
