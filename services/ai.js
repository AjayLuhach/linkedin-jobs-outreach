/**
 * AI Service - Gemini API for LinkedIn feed email extraction & email generation
 * 2-Step Pipeline: Extract Hiring Posts → Generate Email Content
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';

// ============================================================
// GEMINI CLIENT
// ============================================================

function initializeClient() {
  if (!config.ai.geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not set.\n' +
      'Get your API key from: https://makersuite.google.com/app/apikey\n' +
      'Then add to .env: GEMINI_API_KEY=your_api_key_here'
    );
  }
  return new GoogleGenerativeAI(config.ai.geminiApiKey);
}

// ============================================================
// MODEL DISCOVERY & ROTATION
// ============================================================

/**
 * Fetch available models from Gemini API
 */
async function fetchAvailableModels() {
  const apiKey = config.ai.geminiApiKey;
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!response.ok) {
      console.warn('   Could not fetch model list, using defaults');
      return [];
    }

    const data = await response.json();
    const models = data.models || [];

    const textModels = models
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

    console.log(`\n   Available Gemini models: ${textModels.join(', ')}`);
    return textModels;
  } catch (error) {
    console.warn('   Error fetching models:', error.message);
    return [];
  }
}

let cachedModels = null;

async function getModelsForTask(taskType) {
  if (cachedModels === null) {
    cachedModels = await fetchAvailableModels();
  }

  if (cachedModels.length === 0) {
    return config.ai.models[taskType] || config.ai.models.extraction;
  }

  const preferred = config.ai.models[taskType] || config.ai.models.extraction;

  const available = preferred.filter(m =>
    cachedModels.some(cached => cached.startsWith(m) || cached === m)
  );

  const extras = cachedModels.filter(m =>
    !available.some(a => m.startsWith(a) || m === a) &&
    (m.includes('flash') || m.includes('pro'))
  );

  const result = [...available, ...extras];
  return result.length > 0 ? result : config.ai.models[taskType];
}

// ============================================================
// MODEL ROTATION MANAGER
// ============================================================

const modelManager = {
  rateLimitedUntil: {},

  getAvailableModel(models) {
    const now = Date.now();
    for (const model of models) {
      const cooldownUntil = this.rateLimitedUntil[model] || 0;
      if (now >= cooldownUntil) return model;
    }

    let bestModel = models[0];
    let shortestWait = Infinity;
    for (const model of models) {
      const remaining = (this.rateLimitedUntil[model] || 0) - now;
      if (remaining < shortestWait) {
        shortestWait = remaining;
        bestModel = model;
      }
    }
    return bestModel;
  },

  markRateLimited(model) {
    this.rateLimitedUntil[model] = Date.now() + config.ai.rateLimitCooldown;
    console.log(`   ${model} rate-limited, cooling down for ${config.ai.rateLimitCooldown / 1000}s`);
  },

  isRateLimitError(error) {
    const msg = error.message?.toLowerCase() || '';
    return msg.includes('429') ||
           msg.includes('rate limit') ||
           msg.includes('quota') ||
           msg.includes('resource exhausted');
  },
};

/**
 * Execute AI request with automatic model rotation on rate limits
 */
async function executeWithRotation(genAI, prompt, taskType, stepName) {
  const models = await getModelsForTask(taskType);
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
        console.log(`   Rotating to next available model...`);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`All models exhausted for ${stepName}. Please wait and try again.`);
}

// ============================================================
// JSON PARSER
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
    // Attempt to repair truncated JSON by closing open brackets/braces
    console.log(`   Attempting to repair truncated JSON in ${step}...`);
    let repaired = text;

    // If truncated mid-string, close the string first
    // Count unescaped quotes
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Odd number of quotes = truncated inside a string
      // Remove everything from the last unmatched quote
      const lastQuoteIdx = repaired.lastIndexOf('"');
      // Find the key start before this value
      const beforeLastQuote = repaired.substring(0, lastQuoteIdx);
      // Remove the incomplete key-value pair
      const lastComma = beforeLastQuote.lastIndexOf(',');
      if (lastComma > 0) {
        repaired = repaired.substring(0, lastComma);
      }
    }

    // Remove trailing incomplete structures
    repaired = repaired.replace(/,\s*$/, '');

    // Count open/close brackets
    const opens = (repaired.match(/\[/g) || []).length;
    const closes = (repaired.match(/\]/g) || []).length;
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;

    // Close unclosed arrays and objects
    for (let i = 0; i < opens - closes; i++) repaired += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';

    try {
      const result = JSON.parse(repaired);
      console.log(`   JSON repaired successfully (truncated response recovered)`);
      return result;
    } catch (error2) {
      console.error(`\n   JSON Parse Error in ${step} (repair also failed):`);
      console.error('Raw response (first 500 chars):');
      console.error(text.substring(0, 500));
      throw error2;
    }
  }
}

