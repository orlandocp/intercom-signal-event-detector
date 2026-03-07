# Intercom Signal Event Detector

A lightweight embedded signal-processing pipeline for detecting **real
doorbell events** from an analog intercom voltage line using a **Shelly
Plus Uni**.

The system samples the analog voltage, filters electrical noise, detects
signal transitions, and captures complete signal events for later
classification.

This project implements a **real-time event-based signal acquisition
algorithm**, a common approach in embedded signal processing systems
where noisy analog signals must be converted into reliable digital
events.

------------------------------------------------------------------------

# The Problem

Many analog intercom systems share electrical wiring between multiple
apartments. Because of this shared infrastructure, voltage variations
appear on the line even when **your apartment is not being called**.

When connecting a microcontroller or IoT device to this line, several
different electrical events become visible.

In practice, three main scenarios appear on the signal:

------------------------------------------------------------------------

## 1. Real doorbell ring (target signal)

When someone presses your doorbell, the intercom produces a voltage
waveform that activates the buzzer inside your apartment.

Example waveform:

    Voltage

    1.2V        ────────────────
                │               │
                │               │
    0.4V   ─────┘               └────

    0V  ─────────────────────────────────

This is the **only event that should trigger the automation system**.

------------------------------------------------------------------------

## 2. Neighbor doorbell events (line crosstalk)

Because the intercom wiring is shared between apartments, ringing
another apartment can still induce voltage changes on the line.

These signals are weaker but still detectable.

Example:

    Voltage

    0.5V        ────────
                │      │
                │      │
    0.2V  ~ ~ ~ │      │ ~ ~ ~
                │      │
    0V  ────────┴──────┴──────────────

These events **must be ignored**, even though they appear in the signal.

------------------------------------------------------------------------

## 3. Handset hang-up transient

When the handset of the intercom is returned to its base, a short
electrical transient occurs.

Example:

    Voltage

    0.7V        │
                │
                │
    0V  ────────┴────────────────────

This spike is not a doorbell event and should also be ignored.

------------------------------------------------------------------------

## 4. Electrical noise

Even when nothing happens, the analog line contains electrical noise.

Observed noise range:

    0.10V – 0.25V

Typical waveform:

    Voltage

    0.25V   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
    0.20V   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
    0.15V   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~

    0V  ─────────────────────────

Because of this noise, the system cannot simply trigger on raw voltage
changes.

A signal-processing pipeline is required to **stabilize the signal and
detect meaningful events**.

------------------------------------------------------------------------

# Solution Overview

The system implements a small **real-time signal processing pipeline**
running directly on the Shelly Plus Uni.

    ADC Sampling
         ↓
    Exponential Moving Average Filter
         ↓
    Noise Floor Suppression
         ↓
    Hysteresis Threshold Detection
         ↓
    Event Segmentation
         ↓
    Pre-Trigger Buffer Capture
         ↓
    Waveform Event Recording

The final output is a **structured event containing the voltage
waveform**, which can later be analyzed or classified.

------------------------------------------------------------------------

# Sampling Strategy

The analog voltage is sampled at a fixed interval.

Example configuration:

    samplingInterval = 50 ms

This produces:

    20 samples per second

This sampling rate is sufficient because intercom signals evolve on the
order of **hundreds of milliseconds to seconds**, not microseconds.

------------------------------------------------------------------------

# Signal Smoothing (EMA Filter)

Raw ADC measurements often contain high-frequency electrical noise.

To stabilize the signal, the system applies an **Exponential Moving
Average (EMA)** filter.

Formula:

    filtered = filtered + alpha * (raw - filtered)

Where:

    alpha ∈ (0,1)

------------------------------------------------------------------------

## Effect of the filter

Raw samples:

    0.21
    0.19
    0.24
    0.18
    0.23

Filtered samples:

    0.21
    0.20
    0.21
    0.20
    0.21

The filter smooths rapid fluctuations while preserving the overall
signal shape.

------------------------------------------------------------------------

## Choosing alpha

The parameter **alpha** determines how strongly the filter smooths the
signal.

Small alpha:

    alpha = 0.05

