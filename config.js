/**
 * Configuration for feed-email-extractor CLI
 * Candidate details are loaded from resumeData.json (single source of truth)
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Output directory for extracted results
const outputDir = join(__dirname, 'output');

// Load candidate details from local resumeData.json
const RESUME_DATA_PATH = join(__dirname, 'resumeData.json');

function loadCandidate() {
  if (!fs.existsSync(RESUME_DATA_PATH)) {
    throw new Error(`resumeData.json not found at: ${RESUME_DATA_PATH}`);
  }

  const data = JSON.parse(fs.readFileSync(RESUME_DATA_PATH, 'utf-8'));
  const info = data.personalInfo;
  const meta = data.meta;
  const skills = data.skills;
  const experience = data.experience || [];
  const currentRole = experience[0] || {};

  // Calculate experience years from meta.experienceStart
  const startDate = new Date(meta.experienceStart);
  const now = new Date();
  const years = ((now - startDate) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);

  // Collect all skills
  const allSkills = [
    ...(skills.frontend || []),
    ...(skills.backend || []),
    ...(skills.toolsDevOps || []),
    ...(skills.other || []),
  ];

  // Build highlights from experience bullets (first 4)
  const highlights = (currentRole.bullets || []).slice(0, 4);

  return {
    name: info.name,
    email: info.email,
    phone: info.phone,
    location: info.location,
    linkedin: info.linkedin,
    github: info.github,
    portfolio: info.portfolio,
    role: `Full Stack ${meta.stack} Developer`,
    currentTitle: currentRole.title || 'SDE',
    currentCompany: currentRole.company || '',
    experience: `${years} years`,
    experienceStart: meta.experienceStart,
    stack: `${meta.stack} (MongoDB, Express, React, Node.js)`,
    primaryCloud: meta.primaryCloud,
    cannotClaim: meta.cannotClaim || [],
    allSkills,
    highlights,
    summary: data.professionalSummary?.default || '',
  };
}

export const config = {
  // Paths
  paths: {
    outputDir,
    logsDir: join(__dirname, 'logs'),
    resumeDataPath: RESUME_DATA_PATH,
    getOutputPath: (timestamp) => {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      return join(outputDir, `extracted_${timestamp}.json`);
    },
  },

  // AI Configuration (Gemini only)
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',

    // Model pool for rotation (ordered by preference)
    models: {
      extraction: [
        'gemini-2.5-pro',
        'gemini-3-pro-preview',
        'gemini-2.5-flash',
        'gemini-3-flash-preview',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ],
      emailGen: [
        'gemini-2.5-pro',
        'gemini-3-pro-preview',
        'gemini-2.5-flash',
        'gemini-3-flash-preview',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ],
    },

    rateLimitCooldown: 60000, // 60 second cooldown on rate limit
  },

  // Candidate info loaded from resumeData.json
  candidate: loadCandidate(),
};

export default config;
