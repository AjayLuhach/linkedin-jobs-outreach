/**
 * LinkedIn HTML Parser - Version 2 (Current DOM)
 * Parses newer LinkedIn feed markup that uses data-view-name attributes.
 */

import * as cheerio from "cheerio";

function cleanText(text) {
  if (!text) return null;
  return text.replace(/<!---->/g, "").replace(/\s+/g, " ").trim() || null;
}

export function parseLinkedInHtmlV2(html) {
  const $ = cheerio.load(html);
  const posts = [];
  const now = new Date().toISOString();

  const articles = $('div[role="listitem"] > div[data-view-name="feed-full-update"]').parent();
  if (!articles.length) {
    return { posts };
  }

  articles.each((_i, article) => {
    const $article = $(article);

    const componentKey = $article.attr("componentkey") || $article.find('[data-view-name="feed-full-update"]').attr("componentkey");
    const activityId = componentKey || `post_${_i}_${Date.now()}`;
    if (!activityId) return;

    const actorImageLink = $article.find('[data-view-name="feed-actor-image"]').first();
    const actorLink = $article.find('[data-view-name="feed-actor"]').first();
    const profileLink = actorLink.length ? actorLink : actorImageLink;
    const profileUrl = profileLink.attr("href") || null;

    const nameFromLabel = (label) => {
      if (!label) return null;
      const match = label.match(/View\s+(.+?)[’'`]s profile/i);
      if (match) return match[1];
      return label;
    };

    let name = nameFromLabel(profileLink.attr("aria-label"));
    const actorParagraphs = actorLink.find("p").toArray();
    if (!name && actorParagraphs.length) {
      const text = cleanText($(actorParagraphs[0]).text());
      if (text) {
        name = text.split("•")[0].trim() || text;
      }
    }

    let headline = null;
    if (actorParagraphs.length > 1) {
      headline = cleanText($(actorParagraphs[1]).text());
    }

    let postedAgo = null;
    if (actorParagraphs.length > 2) {
      postedAgo = cleanText($(actorParagraphs[2]).text());
    }

    const followBtn = $article.find('button[aria-label^="Follow "]').first();
    const followName = followBtn.attr("aria-label")?.replace("Follow ", "") || null;

    // === POST CONTENT ===
    let postText = null;
    const textElement = $article
      .find('p[data-view-name="feed-commentary"] span[data-testid="expandable-text-box"]')
      .first();

    if (textElement.length > 0) {
      let rawHtml = textElement.html() || "";
      rawHtml = rawHtml.replace(/<span><br><\/span>/g, "\n");
      rawHtml = rawHtml.replace(/<br\s*\/?>/g, "\n");
      const $temp = cheerio.load(rawHtml);
      postText = $temp
        .text()
        .replace(/<!---->/g, "")
        .replace(/hashtag\n?/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim() || null;
    }

    const hashtags = [];
    const commentaryArea = $article.find('p[data-view-name="feed-commentary"]');
    commentaryArea.find('a[href*="keywords=%23"]').each((_j, el) => {
      const href = $(el).attr("href");
      const match = href?.match(/keywords=%23([^&]+)/);
      if (match) hashtags.push(`#${decodeURIComponent(match[1])}`);
    });

    // === JOB CARD ===
    let job = null;
    const jobCard = $article.find('[data-view-name="feed-job-card-entity"]').first();
    if (jobCard.length) {
      const jobUrl = jobCard.attr("href")?.replace(/&amp;/g, "&") || null;
      const jobTitle = cleanText(jobCard.find("p").first().text());
      const jobSubtitle = cleanText(jobCard.find("p").eq(1).text());
      const jobLocation = cleanText(jobCard.find("p").eq(2).text());

      job = {
        title: jobTitle,
        company: jobSubtitle,
        location: jobLocation,
        jobUrl,
      };
    }

    // === ENGAGEMENT ===
    let reactionsLabel = $article.find('[aria-label$="reactions"], [aria-label$="reaction"]').first().attr("aria-label") || "";
    let reactions = parseInt(reactionsLabel.match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""), 10) || 0;
    if (reactions === 0) {
      $article.find("span").each((_i, span) => {
        const text = $(span).text();
        const match = text.match(/^(\d+)\s+reactions?$/i);
        if (match) {
          reactions = parseInt(match[1], 10);
          return false;
        }
      });
    }

    let commentsLabel = $article.find('[aria-label*="comment"]').first().attr("aria-label") || "";
    let comments = parseInt(commentsLabel.match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""), 10) || 0;
    if (comments === 0) {
      $article.find("span").each((_i, span) => {
        const text = $(span).text();
        const match = text.match(/^(\d+)\s+comments?$/i);
        if (match) {
          comments = parseInt(match[1], 10);
          return false;
        }
      });
    }

    let repostsLabel = $article.find('[aria-label*="repost"]').first().attr("aria-label") || "";
    let reposts = parseInt(repostsLabel.match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""), 10) || 0;
    if (reposts === 0) {
      $article.find("span").each((_i, span) => {
        const text = $(span).text();
        const match = text.match(/^(\d+)\s+reposts?$/i);
        if (match) {
          reposts = parseInt(match[1], 10);
          return false;
        }
      });
    }

    posts.push({
      id: activityId,
      source: "html",
      extractedAt: now,
      processed: false,

      author: {
        name: name || followName,
        headline,
        profileUrl: profileUrl?.replace(/&amp;/g, "&") || null,
      },

      post: {
        text: postText,
        postedAgo,
        hashtags,
      },

      job,

      engagement: { reactions, comments, reposts },
    });
  });

  return { posts };
}
