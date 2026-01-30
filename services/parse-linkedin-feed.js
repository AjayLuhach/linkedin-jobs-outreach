import { readFileSync, writeFileSync } from "fs";

const INPUT_FILE = process.argv[2] || "response.json";
const OUTPUT_FILE = process.argv[3] || "parsed-feed.json";

const raw = JSON.parse(readFileSync(INPUT_FILE, "utf-8"));

const included = raw.included;
const searchItems =
  raw.data.data.searchDashClustersByAll.elements[0].items;

// Build lookup maps from included entities by entityUrn
function buildLookup(type) {
  const map = {};
  for (const item of included) {
    if (item["$type"] === type) {
      map[item.entityUrn] = item;
    }
  }
  return map;
}

const profileMap = buildLookup(
  "com.linkedin.voyager.dash.identity.profile.Profile"
);
const activityCountsMap = buildLookup(
  "com.linkedin.voyager.dash.feed.SocialActivityCounts"
);
const socialDetailMap = buildLookup(
  "com.linkedin.voyager.dash.social.SocialDetail"
);
const followingStateMap = buildLookup(
  "com.linkedin.voyager.dash.feed.FollowingState"
);

// Collect all updates keyed by entityUrn
const updateMap = {};
for (const item of included) {
  if (item["$type"] === "com.linkedin.voyager.dash.feed.Update") {
    updateMap[item.entityUrn] = item;
  }
}

// Collect hashtags grouped by activity URN
function getHashtagsForActivity(activityUrn) {
  const tags = [];
  for (const item of included) {
    if (item["$type"] === "com.linkedin.voyager.dash.feed.Hashtag") {
      if (item.entityUrn.includes(activityUrn)) {
        const name = item.trackingUrn?.replace("urn:li:hashtag:", "") || null;
        tags.push({
          name,
          url: item.actionTarget,
        });
      }
    }
  }
  return tags;
}

// Extract profile picture URL from vectorImage artifacts
function extractProfilePicture(actor) {
  const attrs = actor?.image?.attributes || [];
  for (const attr of attrs) {
    const dd = attr.detailData;
    if (!dd) continue;
    const pic = dd.nonEntityProfilePicture || dd.profilePicture;
    if (pic?.vectorImage?.artifacts?.length) {
      const largest = pic.vectorImage.artifacts.reduce((a, b) =>
        a.width > b.width ? a : b
      );
      const rootUrl = pic.vectorImage.rootUrl || "";
      return rootUrl + (largest.fileIdentifyingUrlPathSegment || "");
    }
  }
  return null;
}

// Extract company logo URL from entityComponent image
function extractCompanyLogo(entityComponent) {
  const attrs = entityComponent?.image?.attributes || [];
  for (const attr of attrs) {
    const dd = attr.detailData;
    if (!dd) continue;
    const logo = dd.nonEntityCompanyLogo || dd.companyLogo;
    if (logo?.vectorImage?.artifacts?.length) {
      const largest = logo.vectorImage.artifacts.reduce((a, b) =>
        a.width > b.width ? a : b
      );
      const rootUrl = logo.vectorImage.rootUrl || "";
      return rootUrl + (largest.fileIdentifyingUrlPathSegment || "");
    }
  }
  return null;
}

// Find the matching profile from included
function findProfile(actor) {
  const attrs = actor?.image?.attributes || [];
  for (const attr of attrs) {
    const dd = attr.detailData;
    if (!dd) continue;
    const pic = dd.nonEntityProfilePicture || dd.profilePicture;
    if (pic?.["*profile"]) {
      return profileMap[pic["*profile"]] || null;
    }
  }
  return null;
}

