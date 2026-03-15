// -- CONFIG: debug --
const DEBUG = false;

// -- CONFIG: server --
const SERVER_URL = "http://192.168.0.11:5000/buffer";

// -- CONFIG: sampling --
const SAMPLING_INTERVAL = 50;
const NOISE_FLOOR = 0.25; // Aqui hay un error, este valor era en base a experiencia de voltaje raw (observacion manual que se hizo, no estadística) y se lo esta usando luego de calcular el EMA
const ON_THRESHOLD = 0.30; // Hay que sacar y poner este valores basado en muestras y observación real
const OFF_THRESHOLD = 0.20; // Hay que sacar y poner este valores basado en muestras y observación real
const ALPHA = 0.2; // Hay que sacar y poner este valores basado en muestras y observación real
const PRE_BUFFER_SIZE = 20;

// -- CONFIG: event --
const EVENT_TIMEOUT = 2000; // Hay que sacar y poner este valores basado en muestras y observación real
const MAX_EVENT_DURATION = 35000;  // Hay que sacar y poner este valores basado en muestras y observación real
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
  // En este print estamos indicando que se finalizó el evento, pero que pasa si sending=true?
  //  igual se ha finalizado aunque sending=true? no creo
  print("🔶 Event finalized");

  if (!sending) {
    sending = true;
    sendNextChunk();
  }
}

// -- SAMPLING LOOP --
Timer.set(SAMPLING_INTERVAL, true, function() {
  try {
    let now = Date.now();
    let raw = readVoltage();
    filteredVoltage = applyEMA(filteredVoltage, raw, ALPHA);
    let voltage = applyNoiseFloor(filteredVoltage, NOISE_FLOOR);
    

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

        // Realmente sirve el EVENT_TIMEOUT? cual es su objetivo? realmente en algún caso va a usarse?
        // Realmente sirve el MAX_EVENT_DURATION? cual es su objetivo? realmente en algún caso va a usarse?
        // Recordemos que el http.post tiene igual un time out en su configuracion
        //  y cuando se excede este time out se aborta el evento
        // Si nos sirven como protección en algun caso donde posiblemente ayuden
        //   ahí podríamos dejarlos
        if (idle > EVENT_TIMEOUT || duration > MAX_EVENT_DURATION) {
          print("⏱️ Timeout | idle:", idle, "| duration:", duration);
          eventActive = false;
          finalizeEvent();
        // Realmente sirve el MAX_SAMPLES? cual es su objetivo? realmente en algún caso va a usarse?
        } else if (samples.length >= MAX_SAMPLES) {
          print("⚠️ Max samples reached");
          eventActive = false;
          finalizeEvent();
        }
        // Aqui quizá falta un else que igual fuerce el "finalize"? porque sino solo estará cerrando
        // cuando hay EVENT_TIMEOUT, MAX_EVENT_DURATION o MAX_SAMPLES, y si no se cumple ninguna
        // de esas condiciones sigue guardando samples y se supone que en este punto el newState cambió a off por lo que eso deberia ser sufiente para considerar el evento cerrado.. o me equivoco y quiza estoy olvidando algo?. Hay alguna razón para que esperemos a que
        //  si o si se espere que se cumplan las condiciones EVENT_TIMEOUT, MAX_EVENT_DURATION
        //  o MAX_SAMPLES? Quizá esta asi porque captura el trailing edge y que aprox son 40ticks mas que se guarda, pero es necesario?
        // Luego dijiste que "Los ticks del timeout window (40 ticks × 0V) van al CSV — es correcto para el análisis del trailing edge, pero el Analyzer necesita saber que esos ceros finales no son señal sino espera de timeout. No hay ningún marcador en el CSV que indique dónde terminó la señal activa y empezó el timeout. Esto afectará el análisis futuro." Sin embargo analiza si realmente vale la pena mantenerlos y como indicariamos eso al mandar datos al servidor.

        // dijiste esto:
        // - `MAX_EVENT_DURATION = 35000ms`
        //- `MAX_SAMPLES = 720`
        //- A 50ms/sample: 720 samples = 36000ms
        // se suponia que el MAX_SAMPLES deberia cerrar primero y en ultima instancia el MAX_EVENT_DURATION
        // pero incluso antes que todos ellos si el voltaje ya bajo a 0, o esta el state en off y bajo del OFF_THRESHOLD o el NOISE_FLOOR (habria que definir cual) entonces ya deberiamos dar por terminado el evento directo y no esperar nada mas
      }
    }

    rbPush(preBuffer, sample);
    signalState = newState;

  } catch(e) {
    print("💥 ERROR:", JSON.stringify(e));
  }
});

print("🚀 VHunter started | url:", SERVER_URL, "| interval:", SAMPLING_INTERVAL, "ms");

// Por otra parte necesitamos calcular bien cuales seran los valores de los siguiente basado en datos reales observados, quiza necesitaras definir otros algoritmos aparte de este (separados) para dicho propósito y guardar la informacion necesaria igual en archivos para analizarla?:
// NOISE_FLOOR
// ON_THRESHOLD
// OFF_THRESHOLD
// ALPHA
// EVENT_TIMEOUT
// MAX_EVENT_DURATION
