async function getJSONData ({
  directory,
}: {
  directory: string
}) {
  let Eleventy = null

  try {
    Eleventy = (await import("@11ty/eleventy")).default
  } catch {
    console.error("Unable to find @11ty/eleventy")
    return
  }

  let baseConfig = {
    default: async (_eleventyConfig) => {},
    config: {
      dir: {
      	input: ".",
      	output: "_site",
      }
    }
  }

  baseConfig = await import("./eleventy.config.js").catch(() => {
    console.error("Unable to import your eleventy config.")
  })

  let elev = new Eleventy(baseConfig.dir || ".", "output.json", {
	  config: async function(eleventyConfig) {
	    await baseConfig.default(eleventyConfig)

	    // To grab all data.
	    eleventyConfig.dataFilterSelectors.add("*");
	  }
  });

  let json = await elev.toJSON();
  return json
}
