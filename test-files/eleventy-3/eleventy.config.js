module.exports = function (eleventyConfig) {
  // A minimal shortcode, registered the same way real 11ty projects
  // commonly do (e.g. image/youtube shortcodes) — used to verify the LSP
  // recognizes custom nunjucks tags instead of failing to parse them.
  eleventyConfig.addShortcode("shout", function (value) {
    return String(value).toUpperCase();
  });

  return {};
};
