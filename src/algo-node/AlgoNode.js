/**
 * AlgoNode.js — VNGRD_ALGO_NODE: Tidal-style live-code sequencer + MIDI CC bridge.
 *
 * Completely isolated from existing audio triggers and sampler logic.
 * Audio is routed through its own Tone.js bus (Filter → Volume → Destination).
 *
 * Syntax:
 *   kd hh sd hh      evenly-spaced steps over 1 measure
 *   [hh hh]          group: subdivided (twice as fast within its step slot)
 *   hh*4             ratchet: 4 rapid hits within one step slot
 *   ~                rest (skip the step)
 *
 * CC mapping (command 176 / 0xB0):
 *   CC 1  → LPF sweep on Algo bus  (200 Hz – 20 kHz)
 *   CC 2  → Glitch/stutter density (0 → 85% random skip rate)
 *
 * Ctrl+Enter / Cmd+Enter → evaluate & loop.
 */

'use strict';

// ─── Instrument token → voice alias table ───────────────────────────────────
const VOICE_MAP = {
    kd: 'kick',  bd: 'kick',
    sd: 'snare', sn: 'snare',
    hh: 'hihat', ch: 'hihat',
    oh: 'openhat',
    cp: 'clap',  cl: 'clap',
};

// ─── AlgoNode ────────────────────────────────────────────────────────────────
class _AlgoNode {
    constructor() {
        this._ready        = false;   // DOM wired up
        this._audioReady   = false;   // Tone.js chain built
        this._visible      = false;

        // Drag state
        this._drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };

        // Tone.js nodes (built lazily on first Ctrl+Enter)
        this._filter  = null;   // Tone.Filter  (CC1 target)
        this._vol     = null;   // Tone.Volume
        this._kick    = null;   // MembraneSynth
        this._snare   = null;   // NoiseSynth
        this._hihat   = null;   // MetalSynth
        this._openhat = null;   // MetalSynth (longer decay)
        this._clap    = null;   // NoiseSynth (pink)
        this._part    = null;   // Tone.Part (active loop)

        // Runtime state
        this._glitchDensity    = 0;     // 0–1, CC2 target
        this._midiReady        = false;
        this._ccDisplayTimer   = null;

        // DOM refs (filled in _wire())
        this._hud       = null;
        this._editor    = null;
        this._ccDisplay = null;
        this._midiLabel = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    toggle() {
        if (!this._ready) this._wire();
        this._visible = !this._visible;
        this._hud.style.display = this._visible ? 'flex' : 'none';
    }

    /** Evaluate the current editor contents and restart the loop. */
    async evaluate() {
        if (!this._ready) this._wire();
        try {
            await this._buildAudio();
            const text   = this._editor.value;
            const events = this._parsePattern(text);
            this._startLoop(events);
            this._flashBorder();
        } catch (err) {
            console.error('[AlgoNode] evaluate error:', err);
        }
    }

    /** Stop Transport and clear the loop. */
    stop() {
        if (this._part) {
            this._part.stop();
            this._part.dispose();
            this._part = null;
        }
        if (window.Tone) Tone.Transport.stop();
    }

    // ── DOM Wiring ────────────────────────────────────────────────────────────

