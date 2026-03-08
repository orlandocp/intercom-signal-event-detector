const fs = require("fs");

const OUTPUT = "./event-detector.bundle.js";

const core = fs.readFileSync("./signal-core.js", "utf8")
  .replace(/\nif \(typeof module[\s\S]*?\n\}/m, "")
  .trimEnd();

const glue = fs.readFileSync("./shelly-glue.js", "utf8").trimEnd();

const bundle = core + "\n\n" + glue + "\n";

fs.writeFileSync(OUTPUT, bundle, "utf8");

console.log(`build complete → ${OUTPUT}`);
