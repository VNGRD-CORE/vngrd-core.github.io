/**
 * NeuralComposer.js — 8-track × 16-step SonicPi-style pattern sequencer
 *
 * Architecture:
 *   - 8 tracks, each with a 16-step boolean pattern
 *   - Tone.js Transport drives step clock
 *   - AudioEngine.triggerSequencerNote() fires each active step
 *   - "Armed" track: left-hand pinch toggles the active step in the armed track
 *   - UI: renders #nc-grid (8 rows × 16 step buttons + track label)
 *
 * Public API:
 *   init(audioEngine)     — wire up and render grid
 *   start() / stop()      — transport control
 *   toggleStep(t, s)      — flip a step on/off
 *   armTrack(t)           — set armed track index
 *   toggleArmedStep()     — toggle current step in armed track (pinch gesture)
 *   loadPreset(idx)       — load a factory beat pattern
 *   dispose()
 */

const TRACK_DEFS = [
    { name: 'KICK',  note: 'C1',  color: '#ff3344' },
    { name: 'HAT',   note: 'F#4', color: '#00f3ff' },
    { name: 'METAL', note: 'A4',  color: '#b000ff' },
    { name: 'GLCH',  note: 'C3',  color: '#ff00cc' },
    { name: 'BASS',  note: 'A2',  color: '#ff8800' },
    { name: 'LEAD',  note: 'E4',  color: '#00ff88' },
    { name: 'FM',    note: 'D3',  color: '#ffff00' },
    { name: 'PAD',   note: 'G3',  color: '#88aaff' },
];