// ============================================================
// STEP 1: EXTRACT HIRING POSTS & EMAILS
// ============================================================

function buildExtractionPrompt(feedData) {
  // Handle parsed LinkedIn data (from parser.js) vs raw text
  let feedStr;

  if (feedData.source && feedData.posts) {
    // Parsed LinkedIn data — send only the clean posts
    if (feedData.rawText) {
      feedStr = feedData.rawText;
    } else if (feedData.rawJson) {
      feedStr = JSON.stringify(feedData.rawJson);
    } else {
      feedStr = JSON.stringify(feedData.posts, null, 2);
    }
  } else {
    feedStr = typeof feedData === 'string' ? feedData : JSON.stringify(feedData);
  }

  // Include any pre-extracted emails from parser
  const preExtractedEmails = (feedData.posts || [])
    .flatMap(p => p.emailsFound || [])
    .filter(Boolean);

  const emailHint = preExtractedEmails.length > 0
    ? `\nPRE-EXTRACTED EMAILS FOUND: ${preExtractedEmails.join(', ')}\nInclude these in your results.\n`
    : '';

  return `Analyze these LinkedIn posts and extract ONLY hiring-related posts where someone can apply.
${emailHint}
POSTS DATA:
${feedStr}

HIRING POSTS = posts with "hiring", "looking for", "open position", "send resume", "DM me", referral opportunities.

CRITICAL - Extract ONLY email addresses (format: user@domain.com):
- Extract emails in ALL formats (plain, obfuscated like "name [at] company [dot] com")
- DO NOT include phone numbers (like +91-1234567890) in the emails array
- DO NOT include WhatsApp numbers, contact numbers, or any numeric-only values
- If post only has phone/contact number, leave emails array EMPTY []
- Only valid email addresses with @ symbol belong in emails array

Keep requirements to max 3 items. postSnippet max 50 chars. Be EXTREMELY concise.

JSON only, NO markdown, NO extra whitespace:
{"hiringPosts":[{"posterName":"","posterTitle":"short","company":"","role":"","requirements":["max 3"],"emails":[""],"contactMethod":"email/DM/phone","postSnippet":"max 50 chars","urgency":"high/medium/low"}],"totalPostsAnalyzed":0,"hiringPostsFound":0}`;
}

// ============================================================
// STEP 2: GENERATE EMAIL CONTENT
// ============================================================

function buildEmailGenPrompt(hiringPost, candidate) {
  return `Write a professional job application email.

JOB DETAILS:
- Poster: ${hiringPost.posterName} (${hiringPost.posterTitle})
- Company: ${hiringPost.company}
- Role: ${hiringPost.role}
- Requirements: ${(hiringPost.requirements || []).join(', ')}

CANDIDATE DETAILS (use ONLY this data - do NOT infer anything from the job post):
- Name: ${candidate.name}
- Location: ${candidate.location}
- Current Role: ${candidate.currentTitle} at ${candidate.currentCompany} (since ${candidate.experienceStart})
- Experience: ${candidate.experience}
- Tech Stack: ${candidate.stack}
- Known Skills: ${candidate.allSkills.join(', ')}
- Summary: ${candidate.summary}
- Portfolio: ${candidate.portfolio}
- LinkedIn: ${candidate.linkedin}
- GitHub: ${candidate.github}
- CANNOT claim: ${candidate.cannotClaim.slice(0, 15).join(', ')}

STRICT RULES:
1. Subject: specific to role + company, include candidate name
2. Opening: reference their LinkedIn post
3. ONLY mention skills from the CANDIDATE DETAILS above - NEVER claim skills from the job post that aren't in candidate's known skills
4. NEVER use location, city, or any personal detail from the job post for the candidate - candidate is from ${candidate.location}
5. Max 150 words in body
6. Mention attaching resume
7. Professional but warm tone
8. Sign off with candidate name, portfolio, LinkedIn, GitHub

OUTPUT JSON (no markdown):
{"subject":"","body":"","to":"recipient email","notes":""}`;
}

