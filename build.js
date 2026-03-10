const fs = require("fs");
const { minify } = require("terser");

const OUTPUT = "./event-detector.bundle.js";

async function build() {

  // -- LOAD signal-core.js --
  // Pure signal processing functions. We strip all comments before bundling
  // since the Shelly runtime has limited memory and doesn't need documentation.
  const rawCore = fs.readFileSync("./signal-core.js", "utf8");

  // -- STRIP COMMENTS from signal-core.js --
  // terser removes all comment formats (// /* */ /** */) while keeping
  // the code structure and variable names intact (compress and mangle are off).
  const stripped = await minify(rawCore, {
    compress: false,
    mangle: false,
    format: {
      comments: false,
      beautify: true
    }
  });

  // -- LOAD shelly-glue.js --
  // Shelly-specific code: Timer, Shelly.call, print, state management.
  const glue = fs.readFileSync("./shelly-glue.js", "utf8").trimEnd();

  // -- STRIP module.exports block --
  // The exports block is needed by Jest but not valid in the Shelly runtime.
  const core = stripped.code
    .replace(/\nif \(typeof module[\s\S]*?\n\}/m, "")
    .trimEnd();

  // -- BUNDLE --
  // signal-core first (defines all pure functions),
  // then shelly-glue (calls those functions).
  const bundle = core + "\n\n" + glue + "\n";

  fs.writeFileSync(OUTPUT, bundle, "utf8");
  console.log(`build complete → ${OUTPUT}`);
}

build();
