const fs = require("fs");

const SHELLY_IP = "192.168.0.37";
const SCRIPT_ID = 1;

const timestamp = new Date().toLocaleString("sv-SE", { timeZone: "America/La_Paz" });

async function rpc(method, params) {

  const res = await fetch(`http://${SHELLY_IP}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: 1,
      method,
      params
    })
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(JSON.stringify(data.error));
  }

  return data.result;
}

async function checkShellyAlive() {

  try {

    const res = await fetch(`http://${SHELLY_IP}/rpc/Shelly.GetInfo`);
    await res.json();

    return true;

  } catch (err) {

    return false;

  }

}

async function deploy() {

  console.log("");
  console.log("======================================");
  console.log(`Deploy started at: ${timestamp}`);
  console.log(`Target Shelly IP: ${SHELLY_IP}`);
  console.log(`Script ID: ${SCRIPT_ID}`);
  console.log("======================================");
  console.log("");

  console.log("Checking Shelly availability...");

  const alive = await checkShellyAlive();

  if (!alive) {

    console.log("ERROR: Shelly device is not reachable.");
    console.log("Deploy aborted.");
    return;

  }

  console.log("Shelly is reachable");
  console.log("");

  console.log("Fetching current script status...");

  const statusBefore = await rpc("Script.GetStatus", { id: SCRIPT_ID });

  console.log("Current script info:");
  console.log(JSON.stringify(statusBefore, null, 2));
  console.log("");

  console.log(`Script currently running: ${statusBefore.running}`);
  console.log("");

  const code = fs.readFileSync("./event-detector.bundle.js", "utf8");

  console.log(`Local script size: ${code.length} bytes`);
  console.log("");

  console.log("Stopping script...");
  await rpc("Script.Stop", { id: SCRIPT_ID });

  console.log("Uploading new code...");
  await rpc("Script.PutCode", {
    id: SCRIPT_ID,
    code,
    append: false
  });

  console.log("Starting script...");
  await rpc("Script.Start", { id: SCRIPT_ID });

  console.log("");
  console.log("Checking final script status...");

  const statusAfter = await rpc("Script.GetStatus", { id: SCRIPT_ID });

  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const reset = "\x1b[0m";

  if (statusAfter.running) {
    console.log(`${green}SCRIPT RUNNING${reset}`);
  } else {
    console.log(`${red}SCRIPT NOT RUNNING${reset}`);
  }

  console.log("");
  console.log("Deploy finished");
  console.log("");

}

deploy().catch(err => {

  console.log("");
  console.log("DEPLOY FAILED");
  console.error(err);
  console.log("");

});