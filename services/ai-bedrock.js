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
  // Anthropic Claude
  if (responseBody.content) return responseBody.content[0]?.text || '';
  // Amazon Titan
  if (responseBody.results) return responseBody.results[0]?.outputText || '';
  // Meta Llama
  if (responseBody.generation) return responseBody.generation;
  // Mistral
  if (responseBody.outputs) return responseBody.outputs[0]?.text || '';
  // Cohere
  if (responseBody.text) return responseBody.text;
  // Older Anthropic
  if (responseBody.completion) return responseBody.completion;

  console.warn(`   Unknown response format for ${modelId}`);
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
- CANNOT CLAIM: ${candidate.cannotClaim.join(', ')}

FOR EACH POST, determine:
1. isHiring: Is this a hiring/job/referral post? (true/false)
2. If hiring:
   - Extract emails from post text (format: user@domain.com, including obfuscated like "name [at] company [dot] com")
   - DO NOT include phone numbers in emails array
   - Determine job type, role, requirements (max 3)
   - Score match (1-10) based on candidate's ACTUAL skills vs requirements
   - If score >= 5 AND emails found: generate personalized email (subject + body max 150 words)
   - In email: ONLY mention skills from candidate profile, reference their LinkedIn post, mention attaching resume
   - Sign off with candidate name, portfolio, LinkedIn, GitHub

RESPOND WITH JSON ONLY (no markdown):
{"results":[{"postId":"","isHiring":false,"job":{"title":"","company":"","type":"","requirements":[]},"contacts":{"emails":[],"method":"email/DM/phone"},"match":{"isGoodMatch":false,"score":0,"reason":""},"email":{"to":"","subject":"","body":""},"poster":{"name":"","headline":""}}]}

RULES:
- Non-hiring posts: set isHiring=false, leave other fields empty/default
- No emails found: leave email.to empty, still score the match
- NEVER claim skills from cannotClaim list
- Keep requirements to max 3 items
- Email body max 150 words, professional but warm`;
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
  console.log(`\n   Processing ${posts.length} posts in ${totalBatches} batch(es) of ${batchSize}...`);
  console.log(`   Provider: AWS Bedrock | Model: ${config.bedrock.modelId}\n`);

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`   --- Batch ${batchNum}/${totalBatches} (${batch.length} posts) ---`);

    const prompt = buildBatchPrompt(batch, candidate);
    const responseText = await invokeModel(prompt, `Batch ${batchNum}`);
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

      const matchIcon = contact.match.isGoodMatch ? '+' : '-';
      console.log(`   [${matchIcon}] ${contact.poster.name || 'Unknown'} — ${contact.job.title || 'Unknown role'} @ ${contact.job.company || '?'} — Match: ${contact.match.score}/10`);
      if (contact.email.to) {
        console.log(`       Email: ${contact.email.to}`);
      }
    }

    if (i + batchSize < posts.length) {
      console.log('   Waiting 2s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return allContacts;
}
