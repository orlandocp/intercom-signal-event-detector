/**
 * signal-core.js
 *
 * Pure signal processing functions for the intercom event detector.
 * No side effects, no external dependencies — all functions receive
 * their inputs as parameters and return new values.
 *
 * Concepts used:
 *   - Ring buffer      : fixed-size circular storage for pre-trigger samples
 *   - EMA filter       : low-pass filter to smooth noisy voltage readings
 *   - Hysteresis       : Schmitt trigger to avoid false state transitions
 *   - Noise floor      : minimum signal threshold to reject background noise
 */

// =============================================================================
// RING BUFFER
//
// A fixed-size circular buffer that overwrites the oldest entry when full.
// Used to keep the last N voltage samples before an event starts (pre-trigger),
// so that the rising edge of the signal is always captured even though we don't
// know an event is happening until the voltage crosses the ON threshold.
//
// Analogy: like a security camera that always records the last 20 seconds,
// overwriting older footage. When something happens, you already have the
// moments just before it.
//
// Example with size=3:
//   push("a") → [a, _, _]  head=1  count=1
//   push("b") → [a, b, _]  head=2  count=2
//   push("c") → [a, b, c]  head=0  count=3
//   push("d") → [d, b, c]  head=1  count=3  ← "a" overwritten
//   copyTo()  → ["b", "c", "d"]              ← oldest first
// =============================================================================

/**
 * Creates a new ring buffer of the given size.
 * @param {number} size - Maximum number of items to hold.
 * @returns {{ data: any[], size: number, head: number, count: number }}
 */
function RingBuffer(size) {
  return { data: new Array(size), size: size, head: 0, count: 0 };
}

/**
 * Pushes a new sample into the ring buffer.
 * If the buffer is full, the oldest sample is silently overwritten.
 * @param {{ data: any[], size: number, head: number, count: number }} rb
 * @param {any} sample
 */
function rbPush(rb, sample) {
  rb.data[rb.head] = sample;
  rb.head = (rb.head + 1) % rb.size;
  if (rb.count < rb.size) rb.count++;
}

/**
 * Copies all buffered samples into a target array, oldest first.
 * Does not modify the ring buffer.
 * @param {{ data: any[], size: number, head: number, count: number }} rb
 * @param {any[]} target - Array to append samples into.
 */
function rbCopyTo(rb, target) {
  let start = (rb.head - rb.count + rb.size) % rb.size;
  for (let i = 0; i < rb.count; i++) {
    target.push(rb.data[(start + i) % rb.size]);
  }
}

// =============================================================================
// EMA — Exponential Moving Average (Low-Pass Filter)
//
// A first-order digital low-pass filter that smooths noisy voltage readings
// by giving more weight to recent values while retaining memory of the past.
//
// Formula: filtered = filtered + alpha * (raw - filtered)
//          which is equivalent to: filtered = alpha * raw + (1 - alpha) * filtered
//
// Alpha controls the trade-off between smoothness and responsiveness:
//   - Low alpha  (e.g. 0.05): very smooth, slow to react to changes
//   - High alpha (e.g. 0.50): reacts fast, less smoothing
//   - Alpha = 0.2 is used here as a balance for 50ms sampling rate
//
// Example with alpha=0.2, target=3.0V, starting from 0V:
//   tick 1: 0 + 0.2 * (3.0 - 0)     = 0.600
//   tick 2: 0.6 + 0.2 * (3.0 - 0.6) = 1.080
//   tick 3: 1.08 + 0.2 * (3.0 - 1.08) = 1.464
//   ...converges to 3.0 after ~20 ticks
// =============================================================================

/**
 * Applies one tick of the EMA filter.
 * @param {number} filtered - Previous filtered value.
 * @param {number} raw      - New raw voltage reading.
 * @param {number} alpha    - Smoothing factor, 0 < alpha < 1.
 * @returns {number} New filtered value.
 */
function applyEMA(filtered, raw, alpha) {
  return filtered + alpha * (raw - filtered);
}

