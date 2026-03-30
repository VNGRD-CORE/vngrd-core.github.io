/**
 * NeuralComposer.js — 8-track SonicPi-style step sequencer
 *
 * Left-hand PINCH fires armed block.
 * Left-hand STRIKE (fast downward snap) triggers live kick.
 * BPM adjustable via UI slider.
 *
 * The UI panel is injected into the DOM by this module.
 */

// 8 blocks, each with 16 steps
// step value: note index into SCALE, or -1 = rest, 'K' = kick, 'H' = hihat
const SCALE = [55, 73.42, 82.41, 110, 146.83, 164.81, 220, 293.66, 329.63, 440];

const BLOCKS_DEF = [
    { id:0, name:'KICK·808', color:'#ff3355', type:'kick',
      steps:[ 1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 1, 0 ] },
    { id:1, name:'HI·HAT',   color:'#ff8800', type:'hihat',
      steps:[ 0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0 ] },
    { id:2, name:'SUB·BASS', color:'#00ff88', type:'bass',
      steps:[ 0, 0, 3, 0,  0, 3, 0, 0,  3, 0, 0, 3,  0, 0, 3, 0 ],
      noteIdx: [0, 0, 0, 0, 0, 2, 0, 0, 4, 0, 0, 0, 0, 0, 2, 0] },
    { id:3, name:'PAD·I',    color:'#00f3ff', type:'pad',
      steps:[ 1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0 ],
      noteIdx:[5, 0, 0, 0,  0, 0, 0, 0,  7, 0, 0, 0,  0, 0, 0, 0] },
    { id:4, name:'ARP·I',    color:'#b000ff', type:'pluck',
      steps:[ 1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0 ],
      noteIdx:[4, 0, 5, 0,  6, 0, 7, 0,  8, 0, 7, 0,  6, 0, 5, 0] },
    { id:5, name:'LEAD',     color:'#ff00cc', type:'lead',
      steps:[ 0, 0, 0, 0,  1, 0, 0, 1,  0, 0, 0, 0,  1, 0, 0, 0 ],
      noteIdx:[0, 0, 0, 0,  8, 0, 0, 9,  0, 0, 0, 0,  7, 0, 0, 0] },
    { id:6, name:'ATMO·PAD', color:'#4455ff', type:'pad',
      steps:[ 1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0 ],
      noteIdx:[3, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0] },
    { id:7, name:'SUB·808',  color:'#ff6600', type:'sub',
      steps:[ 1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0 ] },
];

export class NeuralComposer {
    constructor(audioEngine) {
        this._ae      = audioEngine;
        this._bpm     = 120;
        this._step    = 0;
        this._armed   = 0;    // which block is armed for fire
        this._active  = new Set();  // set of block IDs currently looping

        // Internal clock
        this._tickInterval = null;
        this._nextTickTime = 0;
        this._schedAhead   = 0.08;  // schedule 80ms ahead
        this._lastSched    = -1;

        // UI
        this._panel  = null;
        this._stepEls = {};   // blockId → [stepEl × 16]
        this._armEls  = {};   // blockId → arm-button element
        this._running = false;
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._buildUI();
        this._startClock();
    }

    stop() {
        this._running = false;
        this._stopClock();
        if (this._panel) {
            this._panel.style.display = 'none';
        }
    }

    // ── Clock ─────────────────────────────────────────────────────────────────
    _startClock() {
        // Use setInterval for UI updates; Web Audio scheduling for precision
        const ctx = this._ae?.ctx;
        if (ctx) {
            this._nextTickTime = ctx.currentTime + 0.05;
            this._clockLoop();
        }
    }

    _clockLoop() {
        if (!this._running) return;
        const ctx = this._ae?.ctx;
        if (!ctx) return;

        const stepDur = 60 / this._bpm / 4; // 16th note duration

        while (this._nextTickTime < ctx.currentTime + this._schedAhead) {
            if (this._step !== this._lastSched) {
                this._schedStep(this._step, this._nextTickTime);
                this._lastSched = this._step;
            }
            this._step = (this._step + 1) % 16;
            this._nextTickTime += stepDur;
        }

        // Update UI cursor
        requestAnimationFrame(() => {
            this._updateCursor();
            this._clockLoop();
        });
    }

