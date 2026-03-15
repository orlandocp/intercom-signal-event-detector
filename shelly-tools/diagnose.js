const {
  getScriptStatus,
  sleep,
  SHELLY_IP
} = require("./shelly-client");

const SCRIPT_ID = 2;

const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const reset = "\x1b[0m";

function printStatus(label, s) {
  console.log(label);
  console.log(`running   : ${s.running}`);
  console.log(`mem_used  : ${s.mem_used}`);
  console.log(`mem_peak  : ${s.mem_peak}`);
  console.log(`mem_free  : ${s.mem_free}`);
  console.log(`cpu       : ${s.cpu}`);
  console.log("");
}

function analyze(t0, t30) {
  console.log("Diagnostic analysis");
  console.log("-------------------");

  if (t30.mem_used > t0.mem_used + 2000) {
    console.log(`${red}Possible memory leak detected${reset}`);
  }

  if (t30.cpu > 80) {
    console.log(`${red}CPU usage extremely high${reset}`);
  } else if (t30.cpu > 60) {
    console.log(`${yellow}CPU usage high${reset}`);
  }

  if (t30.mem_free < 5000) {
    console.log(`${red}Low memory available${reset}`);
  }

  if (
    t30.mem_used <= t0.mem_used + 500 &&
    t30.cpu < 60 &&
    t30.mem_free > 10000
  ) {
    console.log(`${green}Script health looks good${reset}`);
  }

  console.log("");
}

async function diagnose() {
  console.log("");
  console.log("======================================");
  console.log(`Diagnostics for script ${SCRIPT_ID}`);
  console.log(`Shelly IP: ${SHELLY_IP}`);
  console.log("======================================");
  console.log("");

  const t0 = await getScriptStatus(SCRIPT_ID);
  printStatus("t0 (start)", t0);

  await sleep(10000);

  const t10 = await getScriptStatus(SCRIPT_ID);
  printStatus("t10 (10 seconds)", t10);

  await sleep(20000);

  const t30 = await getScriptStatus(SCRIPT_ID);
  printStatus("t30 (30 seconds)", t30);

  analyze(t0, t30);
}

diagnose().catch(err => {
  console.log("");
  console.log(`${red}DIAGNOSTIC FAILED${reset}`);
  console.error(err);
  console.log("");
});