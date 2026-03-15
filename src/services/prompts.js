/**
 * AI Prompt Templates
 * All prompts used by the extraction and email drafting pipeline.
 */

/**
 * Build the Phase 1 extraction prompt for a batch of LinkedIn posts.
 * @param {object[]} posts - Raw parsed posts
 * @returns {string} Prompt text
 */
export function buildExtractionPrompt(posts) {
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

  return `Extract structured job data from these ${posts.length} LinkedIn posts.
The candidate is a Full Stack MERN Developer (React, Node.js, Express, MongoDB, TypeScript, AWS) with ~3 years of experience based in India. Focus on extracting roles relevant to web development, backend, frontend, or full-stack engineering.

POSTS:
${JSON.stringify(postsData, null, 2)}

FOR EACH POST, extract:
1. isHiring: Is this post from someone HIRING or a company recruiting? (true/false)
2. If isHiring=true, extract:
   - poster: name and headline from the post author
   - summary: 3-4 line summary of the post — what the role needs, key responsibilities, any standout details (team, product, tech stack context)
   - job.title: job role being hired for
   - job.company: company name (null if not mentioned)
   - job.type: "full-time", "contract", "intern", or "remote"
   - job.requirements: 5 to 8 top TECHNICAL skills/technologies required (short strings like "React", "Node.js", "PostgreSQL", "Docker", "TypeScript"). Extract only technology/tool names, not soft skills
   - job.requiredExperience: years of experience required as a number (e.g. "5+ years" → 5, "3-5 years" → 3). null if not mentioned
   - job.salary: original salary text from the post (null if not mentioned)
   - job.salaryMinLPA: minimum salary normalized to Indian Lakhs Per Annum (number or null)
   - job.salaryMaxLPA: maximum salary normalized to Indian Lakhs Per Annum (number or null)
   - contacts.emails: array of email addresses found in post text
     - Match: user@domain.com, name [at] company [dot] com
     - ONLY valid emails with @ and domain. NEVER include URLs, phone numbers, or links
   - contacts.method: "email" if emails found, "DM" if none

3. If isHiring=false: set all fields to defaults (empty strings, null, empty arrays)

MULTI-ROLE POSTS: If a single post lists MULTIPLE distinct job roles (e.g. "Hiring: Node.js Developer, PHP Developer, IT Recruiter"), create a SEPARATE result entry for EACH role that is relevant to a MERN/full-stack/backend/frontend developer. Use the SAME postId for all entries from the same post but different job titles. Skip roles that are clearly non-tech (HR, recruiter, sales, etc.) unless the candidate context matches.

RESPOND WITH ONLY A JSON OBJECT (no markdown, no code fences):
{"results":[{"postId":"id","isHiring":true,"poster":{"name":"Name","headline":"Headline"},"summary":"Looking for a senior React dev to build a dashboard. Remote friendly, urgent hire.","job":{"title":"Role","company":"Co","type":"full-time","requirements":["React","Node.js","MongoDB","TypeScript","Docker","AWS"],"requiredExperience":3,"salary":"8-12 LPA","salaryMinLPA":8,"salaryMaxLPA":12},"contacts":{"emails":["a@b.com"],"method":"email"}}]}

RULES:
- Non-hiring posts: isHiring=false, empty defaults
- requirements: 5-8 short technical skill/technology names ONLY (not sentences, not soft skills)
- NEVER put URLs (http://, https://, lnkd.in) in contacts.emails
- requiredExperience: use the MINIMUM mentioned (e.g. "5-8 years" → 5) or if not mentioned in years derive from the words
- summary: 3-4 lines, capture what the role needs, key responsibilities,experience needed and any standout details (team size, product, tech stack context)
- Mark isHiring=false if the person is LOOKING FOR a job themselves (#OpenToWork, "actively looking", "seeking opportunities", "open to roles"). These are job SEEKERS, not employers hiring
- Mark isHiring=false if the minimum experience required is 4+ years (candidate has ~3 years)
- Mark isHiring=false if the role is primarily a TRAINER, TEACHING, or INSTRUCTOR position (not a developer/engineer role)
- Mark isHiring=false if the PRIMARY technology required is NOT related to web/frontend/backend/full-stack (e.g. Java-only, .NET-only, Python-only, AI/ML-only roles). The candidate is a MERN developer — only extract roles where JavaScript/TypeScript/Node.js/React is a core requirement

CRITICAL REJECTION RULES

Set isHiring=false if ANY of these apply:
1. Interview requires physical presence
   - walk-in, face-to-face, F2F, in-person interview.
2. Candidate location is restricted
   - phrases like "local candidates only", "only from <city>", "must be from Delhi/NCR".
   - mentioning an office or relocation is OK.
3. Job location is outside India
   - non-Indian cities or domains (.pk, .bd, .ae, .uk, .us, etc).
4. Role type or salary invalid
   - internship or contract roles
   - salary < 6 LPA (monthly ×12, hourly ×2080×₹85).

Remote, hybrid, on-site jobs in India without location restrictions are valid.

`;
}

/**
 * Build the Phase 3 email drafting prompt.
 * @param {object[]} contacts - Scored contacts with match info
 * @param {object} candidate - Candidate profile from config
 * @returns {string} Prompt text
 */
export function buildEmailPrompt(contacts, candidate) {
  const contactsData = contacts.map(c => ({
    postId: c.postId,
    posterName: c.poster?.name,
    posterHeadline: c.poster?.headline,
    postSummary: c.summary || '',
    jobTitle: c.job?.title,
    company: c.job?.company,
    requirements: c.job?.requirements,
    matchedSkills: c.match?.matchedSkills || [],
    emailTo: c.contacts?.emails?.[0],
  }));

  return `Write short personalized job application emails for these ${contacts.length} opportunities.

CONTACTS:
${JSON.stringify(contactsData, null, 2)}

CANDIDATE:
- Name: ${candidate.name}
- Role: Full Stack ${candidate.stack} Developer
- Experience: ${candidate.experience}
- Key Skills: ${candidate.skills.slice(0, 15).join(', ')}
- Summary: ${candidate.summary}
FOR EACH CONTACT, generate:
- subject: short natural subject line (not salesy)
- body: email (90-140 words, single flowing paragraph — NO sign-off):
  - Start with a generic greeting (e.g. "Hi," or "Hello,") followed by a newline (\\n\\n) BEFORE the rest of the email body — the greeting MUST be on its own line
  - Reference something specific from the postSummary that caught your eye, then naturally weave in 3-4 skills from matchedSkills with brief context from experience. ONLY mention skills from matchedSkills — never claim skills you don't have
  - End with a note about attached resume and interest in discussing further
  - Do NOT include any sign-off (name, portfolio, linkedin, github) — it is appended automatically
  - Keep it conversational, human, no corporate fluff
  - Plain text only, NO markdown, NO brackets
  - Do NOT split into more than 2 paragraphs — keep it as two cohesive paragraphs

RESPOND WITH ONLY JSON (no markdown, no code fences):
{"emails":[{"postId":"id","subject":"Subject","body":"Email body"}]}`;
}
