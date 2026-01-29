# 📋 Setup Checklist

> **Follow these steps to set up the LinkedIn Feed Email Extractor for your personal use**

Complete this checklist to ensure everything is configured correctly before your first run.

---

## ✅ Pre-Installation Checklist

### 1. System Requirements
- [ ] Node.js v16 or higher installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] Git installed (optional, for cloning)

### 2. API Keys & Credentials
- [ ] **Gemini API Key** obtained from [Google AI Studio](https://makersuite.google.com/app/apikey)
- [ ] **SMTP credentials** ready (Gmail/Outlook/Custom)
  - If using Gmail: Create an [App Password](https://support.google.com/accounts/answer/185833)
- [ ] **Resume PDF** prepared and ready to upload

---

## 🚀 Installation Steps

### Step 1: Clone/Download Repository
```bash
# Clone the repository
git clone <your-repo-url>
cd feed-email-extractor

# Or download ZIP and extract
```
- [ ] Repository downloaded/cloned
- [ ] Navigated to project directory

### Step 2: Install Dependencies
```bash
npm install
```
- [ ] Dependencies installed successfully
- [ ] No installation errors

### Step 3: Environment Configuration

#### 3.1 Create `.env` file
```bash
cp .env.example .env
```
- [ ] `.env` file created

#### 3.2 Edit `.env` with your credentials
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-actual-email@gmail.com
SMTP_PASS=your_actual_app_password
FROM_NAME=Your Actual Name
RESUME_PATH=./Your_Actual_Resume.pdf
EMAIL_TEST_MODE=true
EMAIL_TEST_INBOX=test@yopmail.com
```
- [ ] GEMINI_API_KEY added
- [ ] SMTP_HOST configured
- [ ] SMTP_USER (your email) added
- [ ] SMTP_PASS (app password) added
- [ ] FROM_NAME updated with your name
- [ ] RESUME_PATH updated with your resume filename
- [ ] EMAIL_TEST_MODE set to `true` (for testing)

### Step 4: Resume Setup

#### 4.1 Add your resume PDF
```bash
# Copy your resume to the project root
cp ~/Downloads/Your_Resume.pdf ./
```
- [ ] Resume PDF copied to project root
- [ ] Resume filename matches `RESUME_PATH` in `.env`

### Step 5: Personal Data Configuration

#### 5.1 Edit `resumeData.json`

Open `resumeData.json` and replace all fields with your information:

**Personal Info:**
- [ ] `name` - Your full name
- [ ] `dob` - Your date of birth
- [ ] `email` - Your email address
- [ ] `phone` - Your phone number
- [ ] `location` - Your city/state/country
- [ ] `linkedin` - Your LinkedIn profile URL
- [ ] `github` - Your GitHub profile URL
- [ ] `portfolio` - Your portfolio website URL

**Meta Info:**
- [ ] `experienceStart` - When you started your career (e.g., "Jan 2020")
- [ ] `stack` - Your tech stack (e.g., "MERN", "MEAN", "Django")
- [ ] `primaryCloud` - Your primary cloud platform (e.g., "AWS", "Azure", "GCP")
- [ ] `cannotClaim` - Technologies you DON'T know (important for AI accuracy)

**Skills:**
- [ ] `frontend` - Your frontend skills (e.g., ["React", "Vue", "TypeScript"])
- [ ] `backend` - Your backend skills (e.g., ["Node.js", "Express", "MongoDB"])
- [ ] `toolsDevOps` - Your tools/DevOps skills
- [ ] `other` - Other relevant skills

**Experience:**
- [ ] Update `experience` array with your work history
- [ ] At least one job entry with: `title`, `company`, `duration`, `bullets`

**Professional Summary:**
- [ ] Update `professionalSummary.default` with your summary

#### 5.2 Verify resumeData.json
```bash
# Check if JSON is valid
node -e "console.log(JSON.parse(require('fs').readFileSync('resumeData.json')))"
```
- [ ] No JSON syntax errors
- [ ] All your personal data updated

---

## 🧪 Testing

### Test 1: Verify SMTP Connection
```bash
npm run send:verify
```
**Expected output:**
```
[OK] SMTP connection verified
```
- [ ] SMTP connection successful

**If it fails:**
- Double-check SMTP credentials in `.env`
- Gmail users: Ensure you're using an App Password, not your regular password
- Check if 2FA is enabled on your email account

### Test 2: Test with Sample Data
```bash
npm run start:file sample-feed.json
```
**Expected output:**
```
Pre-flight checks...
[OK] Gemini API Key
Feed data loaded successfully
Using AI: Gemini
STEP 1: Analyzing feed for hiring posts...
...
```
- [ ] Pre-flight checks pass
- [ ] Sample data processed successfully
- [ ] Hiring posts extracted
- [ ] Emails generated
- [ ] Results saved to `output/`
- [ ] Contacts saved to `logs/contacts.json`

**If it fails:**
- Check `GEMINI_API_KEY` in `.env`
- Verify internet connection
- Check console for specific error messages

### Test 3: Test Email Sending (Test Mode)
```bash
npm run send:list
```
- [ ] Unsent emails listed

```bash
npm run send
```
**Expected output:**
```
[TEST MODE] Redirecting recipient@example.com -> test@yopmail.com
[SENT] test@yopmail.com | messageId=...
```
- [ ] Test email sent to `test@yopmail.com`
- [ ] Check https://yopmail.com - inbox: `test` - for the email
- [ ] Email formatting looks good
- [ ] Resume attached correctly

---

## 🎯 First Real Run

### Step 1: Get LinkedIn Data

**Option A: Browser DevTools (Recommended)**
1. Open LinkedIn in your browser
2. Search for jobs (e.g., "React developer hiring")
3. Open DevTools (F12) → Network tab
4. Filter by "Fetch/XHR"
5. Scroll through posts to trigger API calls
6. Find requests to `/voyager/api/feed/` or `/search/`
7. Click on the request → Response tab
8. Copy the entire JSON response

- [ ] LinkedIn API response copied to clipboard

**Option B: Save to File**
- [ ] Save LinkedIn API response as `my-feed.json`

### Step 2: Disable Test Mode
Edit `.env`:
```env
EMAIL_TEST_MODE=false
```
- [ ] Test mode disabled (or keep enabled for safety)

### Step 3: Run Extraction
```bash
# From clipboard:
npm start

# Or from file:
npm run start:file my-feed.json
```
- [ ] Extraction completed
- [ ] Results saved
- [ ] Contacts logged

### Step 4: Review Results
Check `logs/contacts.json`:
- [ ] Contacts look accurate
- [ ] Email content is personalized
- [ ] No errors in generated emails

### Step 5: Send Emails (When Ready)
```bash
# List what will be sent:
npm run send:list

# Send all unsent:
npm run send
```
- [ ] Emails sent successfully
- [ ] No duplicate warnings (or handled appropriately)

---

## 🎉 You're All Set!

### Regular Workflow:
1. Search LinkedIn for jobs/hiring posts
2. Copy API response from DevTools
3. Run `npm start`
4. Review generated emails in `logs/contacts.json`
5. Send when ready: `npm run send`
6. Track sent emails automatically

### Best Practices:
- ✅ Always review generated emails before sending
- ✅ Use test mode when trying new prompts
- ✅ Send max 20-30 emails/day (avoid spam flags)
- ✅ Keep `resumeData.json` updated
- ✅ Check `logs/extraction_history.json` for stats

---

## 🐛 Common Issues

### "GEMINI_API_KEY not set"
→ Add API key to `.env` file

### "SMTP connection failed"
→ Check SMTP credentials
→ Gmail: Use App Password
→ Enable "Less secure app access" (if required)

### "Clipboard is empty"
→ Copy LinkedIn API response before running
→ Or use file input: `npm run start:file`

### "No hiring posts found"
→ Search for "hiring" keywords on LinkedIn first
→ Use more specific searches (e.g., "React developer hiring")

### "Rate limit exceeded"
→ Wait 60 seconds (tool auto-rotates models)
→ Reduce number of posts in input

### Emails going to spam
→ Send fewer emails per day
→ Use professional email subject lines
→ Ensure SMTP authentication is correct

---

## 📚 Next Steps

- [ ] Read [README.md](README.md) for detailed usage
- [ ] Read [CODEBASE_GUIDE.md](CODEBASE_GUIDE.md) to understand the code
- [ ] Customize AI prompts in `services/ai.js`
- [ ] Add new features (see CODEBASE_GUIDE.md for ideas)
- [ ] Star the repo if you find it useful! ⭐

---

## 🔒 Security Reminders

- [ ] Never commit `.env` to GitHub
- [ ] Never commit `resumeData.json` with personal info
- [ ] Never share your SMTP password
- [ ] Keep your Gemini API key private
- [ ] Add sensitive files to `.gitignore` (already done)

---

**Happy job hunting! 🚀**

Need help? Open an issue on GitHub or consult the documentation.
