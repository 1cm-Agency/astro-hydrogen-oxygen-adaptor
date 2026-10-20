/** Text of `<tag id="id">…</tag>`, with the HTML entities Astro escapes in text decoded. */
export function textById(html, id) {
  const match = html.match(new RegExp(`<(\\w+)[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
  if (!match) throw new Error(`No element with id="${id}" in:\n${html.slice(0, 500)}`);
  return match[2]
    .replaceAll('&#34;', '"')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export const jsonById = (html, id) => JSON.parse(textById(html, id));
