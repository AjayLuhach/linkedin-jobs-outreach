# LinkedIn Feed Email Extractor

CLI tool that extracts hiring posts from LinkedIn, uses AI to identify contacts and generate personalized emails, and sends them on a schedule with a dashboard for review.

## Features

- Parse LinkedIn feed API responses (JSON) or scraped HTML
- AI-powered hiring post detection (Gemini, AWS Bedrock, or OpenAI)
- Extract and validate emails from posts (including obfuscated formats)
- Generate personalized cold emails with AI
- Web dashboard for reviewing, approving, and rejecting contacts
- Scheduled email sending with background mailer daemon (9 AM - 1 PM IST)
- Email verification before sending (MX lookup + junk filter)
- Test mode for safe email testing
- Resume PDF attachment (required — fails hard if missing)

## Prerequisites

- Node.js v16+
- AI provider — one of:
  - [Gemini API key](https://makersuite.google.com/app/apikey) (free)
  - AWS credentials for Bedrock
  - [OpenAI API key](https://platform.openai.com/api-keys)
- SMTP credentials (Gmail/Outlook/custom)

## Setup

```bash
npm install
cp .env.example .env    # edit with your credentials
```

Edit `.env`:

```env
# AI — choose "gemini", "bedrock", or "openai"
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
FROM_NAME=Your Name
RESUME_PATH=./Your_Resume.pdf
```

Gmail users: use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password.

Edit `resumeData.json` with your personal info, skills, and experience.

## Workflow

```
1. Parse LinkedIn data    →  output/extract.json
2. AI extract hiring posts →  data/posts.json
3. Score + draft emails   →  data/users/{name}.json
4. Review in dashboard    →  approve / reject contacts
5. Mailer daemon sends    →  scheduled between 9 AM - 1 PM IST
```

## Commands

| Command | Description |
|---|---|
| `npm run parse` | Parse LinkedIn data from clipboard |
| `npm run parse:file <path>` | Parse from a file |
| `npm run generate` | Phase 1: AI extract hiring posts → posts DB |
| `npm run emails` | Phase 2+3: Score posts → draft emails → user DB |
| `npm run emails:redraft` | Re-draft emails for posts with "drafted" status |
| `npm run send` | List approved emails ready to send |
| `npm run dashboard` | Open web dashboard (localhost:3456) |
| `npm run mailer` | Start background mailer daemon |
| `npm run mailer:stop` | Stop the mailer daemon |
| `npm run send:emails` | Send all approved emails immediately |
| `npm run send:list` | List unsent emails |
| `npm run send:verify` | Test SMTP connection |

### Typical usage

```bash
# 1. Copy LinkedIn feed JSON to clipboard, then:
npm run parse

# 2. AI extract hiring posts from parsed data:
npm run generate

# 3. Score posts and draft emails:
npm run emails

# 4. Open dashboard to review and approve contacts:
npm run dashboard

# 5. Start the mailer daemon (sends approved emails on schedule):
npm run mailer
```

## Dashboard

`npm run dashboard` starts a local server at `http://localhost:3456` with:

- Contact cards with match scores, job details, and email previews
- Approve / reject / restore actions
- Filters: Sendable, Approved, Sent, Email Only, DM Only, Low Match, Rejected, Verify Failed
- Salary and job type filters
- Search across all fields

## Email Verification

Before sending, each email is automatically checked:

1. **Junk filter** — skips role-based addresses (noreply@, info@, abuse@, etc.)
2. **MX lookup** — verifies the domain has mail servers (falls back to A record per RFC 5321)

Failed verifications are logged and visible in the dashboard.

Configure in `.env`:
```env
VERIFY_MX_TIMEOUT=5000   # DNS lookup timeout in ms
```

## Mailer Daemon

`npm run mailer` starts a background process that:

- Checks every 60 seconds for approved emails whose scheduled time has passed
- Sends them with a 2-second delay between each
- Runs between 9 AM and 1 PM IST, auto-exits after
- Logs to `logs/mailer.log`

Stop with `npm run mailer:stop`.

## Test Mode

Redirect all emails to a test inbox:

```env
EMAIL_TEST_MODE=true
EMAIL_TEST_INBOX=test@yopmail.com
```

## Project Structure

```
feed-email-extractor/
├── src/
│   ├── cli.js                    # CLI entry point (parse/generate/emails/send)
│   ├── config.js                 # Configuration loader
│   ├── services/
│   │   ├── ai-bedrock.js         # 3-phase pipeline (extract, score, draft)
│   │   ├── ai-provider.js        # Unified AI provider (Bedrock/Gemini/OpenAI)
│   │   ├── prompts.js            # AI prompt templates
│   │   ├── db.js                 # JSON file database
│   │   ├── clipboard.js          # Clipboard reader
│   │   ├── parse-linkedin-feed.js # Parse LinkedIn API JSON
│   │   ├── parse-linkedin-html.js # Parse LinkedIn HTML
│   │   ├── extract-store.js      # Manages output/extract.json
│   │   ├── email-sender.js       # SMTP email sending
│   │   ├── email-validator.js    # Email format validation
│   │   ├── email-verifier.js     # MX lookup + junk filter
│   │   └── location-filter.js    # India-only location filter
│   └── scripts/
│       ├── dashboard-server.js   # Dashboard HTTP server
│       ├── send-emails.js        # CLI for sending emails
│       ├── mailer-daemon.js      # Background mailer daemon
│       ├── mailer-stop.js        # Stop the daemon
│       └── reset-rejected.js     # Reset rejected emails
├── dashboard/
│   ├── index.html                # Dashboard UI
│   └── styles.css                # Dashboard styles
├── data/                         # JSON file DB (gitignored)
│   ├── posts.json
│   └── users/{name}.json
├── output/                       # Generated data (gitignored)
│   └── extract.json
├── resumeData.json               # Your personal info (edit this)
├── .env.example                  # Environment template
└── logs/                         # Logs (gitignored)
    └── mailer.log
```

## AI Providers

### Gemini (default)

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
# GEMINI_MODEL=gemini-2.0-flash
```

### AWS Bedrock

```env
AI_PROVIDER=bedrock
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
```

### OpenAI

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_key
# OPENAI_MODEL=gpt-4o-mini
```

## Notes

- **Gmail limit**: 500 emails/day. Recommend max 20-30/day to avoid spam flags.
- **Privacy**: Never commit `.env` or `resumeData.json` (both in `.gitignore`).
- **Duplicates**: The tool warns before sending to the same email twice.
- **LinkedIn ToS**: Use for personal job search only.

## License

MIT