// ============================================================
// DISPLAY HELPERS
// ============================================================

function displayExtractionResults(extraction) {
  console.log('\n' + '-'.repeat(60));
  console.log('STEP 1: FEED ANALYSIS RESULTS');
  console.log('-'.repeat(60));

  console.log(`\n   Total posts analyzed: ${extraction.totalPostsAnalyzed}`);
  console.log(`   Hiring posts found:  ${extraction.hiringPostsFound}`);

  if (extraction.hiringPosts.length === 0) {
    console.log('\n   No hiring posts with contact info found in this feed.');
    return;
  }

  extraction.hiringPosts.forEach((post, i) => {
    console.log(`\n   --- Post ${i + 1} ---`);
    console.log(`   Poster:  ${post.posterName} (${post.posterTitle})`);
    console.log(`   Company: ${post.company}`);
    console.log(`   Role:    ${post.role}`);
    console.log(`   Emails:  ${(post.emails || []).join(', ') || 'None found'}`);
    console.log(`   Contact: ${post.contactMethod}`);
    console.log(`   Urgency: ${post.urgency}`);
    if (post.requirements?.length > 0) {
      console.log(`   Skills:  ${post.requirements.join(', ')}`);
    }
  });
}

function displayGeneratedEmail(email, index) {
  console.log(`\n   === Email ${index + 1} ===`);
  console.log(`   To:      ${email.to}`);
  console.log(`   Subject: ${email.subject}`);
  console.log(`   ---`);
  console.log(email.body.split('\n').map(line => `   ${line}`).join('\n'));
  if (email.notes) {
    console.log(`\n   Note: ${email.notes}`);
  }
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/**
 * Main 2-step pipeline: Extract hiring posts → Generate emails
 */
export async function extractAndGenerate(feedData) {
  const genAI = initializeClient();
  const candidate = config.candidate;

  // ========== STEP 1: Extract Hiring Posts ==========
  console.log('\n   STEP 1: Analyzing feed for hiring posts...');
  const extractionPrompt = buildExtractionPrompt(feedData);
  const extractionText = await executeWithRotation(genAI, extractionPrompt, 'extraction', 'Step 1 - Extraction');
  const extraction = parseJSON(extractionText, 'Step 1 - Extraction');
  displayExtractionResults(extraction);

  if (!extraction.hiringPosts || extraction.hiringPosts.length === 0) {
    return { extraction, emails: [] };
  }

  // Filter posts that have emails (we can actually send to these)
  const postsWithEmails = extraction.hiringPosts.filter(
    p => p.emails && p.emails.length > 0
  );

  const postsWithoutEmails = extraction.hiringPosts.filter(
    p => !p.emails || p.emails.length === 0
  );

  if (postsWithoutEmails.length > 0) {
    console.log(`\n   ${postsWithoutEmails.length} post(s) found without emails (DM/apply link only)`);
  }

  if (postsWithEmails.length === 0) {
    console.log('\n   No posts with email addresses found. Cannot generate emails.');
    return { extraction, emails: [] };
  }

  // ========== STEP 2: Generate Emails ==========
  console.log(`\n   STEP 2: Generating emails for ${postsWithEmails.length} post(s)...`);

  const generatedEmails = [];

  for (let i = 0; i < postsWithEmails.length; i++) {
    const post = postsWithEmails[i];
    console.log(`\n   Generating email ${i + 1}/${postsWithEmails.length} (${post.company} - ${post.role})...`);

    const emailPrompt = buildEmailGenPrompt(post, candidate);
    const emailText = await executeWithRotation(genAI, emailPrompt, 'emailGen', `Step 2 - Email ${i + 1}`);
    const email = parseJSON(emailText, `Step 2 - Email ${i + 1}`);

    // Ensure the 'to' field has the actual email from extraction
    if (!email.to || email.to === 'recipient email') {
      email.to = post.emails[0];
    }

    email.company = post.company;
    email.role = post.role;
    email.posterName = post.posterName;

    generatedEmails.push(email);
    displayGeneratedEmail(email, i);
  }

  return {
    extraction,
    emails: generatedEmails,
  };
}

export default { extractAndGenerate };
