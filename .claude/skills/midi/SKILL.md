---
name: midi
description: MIDI, Web MIDI API, controller mapping, MIDI learn, NoteOn, ControlChange, hardware controller, device enumeration
---

# VNGRD MIDI Skill

## Stack
- **Web MIDI API** — `navigator.requestMIDIAccess`
- **MIDI learn mode** — dynamic control mapping
- **Messages**: NoteOn / ControlChange
- **Reference file**: `dris_FIXED_MIDI.html`

## Critical Rule (from CLAUDE.md)
- MIDI **must** be initialized inside a **user gesture** (click event)
- Add a fallback message if `navigator.requestMIDIAccess` is denied or unavailable

## Correct Initialization Pattern
```js
document.getElementById('enable-midi-btn').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) {
    showFallback('Web MIDI not supported in this browser.');
    return;
  }
  try {
    const midi = await navigator.requestMIDIAccess({ sysex: false });
    setupMIDI(midi);
  } catch (err) {
    showFallback(`MIDI access denied: ${err.message}`);
  }
});
```

## Device Enumeration
```js
function setupMIDI(midi) {
  midi.inputs.forEach(input => {
    input.onmidimessage = handleMIDI;
  });
  midi.onstatechange = (e) => {
    if (e.port.type === 'input' && e.port.state === 'connected') {
      e.port.onmidimessage = handleMIDI;
    }
  };
}
```

## Message Handler
```js
function handleMIDI(msg) {
  const [status, note, velocity] = msg.data;
  const type = status & 0xf0;
  if (type === 0x90 && velocity > 0) {
    // NoteOn
  } else if (type === 0xB0) {
    // ControlChange — map CC number to parameter
  }
}
```

## MIDI Learn Pattern
```js
let learnTarget = null; // set to parameter name when in learn mode
function handleMIDI(msg) {
  if (learnTarget) {
    midiMap[learnTarget] = { status: msg.data[0], note: msg.data[1] };
    learnTarget = null;
    return;
  }
  // normal dispatch
}
```

## Debugging Checklist
- [ ] `requestMIDIAccess` called inside a click handler?
- [ ] Fallback shown if API unavailable or denied?
- [ ] Controller connected and recognized by OS before page load?
- [ ] Correct channel filtering? (`status & 0x0f` for channel)
- [ ] MIDI learn map persisted to localStorage?
