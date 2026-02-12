/**
 * Configuration for feed-email-extractor CLI
 * Candidate details loaded from condensed resumeData.json
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESUME_DATA_PATH = join(__dirname, 'resumeData.json');

function loadCandidate() {
  if (!fs.existsSync(RESUME_DATA_PATH)) {
    throw new Error(`resumeData.json not found at: ${RESUME_DATA_PATH}`);
  }

  const data = JSON.parse(fs.readFileSync(RESUME_DATA_PATH, 'utf-8'));
  const info = data.personalInfo;

  // Calculate experience years
  const startDate = new Date(data.experienceStart);
  const now = new Date();
  const years = ((now - startDate) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);

  // skills is now { "React.js": ["react", "reactjs", ...], ... }
  const skillsMap = data.skills || {};
  const skillNames = Object.keys(skillsMap);

  return {
    name: info.name,
    email: info.email,
    phone: info.phone,
    location: info.location,
    linkedin: info.linkedin,
    github: info.github,
    portfolio: info.portfolio,
    stack: data.stack,
    primaryCloud: data.primaryCloud,
    experienceStart: data.experienceStart,
    experience: `${years} years`,
    summary: data.summary,
    skills: skillNames,
    skillsWithAliases: skillsMap,
    projects: data.projects,
    cannotClaim: data.cannotClaim,
    currentTitle: data.experience?.[0]?.title || 'SDE',
    currentCompany: data.experience?.[0]?.company || '',
    bullets: data.experience?.[0]?.bullets || [],
  };
}

export const config = {
  // AI provider: "gemini" or "bedrock"
  aiProvider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),

  paths: {
    outputDir: join(__dirname, 'output'),
    extractPath: join(__dirname, 'output', 'extract.json'),
    logsDir: join(__dirname, 'logs'),
  },

  // Gemini config
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    models: [
      'gemini-2.5-pro',
      'gemini-3-pro-preview',
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
    ],
    rateLimitCooldown: 60000,
  },

  // AWS Bedrock config
  bedrock: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'google.gemma-3-27b-it',
  },

  candidate: loadCandidate(),
};

export default config;
