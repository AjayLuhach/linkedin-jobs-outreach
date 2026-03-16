import { parseLinkedInHtmlV2 } from "./html-parsers/html-parser-v2.js";
import { parseLinkedInHtmlV1 } from "./html-parsers/html-parser-v1.js";

const parserSequence = [
  { name: "html-parser-v2", parser: parseLinkedInHtmlV2 },
  { name: "html-parser-v1", parser: parseLinkedInHtmlV1 },
  // Add new parser entries below as new versions are implemented.
];

export function parseHTML(html) {
  let fallbackResult = { posts: [] };

  for (const { parser } of parserSequence) {
    let result;
    try {
      result = parser(html);
    } catch (_error) {
      continue;
    }

    if (!result) {
      continue;
    }

    fallbackResult = result;

    if (result.posts?.length) {
      return result;
    }
  }

  return fallbackResult;
}
