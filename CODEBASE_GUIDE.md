# 🔍 Codebase Deep Dive Guide

> **A complete walkthrough of how the LinkedIn Feed Email Extractor works internally**

This guide will help you understand every part of the codebase, from data flow to AI prompts.

---

## 📌 Table of Contents

1. [Quick Start - Where to Begin](#1-quick-start---where-to-begin)
2. [Data Flow Architecture](#2-data-flow-architecture)
3. [File-by-File Breakdown](#3-file-by-file-breakdown)
4. [Key Concepts](#4-key-concepts)
5. [Customization Points](#5-customization-points)
6. [Common Patterns](#6-common-patterns)

---

## 1. Quick Start - Where to Begin

### 🎯 Start Reading Here (in order):

```
1. index.js          → See the big picture (main flow)
2. config.js         → Understand configuration loading
3. services/ai.js    → The AI brain (most complex)
4. services/parser.js → LinkedIn data parsing
5. Other services    → Supporting functions
```

### 🔥 Most Important Files:

- **`index.js`** - Orchestrates everything
- **`config.js`** - Single source of truth for config
- **`services/ai.js`** - AI extraction & email generation
- **`resumeData.json`** - Your personal data (customize this!)

---

## 2. Data Flow Architecture

### 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER ACTION                               │
│  Copy LinkedIn API response → Clipboard                      │
│  OR                                                          │
│  Save to file.json                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: INPUT READING (clipboard.js)                       │
│  ├── readClipboard() → Get text from clipboard              │
│  └── validateFeedData() → Check if valid JSON               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: PARSING (parser.js)                                │
│  ├── Detect: Search results or Feed data?                   │
│  ├── Extract: Posts, authors, job details                   │
│  ├── Find: Plain & obfuscated emails in post text           │
│  └── Return: Clean array of post objects                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: AI EXTRACTION (ai.js - Step 1)                     │
│  ├── Build prompt with all posts                            │
│  ├── Send to Gemini AI                                      │
│  ├── AI identifies: Hiring posts vs regular posts           │
│  ├── AI extracts: Emails, company, role, requirements       │
│  └── Return: Array of hiring posts with metadata            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: EMAIL GENERATION (ai.js - Step 2)                  │
│  ├── For each hiring post with email:                       │
│  │   ├── Build prompt with job details + your resume data   │
│  │   ├── Send to Gemini AI                                  │
│  │   ├── AI generates: Subject + personalized email body    │
│  │   └── Return: Email object {to, subject, body}           │
│  └── Return: Array of generated emails                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: LOGGING (contact-logger.js)                        │
│  ├── Check: Email already logged? → Skip if duplicate       │
│  ├── Add: New contact to logs/contacts.json                 │
│  ├── Attach: Generated email content + metadata             │
│  └── Track: emailSent: false (not sent yet)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 6: SAVING RESULTS (output.js)                         │
│  ├── Save: output/extracted_TIMESTAMP.json                  │
│  ├── Log: logs/extraction_history.json (stats)              │
│  └── Display: Summary to console                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 7: SENDING EMAILS (scripts/send-emails.js)            │
│  ├── Load: Unsent emails from logs/contacts.json            │
│  ├── Check: Duplicate detection (already sent?)             │
│  ├── Build: Email with resume attachment                    │
│  ├── Send: Via SMTP (email-sender.js)                       │
│  └── Mark: emailSent: true in contacts.json                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. File-by-File Breakdown

### 📄 `index.js` - Main Entry Point

**Purpose**: Orchestrates the entire extraction process

**Key Functions**:

```javascript
// 1. Pre-flight checks
preflightChecks()
  → Verifies GEMINI_API_KEY exists
  → Checks output directory

// 2. Parse CLI arguments
parseArgs()
  → --file path/to/feed.json (optional)

// 3. Get feed data
getFeedData(options)
  → If --file: Read from file
  → Else: Read from clipboard
  → Validate & parse LinkedIn data

// 4. AI extraction + generation
extractAndGenerate(feedData)
  → Step 1: Extract hiring posts
  → Step 2: Generate emails
  → Returns: { extraction, emails }

// 5. Log contacts
logExtractedContacts(hiringPosts, emails)
  → Save to logs/contacts.json
  → Skip duplicates

// 6. Save results
saveResults(results)
  → Save to output/extracted_TIMESTAMP.json
logToHistory(results)
  → Update logs/extraction_history.json
displayFinalSummary(results, outputPath)
  → Pretty print summary
```

**Flow**:
```
main() → checks → parse args → get data → AI process → log → save → done
```

---

### ⚙️ `config.js` - Configuration Loader

**Purpose**: Single source of truth for all configuration

**What it loads**:

1. **Environment variables** (`.env`):
   ```javascript
   GEMINI_API_KEY → config.ai.geminiApiKey
   SMTP_* → Used by email-sender.js
   ```

2. **Resume data** (`resumeData.json`):
   ```javascript
   loadCandidate() → Parses JSON
   Calculates experience years
   Builds skill list
   Returns: config.candidate object
   ```

3. **Paths**:
   ```javascript
   outputDir → output/
   logsDir → logs/
   resumeDataPath → resumeData.json
   ```

4. **AI models**:
   ```javascript
   models.extraction → ['gemini-2.5-pro', 'gemini-2.5-flash', ...]
   models.emailGen → Same list
   ```

**Key Insight**: Change config here → affects entire app

---

### 🧠 `services/ai.js` - AI Brain (Most Complex!)

**Purpose**: Use Gemini AI to extract hiring posts and generate emails

#### Structure Overview:

```javascript
┌─────────────────────────────────────────┐
│  INITIALIZATION                          │
│  initializeClient()                      │
│  → Creates GoogleGenerativeAI client     │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  MODEL DISCOVERY                         │
│  fetchAvailableModels()                  │
│  → Queries Gemini API for available      │
│    models                                │
│  getModelsForTask('extraction')          │
│  → Returns prioritized model list        │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  MODEL ROTATION (Smart!)                 │
│  modelManager.getAvailableModel()        │
│  → Picks first non-rate-limited model    │
│  modelManager.markRateLimited()          │
│  → Cooldown for 60s if rate limit hit    │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  AI EXECUTION                            │
│  executeWithRotation()                   │
│  → Try model #1                          │
│  → If rate limited → Try model #2        │
│  → If all limited → Wait & retry         │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  TWO-STEP PIPELINE                       │
│  Step 1: extractAndGenerate()            │
│    → buildExtractionPrompt()             │
│    → Send to AI                          │
│    → parseJSON() response                │
│    → Returns: hiring posts               │
│  Step 2: For each post                   │
│    → buildEmailGenPrompt()               │
│    → Send to AI                          │
│    → parseJSON() response                │
│    → Returns: email content              │
└─────────────────────────────────────────┘
```

#### Key Functions Explained:

**1. `buildExtractionPrompt(feedData)`**
```javascript
// What it does:
// - Takes parsed LinkedIn posts
// - Creates a prompt asking AI to find hiring posts
// - Asks for: company, role, requirements, emails, urgency

// Prompt structure:
"Analyze these LinkedIn posts and extract ONLY hiring-related posts...
POSTS DATA:
[... feed data ...]
HIRING POSTS = posts with 'hiring', 'looking for', 'open position'...
Extract emails in ALL formats (plain, obfuscated)...
JSON only, NO markdown:
{hiringPosts:[...], totalPostsAnalyzed:0, hiringPostsFound:0}"
```

**2. `buildEmailGenPrompt(hiringPost, candidate)`**
```javascript
// What it does:
// - Takes a single hiring post
// - Takes your resume data from config.candidate
// - Creates a prompt to generate personalized email

// Prompt structure:
"Write a professional job application email.
JOB DETAILS:
- Poster: [name] ([title])
- Company: [company]
- Role: [role]
...
CANDIDATE DETAILS (use ONLY this data):
- Name: [your name]
- Experience: [X years]
- Skills: [your skills]
...
STRICT RULES:
1. Subject: specific to role + company
2. Opening: reference their LinkedIn post
3. ONLY mention YOUR skills (don't claim job post skills)
4. Max 150 words
5. Mention attaching resume
..."
```

**3. `parseJSON(response, step)`**
```javascript
// What it does:
// - Cleans AI response (removes ```json markers)
// - Parses JSON
// - If truncated → Attempts to repair (close brackets)
// - Returns parsed object

// Smart repair for truncated responses:
// - Counts open/close brackets
// - Removes incomplete strings
// - Adds missing closing brackets
```

**4. Model Rotation Logic**
```javascript
// Why it's smart:
// - Gemini has rate limits (requests per minute)
// - Instead of failing, we try the next model
// - If all models are limited → Wait 60s

// Example flow:
Try gemini-2.5-pro → 429 error
  ↓
Try gemini-2.5-flash → 429 error
  ↓
Try gemini-2.0-flash → Success! ✅
```

---

### 📋 `services/parser.js` - LinkedIn Data Parser

**Purpose**: Convert messy LinkedIn API JSON into clean post objects

#### What LinkedIn API Returns:

```javascript
// Complex nested structure:
{
  data: {
    data: {
      searchDashClustersByAll: { ... }  // Search results
      OR
      feedDashMainFeedByMainFeed: { ... }  // Feed data
    }
  },
  included: [
    { $type: 'Update', ... },           // Post content
    { $type: 'SocialActivityCounts', ... },  // Likes/comments
    { $type: 'Hashtag', ... },          // Tags
  ]
}
```

#### What Parser Does:

```javascript
parseLinkedInResponse(raw)
  ↓
1. Detect source: 'search' or 'feed'
  ↓
2. Extract updates from 'included' array
  ↓
3. For each update:
   parseUpdate(update, socialCounts, hashtags)
     ↓
     Extract:
     - actorName (post author)
     - commentary (post text)
     - jobTitle, jobCompany (if job post)
     - likes, comments, shares
     - emailsFound (plain + obfuscated)
  ↓
4. Return clean array: [{ actorName, commentary, emails, ... }]
```

#### Email Extraction (Smart!):

```javascript
extractEmails(text)
  ↓
1. Plain emails: "contact@company.com"
   → Regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g
  ↓
2. Obfuscated: "contact [at] company [dot] com"
   → Regex: /[a-z0-9._%+-]+\s*[\[\(]\s*at\s*[\]\)]\s*[...]/gi
   → Convert: "contact@company.com"
  ↓
3. Return unique emails
```

---

### 📝 `services/contact-logger.js` - Contact Tracker

**Purpose**: Manage `logs/contacts.json` - your contact database

#### Data Structure:

```json
[
  {
    "date": "2025-02-15",
    "job": {
      "title": "Full Stack Developer",
      "company": "TechCorp"
    },
    "contacts": [
      {
        "type": "email",
        "value": "hiring@techcorp.com",
        "name": "John Doe"
      }
    ],
    "description": "Looking for MERN developer...",
    "emailSent": false,
    "emailSentDate": null,
    "emailData": {
      "subject": "Application for Full Stack Developer at TechCorp",
      "body": "Dear John Doe, ...",
      "notes": "",
      "generatedAt": "2025-02-15T10:30:00.000Z"
    }
  }
]
```

#### Key Functions:

```javascript
// 1. Log new contacts (with duplicate prevention)
logExtractedContacts(hiringPosts, generatedEmails)
  → For each post with email:
    → Check: email already in log?
    → If no: Add new entry with emailSent: false
    → If yes: Skip (duplicate)
  → Returns: { added, skippedDuplicate, skippedNoEmail }

// 2. Mark email as sent
markEmailAsSent(email)
  → Find entry with this email
  → Set: emailSent: true, emailSentDate: today
  → Save contacts.json

// 3. Check if already sent
checkPreviouslySent(email)
  → Find entry where emailSent === true
  → Returns: job info + sent date (or null)

// 4. Get unsent emails
getUnsentEmails()
  → Filter: emailSent === false
  → Returns: Array of unsent contact objects
```

---

### ✔️ `services/email-validator.js` - Email Validation

**Purpose**: Validate email addresses and filter out non-email values (phone numbers, invalid formats)

#### Why This Service Exists:

When extracting contact information from LinkedIn posts, the AI sometimes includes phone numbers (like `+91-9618000414`) in the emails array. This service ensures only valid email addresses are processed and sent to.

#### Key Functions:

```javascript
// 1. Validate if a string is a valid email
isValidEmail(email)
  → Checks: basic email format (local@domain.tld)
  → Rejects: phone numbers, invalid formats
  → Returns: true/false

  Example:
  isValidEmail('john@example.com')    // ✅ true
  isValidEmail('+91-9618000414')      // ❌ false (phone number)
  isValidEmail('invalid@')            // ❌ false (incomplete)

// 2. Classify contact values
classifyContact(value)
  → Determines type: 'email', 'phone', or 'unknown'
  → Returns: contact type as string

  Example:
  classifyContact('john@example.com')  // 'email'
  classifyContact('+91-9618000414')    // 'phone'
  classifyContact('123-456')           // 'phone'

// 3. Filter array to valid emails only
filterValidEmails(emails)
  → Takes array of strings
  → Returns: only valid email addresses

  Example:
  filterValidEmails(['john@example.com', '+91-1234567890', 'jane@example.com'])
  // Returns: ['john@example.com', 'jane@example.com']
```

#### Validation Logic:

**Phone Number Detection:**
```javascript
// Checks if value contains only digits, +, -, (, ), spaces
// Pattern: /^[\d\s\+\-\(\)]+$/
'+91-9618000414'  // ❌ Rejected as phone
'9876543210'       // ❌ Rejected as phone
```

**Email Format Validation:**
```javascript
// Must match: local@domain.tld
// Pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
'user@example.com'     // ✅ Valid
'user@example'         // ❌ No TLD
'@example.com'         // ❌ No local part
'user name@example'    // ❌ Space in local
```

#### Integration Points:

**Used in `contact-logger.js`:**
```javascript
// Before logging a contact
const contactType = classifyContact(email);
if (contactType !== 'email') {
  console.log(`[SKIP] ${email} is not a valid email (detected as: ${contactType})`);
  continue;
}
```

**Used in `send-emails.js`:**
```javascript
// Before sending an email
if (!isValidEmail(contact.to)) {
  console.log(`[INVALID] Skipping ${contact.to} - not a valid email`);
  continue;
}
```

**Used in `email-sender.js`:**
```javascript
// Before attempting SMTP send
if (!isValidEmail(to)) {
  return { success: false, error: 'Invalid email address format' };
}
```

#### Benefits:

1. **Prevents Errors**: Won't attempt to send emails to phone numbers
2. **Graceful Handling**: Skips invalid emails, continues with valid ones
3. **Clear Logging**: Shows exactly why an email was skipped
4. **Batch Protection**: One invalid email won't stop the entire send batch

---

### 📧 `services/email-sender.js` - SMTP Email Dispatcher

**Purpose**: Send emails via SMTP with resume attachment and validation

#### Configuration (from `.env`):

```javascript
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@email.com
SMTP_PASS=your_app_password
FROM_NAME=Your Name
RESUME_PATH=./Your_Resume.pdf
```

#### Key Functions:

```javascript
// 1. Verify SMTP connection
verifyConnection()
  → Test connection to SMTP server
  → Returns: true/false

// 2. Send email
sendEmail(emailData, markSent = true)
  → Validate: Check if 'to' is a valid email
  → If invalid: Return error (no exception thrown)
  → Build email:
    - From: "Your Name" <your@email.com>
    - To: recipient
    - Subject: emailData.subject
    - Body: emailData.body (plain text)
    - Attachments: [resume PDF]
  → Send via nodemailer
  → If markSent: Call markEmailAsSent(to)
  → Returns: { success, messageId, to } or { success: false, error }
```

#### Test Mode Feature:

```javascript
// In .env:
EMAIL_TEST_MODE=true
EMAIL_TEST_INBOX=test@yopmail.com

// Result:
// All emails redirect to test@yopmail.com
// You can verify email format before sending to real people
```

---

### 📊 `services/output.js` - Results Saver

**Purpose**: Save extraction results to files

#### What it saves:

**1. `output/extracted_TIMESTAMP.json`**
```json
{
  "extractedAt": "2025-02-15T10:30:00.000Z",
  "totalPostsAnalyzed": 50,
  "hiringPostsFound": 8,
  "emailsGenerated": 5,
  "hiringPosts": [...],      // Full hiring post data
  "generatedEmails": [...]   // Full email content
}
```

**2. `logs/extraction_history.json`**
```json
{
  "entries": [
    {
      "date": "2025-02-15T10:30:00.000Z",
      "postsAnalyzed": 50,
      "hiringPostsFound": 8,
      "emailsGenerated": 5,
      "companies": ["TechCorp", "StartupHub", ...]
    }
  ],
  "stats": {
    "totalExtractions": 15,
    "totalEmails": 67,
    "totalHiringPosts": 95
  }
}
```

---

### 🚀 `scripts/send-emails.js` - Email Sending CLI

**Purpose**: Interactive CLI for sending saved emails

#### Modes:

```bash
# 1. List unsent emails
npm run send:list
  → Shows: all emails where emailSent === false

# 2. Verify SMTP connection
npm run send:verify
  → Tests: SMTP connection

# 3. Send all unsent emails
npm run send
  → For each unsent:
    → Check: Previously sent to this email?
    → If yes: Prompt user to confirm
    → Build email from emailData
    → Send via email-sender.js
    → Mark as sent in contacts.json
    → Wait 1.2s between emails (anti-spam)
```

#### Duplicate Warning Flow:

```javascript
// If email was sent before:
console.log(`
${'='.repeat(70)}
DUPLICATE EMAIL WARNING
${'='.repeat(70)}

PREVIOUS EMAIL (sent 2025-02-10):
Job: Backend Developer at TechCorp
Subject: Application for Backend Developer at TechCorp
Body: Dear John, I am writing to...

CURRENT EMAIL (attempting to send):
Job: Full Stack Developer at TechCorp
Subject: Application for Full Stack Developer at TechCorp
Body: Dear John, I am writing to...

${'='.repeat(70)}
Send anyway? (y/n):
`);

// If user says 'n':
//   → Skip sending
//   → Mark as sent (to prevent future prompts)
// If user says 'y':
//   → Proceed to send
```

---

## 4. Key Concepts

### 🔄 Two-Step AI Pipeline

**Why two steps?**

```
Step 1: Extraction
  Input: 50 LinkedIn posts
  AI task: "Find the hiring posts among these 50"
  Output: 8 hiring posts with emails
  ✅ Reduces data for Step 2

Step 2: Email Generation
  Input: 1 hiring post + your resume
  AI task: "Write a personalized email for this job"
  Output: 1 email (subject + body)
  ✅ Each email is personalized to the specific job

Why not one step?
  → Too much data for one prompt
  → Less personalization
  → Harder to debug
```

### 🔐 Duplicate Prevention

**Three-level protection:**

1. **During extraction** (`contact-logger.js`):
   ```javascript
   // Check if email already in contacts.json
   if (contacts.some(c => c.contacts.some(x => x.value === email))) {
     skip(); // Don't log again
   }
   ```

2. **Before sending** (`scripts/send-emails.js`):
   ```javascript
   // Check if this email was sent before
   const previouslySent = checkPreviouslySent(email);
   if (previouslySent) {
     promptUser(); // Ask to confirm
   }
   ```

3. **After sending**:
   ```javascript
   // Mark as sent even if user skips
   markEmailAsSent(email);
   // Prevents future prompts
   ```

### 🔄 Model Rotation

**Smart failure handling:**

```javascript
// Traditional approach:
try {
  result = await gemini.generate(prompt);
} catch (rateLimitError) {
  throw error; // ❌ Fails completely
}

// Our approach:
models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']
for (model in models) {
  try {
    result = await gemini.generate(prompt, model);
    return result; // ✅ Success
  } catch (rateLimitError) {
    continue; // Try next model
  }
}

// If all models rate-limited:
wait(60_000); // Wait 60s
retry(); // Try again
```

### 🧩 Single Source of Truth

**Configuration hierarchy:**

```
.env
  ↓
config.js (loads .env + resumeData.json)
  ↓
All services import config.js
  ↓
Change .env → entire app updates
```

**Example:**
```javascript
// ❌ Bad: Hardcoded
const apiKey = 'sk-1234567890';

// ✅ Good: From config
import config from '../config.js';
const apiKey = config.ai.geminiApiKey;
```

---

## 5. Customization Points

### 🎨 Easy Customizations

#### 1. **Change AI Prompts**

**Location**: `services/ai.js`

```javascript
// Extraction prompt (line ~280)
function buildExtractionPrompt(feedData) {
  return `Analyze these LinkedIn posts...

  // 👇 Customize these criteria:
  HIRING POSTS = posts with "hiring", "looking for", "open position"

  // 👇 Add more extraction fields:
  {"hiringPosts":[{
    "posterName":"",
    "role":"",
    "salary":"",  // 👈 Add salary field
    ...
  }]}`;
}

// Email generation prompt (line ~297)
function buildEmailGenPrompt(hiringPost, candidate) {
  return `Write a professional job application email.

  // 👇 Customize email style:
  STRICT RULES:
  1. Subject: specific to role + company
  2. Max 150 words  // 👈 Change word limit
  3. Casual tone      // 👈 Change tone
  ...`;
}
```

#### 2. **Add Resume Fields**

**Step 1**: Edit `resumeData.json`:
```json
{
  "personalInfo": {
    "salary": "50k-80k",  // 👈 Add new field
    "availability": "Immediate"
  }
}
```

**Step 2**: Edit `config.js`:
```javascript
function loadCandidate() {
  return {
    name: info.name,
    salary: info.salary,        // 👈 Add here
    availability: info.availability,
    ...
  };
}
```

**Step 3**: Use in AI prompt (`services/ai.js`):
```javascript
CANDIDATE DETAILS:
- Salary expectation: ${candidate.salary}
- Availability: ${candidate.availability}
```

#### 3. **Change Email Delay**

**Location**: `scripts/send-emails.js` (line ~193)

```javascript
// Wait between emails (anti-spam)
await new Promise((resolve) => setTimeout(resolve, 1200));
//                                                    👆
//                                          Change to 2000 for 2s
```

#### 4. **Modify Output Format**

**Location**: `services/output.js`

```javascript
export function saveResults(results) {
  const output = {
    extractedAt: new Date().toISOString(),
    // 👇 Add custom fields:
    userAgent: process.env.USER,
    version: '1.0.0',
    ...
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
}
```

### 🔧 Advanced Customizations

#### 1. **Add New AI Provider (e.g., OpenAI)**

**Step 1**: Install OpenAI SDK:
```bash
npm install openai
```

**Step 2**: Add to `config.js`:
```javascript
ai: {
  provider: process.env.AI_PROVIDER || 'gemini',  // 'gemini' | 'openai'
  geminiApiKey: process.env.GEMINI_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
}
```

**Step 3**: Modify `services/ai.js`:
```javascript
function initializeClient() {
  if (config.ai.provider === 'openai') {
    return new OpenAI({ apiKey: config.ai.openaiApiKey });
  } else {
    return new GoogleGenerativeAI(config.ai.geminiApiKey);
  }
}

async function executeWithRotation(client, prompt, taskType, stepName) {
  if (config.ai.provider === 'openai') {
    // OpenAI implementation
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0].message.content;
  } else {
    // Gemini implementation (existing code)
    ...
  }
}
```

#### 2. **Add Database Storage (SQLite)**

**Step 1**: Install SQLite:
```bash
npm install better-sqlite3
```

**Step 2**: Create `services/database.js`:
```javascript
import Database from 'better-sqlite3';

const db = new Database('data.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    job_title TEXT,
    company TEXT,
    email_sent BOOLEAN,
    created_at DATETIME
  )
`);

export function addContact(email, jobTitle, company) {
  const stmt = db.prepare(`
    INSERT INTO contacts (email, job_title, company, email_sent, created_at)
    VALUES (?, ?, ?, 0, datetime('now'))
  `);
  stmt.run(email, jobTitle, company);
}

export function getUnsentEmails() {
  return db.prepare('SELECT * FROM contacts WHERE email_sent = 0').all();
}
```

**Step 3**: Replace `contact-logger.js` calls with database calls.

#### 3. **Add Web UI (Express)**

**Step 1**: Install Express:
```bash
npm install express ejs
```

**Step 2**: Create `server.js`:
```javascript
import express from 'express';
import { getUnsentEmails } from './services/contact-logger.js';

const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
  const contacts = getUnsentEmails();
  res.render('dashboard', { contacts });
});

app.listen(3000, () => {
  console.log('Dashboard: http://localhost:3000');
});
```

**Step 3**: Create `views/dashboard.ejs`:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Email Dashboard</title>
</head>
<body>
  <h1>Unsent Emails</h1>
  <ul>
    <% contacts.forEach(contact => { %>
      <li>
        <%= contact.to %> - <%= contact.jobTitle %> at <%= contact.jobCompany %>
      </li>
    <% }); %>
  </ul>
</body>
</html>
```

---

## 6. Common Patterns

### 📦 Module Pattern

```javascript
// Each service exports functions and a default object
export function myFunction() { ... }
export function anotherFunction() { ... }

export default {
  myFunction,
  anotherFunction,
};

// Usage:
import { myFunction } from './service.js';  // Named import
import service from './service.js';         // Default import
service.myFunction();
```

### 🔄 Error Handling Pattern

```javascript
// Try-catch with informative errors
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  console.error('Operation failed:', error.message);
  throw new Error(`Friendly error message: ${error.message}`);
}
```

### 📝 Logging Pattern

```javascript
// Consistent prefix for readability
console.log('   [OK] Operation succeeded');
console.log('   [FAIL] Operation failed');
console.log('   [SKIP] Item skipped');
console.log('   Using model: gemini-2.5-pro');
```

### 🗂️ File I/O Pattern

```javascript
// Always use try-catch + existence checks
import fs from 'fs';

function loadData(path) {
  if (!fs.existsSync(path)) {
    return []; // Default value
  }
  try {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch {
    return []; // Fallback on error
  }
}

function saveData(path, data) {
  const dir = dirname(path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}
```

---

## 🎯 Quick Reference

### Most Important Functions to Understand:

1. **`index.js: main()`** - Start here
2. **`services/ai.js: extractAndGenerate()`** - The AI pipeline
3. **`services/ai.js: buildEmailGenPrompt()`** - Email generation logic
4. **`services/parser.js: parseLinkedInResponse()`** - Data parsing
5. **`services/contact-logger.js: logExtractedContacts()`** - Duplicate prevention
6. **`services/email-validator.js: isValidEmail()`** - Email validation

### Files You'll Edit Most:

1. **`resumeData.json`** - Your personal info
2. **`.env`** - API keys & SMTP settings
3. **`services/ai.js`** - AI prompt customization
4. **`config.js`** - Add new config fields

### Debugging Tips:

```javascript
// Add console.log to see data flow:
console.log('DEBUG:', JSON.stringify(data, null, 2));

// Check AI responses:
console.log('AI Response:', extractionText.substring(0, 500));

// Verify configuration:
console.log('Config:', config.candidate);
```

---

## 🚀 Next Steps

1. **Read `index.js`** from top to bottom
2. **Trace one execution** with console.logs
3. **Modify AI prompts** in `services/ai.js`
4. **Test with sample data** using `npm run start:file`
5. **Customize `resumeData.json`** for your profile

---

**Happy coding! 🎉**

If you have questions, open an issue on GitHub or read through the specific files mentioned in this guide.
