#!/bin/bash
set -e

# Files/dirs to strip from ALL commits
STRIP_FILES="CLAUDE.md SCHEDULED_EMAILS.md edit_redraft.md services/gs-config.json services/googleSheets.js scripts/cc-tools.js scripts/create-sheet.js Sonam_FullStack.pdf Ajay_Resume_MERN.pdf"
STRIP_DIRS="docs .claude"

# 43 milestones: HASH|MESSAGE|DATE
MILESTONES=(
  "dc11e8a|Initial commit: LinkedIn Feed Email Extractor|2026-01-29T22:15:00 +0530"
  "6218dd2|Add LinkedIn feed and HTML parsers|2026-01-30T14:30:00 +0530"
  "8dc52fe|Add alternate feed parser for different data formats|2026-02-01T10:45:00 +0530"
  "ccc3d67|Set up AWS Bedrock AI integration|2026-02-02T09:20:00 +0530"
  "ff9f596|Add HTML dashboard for email management|2026-02-02T21:35:00 +0530"
  "462d6ea|Add dashboard npm script command|2026-02-04T15:10:00 +0530"
  "ee9dc1f|Add randomized email send timing|2026-02-06T11:25:00 +0530"
  "8e3e0b4|Add email reject system and improve pipeline|2026-02-06T17:40:00 +0530"
  "a59c6b2|Add email verification before sending|2026-02-08T20:55:00 +0530"
  "575a39c|Update README with setup instructions|2026-02-10T11:05:00 +0530"
  "219ec4d|Set up data storage integration|2026-02-10T22:30:00 +0530"
  "545b028|Add persistent storage for emails and posts|2026-02-12T14:15:00 +0530"
  "cb7fe89|Add approval timestamp display in dashboard|2026-02-14T09:40:00 +0530"
  "8e30dde|Remove unused files from project|2026-02-14T16:50:00 +0530"
  "60b55a8|Add email tracking and status management|2026-02-16T21:20:00 +0530"
  "8e900d5|Fix data formatting and post ID notation|2026-02-18T10:35:00 +0530"
  "4974901|Add post summary section to dashboard|2026-02-18T23:45:00 +0530"
  "d7d1b90|Refine AI prompt for email drafting|2026-02-20T15:25:00 +0530"
  "b355556|Add email sign-off and send delay configuration|2026-02-22T10:10:00 +0530"
  "79e877c|Include salary and experience details in emails|2026-02-22T19:55:00 +0530"
  "8ba2288|Add posts preview section before email generation|2026-02-24T14:40:00 +0530"
  "9bd1c86|Include post summary context in drafted emails|2026-02-25T09:15:00 +0530"
  "0997e32|Add post extraction and processing tools|2026-02-25T21:30:00 +0530"
  "2bbdf84|Fix multi-line email body formatting|2026-02-27T11:05:00 +0530"
  "67a56ed|Remove poster name from email greeting|2026-02-28T14:20:00 +0530"
  "467bf85|Remove verbose post text from email pipeline|2026-02-28T23:35:00 +0530"
  "b4740fd|Add edit and redraft functionality|2026-03-01T10:50:00 +0530"
  "96a86fd|Add location filter to reject non-India jobs|2026-03-02T15:15:00 +0530"
  "4625b6f|Add false positive detection and scoring refinements|2026-03-02T22:40:00 +0530"
  "039cb29|Add send-all button and bulk operations|2026-03-04T09:30:00 +0530"
  "7020ca4|Add API endpoint to fetch all emails|2026-03-05T14:45:00 +0530"
  "e9f4423|Fix email greeting line break formatting|2026-03-05T20:10:00 +0530"
  "1482123|Add multi-user support and update-emails API|2026-03-07T11:25:00 +0530"
  "7ecf8f4|Add SSE for live email sending updates|2026-03-08T15:50:00 +0530"
  "e5208e7|Make dashboard port configurable via environment|2026-03-08T21:15:00 +0530"
  "1c9cc14|Add scoring suggestions for borderline matches|2026-03-10T10:40:00 +0530"
  "4d15420|Refine scoring logic for edge-case matches|2026-03-11T14:05:00 +0530"
  "184f3be|Update email send time window|2026-03-11T23:30:00 +0530"
  "025d5be|Add batch email update API endpoint|2026-03-13T09:55:00 +0530"
  "f7390f1|Add stricter email scoring and filtering rules|2026-03-14T15:20:00 +0530"
  "9b2d32b|Add CTC details to extraction pipeline|2026-03-14T22:45:00 +0530"
  "660ef6e|Enhance post filtering criteria for hiring detection|2026-03-15T11:10:00 +0530"
  "5e818ef|Restructure project and add multi-provider AI support|2026-03-15T16:35:00 +0530"
)

echo ""
echo "   HISTORY REWRITE — ${#MILESTONES[@]} commits"
echo "   ============================================"
echo ""

# Create backup
git branch -f backup-before-rewrite HEAD
echo "   Backup branch: backup-before-rewrite"

# Create orphan branch
git checkout --orphan rewritten-main 2>/dev/null
git rm -rf . 2>/dev/null || true

COMMIT_COUNT=0
SKIPPED=0

for entry in "${MILESTONES[@]}"; do
  IFS='|' read -r HASH MSG DATE <<< "$entry"

  # Clear all tracked files
  git rm -rf . 2>/dev/null || true

  # Checkout tree from this milestone
  git checkout "$HASH" -- . 2>/dev/null || true

  # Strip unwanted files
  for f in $STRIP_FILES; do
    rm -f "$f" 2>/dev/null || true
  done
  for d in $STRIP_DIRS; do
    rm -rf "$d" 2>/dev/null || true
  done

  # Stage everything
  git add -A

  # Skip if no changes from previous commit
  if git diff --cached --quiet 2>/dev/null; then
    echo "   [SKIP] $MSG (empty after stripping)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Commit with custom date
  GIT_AUTHOR_DATE="$DATE" GIT_COMMITTER_DATE="$DATE" \
    git commit -m "$MSG" --quiet

  COMMIT_COUNT=$((COMMIT_COUNT + 1))
  echo "   [$COMMIT_COUNT] $MSG"
done

echo ""
echo "   Created $COMMIT_COUNT commits ($SKIPPED skipped)"
echo ""

# Replace main
git branch -D main 2>/dev/null || true
git branch -m rewritten-main main
echo "   Branch 'main' replaced with rewritten history"
echo "   Backup preserved at 'backup-before-rewrite'"
echo ""
echo "   Done! Run 'git log --oneline' to verify."
echo ""
