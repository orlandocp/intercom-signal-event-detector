const SHELLY_IP = "192.168.0.37";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function getScriptStatus(id) {
  return rpc("Script.GetStatus", { id });
}

async function stopScript(id) {
  return rpc("Script.Stop", { id });
}

async function startScript(id) {
  return rpc("Script.Start", { id });
}

async function uploadScript(id, code) {
  return rpc("Script.PutCode", {
    id,
    code,
    append: false
  });
}

async function checkShellyAlive() {
  try {
    const res = await fetch(`http://${SHELLY_IP}/shelly`);
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = {
  checkShellyAlive,
  getScriptStatus,
  stopScript,
  startScript,
  uploadScript,
  sleep,
  SHELLY_IP
};