const fs = require("fs");
const path = require("path");
const {
  RingBuffer, rbPush, rbCopyTo,
  applyEMA, applyNoiseFloor, applyHysteresis,
  buildSample, buildChunk
} = require("../../signal-core");

// -- CONFIG (must match event-detector.js) --
const NOISE_FLOOR   = 0.25;
const ON_THRESHOLD  = 0.30;
const OFF_THRESHOLD = 0.20;
const ALPHA         = 0.2;
const PRE_BUFFER_SIZE = 20;
const CHUNK_SIZE    = 50;

// -- SIMULATOR --
function simulate(voltages) {
  let preBuffer     = RingBuffer(PRE_BUFFER_SIZE);
  let samples       = [];
  let eventActive   = false;
  let eventStartTime = 0;
  let lastActiveTime = 0;
  let signalState   = false;
  let filteredVoltage = 0;

  const events  = [];   // completed events
  const chunks  = [];   // all chunks generated

  let currentEvent  = null;
  let fakeNow       = 1000000000000;  // monotonic fake timestamp

  for (const raw of voltages) {
    const now = fakeNow;
    fakeNow += 50;

    filteredVoltage = applyEMA(filteredVoltage, raw, ALPHA);
    const voltage   = applyNoiseFloor(filteredVoltage, NOISE_FLOOR);
    const newState  = applyHysteresis(signalState, voltage, ON_THRESHOLD, OFF_THRESHOLD);
    const sample    = buildSample(now, voltage);

    if (newState) {
      if (!eventActive) {
        eventActive    = true;
        eventStartTime = now;
        lastActiveTime = now;
        samples        = [];
        rbCopyTo(preBuffer, samples);
        currentEvent   = { startTime: now, chunks: [] };
      }
      samples.push(sample);
      lastActiveTime = now;

    } else {
      if (eventActive) {
        samples.push(sample);
      }
    }

    rbPush(preBuffer, sample);
    signalState = newState;
  }

  // finalize any open event at end of input
  if (eventActive && samples.length > 0) {
    eventActive = false;
    _flushChunks(samples, eventStartTime, currentEvent, chunks);
    events.push(currentEvent);
  }

  return { events, chunks };
}

function _flushChunks(samples, eventStartTime, currentEvent, chunks) {
  let remaining = [...samples];
  while (remaining.length > 0) {
    const end    = Math.min(CHUNK_SIZE, remaining.length);
    const isLast = end >= remaining.length;
    const chunk  = buildChunk(remaining, end, eventStartTime, isLast);
    const record = { raw: chunk, isLast, sampleCount: end };
    chunks.push(record);
    currentEvent.chunks.push(record);
    remaining.splice(0, end);
  }
}

// -- CSV LOADER --
function loadVoltages(filename) {
  const filepath = path.join(__dirname, "../fixtures", filename);
  const lines = fs.readFileSync(filepath, "utf8")
    .split("\n")
    .filter(l => l.trim().length > 0)
    .slice(1); // skip header

  return lines.map(line => {
    const parts = line.split(",");
    return parseFloat(parts[1]);
  });
}

function loadTimestamps(filename) {
  const filepath = path.join(__dirname, "../fixtures", filename);
  const lines = fs.readFileSync(filepath, "utf8")
    .split("\n")
    .filter(l => l.trim().length > 0)
    .slice(1);

  return lines.map(line => {
    const parts = line.split(",");
    return parseFloat(parts[0]);
  });
}

// -- FIXTURES --
const fixtures = [
  { file: "20260308_130209.csv", expectedSamples: 290 },
  { file: "20260308_150418.csv", expectedSamples: 324 },
];

// ============================================================
// TESTS
// ============================================================

describe.each(fixtures)("Signal fixture: $file", ({ file, expectedSamples }) => {

  let voltages;
  let timestamps;
  let result;

  beforeAll(() => {
    voltages   = loadVoltages(file);
    timestamps = loadTimestamps(file);
    result     = simulate(voltages);
  });

  // 1 — exactly one event detected
  it("detects exactly 1 event", () => {
    expect(result.events).toHaveLength(1);
  });

  // 2 — sample count matches CSV row count
  it("total samples captured matches CSV row count", () => {
    const total = result.chunks.reduce((sum, c) => sum + c.sampleCount, 0);
    expect(total).toBe(expectedSamples);
  });

  // 3 — chunk count is ceil(samples / CHUNK_SIZE)
  it("chunk count is ceil(totalSamples / CHUNK_SIZE)", () => {
    const total    = result.chunks.reduce((sum, c) => sum + c.sampleCount, 0);
    const expected = Math.ceil(total / CHUNK_SIZE);
    expect(result.chunks).toHaveLength(expected);
  });

  // 4 — only last chunk has isFinal=1
  it("only the last chunk is marked as final", () => {
    const allButLast = result.chunks.slice(0, -1);
    const last       = result.chunks[result.chunks.length - 1];
    expect(last.isLast).toBe(true);
    allButLast.forEach(c => expect(c.isLast).toBe(false));
  });

  // 6 — timestamps ordered within each chunk
  it("timestamps are ordered within each chunk", () => {
    for (const chunk of result.chunks) {
      const lines = chunk.raw.split("\n").filter(l => l && !l.startsWith("META"));
      const ts    = lines.map(l => parseFloat(l.split(",")[0]));
      for (let i = 1; i < ts.length; i++) {
        expect(ts[i]).toBeGreaterThan(ts[i - 1]);
      }
    }
  });

  // 7 — no overlap between consecutive chunks
  it("no timestamp overlap between consecutive chunks", () => {
    for (let i = 1; i < result.chunks.length; i++) {
      const prev = result.chunks[i - 1].raw.split("\n").filter(l => l && !l.startsWith("META"));
      const curr = result.chunks[i].raw.split("\n").filter(l => l && !l.startsWith("META"));
      const lastTs  = parseFloat(prev[prev.length - 1].split(",")[0]);
      const firstTs = parseFloat(curr[0].split(",")[0]);
      expect(firstTs).toBeGreaterThan(lastTs);
    }
  });

  // 9 — sum of chunk sample counts equals total samples
  it("sum of chunk sample counts equals total samples", () => {
    const total     = result.chunks.reduce((sum, c) => sum + c.sampleCount, 0);
    const fromEvent = result.events[0].chunks.reduce((sum, c) => sum + c.sampleCount, 0);
    expect(total).toBe(fromEvent);
  });
});
