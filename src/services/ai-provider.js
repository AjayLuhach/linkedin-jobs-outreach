/**
 * Unified AI Provider
 * Routes to Bedrock, Gemini, or OpenAI based on AI_PROVIDER env var.
 * Each provider implements the same interface: send a prompt, get text back.
 */

import config from '../config.js';

// ============================================================
// PROVIDER: AWS BEDROCK
// ============================================================

let bedrockClient = null;

async function invokeBedrockModel(prompt, stepName) {
  if (!bedrockClient) {
    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const { accessKeyId, secretAccessKey, region } = config.bedrock;
    bedrockClient = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

  const body = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 8192,
    temperature: 0.1,
    top_p: 0.9,
  });

  const command = new InvokeModelCommand({
    modelId: config.bedrock.modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  });

  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return extractBedrockText(responseBody);
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes('ThrottlingException') || msg.includes('429') || msg.includes('Too many requests')) {
      console.log(`   Throttled, waiting 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      const retryResponse = await bedrockClient.send(command);
      const retryBody = JSON.parse(new TextDecoder().decode(retryResponse.body));
      return extractBedrockText(retryBody);
    }
    throw new Error(`Bedrock ${stepName} failed: ${msg}`);
  }
}

function extractBedrockText(responseBody) {
  // OpenAI-compatible format (Gemma, Llama, Mistral on Bedrock)
  if (responseBody.choices) {
    return responseBody.choices[0]?.message?.content || responseBody.choices[0]?.text || '';
  }
  // Anthropic format (Claude on Bedrock)
  if (responseBody.content) {
    return responseBody.content.map(c => c.text || '').join('');
  }
  // Google Vertex-style
  if (responseBody.candidates) {
    const parts = responseBody.candidates[0]?.content?.parts;
    if (parts?.length) return parts.map(p => p.text || '').join('');
  }
  console.warn(`   Unknown Bedrock response format, keys: ${Object.keys(responseBody).join(', ')}`);
  return JSON.stringify(responseBody);
}

// ============================================================
// PROVIDER: GEMINI
// ============================================================

let geminiModel = null;

async function invokeGeminiModel(prompt, stepName) {
  if (!geminiModel) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
    geminiModel = genAI.getGenerativeModel({ model: config.ai.geminiModel || 'gemini-2.0-flash' });
  }

  try {
    const result = await geminiModel.generateContent(prompt);
    const response = result.response;
    return response.text();
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      console.log(`   Gemini rate limited, waiting 60s...`);
      await new Promise(resolve => setTimeout(resolve, 60000));
      const result = await geminiModel.generateContent(prompt);
      return result.response.text();
    }
    throw new Error(`Gemini ${stepName} failed: ${msg}`);
  }
}

// ============================================================
// PROVIDER: OPENAI
// ============================================================

let openaiClient = null;

async function invokeOpenAIModel(prompt, stepName) {
  if (!openaiClient) {
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }

  try {
    const response = await openaiClient.chat.completions.create({
      model: config.openai.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
      temperature: 0.1,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes('429') || msg.includes('Rate limit')) {
      console.log(`   OpenAI rate limited, waiting 30s...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
      const response = await openaiClient.chat.completions.create({
        model: config.openai.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8192,
        temperature: 0.1,
      });
      return response.choices[0]?.message?.content || '';
    }
    throw new Error(`OpenAI ${stepName} failed: ${msg}`);
  }
}

// ============================================================
// UNIFIED INTERFACE
// ============================================================

const PROVIDERS = {
  bedrock: {
    invoke: invokeBedrockModel,
    validate: () => !!(config.bedrock.accessKeyId && config.bedrock.secretAccessKey),
    label: 'AWS Bedrock',
    hint: 'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION in .env',
  },
  gemini: {
    invoke: invokeGeminiModel,
    validate: () => !!(config.ai.geminiApiKey),
    label: 'Google Gemini',
    hint: 'Set GEMINI_API_KEY in .env',
  },
  openai: {
    invoke: invokeOpenAIModel,
    validate: () => !!(config.openai.apiKey),
    label: 'OpenAI',
    hint: 'Set OPENAI_API_KEY in .env',
  },
};

/**
 * Send a prompt to the configured AI provider and get text back.
 * @param {string} prompt - The prompt text
 * @param {string} stepName - Label for logging/errors (e.g. "Extract-1")
 * @returns {Promise<string>} AI response text
 */
export async function invokeAI(prompt, stepName) {
  const provider = PROVIDERS[config.aiProvider];
  if (!provider) {
    throw new Error(`Unknown AI_PROVIDER="${config.aiProvider}". Use: bedrock, gemini, or openai`);
  }
  if (!provider.validate()) {
    throw new Error(`${provider.label} is selected but not configured. ${provider.hint}`);
  }
  return provider.invoke(prompt, stepName);
}

/**
 * Check if the configured AI provider has valid credentials in .env.
 * Throws with a helpful message if not.
 */
export function validateProvider() {
  const providerName = config.aiProvider;
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(
      `Unknown AI_PROVIDER="${providerName}" in .env.\n` +
      `   Supported providers: bedrock, gemini, openai\n` +
      `   Set AI_PROVIDER to one of the above.`
    );
  }

  if (!provider.validate()) {
    // Check if ANY provider is configured
    const configured = Object.entries(PROVIDERS)
      .filter(([, p]) => p.validate())
      .map(([name, p]) => `${p.label} (AI_PROVIDER=${name})`);

    if (configured.length > 0) {
      throw new Error(
        `${provider.label} (AI_PROVIDER=${providerName}) is not configured.\n` +
        `   ${provider.hint}\n\n` +
        `   Or switch to a configured provider:\n` +
        configured.map(c => `   - ${c}`).join('\n')
      );
    }

    throw new Error(
      `No AI provider is configured. Set up at least one in .env:\n\n` +
      Object.values(PROVIDERS).map(p => `   ${p.label}: ${p.hint}`).join('\n')
    );
  }

  return { name: providerName, label: provider.label };
}

/**
 * Get the display name of the current provider + model.
 */
export function getProviderInfo() {
  const providerName = config.aiProvider;
  const models = {
    bedrock: config.bedrock.modelId,
    gemini: config.ai.geminiModel || 'gemini-2.0-flash',
    openai: config.openai.model || 'gpt-4o-mini',
  };
  const provider = PROVIDERS[providerName];
  return {
    name: providerName,
    label: provider?.label || providerName,
    model: models[providerName] || 'unknown',
    configured: provider?.validate() || false,
  };
}

// ============================================================
// JSON PARSER (shared utility — with truncation repair)
// ============================================================

export function parseJSON(response, step = '') {
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
