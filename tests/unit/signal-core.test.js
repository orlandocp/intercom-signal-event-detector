const {
  RingBuffer, rbPush, rbCopyTo,
  applyEMA, applyNoiseFloor, applyHysteresis,
  buildSample, buildChunk
} = require("../../signal-core");

// ============================================================
// RING BUFFER
// ============================================================

describe("RingBuffer", () => {

  describe("partial fill", () => {
    it("returns only pushed items", () => {
      const rb = RingBuffer(5);
      rbPush(rb, "a");
      rbPush(rb, "b");
      rbPush(rb, "c");
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toEqual(["a", "b", "c"]);
    });
  });

  describe("exact fill", () => {
    it("returns all items in order", () => {
      const rb = RingBuffer(3);
      rbPush(rb, "a");
      rbPush(rb, "b");
      rbPush(rb, "c");
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toEqual(["a", "b", "c"]);
    });
  });

  describe("overflow wrapping", () => {
    it("discards oldest and preserves order", () => {
      const rb = RingBuffer(3);
      rbPush(rb, "a");
      rbPush(rb, "b");
      rbPush(rb, "c");
      rbPush(rb, "d");
      rbPush(rb, "e");
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toEqual(["c", "d", "e"]);
    });

    it("never exceeds size", () => {
      const rb = RingBuffer(3);
      for (let i = 0; i < 10; i++) rbPush(rb, i);
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toHaveLength(3);
    });
  });

  describe("single element", () => {
    it("returns that element", () => {
      const rb = RingBuffer(5);
      rbPush(rb, "x");
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toEqual(["x"]);
    });
  });

  describe("empty buffer", () => {
    it("returns nothing", () => {
      const rb = RingBuffer(5);
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toHaveLength(0);
    });
  });

  describe("size=1", () => {
    it("always holds only the last item", () => {
      const rb = RingBuffer(1);
      rbPush(rb, "a");
      rbPush(rb, "b");
      rbPush(rb, "c");
      const out = [];
      rbCopyTo(rb, out);
      expect(out).toEqual(["c"]);
    });
  });
});

// ============================================================
// EMA
// ============================================================

describe("applyEMA", () => {

  it("converges to target after many iterations", () => {
    let f = 0;
    for (let i = 0; i < 100; i++) f = applyEMA(f, 3.0, 0.2);
    expect(f).toBeCloseTo(3.0, 3);
  });

  it("first tick equals alpha * target", () => {
    const f = applyEMA(0, 3.0, 0.2);
    expect(f).toBeCloseTo(0.6, 5);
  });

  it("never overshoots target", () => {
    let f = 0;
    for (let i = 0; i < 50; i++) {
      f = applyEMA(f, 3.0, 0.2);
      expect(f).toBeLessThanOrEqual(3.0);
    }
  });

  it("decays from high to low", () => {
    let f = 3.0;
    for (let i = 0; i < 100; i++) f = applyEMA(f, 0, 0.2);
    expect(f).toBeCloseTo(0, 3);
  });

  it("stays stable when raw equals filtered", () => {
    const f = applyEMA(1.5, 1.5, 0.2);
    expect(f).toBeCloseTo(1.5, 10);
  });
});

// ============================================================
// NOISE FLOOR
// ============================================================

describe("applyNoiseFloor", () => {

  it("zeroes values strictly below floor", () => {
    expect(applyNoiseFloor(0.24, 0.25)).toBe(0);
  });

  it("passes through values strictly above floor", () => {
    expect(applyNoiseFloor(0.26, 0.25)).toBeCloseTo(0.26);
  });

  it("passes through value exactly at floor (strict <)", () => {
    expect(applyNoiseFloor(0.25, 0.25)).toBeCloseTo(0.25);
  });

  it("zeroes 0", () => {
    expect(applyNoiseFloor(0, 0.25)).toBe(0);
  });

  it("passes through large values", () => {
    expect(applyNoiseFloor(3.5, 0.25)).toBeCloseTo(3.5);
  });
});

// ============================================================
// HYSTERESIS
// ============================================================

describe("applyHysteresis", () => {

  describe("OFF → ON", () => {
    it("turns ON strictly above onThreshold", () => {
      expect(applyHysteresis(false, 0.31, 0.30, 0.20)).toBe(true);
    });

    it("stays OFF at exactly onThreshold", () => {
      expect(applyHysteresis(false, 0.30, 0.30, 0.20)).toBe(false);
    });

    it("stays OFF below onThreshold", () => {
      expect(applyHysteresis(false, 0.29, 0.30, 0.20)).toBe(false);
    });
  });

  describe("ON → OFF", () => {
    it("turns OFF strictly below offThreshold", () => {
      expect(applyHysteresis(true, 0.19, 0.30, 0.20)).toBe(false);
    });

    it("stays ON at exactly offThreshold", () => {
      expect(applyHysteresis(true, 0.20, 0.30, 0.20)).toBe(true);
    });

    it("stays ON above offThreshold", () => {
      expect(applyHysteresis(true, 0.21, 0.30, 0.20)).toBe(true);
    });
  });

  describe("dead zone", () => {
    it("stays OFF in dead zone when coming from OFF", () => {
      expect(applyHysteresis(false, 0.25, 0.30, 0.20)).toBe(false);
    });

    it("stays ON in dead zone when coming from ON", () => {
      expect(applyHysteresis(true, 0.25, 0.30, 0.20)).toBe(true);
    });
  });
});

// ============================================================
// BUILD SAMPLE
// ============================================================

describe("buildSample", () => {

  it("formats as timestamp,voltage", () => {
    const s = buildSample(1772986131188, 3.2521);
    expect(s).toBe("1772986131188,3.2521");
  });

  it("rounds to 4 decimal places", () => {
    const s = buildSample(1000, 0.123456789);
    expect(s).toBe("1000,0.1235");
  });

  it("pads to 4 decimals for whole numbers", () => {
    const s = buildSample(1000, 0);
    expect(s).toBe("1000,0.0000");
  });
});

// ============================================================
// BUILD CHUNK
// ============================================================

describe("buildChunk", () => {

  const samples = [
    "1000,0.3952",
    "1050,0.4100",
    "1100,0.4250"
  ];

  it("starts with META line", () => {
    const chunk = buildChunk(samples, 3, 1000, false);
    const lines = chunk.split("\n");
    expect(lines[0]).toBe("META,1000,0");
  });

  it("marks final chunk with 1", () => {
    const chunk = buildChunk(samples, 3, 1000, true);
    const lines = chunk.split("\n");
    expect(lines[0]).toBe("META,1000,1");
  });

  it("includes exactly end samples", () => {
    const chunk = buildChunk(samples, 2, 1000, false);
    const lines = chunk.split("\n").filter(l => l.length > 0);
    expect(lines).toHaveLength(3); // META + 2 samples
    expect(lines[1]).toBe("1000,0.3952");
    expect(lines[2]).toBe("1050,0.4100");
  });

  it("includes all samples when end === samples.length", () => {
    const chunk = buildChunk(samples, 3, 1000, true);
    const lines = chunk.split("\n").filter(l => l.length > 0);
    expect(lines).toHaveLength(4); // META + 3 samples
  });

  it("each sample line ends with newline", () => {
    const chunk = buildChunk(samples, 3, 1000, false);
    expect(chunk.endsWith("\n")).toBe(true);
  });
});