// =============================================================================
// NOISE FLOOR
//
// Clamps any voltage below the noise floor to exactly 0.
// Prevents the EMA filter's slow decay from keeping a tiny residual voltage
// above the OFF threshold, which would prevent events from closing correctly.
//
// Example with floor=0.25V:
//   0.10V → 0.00V  (clamped)
//   0.24V → 0.00V  (clamped)
//   0.25V → 0.25V  (passes through — condition is strict <)
//   0.30V → 0.30V  (passes through)
// =============================================================================

/**
 * Returns 0 if voltage is strictly below the noise floor, otherwise returns voltage unchanged.
 * @param {number} voltage - Filtered voltage value.
 * @param {number} floor   - Noise floor threshold in volts.
 * @returns {number}
 */
function applyNoiseFloor(voltage, floor) {
  return voltage < floor ? 0 : voltage;
}

// =============================================================================
// HYSTERESIS (Schmitt Trigger)
//
// A two-threshold state machine that prevents rapid ON/OFF toggling when the
// signal hovers near a single threshold (chatter/bouncing).
//
// Uses two separate thresholds:
//   - onThreshold:  voltage must rise ABOVE this to switch ON
//   - offThreshold: voltage must fall BELOW this to switch OFF
//
// The gap between the two thresholds is the "dead zone" — in this dead zone
// the state never changes, regardless of the voltage.
//
// Analogy: a thermostat that turns heating ON at 18°C and OFF at 22°C.
// It won't rapidly toggle if the temperature sits at 20°C.
//
// Example with onThreshold=0.30, offThreshold=0.20:
//   state=OFF, voltage=0.31 → ON   (crossed onThreshold going up)
//   state=ON,  voltage=0.25 → ON   (in dead zone, no change)
//   state=ON,  voltage=0.19 → OFF  (crossed offThreshold going down)
//   state=OFF, voltage=0.25 → OFF  (in dead zone, no change)
// =============================================================================

/**
 * Applies hysteresis to determine the new signal state.
 * @param {boolean} state        - Current signal state (true = ON, false = OFF).
 * @param {number}  voltage      - Current filtered voltage.
 * @param {number}  onThreshold  - Voltage above which state switches to ON.
 * @param {number}  offThreshold - Voltage below which state switches to OFF.
 * @returns {boolean} New signal state.
 */
function applyHysteresis(state, voltage, onThreshold, offThreshold) {
  if (!state && voltage > onThreshold) return true;
  if (state && voltage < offThreshold) return false;
  return state;
}

// =============================================================================
// SAMPLE
//
// Formats a single voltage reading as a CSV line: "timestamp,voltage"
// Voltage is always serialized with exactly 4 decimal places.
//
// Example:
//   buildSample(1772986131188, 3.2521) → "1772986131188,3.2521"
//   buildSample(1772986131188, 0)      → "1772986131188,0.0000"
// =============================================================================

/**
 * Builds a CSV sample line from a timestamp and voltage.
 * @param {number} now     - Unix timestamp in milliseconds.
 * @param {number} voltage - Filtered voltage value.
 * @returns {string} e.g. "1772986131188,3.2521"
 */
function buildSample(now, voltage) {
  return now + "," + voltage.toFixed(4);
}

// =============================================================================
// CHUNK
//
// Builds an HTTP POST body containing a META header line followed by
// up to CHUNK_SIZE sample lines. The META line identifies the event
// and signals whether this is the final chunk of the event.
//
// Format:
//   META,<eventStartTime>,<isFinal>\n
//   <timestamp>,<voltage>\n
//   <timestamp>,<voltage>\n
//   ...
//
// Example (final chunk):
//   META,1772986131188,1
//   1772986131188,3.2521
//   1772986131238,3.1900
// =============================================================================

/**
 * Builds a chunk payload string ready to POST to the server.
 * @param {string[]} samples       - Array of sample lines ("timestamp,voltage").
 * @param {number}   end           - Number of samples to include (from index 0).
 * @param {number}   eventStartTime - Timestamp of event start (used as event ID).
 * @param {boolean}  isLast        - True if this is the final chunk of the event.
 * @returns {string} The full chunk body including META header.
 */
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