    _schedStep(step, time) {
        for (const id of this._active) {
            const block = BLOCKS_DEF[id];
            if (!block.steps[step]) continue;

            const noteIdx = block.noteIdx ? block.noteIdx[step] : 0;
            const freq    = SCALE[noteIdx] || SCALE[0];

            switch (block.type) {
                case 'kick':
                    this._ae.triggerKick(0.85);
                    break;
                case 'hihat':
                    this._ae.triggerHihat(0.5);
                    break;
                case 'bass':
                    this._ae.triggerSynth(freq * 0.5, 0.22, 0.55, 'pluck');
                    break;
                case 'pad':
                case 'atmo':
                    this._ae.triggerSynth(freq, 0.5, 0.32, 'pad');
                    break;
                case 'pluck':
                case 'lead':
                    this._ae.triggerSynth(freq, 0.14, 0.48, 'pluck');
                    break;
                case 'sub':
                    this._ae.triggerKick(1.0);
                    break;
            }
        }
    }

    _stopClock() {
        this._step = 0;
    }

    // ── Gesture interface ─────────────────────────────────────────────────────

    /** Call when left-hand pinch detected — fires armed block on/off toggle. */
    onPinch() {
        if (!this._running) return;
        const id = this._armed;
        if (this._active.has(id)) {
            this._active.delete(id);
        } else {
            this._active.add(id);
        }
        this._armNextBlock();
        this._refreshBlockUI(id);
    }

    /** Arm the next block in sequence (cycles around). */
    _armNextBlock() {
        this._armed = (this._armed + 1) % BLOCKS_DEF.length;
        this._refreshArmUI();
    }

    setBPM(bpm) {
        this._bpm = Math.max(40, Math.min(240, bpm));
        const el = document.getElementById('nc-bpm-val');
        if (el) el.textContent = Math.round(this._bpm);
    }

    // ── UI ────────────────────────────────────────────────────────────────────
    _buildUI() {
        if (this._panel) { this._panel.style.display = 'flex'; return; }

        const panel = document.createElement('div');
        panel.id = 'nc-panel';
        panel.innerHTML = `
          <div id="nc-header">
            <span id="nc-title">NEURAL COMPOSER</span>
            <span id="nc-bpm-ctrl">
              <button class="nc-bpm-btn" id="nc-bpm-dn">◀</button>
              <span id="nc-bpm-val">${this._bpm}</span> BPM
              <button class="nc-bpm-btn" id="nc-bpm-up">▶</button>
            </span>
          </div>
          <div id="nc-tracks"></div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // BPM buttons
        document.getElementById('nc-bpm-dn').onclick = () => this.setBPM(this._bpm - 5);
        document.getElementById('nc-bpm-up').onclick = () => this.setBPM(this._bpm + 5);

        const tracksEl = document.getElementById('nc-tracks');
        for (const block of BLOCKS_DEF) {
            const row   = document.createElement('div');
            row.className = 'nc-row';
            row.dataset.id = block.id;

            const armBtn = document.createElement('button');
            armBtn.className = 'nc-arm';
            armBtn.textContent = '◎';
            armBtn.style.color = block.color;
            armBtn.onclick = () => {
                this._armed = block.id;
                this._refreshArmUI();
            };
            this._armEls[block.id] = armBtn;

            const label = document.createElement('span');
            label.className = 'nc-label';
            label.textContent = block.name;
            label.style.color  = block.color;

            const grid = document.createElement('div');
            grid.className = 'nc-grid';
            this._stepEls[block.id] = [];

            for (let s = 0; s < 16; s++) {
                const cell = document.createElement('span');
                cell.className = 'nc-cell' + (block.steps[s] ? ' nc-cell-on' : '');
                cell.style.setProperty('--bclr', block.color);
                cell.onclick = () => {
                    block.steps[s] = block.steps[s] ? 0 : 1;
                    cell.classList.toggle('nc-cell-on', !!block.steps[s]);
                };
                grid.appendChild(cell);
                this._stepEls[block.id].push(cell);
            }

            row.appendChild(armBtn);
            row.appendChild(label);
            row.appendChild(grid);
            tracksEl.appendChild(row);
        }

        this._refreshArmUI();
    }

    _updateCursor() {
        const step = (this._step + 15) % 16; // one step behind (already advanced)
        for (const block of BLOCKS_DEF) {
            const cells = this._stepEls[block.id];
            if (!cells) continue;
            cells.forEach((c, i) => {
                c.classList.toggle('nc-cursor', i === step);
                c.classList.toggle('nc-active-row', this._active.has(block.id));
            });
        }
    }

    _refreshBlockUI(id) {
        const block = BLOCKS_DEF[id];
        const cells = this._stepEls[id];
        if (!cells) return;
        cells.forEach(c => c.classList.toggle('nc-active-row', this._active.has(id)));
    }

    _refreshArmUI() {
        for (const [id, btn] of Object.entries(this._armEls)) {
            btn.textContent = parseInt(id) === this._armed ? '●' : '◎';
            btn.classList.toggle('nc-armed', parseInt(id) === this._armed);
        }
    }
}
