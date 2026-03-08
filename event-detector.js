// -- CONFIG: debug --
const DEBUG = false;

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

// -- RING BUFFER --
function RingBuffer(size) {
  return { data: new Array(size), size: size, head: 0, count: 0 };
}

function rbPush(rb, sample) {
  rb.data[rb.head] = sample;
  rb.head = (rb.head + 1) % rb.size;
  if (rb.count < rb.size) rb.count++;
}

function rbCopyTo(rb, target) {
  let start = (rb.head - rb.count + rb.size) % rb.size;
  for (let i = 0; i < rb.count; i++) {
    target.push(rb.data[(start + i) % rb.size]);
  }
}

// -- STATE --
let preBuffer = RingBuffer(PRE_BUFFER_SIZE);
let samples = [];
let eventActive = false;
let eventStartTime = 0;
let lastActiveTime = 0;
let signalState = false;
let filteredVoltage = 0;
let sendIndex = 0;

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
  if (sendIndex >= samples.length) {
    print("✅ All chunks sent |", samples.length, "samples");
    samples = [];
    sendIndex = 0;
    return;
  }

  let end = Math.min(sendIndex + CHUNK_SIZE, samples.length);
  let chunk = "";
  for (let i = sendIndex; i < end; i++) {
    chunk += samples[i] + "\n";
  }

  if (DEBUG) print("Sending chunk", sendIndex, "-", end);

  Shelly.call("HTTP.POST", {
    url: SERVER_URL,
    body: chunk,
    timeout: 1.0
  }, function(result, error) {
    if (error) {
      print("❌ Chunk error:", JSON.stringify(error));
    } else {
      if (DEBUG) print("Chunk ok:", result.code);
      sendIndex = end;
      Timer.set(CHUNK_DELAY_MS, false, sendNextChunk);
    }
  });
}

// -- FINALIZE --
function finalizeEvent() {
  if (samples.length === 0) return;
  print("Event finalized |", samples.length, "samples");
  sendIndex = 0;
  sendNextChunk();
}

// -- SAMPLING LOOP --
Timer.set(SAMPLING_INTERVAL, true, function() {
  try {
    let raw = readVoltage();
    filteredVoltage = filteredVoltage + ALPHA * (raw - filteredVoltage);
    let voltage = filteredVoltage < NOISE_FLOOR ? 0 : filteredVoltage;
    let now = Date.now();

    let newState = signalState;
    if (!signalState && voltage > ON_THRESHOLD) newState = true;
    if (signalState && voltage < OFF_THRESHOLD) newState = false;

    if (DEBUG && newState !== signalState) {
      print("State:", signalState, "->", newState, "| V:", voltage);
    }

    let sample = now + "," + voltage.toFixed(4);

    if (newState) {
      if (!eventActive) {
        print("🌟 Event started | V:", voltage);
        eventActive = true;
        samples = [];
        rbCopyTo(preBuffer, samples);
        eventStartTime = now;
      }
      samples.push(sample);
      lastActiveTime = now;
      if (DEBUG) print("Sample | V:", voltage, "| total:", samples.length);

    } else {
      if (eventActive) {
        samples.push(sample);
        if (DEBUG) print("Sample | V:", voltage, "| total:", samples.length);

        let idle = now - lastActiveTime;
        let duration = now - eventStartTime;
        if (DEBUG) print("Idle:", idle, "| Duration:", duration);

        if (idle > EVENT_TIMEOUT || duration > MAX_EVENT_DURATION) {
          print("⏱️ Timeout | idle:", idle, "| duration:", duration);
          finalizeEvent();
          eventActive = false;
        } else if (samples.length >= MAX_SAMPLES) {
          print("⚠️ Max samples reached");
          finalizeEvent();
          eventActive = false;
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