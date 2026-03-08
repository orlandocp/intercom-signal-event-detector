const fs = require("fs");

const SHELLY_IP = "192.168.0.37";
const SCRIPT_ID = 1;

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

  return res.json();
}

async function deploy() {

  const code = fs.readFileSync("./event-detector.js", "utf8");

  await rpc("Script.Stop", { id: SCRIPT_ID });

  await rpc("Script.PutCode", {
    id: SCRIPT_ID,
    code,
    append: false
  });

  await rpc("Script.Start", { id: SCRIPT_ID });

  console.log("deploy complete");
}

deploy();