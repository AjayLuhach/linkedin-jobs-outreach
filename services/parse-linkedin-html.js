import { readFileSync, writeFileSync } from "fs";
import * as cheerio from "cheerio";

const INPUT_FILE = process.argv[2] || "linkedin.html";
const OUTPUT_FILE = process.argv[3] || "parsed-html-feed.json";

const html = readFileSync(INPUT_FILE, "utf-8");
const $ = cheerio.load(html);

// Helper: clean text by stripping HTML comments, excess whitespace
function cleanText(text) {
  if (!text) return null;
  return text
    .replace(/<!---->/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

// Helper: extract text from a cheerio element, ignoring visually-hidden duplicates
function visibleText(el) {
  const clone = el.clone();
  clone.find(".visually-hidden").remove();
  return cleanText(clone.text());
}

// Extract job URL ID from linkedin job URL
function extractJobId(url) {
  if (!url) return null;
  const match = url.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

// Parse each article (post)
const posts = [];
const articles = $('[role="article"][data-urn^="urn:li:activity:"]');

articles.each((_i, article) => {
  const $article = $(article);
  const activityUrn = $article.attr("data-urn");
  const activityId = activityUrn?.replace("urn:li:activity:", "") || null;

  // === AUTHOR ===
  const actorContainer = $article.find(
    ".update-components-actor__container"
  ).first();

  // Profile link & URL
  const profileLink = actorContainer
    .find("a.update-components-actor__meta-link")
    .first();
  const profileUrl = profileLink.attr("href") || null;

  // Name
  const nameEl = actorContainer
    .find(".update-components-actor__title")
    .first();
  const name = visibleText(
    nameEl.find('[dir="ltr"]').first()
  );

  // Headline / description
  const headlineEl = actorContainer
    .find(".update-components-actor__description")
    .first();
  const headline = visibleText(headlineEl);

  // Connection degree & verification
  const suppEl = actorContainer
    .find(".update-components-actor__supplementary-actor-info")
    .first();
  const suppHidden = suppEl.find(".visually-hidden").first().text().trim().replace(/<!---->/g, "");
  const isVerified = suppHidden.includes("Verified");
  const isPremium = suppHidden.includes("Premium");
  const connectionDegree = suppHidden.replace("Verified", "").replace("Premium", "").replace(/[•·]/g, "").trim() || null;

  // Posted time
  const subDescEl = $article
    .find(".update-components-actor__sub-description")
    .first();
  const postedAgo = visibleText(subDescEl);
  const postedAgoFull =
    subDescEl.find(".visually-hidden").first().text().trim().replace(/<!---->/g, "").trim() || null;

  // Profile picture
  const avatarImg = actorContainer
    .find(".update-components-actor__avatar-image")
    .first();
  const profilePictureUrl = avatarImg.attr("src")?.replace(/&amp;/g, "&") || null;

  // Follow button -> extract name for cases where profile name is hard to get
  const followBtn = $article
    .find('button[aria-label^="Follow "]')
    .first();
  const followName = followBtn.attr("aria-label")?.replace("Follow ", "") || null;

  // === POST CONTENT / COMMENTARY ===
  const commentaryEl = $article
    .find(".update-components-update-v2__commentary")
    .first();

  let postText = null;
  if (commentaryEl.length) {
    // Get the inner span with dir="ltr" which has the actual post text
    const textSpan = commentaryEl.find("span.break-words span[dir='ltr']").first();
    if (textSpan.length) {
      // Process the HTML to get clean text with line breaks
      let rawHtml = textSpan.html() || "";
      // Replace <br> with newlines
      rawHtml = rawHtml.replace(/<span><br><\/span>/g, "\n");
      rawHtml = rawHtml.replace(/<br\s*\/?>/g, "\n");
      // Strip all remaining HTML tags but keep text
      const $temp = cheerio.load(rawHtml);
      postText = $temp.text()
        .replace(/<!---->/g, "")
        .replace(/hashtag\n?/g, "") // remove "hashtag" screen reader text
        .replace(/\n{3,}/g, "\n\n") // collapse multiple newlines
        .trim() || null;
    }
  }

  // Extract hashtags from the commentary
  const hashtags = [];
  commentaryEl.find('a[href*="keywords=%23"]').each((_j, el) => {
    const href = $(el).attr("href");
    const match = href?.match(/keywords=%23([^&]+)/);
    if (match) {
      hashtags.push({
        tag: `#${decodeURIComponent(match[1])}`,
        url: href?.replace(/&amp;/g, "&") || null,
      });
    }
  });

  // === JOB CARD (entity component) ===
  let job = null;
  const entityEl = $article.find(".update-components-entity").first();
  if (entityEl.length) {
    const entityLink = entityEl
      .find("a.update-components-entity__content")
      .first();
    const jobUrl = entityLink.attr("href")?.replace(/&amp;/g, "&") || null;

    const jobTitle = cleanText(
      entityEl.find(".update-components-entity__title").first().text()
    );
    const jobSubtitle = cleanText(
      entityEl.find(".update-components-entity__subtitle").first().text()
    );
    const jobLocation = cleanText(
      entityEl.find(".update-components-entity__description").first().text()
    );

    // Company logo
    const companyLogoImg = entityEl
      .find(".update-components-entity__image-container img")
      .first();
    const companyLogoUrl =
      companyLogoImg.attr("src")?.replace(/&amp;/g, "&") || null;

    // Parse "Job by CompanyName" -> just company name
    const company = jobSubtitle?.replace(/^Job by\s*/i, "") || null;

    job = {
      title: jobTitle,
      company,
      location: jobLocation,
      jobUrl,
      jobId: extractJobId(jobUrl),
      companyLogoUrl,
    };
  }

  // === ARTICLE LINK (shared article/link) ===
  let article_link = null;
  const articleEl = $article.find("article.update-components-article").first();
  if (articleEl.length) {
    const linkEl = articleEl.find("a").first();
    const articleTitle = cleanText(
      articleEl.find(".update-components-article__title").first().text()
    );
    const articleSubtitle = cleanText(
      articleEl.find(".update-components-article__subtitle--inset").first().text()
    );
    const articleImgEl = articleEl.find("img").first();

    article_link = {
      title: articleTitle,
      source: articleSubtitle,
      url: linkEl.attr("href")?.replace(/&amp;/g, "&") || null,
      imageUrl: articleImgEl.attr("src")?.replace(/&amp;/g, "&") || null,
    };
  }

  // === IMAGE CONTENT ===
  let image = null;
  const imageEl = $article.find(".update-components-image").first();
  if (imageEl.length) {
    const imgTag = imageEl.find("img").first();
    image = {
      url: imgTag.attr("src")?.replace(/&amp;/g, "&") || null,
      alt: imgTag.attr("alt") || null,
      width: parseInt(imgTag.attr("width"), 10) || null,
      height: parseInt(imgTag.attr("height"), 10) || null,
    };
  }

  // === ENGAGEMENT / SOCIAL COUNTS ===
  const socialCountsEl = $article
    .find(".social-details-social-counts")
    .first();

  // Reactions count
  const reactionsBtn = socialCountsEl
    .find('[aria-label$="reactions"], [aria-label$="reaction"]')
    .first();
  const reactionsLabel = reactionsBtn.attr("aria-label") || "";
  const reactionsCount = parseInt(reactionsLabel.match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""), 10) || 0;

  // Reaction types from icons
  const reactionTypes = [];
  socialCountsEl
    .find("img.reactions-icon[data-test-reactions-icon-type]")
    .each((_j, el) => {
      const type = $(el).attr("data-test-reactions-icon-type");
      if (type && !reactionTypes.includes(type)) reactionTypes.push(type);
    });

  // Comments count
  const commentsBtn = socialCountsEl
    .find('[aria-label*="comment"]')
    .first();
  const commentsLabel = commentsBtn.attr("aria-label") || "";
  const commentsCount =
    parseInt(commentsLabel.match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""), 10) || 0;

  // Reposts count
  const repostsBtn = socialCountsEl
    .find('[aria-label*="repost"]')
    .first();
  const repostsLabel = repostsBtn.attr("aria-label") || "";
  const repostsCount =
    parseInt(repostsLabel.match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""), 10) || 0;

  // === BUILD POST OBJECT ===
  const post = {
    id: activityId,
    activityUrn,

    author: {
      name: name || followName,
      headline,
      profileUrl: profileUrl?.replace(/&amp;/g, "&") || null,
      profilePictureUrl,
      connectionDegree,
      isVerified,
      isPremium,
    },

    post: {
      text: postText,
      postedAgo,
      postedAgoFull,
      hashtags,
    },

    job,
    articleLink: article_link,
    image,

    engagement: {
      reactions: reactionsCount,
      reactionTypes,
      comments: commentsCount,
      reposts: repostsCount,
    },
  };

  posts.push(post);
});

const result = {
  extractedAt: new Date().toISOString(),
  source: INPUT_FILE,
  totalPosts: posts.length,
  posts,
};

writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
console.log(`Parsed ${posts.length} posts from HTML -> ${OUTPUT_FILE}`);
