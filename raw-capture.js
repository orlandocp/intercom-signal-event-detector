// -- CONFIG: server --
const SERVER_URL = "http://192.168.0.11:5000/raw";

// -- CONFIG: sampling --
const SAMPLING_INTERVAL = 50;

// -- CONFIG: send --
const CHUNK_SIZE = 100;
const CHUNK_DELAY_MS = 500;
const CHUNK_TIMEOUT = 1;
const MAX_BUFFER = 300;

// -- STATE --
let samples = [];
let sending = false;
let totalSamples = 0;
let totalChunks = 0;
let isFirstChunk = true;

// -- VOLTAGE --
function readVoltage() {
  return Shelly.getComponentStatus("voltmeter:100").voltage;
}

// -- SEND --
function sendNextChunk() {
  let end = Math.min(CHUNK_SIZE, samples.length);
  if (end === 0) {
    sending = false;
    return;
  }

  // On the very first chunk, prepend a RESTART marker so the server
  // knows this is a fresh start of the capture script
  let chunk = "";
  if (isFirstChunk) {
    chunk += "RESTART," + samples[0].split(",")[0] + "\n";
    isFirstChunk = false;
  }

  for (let i = 0; i < end; i++) {
    chunk += samples[i] + "\n";
  }

  Shelly.call("HTTP.POST", {
    url: SERVER_URL,
    body: chunk,
    timeout: CHUNK_TIMEOUT
  }, function(result, error) {
    if (error) {
      print("❌ Chunk error:", JSON.stringify(error));
      // Reset isFirstChunk so the RESTART marker is sent again on next attempt
      isFirstChunk = true;
      sending = false;
    } else {
      totalSamples += end;
      totalChunks++;
      samples.splice(0, end);
      if (samples.length >= CHUNK_SIZE) {
        Timer.set(CHUNK_DELAY_MS, false, sendNextChunk);
      } else {
        sending = false;
      }
    }
  });
}

// -- SAMPLING LOOP --
Timer.set(SAMPLING_INTERVAL, true, function() {
  try {
    let now = Date.now();
    let raw = readVoltage();
    samples.push(Math.floor(now) + "," + raw);

    if (samples.length > MAX_BUFFER) {
      let drop = samples.length - MAX_BUFFER;
      print("⚠️ Buffer full — dropping", drop, "oldest samples");
      samples.splice(0, drop);
    }

    if (!sending && samples.length >= CHUNK_SIZE) {
      sending = true;
      sendNextChunk();
    }

  } catch(e) {
    print("💥 ERROR:", JSON.stringify(e));
  }
});

print("🚀 RawCapture started | url:", SERVER_URL, "| interval:", SAMPLING_INTERVAL, "ms");
