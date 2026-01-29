/**
 * Parser Service - Extract meaningful data from LinkedIn API responses
 * Strips out schema definitions, recipe types, image artifacts, tracking tokens
 * and returns only the data needed for hiring post extraction.
 */

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+\s*[\[\(]\s*at\s*[\]\)]\s*[a-zA-Z0-9.-]+\s*[\[\(]\s*dot\s*[\]\)]\s*[a-zA-Z]{2,}/gi;

/**
 * Detect response type and parse accordingly
 * @param {object} raw - the full LinkedIn API JSON response
 * @returns {object} clean parsed data
 */
export function parseLinkedInResponse(raw) {
  const data = raw?.data?.data;
  const included = raw?.included || [];

  if (!data && !included.length) {
    throw new Error('Unrecognized LinkedIn response format — no data or included array found.');
  }

  // Detect source type
  let source = 'unknown';
  let totalResults = 0;

  if (data?.searchDashClustersByAll) {
    source = 'search';
    totalResults = data.searchDashClustersByAll.metadata?.totalResultCount || 0;
  } else if (data?.feedDashMainFeedByMainFeed) {
    source = 'feed';
    totalResults = data.feedDashMainFeedByMainFeed.paging?.total || 0;
  }

  // Build lookup maps from included array
  const updates = [];
  const socialCounts = new Map();
  const hashtags = new Map(); // activityUrn -> [tag names]

  for (const item of included) {
    const type = item.$type || '';

    if (type.includes('Update') || type.includes('feed.Update')) {
      updates.push(item);
    } else if (type.includes('SocialActivityCounts')) {
      socialCounts.set(item.urn, item);
    } else if (type.includes('Hashtag')) {
      const tag = item.trackingUrn?.replace('urn:li:hashtag:', '') || '';
      const activityMatch = item.entityUrn?.match(/urn:li:activity:\d+/);
      if (tag && activityMatch) {
        const activityUrn = activityMatch[0];
        if (!hashtags.has(activityUrn)) hashtags.set(activityUrn, []);
        hashtags.get(activityUrn).push(tag);
      }
    }
  }

  // Parse each update into a clean post object
  const posts = updates.map(update => parseUpdate(update, socialCounts, hashtags));

  console.log(`   Parser: ${source} response, ${posts.length} posts extracted, ${totalResults} total available`);

  return { source, totalResults, posts };
}

/**
 * Parse a single Update entity into a clean post object
 */
function parseUpdate(update, socialCounts, hashtags) {
  const actor = update.actor || {};
  const metadata = update.metadata || {};
  const socialContent = update.socialContent || {};
  const content = update.content || {};

  // Extract activity URN for joining with social counts & hashtags
  const activityUrn = metadata.backendUrn || '';

  // Actor info
  const actorName = actor.name?.text || '';
  const actorHeadline = actor.description?.text || '';

  // Commentary text (the actual post body)
  const commentaryComponent = update.commentary || content?.commentaryComponent;
  const commentary = commentaryComponent?.commentary?.text
    || commentaryComponent?.text?.text
    || '';

  // Job/entity component (for shared jobs)
  const entity = content?.entityComponent;
  const jobTitle = entity?.title?.text || '';
  const jobCompany = entity?.subtitle?.text?.replace('Job by ', '') || '';
  const jobLocation = entity?.description?.text || '';
  const jobUrl = entity?.navigationContext?.actionTarget || '';

  // Social counts
  const counts = socialCounts.get(activityUrn) || {};
  const likes = counts.numLikes || 0;
  const comments = counts.numComments || 0;
  const shares = counts.numShares || 0;

  // Hashtags
  const tags = hashtags.get(activityUrn) || [];

  // Share URL
  const shareUrl = socialContent.shareUrl || '';

  // Extract emails from commentary text
  const emailsFound = extractEmails(commentary);

  // Also check for reshared update
  let resharedPost = null;
  if (update.resharedUpdate) {
    resharedPost = parseUpdate(update.resharedUpdate, socialCounts, hashtags);
  }

  const post = {
    actorName,
    actorHeadline,
    commentary,
    jobTitle,
    jobCompany,
    jobLocation,
    jobUrl,
    hashtags: tags,
    likes,
    comments,
    shares,
    emailsFound,
    shareUrl,
  };

  // Only include reshared if it exists
  if (resharedPost) {
    post.resharedPost = resharedPost;
  }

  return post;
}

/**
 * Extract email addresses from text (plain + obfuscated)
 */
function extractEmails(text) {
  if (!text) return [];

  const emails = new Set();

  // Plain emails
  const plain = text.match(EMAIL_REGEX) || [];
  plain.forEach(e => emails.add(e.toLowerCase()));

  // Obfuscated: "name [at] company [dot] com"
  const obfuscated = text.match(OBFUSCATED_EMAIL_REGEX) || [];
  obfuscated.forEach(e => {
    const cleaned = e
      .replace(/\s*[\[\(]\s*at\s*[\]\)]\s*/gi, '@')
      .replace(/\s*[\[\(]\s*dot\s*[\]\)]\s*/gi, '.')
      .toLowerCase();
    emails.add(cleaned);
  });

  return [...emails];
}

export default { parseLinkedInResponse };