// Factory beat patterns (8 tracks × 16 steps)
const PRESETS = [
    // 0: 4-on-the-floor techno
    [
        [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],   // kick
        [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1],   // hat
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],   // metal
        [0,0,0,1, 0,0,0,1, 0,0,1,0, 0,0,0,1],   // glitch
        [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],   // bass
        [0,0,0,0, 0,1,0,0, 0,0,0,1, 0,0,0,0],   // lead
        [0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,1,0],   // fm
        [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],   // pad
    ],
    // 1: trap hi-hat storm
    [
        [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        [1,1,0,1, 1,0,1,1, 1,0,1,1, 0,1,1,1],
        [0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
        [0,0,1,0, 0,0,0,0, 0,1,0,0, 0,0,0,1],
        [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,1,0,0],
        [0,0,0,1, 0,0,1,0, 0,0,0,0, 1,0,0,0],
        [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    ],
    // 2: IDM breakcore
    [
        [1,0,1,1, 0,0,1,0, 1,1,0,0, 1,0,1,0],
        [0,1,0,0, 1,1,0,1, 0,0,1,1, 0,1,0,1],
        [1,0,0,1, 0,1,0,0, 1,0,0,1, 0,0,1,0],
        [0,0,1,0, 1,0,0,1, 0,1,0,0, 1,0,0,1],
        [1,0,0,0, 0,0,1,0, 0,0,0,1, 0,0,0,0],
        [0,1,0,1, 0,0,0,0, 1,0,1,0, 0,0,0,1],
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,1,0,0],
        [1,0,1,0, 0,1,0,1, 0,0,1,0, 1,0,0,1],
    ],
];

export class NeuralComposer {
    constructor() {
        this._ae       = null;
        this._bpm      = 128;
        this._step     = 0;           // current step 0..15
        this._playing  = false;
        this._armed    = 0;           // armed track index

        // 8 tracks × 16 steps
        this._patterns = Array.from({ length: 8 }, () => new Uint8Array(16));

        this._seq      = null;        // Tone.Sequence
        this._gridEl   = null;
        this._stepLeds = [];          // [track][step] → DOM element
    }

    /**
     * @param {AudioEngine} ae
     */
    init(ae) {
        this._ae = ae;
        this.loadPreset(0);
        this._renderGrid();
        this._buildSequencer();
        return this;
    }

    // ── Sequencer ─────────────────────────────────────────────────────────────

    _buildSequencer() {
        const Tone = window.Tone;
        if (!Tone) return;

        Tone.getTransport().bpm.value = this._bpm;

        this._seq = new Tone.Sequence((time, step) => {
            this._step = step;
            this._tickStep(step, time);
            this._highlightStep(step);
        }, [...Array(16).keys()], '16n');
    }

    _tickStep(step, time) {
        for (let t = 0; t < 8; t++) {
            if (!this._patterns[t][step]) continue;
            const def = TRACK_DEFS[t];
            // Schedule slightly ahead of time for accuracy
            window.Tone?.getTransport().scheduleOnce(() => {
                this._ae?.triggerSequencerNote(t, def.note, 0.85);
            }, time);
        }
    }

    start() {
        if (this._playing) return;
        this._playing = true;
        this._seq?.start(0);
        window.Tone?.getTransport().start();
        document.getElementById('nc-play-btn')?.classList.add('nc-active');
        document.getElementById('nc-status')?.setAttribute('data-playing', '1');
    }

    stop() {
        if (!this._playing) return;
        this._playing = false;
        this._seq?.stop();
        // Don't stop global transport — other Tone nodes may use it
        this._step = 0;
        this._highlightStep(-1);
        document.getElementById('nc-play-btn')?.classList.remove('nc-active');
        document.getElementById('nc-status')?.removeAttribute('data-playing');
    }

    toggleTransport() {
        this._playing ? this.stop() : this.start();
    }

    // ── Patterns ──────────────────────────────────────────────────────────────

    toggleStep(track, step) {
        this._patterns[track][step] ^= 1;
        this._updateLed(track, step);
    }

    /** Arm a track for pinch-gesture toggling */
    armTrack(t) {
        this._armed = t;
        this._updateArmedHighlight();
    }

    /** Left-hand pinch: toggle the current step in the armed track */
    toggleArmedStep() {
        this.toggleStep(this._armed, this._step);
    }

    loadPreset(idx) {
        const p = PRESETS[Math.min(idx, PRESETS.length - 1)];
        for (let t = 0; t < 8; t++) {
            for (let s = 0; s < 16; s++) {
                this._patterns[t][s] = p[t][s];
            }
        }
        // Refresh LEDs if grid is already rendered
        if (this._stepLeds.length) {
            for (let t = 0; t < 8; t++) {
                for (let s = 0; s < 16; s++) this._updateLed(t, s);
            }
        }
    }

    setBPM(bpm) {
        this._bpm = Math.max(40, Math.min(300, bpm));
        try { window.Tone?.getTransport().bpm.rampTo(this._bpm, 0.1); } catch (_) {}
        const el = document.getElementById('nc-bpm-val');
        if (el) el.textContent = this._bpm;
    }

    // ── Grid UI ───────────────────────────────────────────────────────────────

    _renderGrid() {
        const wrap = document.getElementById('nc-grid');
        if (!wrap) return;
        this._gridEl = wrap;
        this._stepLeds = [];

        let html = '';
        for (let t = 0; t < 8; t++) {
            const def = TRACK_DEFS[t];
            html += `<div class="nc-row" data-track="${t}">`;
            html += `<button class="nc-track-lbl" data-track="${t}" style="--tc:${def.color}"
                        onclick="window._NC?.armTrack(${t})">${def.name}</button>`;
            for (let s = 0; s < 16; s++) {
                const on   = this._patterns[t][s] ? ' nc-on' : '';
                const bar  = s % 4 === 0 ? ' nc-bar' : '';
                html += `<button class="nc-step${on}${bar}" data-t="${t}" data-s="${s}"
                            style="--tc:${def.color}"
                            onclick="window._NC?.toggleStep(${t},${s})"></button>`;
            }
            html += '</div>';
        }
        wrap.innerHTML = html;

        // Cache LED references
        for (let t = 0; t < 8; t++) {
            this._stepLeds[t] = [];
            for (let s = 0; s < 16; s++) {
                this._stepLeds[t][s] = wrap.querySelector(
                    `.nc-step[data-t="${t}"][data-s="${s}"]`
                );
            }
        }

        this._updateArmedHighlight();
    }

    _updateLed(track, step) {
        const el = this._stepLeds[track]?.[step];
        if (!el) return;
        el.classList.toggle('nc-on', !!this._patterns[track][step]);
    }

    _highlightStep(step) {
        // Remove previous playhead
        this._gridEl?.querySelectorAll('.nc-play').forEach(el => el.classList.remove('nc-play'));
        if (step < 0) return;
        for (let t = 0; t < 8; t++) {
            this._stepLeds[t]?.[step]?.classList.add('nc-play');
        }
    }

    _updateArmedHighlight() {
        this._gridEl?.querySelectorAll('.nc-track-lbl').forEach((el, t) => {
            el.classList.toggle('nc-armed', t === this._armed);
        });
    }

    dispose() {
        this.stop();
        try { this._seq?.dispose(); } catch (_) {}
        this._seq     = null;
        this._ae      = null;
        this._gridEl  = null;
        this._stepLeds = [];
    }
}