    _wire() {
        this._ready     = true;
        this._hud       = document.getElementById('algo-node-hud');
        this._editor    = document.getElementById('algo-node-editor');
        this._ccDisplay = document.getElementById('algo-node-cc-display');
        this._midiLabel = document.getElementById('algo-node-midi-dot');

        // Keyboard shortcut: Ctrl/Cmd+Enter
        this._editor.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.evaluate();
            }
        });

        // Dragging via header
        this._initDrag();

        // MIDI CC bridge
        this._initMIDI();
    }

    // ── Tone.js Audio Chain ───────────────────────────────────────────────────

    async _buildAudio() {
        if (this._audioReady) return;
        this._audioReady = true;

        const T = window.Tone;
        await T.start();

        // Bus: all synths → filter → vol → main out
        this._filter = new T.Filter({ frequency: 20000, type: 'lowpass' }).toDestination();
        this._vol    = new T.Volume(-6).connect(this._filter);

        // Kick — MembraneSynth
        this._kick = new T.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 6,
            envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.12 }
        }).connect(this._vol);

        // Snare — white NoiseSynth
        this._snare = new T.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 }
        }).connect(this._vol);

        // Hi-hat — closed (short decay)
        this._hihat = new T.MetalSynth({
            frequency: 400,
            envelope: { attack: 0.001, decay: 0.07, release: 0.01 },
            harmonicity: 5.1,
            modulationIndex: 32,
            resonance: 4000,
            octaves: 1.5
        }).connect(this._vol);

        // Open hi-hat — longer decay
        this._openhat = new T.MetalSynth({
            frequency: 400,
            envelope: { attack: 0.001, decay: 0.38, release: 0.12 },
            harmonicity: 5.1,
            modulationIndex: 32,
            resonance: 4000,
            octaves: 1.5
        }).connect(this._vol);

        // Clap — pink noise
        this._clap = new T.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.005, decay: 0.09, sustain: 0, release: 0.03 }
        }).connect(this._vol);
    }

    // ── Sequencer ─────────────────────────────────────────────────────────────

    _startLoop(events) {
        if (this._part) {
            this._part.stop();
            this._part.dispose();
            this._part = null;
        }

        if (events.length === 0) return;

        this._part = new Tone.Part((time, ev) => {
            // Glitch/stutter: randomly drop events
            if (this._glitchDensity > 0 && Math.random() < this._glitchDensity) return;
            this._trigger(ev.note, time);
        }, events);

        this._part.loop    = true;
        this._part.loopEnd = '1m';
        this._part.start(0);

        if (Tone.Transport.state !== 'started') {
            Tone.Transport.bpm.value = 120;
            Tone.Transport.start('+0.05');
        }
    }

    _trigger(note, time) {
        const voice = VOICE_MAP[note] || note;
        switch (voice) {
            case 'kick':    this._kick.triggerAttackRelease('C1', '8n', time);  break;
            case 'snare':   this._snare.triggerAttackRelease('16n', time);      break;
            case 'hihat':   this._hihat.triggerAttackRelease('32n', time);      break;
            case 'openhat': this._openhat.triggerAttackRelease('16n', time);    break;
            case 'clap':    this._clap.triggerAttackRelease('16n', time);       break;
            default: break; // unknown token → silent
        }
    }

    // ── Tidal-Style Parser ────────────────────────────────────────────────────

    /**
     * Parse multi-line pattern text into a flat array of Tone.Part events.
     * Each line is an independent rhythmic layer; all layers share 1 measure.
     *
     * @param  {string} text
     * @returns {{ time: string, note: string }[]}
     */
    _parsePattern(text) {
        const lines = text.split('\n');
        const all   = [];
        for (const raw of lines) {
            const line = raw.trim();
            if (line.length === 0 || line.startsWith('--') || line.startsWith('//')) continue;
            all.push(...this._parseLine(line));
        }
        return all;
    }

    _parseLine(line) {
        const tokens  = this._tokenize(line);
        const events  = [];
        const stepDur = 1 / tokens.length; // fraction of 1 measure per step
        tokens.forEach((tok, i) => {
            this._expandToken(tok, i * stepDur, stepDur, events);
        });
        return events;
    }

    /**
     * Tokenize one line into an array of { type, content } objects.
     * Handles nested [...] groups.
     */
    _tokenize(line) {
        const tokens = [];
        let i = 0;
        while (i < line.length) {
            const ch = line[i];
            if (ch === ' ' || ch === '\t') { i++; continue; }
            if (ch === '[') {
                // Walk forward, tracking depth, to find matching ]
                let depth = 1, j = i + 1;
                while (j < line.length && depth > 0) {
                    if (line[j] === '[') depth++;
                    if (line[j] === ']') depth--;
                    j++;
                }
                tokens.push({ type: 'group', content: line.slice(i + 1, j - 1) });
                i = j;
            } else {
                let j = i;
                while (j < line.length && line[j] !== ' ' && line[j] !== '\t' &&
                       line[j] !== '[' && line[j] !== ']') j++;
                tokens.push({ type: 'token', content: line.slice(i, j) });
                i = j;
            }
        }
        return tokens;
    }

    /**
     * Recursively expand a token into timed events.
     *
     * @param {{ type: string, content: string }} tok
     * @param {number} start   fractional measure position (0–1)
     * @param {number} dur     fractional measure duration for this slot
     * @param {Array}  events  accumulator
     */
    _expandToken(tok, start, dur, events) {
        if (tok.type === 'group') {
            // Subdivide the inner tokens evenly within this slot
            const inner  = this._tokenize(tok.content);
            const subDur = dur / inner.length;
            inner.forEach((sub, i) => {
                this._expandToken(sub, start + i * subDur, subDur, events);
            });
            return;
        }

        const content = tok.content;
        if (!content || content === '~') return; // rest

        // Ratchet syntax: note*N
        const rm = content.match(/^([a-z]+)\*(\d+)$/i);
        if (rm) {
            const note   = rm[1];
            const count  = Math.max(1, parseInt(rm[2], 10));
            const subDur = dur / count;
            for (let i = 0; i < count; i++) {
                events.push({ time: this._toMeasureTime(start + i * subDur), note });
            }
            return;
        }

        events.push({ time: this._toMeasureTime(start), note: content });
    }

    /**
     * Convert a fractional measure position to a Tone.js time string.
     * e.g. 0.25 → "0.25m"
     */
    _toMeasureTime(frac) {
        return frac.toFixed(8).replace(/\.?0+$/, '') + 'm';
    }

    // ── Visual Feedback ───────────────────────────────────────────────────────

    _flashBorder() {
        if (!this._hud) return;
        this._hud.classList.add('algo-node-flash');
        setTimeout(() => this._hud.classList.remove('algo-node-flash'), 60);
    }

    // ── MIDI CC Bridge ────────────────────────────────────────────────────────

    async _initMIDI() {
        if (!navigator.requestMIDIAccess) {
            this._setMIDILabel('[ MIDI: NO API ]', false);
            return;
        }
        try {
            const access = await navigator.requestMIDIAccess({ sysex: false });

            const bind = input => { input.onmidimessage = msg => this._onCC(msg); };

            access.inputs.forEach(bind);
            if (access.inputs.size > 0) this._setMIDILabel('[ MIDI: CONNECTED ]', true);

            access.onstatechange = e => {
                if (e.port.type === 'input' && e.port.state === 'connected') {
                    bind(e.port);
                    this._setMIDILabel('[ MIDI: CONNECTED ]', true);
                }
            };
        } catch (err) {
            this._setMIDILabel('[ MIDI: DENIED ]', false);
        }
    }

    _onCC(msg) {
        const [status, cc, value] = msg.data;
        if ((status & 0xF0) !== 0xB0) return; // Only Control Change (176)

        const norm = value / 127;

        if (cc === 1) {
            // CC1 → LPF sweep: 200 Hz – 20 kHz
            const freq = 200 + norm * 19800;
            if (this._filter) this._filter.frequency.rampTo(freq, 0.04);
        } else if (cc === 2) {
            // CC2 → Glitch/stutter density 0 – 85 %
            this._glitchDensity = norm * 0.85;
        }

        // Show raw CC value in editor corner
        this._showCC(cc, value);
    }

    _setMIDILabel(text, connected) {
        if (!this._midiLabel) return;
        this._midiLabel.textContent = text;
        this._midiLabel.style.color = connected
            ? '#00FF41'
            : 'rgba(0,255,65,0.3)';
    }

    _showCC(cc, value) {
        if (!this._ccDisplay) return;
        this._ccDisplay.textContent = `CC${cc}: ${value}`;
        this._ccDisplay.style.opacity = '1';
        clearTimeout(this._ccDisplayTimer);
        this._ccDisplayTimer = setTimeout(() => {
            this._ccDisplay.style.opacity = '0';
        }, 1400);
    }

    // ── Drag ─────────────────────────────────────────────────────────────────

    _initDrag() {
        const hud    = this._hud;
        const header = hud && hud.querySelector('.algo-node-header');
        if (!header) return;

        header.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            const rect = hud.getBoundingClientRect();
            this._drag = {
                active: true,
                startX: e.clientX, startY: e.clientY,
                origX:  rect.left,  origY:  rect.top,
            };
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!this._drag.active) return;
            const dx = e.clientX - this._drag.startX;
            const dy = e.clientY - this._drag.startY;
            hud.style.left   = (this._drag.origX + dx) + 'px';
            hud.style.top    = (this._drag.origY + dy) + 'px';
            hud.style.right  = 'auto';
            hud.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            this._drag.active = false;
        });
    }
}

// ─── Singleton export ────────────────────────────────────────────────────────
const AlgoNode = new _AlgoNode();
window.AlgoNode = AlgoNode;
