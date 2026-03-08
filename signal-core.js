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

// -- SIGNAL PROCESSING --
function applyEMA(filtered, raw, alpha) {
  return filtered + alpha * (raw - filtered);
}

function applyNoiseFloor(voltage, floor) {
  return voltage < floor ? 0 : voltage;
}

function applyHysteresis(state, voltage, onThreshold, offThreshold) {
  if (!state && voltage > onThreshold) return true;
  if (state && voltage < offThreshold) return false;
  return state;
}

// -- SAMPLE --
function buildSample(now, voltage) {
  return now + "," + voltage.toFixed(4);
}

// -- CHUNK --
function buildChunk(samples, end, eventStartTime, isLast) {
  let chunk = "META," + eventStartTime + "," + (isLast ? "1" : "0") + "\n";
  for (let i = 0; i < end; i++) {
    chunk += samples[i] + "\n";
  }
  return chunk;
}

if (typeof module !== "undefined") {
  module.exports = {
    RingBuffer, rbPush, rbCopyTo,
    applyEMA, applyNoiseFloor, applyHysteresis,
    buildSample, buildChunk
  };
}
