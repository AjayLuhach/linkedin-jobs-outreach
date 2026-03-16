/**
 * LinkedIn HTML Parser - Version 1 (Legacy DOM)
 * Parses the previous LinkedIn feed markup.
 */

import * as cheerio from "cheerio";

function cleanText(text) {
  if (!text) return null;
  return text.replace(/<!---->/g, "").replace(/\s+/g, " ").trim() || null;
}

function visibleText(el) {
  const clone = el.clone();
  clone.find(".visually-hidden").remove();
  return cleanText(clone.text());
}

export function parseLinkedInHtmlV1(html) {
  const $ = cheerio.load(html);
  const posts = [];
  const now = new Date().toISOString();

  const articles = $('[role="article"][data-urn^="urn:li:activity:"]');
  if (!articles.length) {
    return { posts };
  }

  articles.each((_i, article) => {
    const $article = $(article);
    const activityUrn = $article.attr("data-urn");
    const activityId = activityUrn ? activityUrn.replace("urn:li:activity:", "") : null;
    if (!activityId) return;

    // === AUTHOR ===
    const actorContainer = $article.find(".update-components-actor__container").first();
    const profileLink = actorContainer.find("a.update-components-actor__meta-link").first();
    const profileUrl = profileLink.attr("href") || null;

    let name = null;
    if (actorContainer.length) {
      const nameEl = actorContainer.find(".update-components-actor__title").first();
      name = nameEl.length ? visibleText(nameEl.find('[dir="ltr"]').first()) : null;
    }
    if (!name && profileLink.length) {
      const ariaLabel = profileLink.attr("aria-label") || "";
      name = ariaLabel.split(" profile|View ")[1]?.split("'s profile")[0] || ariaLabel || null;
    }

    let headline = null;
    if (actorContainer.length) {
      const headlineEl = actorContainer.find(".update-components-actor__description").first();
      headline = headlineEl.length ? visibleText(headlineEl) : null;
    }

    const followBtn = $article.find('button[aria-label^="Follow "]').first();
    const followName = followBtn.attr("aria-label")?.replace("Follow ", "") || null;

    let postedAgo = null;
    if (actorContainer.length) {
      const subDescEl = actorContainer.find(".update-components-actor__sub-description").first();
      postedAgo = subDescEl.length ? visibleText(subDescEl) : null;
    }

    // === POST CONTENT ===
    let postText = null;
    const textElement = $article
      .find(".update-components-update-v2__commentary span.break-words span[dir='ltr']")
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
    const commentaryArea = $article.find(".update-components-update-v2__commentary");
    commentaryArea.find('a[href*="keywords=%23"]').each((_j, el) => {
      const href = $(el).attr("href");
      const match = href?.match(/keywords=%23([^&]+)/);
      if (match) hashtags.push(`#${decodeURIComponent(match[1])}`);
    });

    // === JOB CARD ===
    let job = null;
    const entityEl = $article.find(".update-components-entity").first();
    if (entityEl.length) {
      const jobUrl =
        entityEl.find("a.update-components-entity__content").first().attr("href")?.replace(/&amp;/g, "&") ||
        null;
      const jobTitle = cleanText(entityEl.find(".update-components-entity__title").first().text());
      const jobSubtitle = cleanText(entityEl.find(".update-components-entity__subtitle").first().text());
      const jobLocation = cleanText(entityEl.find(".update-components-entity__description").first().text());

      job = {
        title: jobTitle,
        company: jobSubtitle?.replace(/^Job by\s*/i, "") || null,
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
