export default function (eleventyConfig) {
  // A plain shortcode — the most common shape in real projects.
  eleventyConfig.addShortcode("shout", function (value) {
    return String(value).toUpperCase();
  });

  // Multiple args, including one with a default.
  eleventyConfig.addShortcode("image", function (src, alt, widths = [400, 800]) {
    return `<img src="${src}" alt="${alt}" data-widths="${widths.join(",")}">`;
  });

  // Paired shortcode: `{% callout "warning" %}...{% endcallout %}`
  eleventyConfig.addPairedShortcode("callout", function (content, level) {
    return `<div class="callout callout--${level}">${content}</div>`;
  });

  // A raw nunjucks tag, registered with a hand-written extension.
  eleventyConfig.addNunjucksTag("banner", function (nunjucksEngine) {
    return new (class {
      tags = ["banner"];
      parse(parser, nodes) {
        const tok = parser.nextToken();
        const args = parser.parseSignature(true, true);
        parser.advanceAfterBlockEnd(tok.value);
        return new nodes.CallExtension(this, "run", args, []);
      }
      run(_ctx, text) {
        return new nunjucksEngine.runtime.SafeString(`<aside>${text}</aside>`);
      }
    })();
  });

  // Async shortcode — registered the same way, resolved differently.
  eleventyConfig.addAsyncShortcode("remoteTitle", async function (url) {
    return `title of ${url}`;
  });

  eleventyConfig.addFilter("titlecase", function (str) {
    return String(str).replace(/\b\w/g, (c) => c.toUpperCase());
  });

  eleventyConfig.addNunjucksFilter("slugify", function (str) {
    return String(str).toLowerCase().replace(/\s+/g, "-");
  });
}

export const config = {
  dir: {
    input: "."
  }
};
