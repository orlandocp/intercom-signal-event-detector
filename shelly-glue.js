// -- CONFIG: debug --
const DEBUG = true;

// -- CONFIG: server --
const SERVER_URL = "http://192.168.0.20:5000/buffer";

// -- CONFIG: sampling --
const SAMPLING_INTERVAL = 50;
const NOISE_FLOOR = 0.25;
const ON_THRESHOLD = 0.30;
const OFF_THRESHOLD = 0.20;
const ALPHA = 0.2;
const PRE_BUFFER_SIZE = 20;

// -- CONFIG: event --
const EVENT_TIMEOUT = 2000;
const MAX_EVENT_DURATION = 35000;
const MAX_SAMPLES = Math.ceil(MAX_EVENT_DURATION / SAMPLING_INTERVAL) + PRE_BUFFER_SIZE;

// -- CONFIG: send --
const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 200;
const CHUNK_TIMEOUT = 0.5;

// -- STATE --
let preBuffer = RingBuffer(PRE_BUFFER_SIZE);
let samples = [];
let eventActive = false;
let eventStartTime = 0;
let lastActiveTime = 0;
let signalState = false;
let filteredVoltage = 0;
let sending = false;
let totalSamples = 0;
let totalChunks = 0;

// -- VOLTAGE --
function readVoltage() {
  return Shelly.getComponentStatus("voltmeter:100").voltage;
}

// -- WEBHOOK --
function webhookPulse(v) {
  print("⚡ Webhook | V:", v, "| t:", Date.now());
}

// -- SEND --
function sendNextChunk() {
  let end = Math.min(CHUNK_SIZE, samples.length);
  if (end === 0) {
    sending = false;
    return;
  }

  let isLast = !eventActive && (end >= samples.length);
  let chunk = buildChunk(samples, end, eventStartTime, isLast);

  if (DEBUG) print("Sending chunk | size:", end, "| final:", isLast);

  Shelly.call("HTTP.POST", {
    url: SERVER_URL,
    body: chunk,
    timeout: CHUNK_TIMEOUT
  }, function(result, error) {
    if (error) {
      print("❌ Chunk error — aborting event:", JSON.stringify(error));
      samples = [];
      sending = false;
      eventActive = false;
    } else {
      if (DEBUG) print("Chunk ok:", result.code);
      totalSamples += end;
      totalChunks++;
      samples.splice(0, end);
      if (isLast) {
        let duration = ((Date.now() - eventStartTime) / 1000).toFixed(1);
        print("✅ All chunks sent | samples:", totalSamples, "| chunks:", totalChunks, "| duration:", duration, "s");
        sending = false;
      } else if (samples.length >= CHUNK_SIZE || !eventActive) {
        Timer.set(CHUNK_DELAY_MS, false, sendNextChunk);
      } else {
        sending = false;
      }
    }
  });
}

// -- FINALIZE --
function finalizeEvent() {
  if (samples.length === 0) return;
  print("🔶 Event finalized");
  if (!sending) {
    sending = true;
    sendNextChunk();
  }
}

// -- SAMPLING LOOP --
Timer.set(SAMPLING_INTERVAL, true, function() {
  try {
    let raw = readVoltage();
    filteredVoltage = applyEMA(filteredVoltage, raw, ALPHA);
    let voltage = applyNoiseFloor(filteredVoltage, NOISE_FLOOR);
    let now = Date.now();

    let newState = applyHysteresis(signalState, voltage, ON_THRESHOLD, OFF_THRESHOLD);

    if (DEBUG && newState !== signalState) {
      print("State:", signalState, "->", newState, "| V:", voltage);
    }

    let sample = buildSample(now, voltage);

    if (newState) {
      if (!eventActive) {
        print("🌟 Event started | V:", voltage);
        eventActive = true;
        samples = [];
        totalSamples = 0;
        totalChunks = 0;
        rbCopyTo(preBuffer, samples);
        eventStartTime = now;
      }
      samples.push(sample);
      lastActiveTime = now;
      if (DEBUG) print("Sample | V:", voltage, "| total:", samples.length);

      if (!sending && samples.length >= CHUNK_SIZE) {
        sending = true;
        sendNextChunk();
      }

    } else {
      if (eventActive) {
        samples.push(sample);
        if (DEBUG) print("Sample | V:", voltage, "| total:", samples.length);

        let idle = now - lastActiveTime;
        let duration = now - eventStartTime;
        if (DEBUG) print("Idle:", idle, "| Duration:", duration);

        if (idle > EVENT_TIMEOUT || duration > MAX_EVENT_DURATION) {
          print("⏱️ Timeout | idle:", idle, "| duration:", duration);
          eventActive = false;
          finalizeEvent();
        } else if (samples.length >= MAX_SAMPLES) {
          print("⚠️ Max samples reached");
          eventActive = false;
          finalizeEvent();
        }
      }
    }

    rbPush(preBuffer, sample);
    signalState = newState;

  } catch(e) {
    print("💥 ERROR:", JSON.stringify(e));
  }
});

print("🚀 VHunter started | url:", SERVER_URL, "| interval:", SAMPLING_INTERVAL, "ms");