// Extract hashtag names from commentary attributesV2
function extractInlineHashtags(commentary) {
  const hashtags = [];
  const attrs = commentary?.text?.attributesV2 || [];
  for (const attr of attrs) {
    const hashtagRef = attr.detailData?.["*hashtag"];
    if (hashtagRef) {
      // URN format: urn:li:fsd_hashtag:(tagname,activityUrn)
      const match = hashtagRef.match(/urn:li:fsd_hashtag:\(([^,]+),/);
      if (match) hashtags.push(`#${match[1]}`);
    }
  }
  return hashtags;
}

// Parse each post
const posts = searchItems.map((searchItem) => {
  const updateUrn = searchItem.item.searchFeedUpdate?.["*update"];
  if (!updateUrn) return null;

  const update = updateMap[updateUrn];
  if (!update) return null;

  const actor = update.actor;
  const commentary = update.commentary;
  const metadata = update.metadata;
  const socialContent = update.socialContent;
  const entityComponent = update.content?.entityComponent;

  // Extract activity URN
  const activityUrn = metadata?.backendUrn || null;
  const activityId = activityUrn?.replace("urn:li:activity:", "") || null;

  // Find matching profile
  const profile = findProfile(actor);

  // Find social counts
  const countsUrn = `urn:li:fsd_socialActivityCounts:${activityUrn}`;
  // Also check ugcPost variant
  const shareUrn = metadata?.shareUrn;
  const countsUrnAlt = shareUrn
    ? `urn:li:fsd_socialActivityCounts:${shareUrn}`
    : null;
  const counts =
    activityCountsMap[countsUrn] || activityCountsMap[countsUrnAlt] || null;

  // Find matching activity counts by scanning (fallback)
  let socialCounts = null;
  if (counts) {
    socialCounts = counts;
  } else {
    for (const item of included) {
      if (
        item["$type"] ===
        "com.linkedin.voyager.dash.feed.SocialActivityCounts"
      ) {
        if (
          item.urn === activityUrn ||
          item.urn === shareUrn
        ) {
          socialCounts = item;
          break;
        }
      }
    }
  }

  // Build the clean post object
  const post = {
    id: activityId,
    activityUrn,
    shareUrn: metadata?.shareUrn || null,

    author: {
      name: actor?.name?.text || null,
      firstName: profile?.firstName || null,
      lastName: profile?.lastName || null,
      headline: actor?.description?.text || null,
      profileUrl: actor?.navigationContext?.actionTarget || null,
      publicIdentifier: profile?.publicIdentifier || null,
      profileUrn: profile?.entityUrn || null,
      profilePictureUrl: extractProfilePicture(actor),
      connectionDegree:
        actor?.supplementaryActorInfo?.accessibilityText || null,
      isVerified:
        actor?.supplementaryActorInfo?.accessibilityText?.includes(
          "Verified"
        ) || false,
    },

    post: {
      text: commentary?.text?.text || null,
      postedAgo: actor?.subDescription?.text?.trim() || null,
      postedAgoFull: actor?.subDescription?.accessibilityText || null,
      visibility:
        metadata?.shareAudience || null,
      shareUrl: socialContent?.shareUrl || null,
      hashtags: extractInlineHashtags(commentary),
    },

    job: entityComponent
      ? {
          title: entityComponent.title?.text || null,
          company: entityComponent.subtitle?.text?.replace("Job by ", "") || null,
          jobUrl:
            entityComponent.ctaButton?.navigationContext?.actionTarget || null,
          jobId: (() => {
            const url =
              entityComponent.ctaButton?.navigationContext?.actionTarget;
            if (!url) return null;
            const match = url.match(/\/jobs\/view\/(\d+)/);
            return match ? match[1] : null;
          })(),
          companyLogoUrl: extractCompanyLogo(entityComponent),
        }
      : null,

    engagement: socialCounts
      ? {
          likes: socialCounts.numLikes || 0,
          comments: socialCounts.numComments || 0,
          shares: socialCounts.numShares || 0,
          impressions: socialCounts.numImpressions || null,
          isLikedByViewer: socialCounts.liked || false,
          reactions: (socialCounts.reactionTypeCounts || []).map((r) => ({
            type: r.reactionType,
            count: r.count,
          })),
        }
      : null,

    relatedHashtags: getHashtagsForActivity(activityUrn),

    metadata: {
      detailPageType: metadata?.detailPageType || null,
      isRootShare: metadata?.rootShare || false,
      trackingId:
        searchItem.item.searchFeedUpdate?.trackingId || null,
    },
  };

  return post;
});

const result = {
  extractedAt: new Date().toISOString(),
  totalPosts: posts.filter(Boolean).length,
  posts: posts.filter(Boolean),
};

writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
console.log(`Parsed ${result.totalPosts} posts -> ${OUTPUT_FILE}`);