Produces heavy smoothing but responds slowly to real events.

Large alpha:

    alpha = 0.7

Responds quickly but allows more noise to pass.

Typical embedded values:

    0.1 – 0.3

This project uses:

    alpha = 0.2

This provides a good balance between:

-   noise reduction\
-   responsiveness to real events

------------------------------------------------------------------------

# Noise Floor Suppression

Because the line constantly fluctuates between **0.1V and 0.25V**, a
**noise floor** is defined.

    noiseFloor = 0.25

Values below this threshold are treated as zero.

    if voltage < noiseFloor
        voltage = 0

This prevents background noise from triggering events.

------------------------------------------------------------------------

# Threshold Detection

A naive detector might use a single threshold:

    threshold = 0.30

    if voltage > threshold
        signal = ON
    else
        signal = OFF

However, if the signal fluctuates around the threshold, the detector
rapidly switches between ON and OFF.

Example:

    Voltage

    0.32 → ON
    0.29 → OFF
    0.31 → ON
    0.28 → OFF

Result:

    ON OFF ON OFF ON OFF

This behavior is called **threshold chatter**.

------------------------------------------------------------------------

# Hysteresis Detection

To avoid this problem, the system uses **hysteresis**, meaning two
thresholds are defined.

    onThreshold  = 0.30
    offThreshold = 0.20

State transitions follow these rules:

    OFF → ON   when voltage > 0.30
    ON  → OFF  when voltage < 0.20

Graphically:

    Voltage

    ON threshold  → 0.30
    OFF threshold → 0.20

           ON
    --------┐
            │
            │
            └-------- OFF

Values between **0.20 and 0.30** do not change the signal state.

Example signal:

    Voltage   State

    0.28      OFF
    0.31      ON
    0.29      ON
    0.27      ON
    0.22      ON
    0.19      OFF

This eliminates rapid switching caused by noise.

------------------------------------------------------------------------

# Event-Based Acquisition

When the signal crosses the **ON threshold**, the system begins
capturing an event.

    eventActive = true

While the signal remains active, all samples are stored.

------------------------------------------------------------------------

# Pre-Trigger Ring Buffer

Before an event occurs, the system continuously stores samples in a
**circular buffer**.

Example:

    preBufferSize = 20

At a 50 ms sampling interval, this stores:

    1 second of signal history

When an event begins, this buffer is copied so the recorded waveform
includes **the signal leading up to the trigger**.

Example captured waveform:

    pre-trigger samples
    0.12
    0.15
    0.18

    event
    0.35
    0.90
    1.20
    1.10
    0.60

    post-event
    0.25
    0.18

This context is extremely useful for later signal analysis.

------------------------------------------------------------------------

# Event Segmentation

An event ends when one of the following conditions occurs:

    signal inactivity timeout exceeded
    OR
    maximum event duration exceeded

Example configuration:

    eventTimeout = 2000 ms
    maxEventDuration = 10000 ms

This prevents events from growing indefinitely.

------------------------------------------------------------------------

# Event Output

Each detected event contains a timestamped waveform.

Example structure:

    {
      samples: [
        {t: timestamp, v: voltage},
        {t: timestamp, v: voltage},
        ...
      ]
    }

This allows future analysis such as:

-   waveform comparison\
-   event classification\
-   neighbor ring rejection\
-   machine learning approaches

------------------------------------------------------------------------

# Hardware

Device:

    Shelly Plus Uni

Input:

    Analog voltage from intercom line

The entire signal processing pipeline runs **directly on the embedded
device**.

No cloud processing is required.

------------------------------------------------------------------------

# Why This Architecture

This architecture is commonly used in embedded signal processing because
it provides:

-   robust noise filtering\
-   deterministic memory usage\
-   reliable event segmentation\
-   temporal context capture\
-   low CPU overhead

All processing runs locally, making the system **fast, deterministic,
and reliable**.

------------------------------------------------------------------------

# Future Improvements

Possible extensions include:

-   waveform feature extraction\
-   classification of event types\
-   adaptive thresholds\
-   pattern recognition\
-   machine learning classifiers

------------------------------------------------------------------------

# License

MIT
