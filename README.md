# 📧 LinkedIn Feed Email Extractor

> **Automate your job search**: Extract hiring posts from LinkedIn, generate personalized emails with AI, and send them automatically.

A CLI tool that processes LinkedIn feed API responses, uses Gemini AI to identify hiring posts with contact emails, generates personalized job application emails, and sends them via SMTP.

---

## 🚀 Features

- ✅ Parse LinkedIn feed/search API responses
- 🤖 AI-powered hiring post detection (Gemini)
- 📧 Extract and validate emails from posts (including obfuscated formats)
- ✔️ Smart email validation - filters out phone numbers and invalid formats
- ✍️ Generate personalized email content with AI
- 📮 Send emails via SMTP with resume attachment
- 📊 Track sent emails and prevent duplicates
- 🛡️ Graceful error handling - invalid emails won't stop the batch
- 🧪 Test mode for safe email testing

---

## 📋 Prerequisites

- **Node.js** v16+ installed
- **Gemini API key** (free from [Google AI Studio](https://makersuite.google.com/app/apikey))
- **SMTP credentials** (Gmail/Outlook/custom SMTP server)
- **LinkedIn API access** (optional - can use browser DevTools)

---

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd feed-email-extractor
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
```env
GEMINI_API_KEY=your_gemini_api_key_here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
FROM_NAME=Your Name
RESUME_PATH=./your_resume.pdf
```

> **Gmail users**: Use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password.

### 4. Update your resume data
Edit `resumeData.json` with your personal information:
```json
{
  "personalInfo": {
    "name": "Your Name",
    "email": "your@email.com",
    "phone": "+1234567890",
    "location": "City, State, Country",
    "linkedin": "linkedin.com/in/yourprofile",
    "github": "github.com/yourusername",
    "portfolio": "https://yourportfolio.com"
  },
  "meta": {
    "experienceStart": "Jan 2020",
    "stack": "MERN",
    "primaryCloud": "AWS",
    "cannotClaim": ["Java", "Python Django"]
  },
  ...
}
```

### 5. Add your resume PDF
Place your resume PDF in the project root and update `RESUME_PATH` in `.env`:
```
RESUME_PATH=./Your_Resume.pdf
```

---

## 📖 How to Use

### Step 1: Get LinkedIn Feed Data

**Option A: Using Browser DevTools** (Recommended)
1. Open LinkedIn and search for jobs/posts (e.g., "React developer hiring")
2. Open DevTools (F12) → Network tab → Filter by "Fetch/XHR"
3. Scroll through posts to trigger API calls
4. Look for requests to `/voyager/api/feed/` or `/search/`
5. Copy the JSON response

**Option B: Using LinkedIn API** (if you have access)
- Use the official LinkedIn API to fetch feed/search data

### Step 2: Run the Extractor

**From clipboard:**
```bash
npm start
```
(Make sure you copied the LinkedIn API response first)

**From a file:**
```bash
npm run start:file sample-feed.json
```

The tool will:
1. ✅ Parse the LinkedIn data
2. 🤖 Analyze posts with Gemini AI
3. 📧 Extract hiring posts with emails
4. ✍️ Generate personalized email content
5. 💾 Save everything to `output/extracted_TIMESTAMP.json`
6. 📝 Log contacts to `logs/contacts.json`

### Step 3: Review Generated Emails

Check `logs/contacts.json` to see all extracted contacts and generated emails.

### Step 4: Send Emails

**List unsent emails:**
```bash
npm run send:list
```

**Verify SMTP connection:**
```bash
npm run send:verify
```

**Send all unsent emails:**
```bash
npm run send
```

> **Safety feature**: If an email was previously sent, you'll be prompted to confirm before resending.

---

## 🧪 Testing

**Test Mode** (redirect all emails to a test inbox):
```env
EMAIL_TEST_MODE=true
EMAIL_TEST_INBOX=test@yopmail.com
```

All emails will be sent to the test inbox instead of real recipients. Perfect for testing!

---

## 📂 Project Structure

```
feed-email-extractor/
├── index.js                    # Main CLI entry point
├── config.js                   # Configuration loader
├── resumeData.json             # Your personal info (edit this!)
├── package.json                # Dependencies & scripts
├── .env                        # Environment variables (create from .env.example)
├── services/
│   ├── clipboard.js            # Read clipboard content
│   ├── parser.js               # Parse LinkedIn API responses
│   ├── ai.js                   # Gemini AI integration
│   ├── email-validator.js      # Validate emails, filter phone numbers
│   ├── contact-logger.js       # Track contacts & sent status
│   ├── email-sender.js         # SMTP email sending
│   └── output.js               # Save results to files
├── scripts/
│   └── send-emails.js          # CLI for sending emails
├── output/                     # Extracted results (auto-generated)
└── logs/
    ├── contacts.json           # Contact log with sent status
    └── extraction_history.json # Extraction history stats
```

---

## 🔄 Workflow Diagram

```
┌──────────────────┐
│  LinkedIn Feed   │
│  (Copy JSON)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Clipboard /     │
│  File Input      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Parser          │
│  (Extract posts) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Gemini AI       │
│  - Find hiring   │
│  - Extract emails│
│  - Generate msgs │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Save Results    │
│  - output/*.json │
│  - logs/*.json   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Send Emails     │
│  (SMTP)          │
└──────────────────┘
```

---

## 🎯 Understanding the Code

### **1. index.js** - Main Orchestrator
```javascript
// Entry point - coordinates the entire flow
main()
  → preflightChecks()      // Verify API keys, paths
  → getFeedData()          // Read clipboard or file
  → extractAndGenerate()   // AI extraction + email generation
  → logExtractedContacts() // Save to contacts.json
  → saveResults()          // Save to output/
```

### **2. config.js** - Configuration Hub
```javascript
// Loads all configuration from:
// - .env (API keys, SMTP settings)
// - resumeData.json (your personal info)
// Single source of truth for the entire app
```

### **3. services/parser.js** - LinkedIn Data Parser
```javascript
// Parses raw LinkedIn API response
// Extracts: author, post text, job details, emails
// Handles: search results & feed data
// Returns: Clean array of posts
```

### **4. services/ai.js** - AI Brain
```javascript
// Two-step AI pipeline:
// Step 1: Extract hiring posts from feed
// Step 2: Generate personalized emails
// Features: Model rotation, rate limit handling, JSON repair
```

### **5. services/contact-logger.js** - Contact Tracker
```javascript
// Manages logs/contacts.json
// Tracks: email addresses, job details, sent status
// Prevents: duplicate emails to same person
```

### **6. services/email-sender.js** - Email Dispatcher
```javascript
// Sends emails via SMTP
// Attaches: resume PDF
// Supports: test mode, connection verification
```

### **7. scripts/send-emails.js** - Email CLI
```javascript
// Interactive CLI for sending emails
// Features: list unsent, verify connection, duplicate warnings
```

---

## 🔧 Customization Guide

### Change AI Model Preferences
Edit `config.js`:
```javascript
models: {
  extraction: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  emailGen: ['gemini-2.5-pro', 'gemini-2.5-flash'],
}
```

### Modify Email Generation Prompt
Edit `services/ai.js` → `buildEmailGenPrompt()` function

### Add More Resume Fields
1. Add fields to `resumeData.json`
2. Update `config.js` → `loadCandidate()` function
3. Use in AI prompts in `services/ai.js`

### Change Output Format
Edit `services/output.js` → `saveResults()` function

---

## ⚠️ Important Notes

### Email Limits
- **Gmail**: 500 emails/day for free accounts
- **Recommendation**: Send max 20-30 emails/day to avoid spam flags
- Use `EMAIL_TEST_MODE=true` for testing

### Privacy
- Never commit `.env` or `resumeData.json` to GitHub (use `.gitignore`)
- Keep your API keys and SMTP passwords secure

### LinkedIn API
- This tool works with LinkedIn API responses
- Respect LinkedIn's Terms of Service
- Use for personal job search only

### Duplicate Prevention
- The tool tracks sent emails in `logs/contacts.json`
- You'll be warned before sending to the same email twice
- Mark emails as sent even if you skip them

---

## 🐛 Troubleshooting

### "GEMINI_API_KEY not set"
→ Add `GEMINI_API_KEY` to your `.env` file

### "SMTP connection failed"
→ Check SMTP credentials in `.env`
→ Gmail users: Use [App Password](https://support.google.com/accounts/answer/185833)

### "Clipboard is empty"
→ Copy LinkedIn API response before running
→ Or use `npm run start:file sample-feed.json`

### "No hiring posts found"
→ LinkedIn feed might not contain hiring posts
→ Search for "hiring" or specific job titles on LinkedIn first

### Rate limits / 429 errors
→ Tool automatically rotates between Gemini models
→ Wait 60 seconds if all models are rate-limited

---

## 📊 Output Files

### `output/extracted_TIMESTAMP.json`
Complete extraction results with all posts and generated emails.

### `logs/contacts.json`
Contact database with tracking:
```json
{
  "date": "2025-02-15",
  "job": {
    "title": "Full Stack Developer",
    "company": "TechCorp"
  },
  "contacts": [{
    "type": "email",
    "value": "hiring@techcorp.com",
    "name": "John Doe"
  }],
  "emailSent": false,
  "emailData": {
    "subject": "Application for Full Stack Developer at TechCorp",
    "body": "..."
  }
}
```

### `logs/extraction_history.json`
Stats tracking:
```json
{
  "entries": [...],
  "stats": {
    "totalExtractions": 10,
    "totalEmails": 25,
    "totalHiringPosts": 35
  }
}
```

---

## 🤝 Contributing

Feel free to open issues or submit PRs to improve this tool!

---

## 📜 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- **Google Gemini AI** for powerful text analysis
- **Nodemailer** for email sending
- **Clipboardy** for clipboard access

---

## 📞 Support

If you encounter issues or have questions, please open an issue on GitHub.

---

**Happy job hunting! 🎯**
