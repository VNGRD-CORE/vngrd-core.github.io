// ═══════════════════════════════════════════════════════════════
// GHOST TERMINAL — Sentient AI Companion v5
// Extracted from main.js — depends on $, APP (defined in main.js)
// ═══════════════════════════════════════════════════════════════

var _ghostLastMsg = '';
var _ghostSysLastAt = 0;
function ghostLog(msg, type = 'cmd') {
    var dedupKey = type + '|' + msg;
    if (dedupKey === _ghostLastMsg && type !== 'user') return;
    _ghostLastMsg = dedupKey;
    if (type !== 'user' && type !== 'success') {
        var now = Date.now();
        if (now - _ghostSysLastAt < 5000 && type === 'cmd') return;
        _ghostSysLastAt = now;
    }
    const term = $('ghost-terminal');
    const body = $('ghost-terminal-body');
    if (term && term.classList.contains('active')) {
        clearTimeout(window._ghostCollapseTimer);
        term.classList.add('expanded');
        window._ghostCollapseTimer = setTimeout(function() {
            var inp = $('ghost-input');
            if (inp && !inp.value.trim() && document.activeElement !== inp) {
                term.classList.remove('expanded');
            }
        }, type === 'ai' ? 9000 : 5000);
    }
    const ts = new Date().toTimeString().split(' ')[0].substring(0, 5);
    const line = document.createElement('div');
    line.className = 'ghost-log';
    line.innerHTML = '<span class="ts">' + ts + '</span><span class="' + type + '">' + msg + '</span>';
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    if (body.children.length > 80) body.firstChild.remove();
}

function ghostInit() {
    let dragging = false, startX, startY, elX, elY;
    const header = $('ghost-terminal-header');
    const terminal = $('ghost-terminal');
    header.addEventListener('mousedown', e => {
        dragging = true; startX = e.clientX; startY = e.clientY;
        elX = terminal.offsetLeft; elY = terminal.offsetTop;
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        terminal.style.left = (elX + e.clientX - startX) + 'px';
        terminal.style.top = (elY + e.clientY - startY) + 'px';
        terminal.style.right = 'auto'; terminal.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
}

function toggleGhost() {
    const term = $('ghost-terminal');
    const isActive = term.classList.contains('active');
    if (isActive) {
        term.classList.remove('active', 'expanded');
        term.style.display = '';
        clearTimeout(window._ghostCollapseTimer);
    } else {
        term.style.display = 'flex';
        term.classList.add('active');
        $('ghost-input').focus();
    }
}

$('ghost-input').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); toggleGhost(); return; }
    if ((e.key === 'g' || e.key === 'G') && e.target.value === '') { e.preventDefault(); toggleGhost(); return; }
    if (e.key === 'Enter') { const val = e.target.value.trim(); if (val) processGhostCommand(val); e.target.value = ''; }
});

window._ghostCollapseTimer = null;
function _ghostScheduleCollapse(delay) {
    clearTimeout(window._ghostCollapseTimer);
    window._ghostCollapseTimer = setTimeout(function() {
        var inp = $('ghost-input');
        if (inp && !inp.value.trim() && document.activeElement !== inp) {
            $('ghost-terminal').classList.remove('expanded');
        }
    }, delay || 6000);
}
$('ghost-input').addEventListener('input', function() {
    var term = $('ghost-terminal');
    clearTimeout(window._ghostCollapseTimer);
    if (this.value.trim()) {
        term.classList.add('expanded');
    } else {
        _ghostScheduleCollapse(3000);
    }
});
$('ghost-input').addEventListener('focus', function() {
    clearTimeout(window._ghostCollapseTimer);
});
$('ghost-input').addEventListener('blur', function() {
    if (!this.value.trim()) _ghostScheduleCollapse(4000);
});

// ═══════════════════════════════════════════════════════════════
// GHOST AI — CONTEXTUAL KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

var GHOST = {
    getContext: function() {
        return {
            hasMedia: APP.media.queue.length > 0,
            mediaCount: APP.media.queue.length,
            hasAudio: APP.audio.isPlaying,
            hasCamera: !!APP.camera.stream,
            isLive: APP.state.isLive,
            isRecording: APP.state.isRecording,
            hasMidi: APP.status.isMidiActive,
            hasWallet: !!(APP.wallet && APP.wallet.address),
            hasGuest: !!(APP.guest && APP.guest.isActive),
            theme: APP.state.theme || 'cyan',
            fps: APP.render.fps,
            seismic: APP.vj.rumbleEnabled,
            party: APP.vj.uiReactivity,
            isShooting: !!(APP.shooting && APP.shooting.active),
            glassIntegrity: typeof APP.glassIntegrity !== 'undefined' ? APP.glassIntegrity : 100,
            uptime: $('uptime') ? $('uptime').textContent : '00:00:00',
            hour: new Date().getHours(),
            isCycling: APP.state.isCycle
        };
    },

    tips: [
        { condition: function(ctx) { return !ctx.hasMedia && !ctx.hasAudio && !ctx.hasCamera; },
          msgs: [
            'Your canvas is empty. Load some visuals! Click LOAD_MEDIA in the sidebar or type "load" to scan a folder.',
            'Tip: Drag & drop images or videos onto the screen to add them to your media deck.',
            'Try loading some music first — click the audio button in MEDIA_DECK, then arm SEISMIC to feel the bass shake your screen.',
            'New here? Start by loading media (images/videos) into the deck, then add music. The magic happens when they combine.',
            'Pro tip: Type "load" to scan a whole folder of visuals at once. Way faster than loading one by one.'
          ]
        },
        { condition: function(ctx) { return ctx.hasMedia && !ctx.hasAudio; },
          msgs: [
            'Visuals loaded, but no audio yet. Load a track and watch the reactivity come alive!',
            'Try adding music — then type "seismic" to make the whole screen shake with the bass.',
            'Your deck has ' + 0 + ' items. Add audio and type "party" for autonomous visual morphing on every beat.',
            'Tip: With music playing, the VU meter lights up, bass analysis kicks in, and FX become audio-reactive.'
          ],
          dynamic: function(ctx) { return 'Your deck has ' + ctx.mediaCount + ' items. Load audio and the console comes alive.'; }
        },
        { condition: function(ctx) { return ctx.hasAudio && !ctx.seismic; },
          msgs: [
            'Music detected! Type "seismic" to arm bass-reactive screen shake. Every kick drum shakes the viewport.',
            'Audio is playing. Try "party" to enable autonomous mode — logos morph, themes shift, FX trigger on beats.',
            'Tip: The REACTIVITY section has wild FX. Try X-RAY, VOID, or LUCY for real-time visual processing.',
            'Your audio feeds the FFT analyzer. Arm SEISMIC + load some visuals for a full VJ experience.'
          ]
        },
        { condition: function(ctx) { return ctx.seismic && !ctx.party && ctx.hasAudio; },
          msgs: [
            'Seismic is rumbling. Now type "party" for full autonomous mode — the console becomes self-aware.',
            'Bass is shaking. Try the REACTIVITY FX: X-RAY scans, VOID crushes to grayscale, LUCY is full hallucination.',
            'Type "crush" for an instant RGB explosion, "stutter" for a trails burst, or "invert" for color flip.'
          ]
        },
        { condition: function(ctx) { return ctx.hasCamera && !ctx.isLive; },
          msgs: [
            'Camera is hot. Hit GO_LIVE for a cinematic 3-2-1 countdown. Audio ducks automatically.',
            'Your camera feed is ready. Go live, then your stream becomes the canvas source. Record it with REC.',
            'Tip: Going live overrides the media deck on the canvas. Your camera becomes the broadcast source.'
          ]
        },
        { condition: function(ctx) { return ctx.isLive && !ctx.isRecording; },
          msgs: [
            'You\'re LIVE! Hit REC to capture your broadcast. Everything on the canvas gets recorded.',
            'Live broadcast active. Try the Lower Third — click GUEST, TRACK, or BREAKING for overlay graphics.',
            'Tip: While live, you can still trigger FX. Try "crush" or "shatter" for dramatic transitions.'
          ]
        },
        { condition: function(ctx) { return ctx.isRecording; },
          msgs: [
            'Recording in progress. Everything on canvas is being captured. Use FX for dramatic moments.',
            'REC is hot. Trigger "shatter" for glass fractures or "crush" for an RGB explosion during the recording.'
          ]
        },
        { condition: function(ctx) { return ctx.hasMidi; },
          msgs: [
            'MIDI controller detected. Notes 36-39 trigger FX impacts. Notes 40-47 switch themes. CC1 controls brightness.',
            'MIDI is live. Use MIDI LEARN to map any knob/fader to any control. Click a button, then move a MIDI control.',
            'Pro tip: Map your drum pads to FX triggers. Pad 1=Stutter, Pad 2=Invert, Pad 3=Crush, Pad 4=Seismic.'
          ]
        },
        { condition: function(ctx) { return ctx.hasGuest; },
          msgs: [
            'Guest connected via P2P! Their stream appears in your canvas priority chain. Use Lower Third to label them.',
            'P2P call active. UI sync sends your lower thirds and logos to the guest in real-time.'
          ]
        },
        { condition: function(ctx) { return ctx.hasWallet; },
          msgs: [
            'Wallet connected. Click SCAN_WALLET_ASSETS to browse and summon assets onto the canvas.',
            'Assets appear in the vault at the bottom — click any thumbnail to bring it onto the canvas.'
          ]
        },
        { condition: function() { return true; },
          msgs: [
            'Press SPACE to rotate through your media deck. Hold it down for rapid-fire switching.',
            'Press H for instant fullscreen. Press G to toggle this terminal. ESC is panic reset.',
            'Connect a MIDI controller and this whole console becomes a performance instrument.',
            'Every element on canvas is draggable. Drag your station bug, 2D logo, or 3D logo to reposition them.',
            'Two-finger pinch on the canvas (or Ctrl+scroll) resizes logos and bugs in real-time.',
            'Type "theme purple" or "theme gold" to change the entire UI color scheme. 6 themes available.',
            'The AI_INJECTION section generates images from text. Type a prompt and hit GENERATE to inject AI art onto your canvas.',
            'Lower Thirds sync to P2P guests. Change text on your side, it appears on theirs instantly.',
            'VHS mode adds analog scan lines and color bleeding. Toggle it in the sidebar for that retro look.',
            'Type "shatter" for a glass-fracture explosion across the screen. Pure cinema.',
            'Connect a MIDI controller and this whole console becomes a performance instrument.',
            'The IDENTITY section lets you set a station name, upload a 2D logo, or load a 3D model that spins on canvas.',
            'Session Lab lets you save/load entire sessions. Export as .vgd file to share your complete setup.',
            'Type "crypto" to fetch live BTC/ETH/SOL prices into the news ticker.',
            'Audio modes: STEREO is flat, 3D_SPATIAL uses HRTF for immersive positioning, DOLBY adds compression + EQ.',
            'The SYSTEM_FAILURE button triggers 5 seconds of pure chaos — inverts, flashes, color shifts. Use wisely.',
            'You can load audio AND video. Video audio feeds the FFT analyzer just like music tracks.',
            'Type "stutter" for a motion-trails burst, "invert" for instant color flip, "crush" for maximum RGB split.',
            'The canvas captures at native resolution. Record at 4K for production-quality output.',
            'Night theme (type "theme night") is perfect for low-light environments. Minimal UI glow.',
            'SHOOT mode: click the SHOOT button in Reactivity to arm a machine gun crosshair. Each click fractures the glass.',
            'Glass Integrity drains as you shoot. Deplete it completely to trigger TERMINAL SHATTER — full screen explosion.',
            'The SFX pads in the lower panel are fully customisable. Click the gear icon on any pad to change sound + linked FX.',
            'PUNCH FX now oscillates like a tweeter — the canvas punches toward you then snaps back on every kick drum hit.',
            'Arm PUNCH, load some music, and watch the canvas physically push and pull with the bass. Zero latency.'
          ]
        }
    ],

    getTip: function() {
        var ctx = this.getContext();
        for (var i = 0; i < this.tips.length - 1; i++) {
            if (this.tips[i].condition(ctx)) {
                if (this.tips[i].dynamic) return this.tips[i].dynamic(ctx);
                var msgs = this.tips[i].msgs;
                return msgs[Math.floor(Math.random() * msgs.length)];
            }
        }
        var gen = this.tips[this.tips.length - 1].msgs;
        return gen[Math.floor(Math.random() * gen.length)];
    },

    understand: function(input) {
        var c = input.toLowerCase().trim();

        if (c.match(/slit.?scan\s+(off|stop|disable)|slitscan\s+(off|stop|disable)/)) return 'vb_b_off';
        if (c.match(/(luma.?bloom|bloom)\s+(off|stop|disable)/)) return 'vb_b_off';
        if (c.match(/(dither.?luxe?|dither)\s+(off|stop|disable)/)) return 'vb_b_off';
        if (c.match(/caustics?\s+(off|stop|disable)/)) return 'vb_b_off';
        if (c.match(/(ghost.?echo|ghostecho)\s+(off|stop|disable)/)) return 'vb_b_off';
        if (c.match(/(spectral.?mosh|mosh|spectral)\s+(off|stop|disable)/)) return 'vb_b_off';
        if (c.match(/slit.?scan|slitscan/)) return 'vb_slit_scan';
        if (c.match(/luma.?bloom/)) return 'vb_luma_bloom';
        if (c.match(/dither|dither.?luxe/)) return 'vb_dither_luxe';
        if (c.match(/caustic/)) return 'vb_caustics';
        if (c.match(/ghost.?echo|ghostecho|ghost echo/)) return 'vb_ghost_echo';
        if (c.match(/spectral.?mosh|mosh/)) return 'vb_spectral_mosh';
        if (c.match(/bank.?b|gpu.?fx|shader|bank b fx/)) return 'vb_help';

        if (c.match(/^(hi|hello|hey|yo|sup|ciao|hola|bonjour|salut|oi|what'?s up|howdy|greetings?)$/)) return 'greet';
        if (c.match(/help|what can|how do|commands?|guide|tutorial|show me|teach/)) return 'help';
        if (c.match(/status|sys|system|stats?|info|diagnostics?/)) return 'status';
        if (c.match(/^(tip|advice|suggest|idea|what should|bored|nothing|idk|hmm|now what)/)) return 'tip';

        if (c.match(/load|open|import|folder|browse|add media|add visual/)) return 'load';
        if (c.match(/music|audio|song|track|sound|playlist|beat/)) return 'audio_help';
        if (c.match(/play|pause|resume|stop playing/)) return 'play';
        if (c.match(/next|skip|forward/)) return 'next';
        if (c.match(/prev|back|rewind/)) return 'prev';
        if (c.match(/rotate|cycle|shuffle|auto.?play/)) return 'cycle';
        if (c.match(/eject|remove|delete|clear deck/)) return 'eject';
        if (c.match(/queue|deck|media list|what.?s loaded|how many/)) return 'queue';

        if (c.match(/camera|cam|webcam|init cam/)) return 'camera_help';
        if (c.match(/go live|start live|broadcast|stream|countdown/)) return 'golive_help';
        if (c.match(/^(record|rec|start rec(ording)?|stop rec(ording)?)$/)) return 'record_toggle';
        if (c.match(/record|rec|capture/)) return 'record_help';
        if (c.match(/kill|shutdown|stop cam|end cam/)) return 'kill_help';

        if (c.match(/^(void|grayscale|grey|gray|desaturate)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(lucy|hallucin|psychedelic|trippy|acid)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(xray|x-ray|scan|skeleton)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(tear|rip|displace)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(punch|hit|impact)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(nvg|night.?vision|thermal)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(vhs|retro|analog|tape)\s+(off|stop|disable)$/)) return 'fx_off';
        if (c.match(/^(shatter|break|glass|fracture|smash)$/)) return 'shatter';
        if (c.match(/^(crush|rgb|split|glitch)$/)) return 'crush';
        if (c.match(/^(stutter|trails?|echo)$/)) return 'stutter';
        if (c.match(/^(invert|negative|flip color)$/)) return 'invert';
        if (c.match(/^(void|grayscale|grey|gray|desaturate)$/)) return 'void';
        if (c.match(/^(lucy|hallucin|psychedelic|trippy|acid)$/)) return 'lucy';
        if (c.match(/^(xray|x-ray|scan|skeleton)$/)) return 'xray';
        if (c.match(/^(tear|rip|displace)$/)) return 'tear';
        if (c.match(/^(punch|hit|impact)$/)) return 'punch';
        if (c.match(/^(nvg|night.?vision|thermal)$/)) return 'nvg';
        if (c.match(/^(vhs|retro|analog|tape)$/)) return 'vhs';
        if (c.match(/^(shoot|gun|weapon|fire|bullet|machine.?gun|crosshair)$/)) return 'shoot_help';
        if (c.match(/fx|effect|filter|what fx|visual/)) return 'fx_help';
        if (c.match(/^(party|rave|auto.?mode|autonomous)$/)) return 'party';
        if (c.match(/^(seismic|shake|rumble|bass|vibrate)$/)) return 'seismic';
        if (c.match(/integrity|glass|shatter|fracture|dent|repair/)) return 'integrity_help';
        if (c.match(/sampler|sfx.?pad|pad.*fx|soundboard|boom|horn|crowd/)) return 'sampler_help';
        if (c.match(/failure|psychosis|chaos|destroy|meltdown/)) return 'failure';
        if (c.match(/reset|panic|emergency|esc|clear fx|stop fx|normal/)) return 'reset';

        if (c.match(/^theme\s+\w+/)) return 'theme_set';
        if (c.match(/theme|color|palette|skin|style/)) return 'theme_help';

        if (c.match(/logo|identity|watermark|bug|station|brand/)) return 'identity_help';
        if (c.match(/lower.?third|overlay|caption|subtitle|name tag|l3/)) return 'lt_help';

        if (c.match(/p2p|peer|call|video.?call|connect|guest/)) return 'p2p_help';
        if (c.match(/midi|controller|pad|knob|fader|keyboard|instrument/)) return 'midi_help';

        if (c.match(/mint|nft|snapshot|capture art/)) return 'mint';
        if (c.match(/wallet|metamask|eth|crypto|bitcoin|btc|sol|connect wallet/)) return 'wallet_help';

        if (c.match(/vr|virtual reality|headset|immersive/)) return 'vr_help';
        if (c.match(/save|session|export|backup/)) return 'session_help';

        if (c.match(/time|clock|date/)) return 'time';
        if (c.match(/crypto|price|bitcoin|btc|eth|sol/)) return 'crypto';
        if (c.match(/joke|funny|laugh|humor|lol/)) return 'joke';
        if (c.match(/about|who|what is|version/)) return 'about';
        if (c.match(/clear|cls|wipe/)) return 'clear';
        if (c.match(/fullscreen|fs|maximize|expand/)) return 'fullscreen';
        if (c.match(/slide|panels|hide panels|show panels|focus|cinema/)) return 'slide';
        if (c.match(/ai|generate|image|dall|prompt|txt2img/)) return 'ai_help';
        if (c.match(/resolution|4k|1080|canvas size/)) return 'resolution';
        if (c.match(/spatial|stereo|dolby|surround|3d audio/)) return 'audio_mode';
        if (c.match(/shortcut|hotkey|keyboard|key bind/)) return 'shortcuts';

        if (c.match(/^(go.?live|start.?live|start.?broadcast|broadcast|3.?2.?1)/)) return 'golive_exec';
        if (c.match(/^(inject|inject.?loop|record.?loop|loop|10.?sec)/)) return 'inject_exec';
        if (c.match(/voice.?cmd|voice.?command|listen|mic.?cmd|stop.?listen/)) return 'voice_toggle';

        return 'unknown';
    }
};

function processGhostCommand(cmd, voiceMode) {
    var c = cmd.toLowerCase().trim();
    var intent = GHOST.understand(cmd);
    var ctx = GHOST.getContext();
    var hour = ctx.hour;
    if (voiceMode) ghostLog('🎤 ' + cmd.toUpperCase(), 'cmd');
    else ghostLog(cmd.toUpperCase(), 'user');

    switch(intent) {
            case 'greet':
                var greets = [
                    'Hey operator. Systems nominal. What are we building?',
                    hour < 12 ? 'Morning shift. Coffee protocols engaged. What\'s the plan?' : hour < 18 ? 'Afternoon, commander. All systems green.' : 'Night mode active. Let\'s make something wild.',
                    'Yo. ' + (ctx.hasMedia ? ctx.mediaCount + ' visuals loaded. ' : 'Canvas is empty. ') + (ctx.hasAudio ? 'Audio is pumping.' : 'No audio yet.') + ' What\'s next?'
                ];
                ghostLog(greets[Math.floor(Math.random() * greets.length)], 'ai');
                break;

            case 'status':
                ghostLog('FPS:' + ctx.fps + ' | MEDIA:' + ctx.mediaCount + ' | AUDIO:' + (ctx.hasAudio ? 'PLAYING' : 'IDLE') + ' | CAM:' + (ctx.hasCamera ? (ctx.isLive ? 'LIVE' : 'STANDBY') : 'OFF'), 'ai');
                ghostLog('THEME:' + ctx.theme.toUpperCase() + ' | SEISMIC:' + (ctx.seismic ? 'ARMED' : 'OFF') + ' | PARTY:' + (ctx.party ? 'ON' : 'OFF') + ' | REC:' + (ctx.isRecording ? 'HOT' : 'OFF'), 'ai');
                ghostLog('MIDI:' + (ctx.hasMidi ? 'CONNECTED' : 'OFF') + ' | WALLET:' + (ctx.hasWallet ? 'LINKED' : 'OFF') + ' | P2P:' + (ctx.hasGuest ? 'ACTIVE' : 'OFF') + ' | UP:' + ctx.uptime, 'ai');
                ghostLog('SHOOT:' + (ctx.isShooting ? 'ARMED' : 'OFF') + ' | GLASS:' + ctx.glassIntegrity + '%', 'ai');
                break;

            case 'help':
                ghostLog('── MEDIA ──  load · eject · queue · cycle · next · prev', 'ai');
                ghostLog('── FX TOGGLE ──  void · lucy · xray · tear · punch · nvg · vhs', 'ai');
                ghostLog('── FX BURST ──  crush · stutter · invert · shatter · failure', 'ai');
                ghostLog('── TACTICAL ──  shoot (machine gun mode, drains glass integrity)', 'ai');
                ghostLog('── AUDIO ──  sampler (SFX pads) · seismic · party', 'ai');
                ghostLog('── LIVE ──  reset · fullscreen · slide', 'ai');
                ghostLog('── THEME ──  theme cyan / magenta / green / purple / gold / night', 'ai');
                ghostLog('── TOOLS ──  status · crypto · time · shortcuts · about · clear', 'ai');
                ghostLog('Or just ask naturally — "how do I shoot?" · "what are SFX pads?"', 'ai');
                break;

            case 'tip':
                ghostLog(GHOST.getTip(), 'ai');
                break;

            case 'load':
                ghostLog('Opening file picker — select images, videos, or audio...', 'ai');
                (function() {
                    var inp = document.createElement('input');
                    inp.type = 'file'; inp.multiple = true;
                    inp.accept = 'image/*,video/*,audio/*,audio/mpeg,audio/wav,audio/ogg';
                    inp.onchange = function(e) {
                        var files = Array.from(e.target.files || []);
                        if (!files.length) { ghostLog('LOAD_ABORTED: no files selected.', 'crit'); return; }
                        var mediaArr = [], audioArr = [];
                        files.forEach(function(f) {
                            if (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|aac|flac)$/i.test(f.name)) audioArr.push(f);
                            else mediaArr.push(f);
                        });
                        if (mediaArr.length) {
                            if (typeof loadMediaFiles === 'function') loadMediaFiles({ files: mediaArr });
                            ghostLog('LOADED: ' + mediaArr.length + ' VISUAL' + (mediaArr.length > 1 ? 'S' : ''), 'success');
                            ghostLog('SPACE rotates media · type "cycle" for auto-rotation', 'ai');
                        }
                        if (audioArr.length) {
                            if (typeof loadAudioFiles === 'function') loadAudioFiles({ files: audioArr });
                            ghostLog('LOADED: ' + audioArr.length + ' AUDIO_FILE' + (audioArr.length > 1 ? 'S' : ''), 'success');
                        }
                    };
                    inp.click();
                })();
                break;

            case 'audio_help':
                ghostLog('Load MP3/WAV via LOAD AUDIO. Audio drives beat-reactive FX. Modes: STEREO / 3D_SPATIAL / DOLBY.', 'ai');
                if (!ctx.hasAudio) ghostLog('No audio loaded yet.', 'cmd');
                break;

            case 'play':
                if (typeof togglePlayPause === 'function') togglePlayPause();
                ghostLog('Playback toggled.', 'success');
                break;

            case 'next':
                if (typeof nextTrack === 'function') nextTrack();
                ghostLog('Next track.', 'success');
                break;

            case 'prev':
                if (typeof prevTrack === 'function') prevTrack();
                ghostLog('Previous track.', 'success');
                break;

            case 'cycle':
                if ($('btn-cycle-toggle')) $('btn-cycle-toggle').click();
                ghostLog(APP.state.isCycle ? 'CYCLE MODE: ON — media auto-rotates.' : 'CYCLE MODE: OFF', APP.state.isCycle ? 'success' : 'ai');
                break;

            case 'eject':
                if (typeof ejectCurrent === 'function') ejectCurrent();
                ghostLog('Current media ejected from deck.', 'success');
                break;

            case 'queue':
                ghostLog('MEDIA_DECK: ' + ctx.mediaCount + ' items loaded.', 'ai');
                if (ctx.mediaCount > 0) ghostLog('Press SPACE to rotate. EJECT removes current. CLEAR wipes all.', 'ai');
                else ghostLog('Deck is empty. Type "load" or click LOAD_MEDIA to add visuals.', 'ai');
                break;

            case 'camera_help':
                ghostLog('INIT_CAM → GO_LIVE (3-2-1 countdown). MIC toggles mic. KILL shuts down completely.', 'ai');
                if (ctx.hasCamera) ghostLog('Camera: ' + (ctx.isLive ? 'LIVE' : 'STANDBY'), ctx.isLive ? 'success' : 'cmd');
                break;

            case 'golive_help':
                if (!ctx.hasCamera) { ghostLog('INIT_CAM first, then say "go live" or click GO_LIVE.', 'crit'); }
                else if (ctx.isLive) { ghostLog('ALREADY LIVE. Say "end" to stop broadcast or "kill" to shut down.', 'ai'); }
                else { ghostLog('CAM READY. Say "go live" or click GO_LIVE for 3-2-1 countdown.', 'ai'); }
                break;

            case 'record_help':
                ghostLog('REC header button records the full canvas output. INJECT = 10s camera loop. CAPTURE_VNGRD_CLIP = signed 30s VGD.', 'ai');
                break;

            case 'kill_help':
                ghostLog('KILL shuts down camera + stops recording + clears the live feed.', 'ai');
                ghostLog('END stops just the live broadcast but keeps camera running.', 'ai');
                break;

            case 'shatter':
                ghostLog('SHATTER_PROTOCOL: INITIATING...', 'success');
                var stage = $('stage'); var rect = stage.getBoundingClientRect();
                for (var i = 0; i < 6; i++) { (function(j) { setTimeout(function() { var x = rect.left + Math.random() * rect.width; var y = rect.top + Math.random() * rect.height; if (typeof createGlassFracture === 'function') createGlassFracture(x, y); }, j * 80); })(i); }
                ghostLog('GLASS_MATRIX: SHATTERED', 'success');
                break;

            case 'crush':
                if (typeof impactCrush === 'function') impactCrush();
                ghostLog('CRUSH FX — maximum RGB split + pixelation. 500ms burst.', 'success');
                break;

            case 'stutter':
                if (typeof impactStutter === 'function') impactStutter();
                ghostLog('STUTTER FX — motion trails + chromatic aberration. 500ms burst.', 'success');
                break;

            case 'invert':
                if (typeof impactInvert === 'function') impactInvert();
                ghostLog('INVERT FX — color negative + aberration. 500ms burst.', 'success');
                break;

            case 'void':
                if (typeof toggleFX === 'function') toggleFX('void');
                ghostLog('VOID: ' + (document.body.classList.contains('fx-void') ? 'ON' : 'OFF'), 'success');
                break;

            case 'lucy':
                if (typeof toggleFX === 'function') toggleFX('lucy');
                ghostLog('LUCY: ' + (document.body.classList.contains('fx-lucy') ? 'ON' : 'OFF'), 'success');
                break;

            case 'xray':
                if (typeof toggleFX === 'function') toggleFX('scan');
                ghostLog('X-RAY: ' + (document.body.classList.contains('fx-scan') ? 'ON' : 'OFF'), 'success');
                break;

            case 'tear':
                if (typeof toggleFX === 'function') toggleFX('tear');
                ghostLog('TEAR: ' + (document.body.classList.contains('fx-tear') ? 'ON' : 'OFF'), 'success');
                break;

            case 'punch':
                if (typeof toggleFX === 'function') toggleFX('punch');
                ghostLog('PUNCH: ' + (document.body.classList.contains('fx-punch') ? 'ON' : 'OFF'), 'success');
                break;

            case 'nvg':
                if (typeof toggleFX === 'function') toggleFX('nvg');
                ghostLog('NVG: ' + (document.body.classList.contains('fx-nvg') ? 'ON' : 'OFF'), 'success');
                break;

            case 'vhs':
                if (typeof toggleVHS === 'function') toggleVHS();
                ghostLog('VHS: TOGGLED', 'success');
                break;

            case 'fx_help':
                ghostLog('BANK A: void · lucy · xray · tear · punch · nvg · vhs · shoot | seismic · party · reset', 'ai');
                ghostLog('BANK B (GPU): slit_scan · luma_bloom · dither_luxe · caustics · ghost_echo · spectral_mosh', 'ai');
                ghostLog('BURST: crush · stutter · invert · shatter', 'ai');
                break;

            case 'shoot_help':
                ghostLog('SHOOT MODE — click SHOOT in the Reactivity panel (or the SFX pad) to arm.', 'ai');
                ghostLog('Canvas becomes a crosshair target. Click to fire: glass fractures on canvas, metal dents on UI.', 'ai');
                ghostLog('Each shot drains the GLASS INTEGRITY bar. Deplete it fully to trigger TERMINAL SHATTER.', 'ai');
                ghostLog('Integrity auto-repairs over time. Shoot fast for maximum chaos.', 'ai');
                break;

            case 'integrity_help':
                ghostLog('GLASS INTEGRITY: tracks cumulative damage from SHOOT mode. Shown in the header bar.', 'ai');
                ghostLog('When integrity hits 0, TERMINAL SHATTER fires — full screen glass explosion.', 'ai');
                ghostLog('Auto-repairs over ~30 seconds when you stop shooting.', 'ai');
                break;

            case 'sampler_help':
                ghostLog('SFX PADS: click a pad → BOOM, HORN, CROWD, etc. Right-click to arm mic recording.', 'ai');
                ghostLog('Gear icon on each pad → load sample file + couple an FX:', 'ai');
                ghostLog('  BANK A: punch · seismic · void · lucy · nvg · vhs · failure · shoot · party', 'ai');
                ghostLog('  BANK B: slit_scan · luma_bloom · dither_luxe · caustics · ghost_echo · spectral_mosh', 'ai');
                ghostLog('Coupled FX fires on pad hit + sample audio drives audio-reactive engines.', 'ai');
                ghostLog('MIDI-mappable: assign any pad to a MIDI note for live triggering.', 'ai');
                break;

            case 'party':
                if ($('btn-ui-react')) $('btn-ui-react').click();
                ghostLog('PARTY MODE: ' + (APP.vj.uiReactivity ? 'ON' : 'OFF'), APP.vj.uiReactivity ? 'success' : 'ai');
                break;

            case 'seismic':
                if ($('btn-rumble')) $('btn-rumble').click();
                ghostLog('SEISMIC: ' + (APP.vj.rumbleEnabled ? 'ARMED' : 'OFF'), APP.vj.rumbleEnabled ? 'success' : 'ai');
                break;

            case 'record_toggle': {
                var _lc = $('live-ctrls');
                if (!_lc || _lc.style.display === 'none') {
                    ghostLog('REC: go live first to enable recording', 'crit');
                } else {
                    var _wasRec = APP.broadcast.isRecording;
                    $('btn-rec').click();
                    ghostLog(_wasRec ? 'REC: STOPPED — saving clip' : 'REC: RECORDING STARTED', _wasRec ? 'ai' : 'success');
                }
                break;
            }

            case 'fx_off': {
                var _fxWord = c.split(/\s+/)[0];
                var _fxMap = { void:'void', grayscale:'void', grey:'void', gray:'void', lucy:'lucy',
                               xray:'scan', scan:'scan', skeleton:'scan', tear:'tear', rip:'tear',
                               punch:'punch', hit:'punch', nvg:'nvg', vhs:'vhs', retro:'vhs', tape:'vhs' };
                var _fxId = _fxMap[_fxWord];
                if (_fxId) {
                    var _cls = 'fx-' + _fxId;
                    if (document.body.classList.contains(_cls)) {
                        if (_fxId === 'vhs') { if (typeof toggleVHS === 'function') toggleVHS(); }
                        else { if (typeof toggleFX === 'function') toggleFX(_fxId); }
                        ghostLog(_fxWord.toUpperCase() + ': OFF', 'ai');
                    } else {
                        ghostLog(_fxWord.toUpperCase() + ': already off', 'ai');
                    }
                }
                break;
            }

            case 'failure':
                if ($('btn-psychosis')) $('btn-psychosis').click();
                ghostLog('SYSTEM_FAILURE TRIGGERED — 5 seconds of pure chaos.', 'crit');
                break;

            case 'reset':
                if (typeof resetAllFX === 'function') resetAllFX();
                else if (typeof panicReset === 'function') panicReset();
                ghostLog('ALL FX CLEARED. Systems nominal.', 'success');
                break;

            case 'theme_set':
                var t = c.split(/\s+/)[1];
                if (['cyan','magenta','green','purple','gold','night'].includes(t)) {
                    setTheme(t);
                    ghostLog('Theme: ' + t.toUpperCase(), 'success');
                } else { ghostLog('Available: cyan, magenta, green, purple, gold, night', 'ai'); }
                break;

            case 'theme_help':
                ghostLog('Themes: cyan / magenta / green / purple / gold / night. Current: ' + ctx.theme.toUpperCase() + '. Type "theme [name]" to switch.', 'ai');
                break;

            case 'identity_help':
                ghostLog('STATION BUG: text watermark (draggable). 2D LOGO: PNG/GIF upload. 3D LOGO: OBJ/FBX. All pinch-to-resize on canvas.', 'ai');
                break;

            case 'lt_help':
                ghostLog('Lower thirds: GUEST (name/role), TRACK (auto-fill from audio), B.NEWS (red alert). Edit fields live. [X] hides.', 'ai');
                break;

            case 'p2p_help':
                ghostLog('P2P CALL: open header panel → INIT_PEER → share ID → CALL. Guest stream appears on canvas with full UI sync.', 'ai');
                break;

            case 'midi_help':
                ghostLog('INIT WEBMIDI in sidebar. Notes 36-39: burst FX. 40-47: themes. CC1: brightness, CC7: volume. Use LEARN mode to map any control.', 'ai');
                break;

            case 'mint':
                takeScreenshot();
                break;

            case 'wallet_help':
                ghostLog('Connect wallet via header badge. SCAN_WALLET_ASSETS loads assets into vault — click thumbnail to summon to canvas.', 'ai');
                break;

            case 'vr_help':
                ghostLog('ENTER_VR in Session Lab launches WebXR immersive mode. Requires a WebXR-capable browser + headset.', 'ai');
                break;

            case 'session_help':
                ghostLog('SESSION MANAGEMENT:', 'success');
                ghostLog('SAVE: Stores your entire setup to localStorage.', 'ai');
                ghostLog('EXPORT: Downloads a .vgd JSON file you can share.', 'ai');
                ghostLog('IMPORT: Load a .vgd file to restore a complete session.', 'ai');
                ghostLog('Sessions save: theme, positions, lower third, audio mode, FX state.', 'ai');
                break;

            case 'ai_help':
                ghostLog('AI_INJECTION sidebar: pick a Pollinations model (FLUX / TURBO / 3D / ANIME), type a prompt, hit GENERATE. Free, unlimited, no API key.', 'ai');
                break;

            case 'time':
                ghostLog(new Date().toLocaleTimeString() + ' | UP:' + ctx.uptime, 'ai');
                break;

            case 'crypto':
                if (typeof fetchCrypto === 'function') fetchCrypto();
                ghostLog('Fetching live prices... Check the ticker bar.', 'ai');
                break;

            case 'joke':
                var jokes = [
                    'Why do DJs make great coders? They know how to drop the beat and the bugs.',
                    'I told my GPU a joke. It rendered me speechless.',
                    '404: Humor module temporarily unavailable.',
                    'What\'s a VJ\'s favorite key? The space bar.',
                    'My render loop walks into a bar. The bar walks into my render loop. Stack overflow.',
                    'I asked the AI to generate art. It generated an invoice instead.',
                    'WebGL broke again. Must be a shader day.',
                    'Why did the WebRTC call fail? Because it couldn\'t find a common ICE breaker.'
                ];
                ghostLog(jokes[Math.floor(Math.random() * jokes.length)], 'ai');
                break;

            case 'about':
                ghostLog('GHOST://AI v5 — DRIS//CORE companion. Every command, every FX, every shortcut. Just ask.', 'ai');
                break;

            case 'clear':
                $('ghost-terminal-body').innerHTML = '';
                ghostLog('Terminal cleared.', 'ai');
                break;

            case 'fullscreen':
                if (typeof toggleFullscreen === 'function') toggleFullscreen();
                ghostLog('Fullscreen toggled. (Shortcut: press H)', 'success');
                break;

            case 'slide':
                if (typeof toggleSystemSlide === 'function') toggleSystemSlide();
                ghostLog('System slide toggled. Panels slide out, canvas takes over. (Shortcut: Tab)', 'success');
                break;

            case 'resolution':
                ghostLog('Canvas: ' + APP.render.width + 'x' + APP.render.height, 'ai');
                ghostLog('The render pipeline outputs at this resolution. Records at native res.', 'ai');
                break;

            case 'audio_mode':
                ghostLog('AUDIO MODES:', 'success');
                ghostLog('STEREO: Standard left/right. Clean and flat.', 'ai');
                ghostLog('3D SPATIAL: HRTF panning + distance model. Immersive.', 'ai');
                ghostLog('DOLBY: Dynamic range compression + EQ processing. Punchy.', 'ai');
                ghostLog('Switch via buttons in the AUDIO section of sidebar.', 'ai');
                break;

            case 'shortcuts':
                ghostLog('G: terminal | H: fullscreen | TAB: slide panels | SPACE: next media | ESC: panic reset', 'ai');
                break;

            case 'golive_exec':
                var glBtn = document.getElementById('btn-go-live');
                if (glBtn) { glBtn.click(); ghostLog('GO_LIVE: COUNTDOWN INITIATED', 'success'); }
                else ghostLog('GO_LIVE: INIT_CAM FIRST', 'crit');
                break;

            case 'inject_exec':
                var inBtn = document.getElementById('btn-inject');
                if (inBtn) { inBtn.click(); ghostLog('INJECT_LOOP: RECORDING 10s', 'success'); }
                else ghostLog('INJECT_LOOP: CAM NOT READY', 'crit');
                break;

            case 'vb_b_off': {
                var _vbOffWord = c.split(/\s+/)[0];
                var _vbOffMap = {
                    'slit':'SLIT_SCAN','slitscan':'SLIT_SCAN',
                    'luma':'LUMA_BLOOM','bloom':'LUMA_BLOOM',
                    'dither':'DITHER_LUXE',
                    'caustics':'CAUSTICS','caustic':'CAUSTICS',
                    'ghost':'GHOST_ECHO','ghostecho':'GHOST_ECHO',
                    'mosh':'SPECTRAL_MOSH','spectral':'SPECTRAL_MOSH'
                };
                var _vbOffSN = _vbOffMap[_vbOffWord];
                if (_vbOffSN && typeof _vbDeactivate === 'function') {
                    _vbDeactivate(_vbOffSN);
                    ghostLog('BANK_B: ' + _vbOffSN + ' OFF', 'ai');
                }
                break;
            }

            case 'vb_slit_scan':
            case 'vb_luma_bloom':
            case 'vb_dither_luxe':
            case 'vb_caustics':
            case 'vb_ghost_echo':
            case 'vb_spectral_mosh': {
                var _vbMap = {
                    'vb_slit_scan':'SLIT_SCAN','vb_luma_bloom':'LUMA_BLOOM',
                    'vb_dither_luxe':'DITHER_LUXE','vb_caustics':'CAUSTICS',
                    'vb_ghost_echo':'GHOST_ECHO','vb_spectral_mosh':'SPECTRAL_MOSH'
                };
                var _vbSN = _vbMap[intent];
                if (typeof _setFXBank === 'function') _setFXBank('B');
                if (typeof window._vbActivate === 'function') window._vbActivate(_vbSN, false);
                ghostLog('BANK_B: ' + _vbSN + ' BURST', 'success');
                break;
            }

            case 'vb_help':
                ghostLog('BANK B — GPU SHADERS: slitscan · bloom · dither · caustics · ghostecho · mosh', 'ai');
                ghostLog('Say any name to burst 3s, name + "off" to stop. Double-tap button = persistent lock.', 'ai');
                break;

            case 'voice_toggle':
                if (typeof _ghostVoiceToggle === 'function') _ghostVoiceToggle();
                break;

            case 'unknown':
                if (!voiceMode) {
                    ghostLog('Unknown. Try: void · lucy · seismic · party · go live · inject · slit scan · status · help', 'crit');
                }
                break;
        }
}

// ═══════════════════════════════════════════════════════════════
// GHOST VOICE COMMAND ENGINE
// ═══════════════════════════════════════════════════════════════
(function() {
    var _gvRec = null;
    var _gvOn  = false;

    function _gvFire(text) {
        var t = text.trim();
        if (!t || t.length < 2) return;
        if (typeof processGhostCommand === 'function') processGhostCommand(t, true);
    }

    function _buildGVRec() {
        var SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechAPI) return null;
        var r = new SpeechAPI();
        r.continuous      = true;
        r.interimResults  = false;
        r.lang            = 'en-US';
        r.maxAlternatives = 1;
        r.onresult = function(e) {
            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) _gvFire(e.results[i][0].transcript);
            }
        };
        r.onend = function() {
            if (_gvOn) setTimeout(function() { try { r.start(); } catch(x) {} }, 400);
        };
        r.onerror = function(e) {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            if (typeof ghostLog === 'function') ghostLog('VOICE_ERR: ' + e.error, 'crit');
        };
        return r;
    }

    window._ghostVoiceToggle = function() {
        _gvOn = !_gvOn;
        var btn = document.getElementById('btn-ghost-mic');
        if (_gvOn) {
            if (!_gvRec) _gvRec = _buildGVRec();
            if (_gvRec) {
                try { _gvRec.start(); } catch(x) {}
                if (btn) btn.classList.add('on');
                if (typeof ghostLog === 'function') ghostLog('VOICE_CMD: ARMED — speak any command', 'success');
            } else {
                _gvOn = false;
                if (typeof ghostLog === 'function') ghostLog('VOICE_CMD: UNSUPPORTED IN THIS BROWSER', 'crit');
            }
        } else {
            if (_gvRec) { try { _gvRec.abort(); } catch(x) {} _gvRec = null; }
            if (btn) btn.classList.remove('on');
            if (typeof ghostLog === 'function') ghostLog('VOICE_CMD: OFF', 'ai');
        }
        return _gvOn;
    };
})();

// ═══ GHOST AUTO-TIPS ═══
var _ghostIdleTimer = null;
var _ghostTipIndex = 0;
var _ghostStartupDone = false;

function ghostStartupSequence() {
    if (_ghostStartupDone) return;
    _ghostStartupDone = true;
    var term = $('ghost-terminal');
    if (!term) return;
    term.style.display = 'flex';
    term.classList.add('active');
    var ctx = GHOST.getContext();
    var hour = ctx.hour;
    var greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    setTimeout(function() { ghostLog(greeting + ' — GHOST online.', 'ai'); }, 800);
    resetGhostIdleTimer();
}

function resetGhostIdleTimer() {
    if (_ghostIdleTimer) clearTimeout(_ghostIdleTimer);
    _ghostIdleTimer = setTimeout(ghostIdleTip, 45000);
}

function ghostIdleTip() {
    var term = $('ghost-terminal');
    if (!term || term.style.display === 'none') {
        _ghostIdleTimer = setTimeout(ghostIdleTip, 45000);
        return;
    }
    ghostLog(GHOST.getTip(), 'ai');
    _ghostIdleTimer = setTimeout(ghostIdleTip, 60000);
}

document.addEventListener('click', resetGhostIdleTimer, { passive: true });
document.addEventListener('keydown', resetGhostIdleTimer, { passive: true });
document.addEventListener('touchstart', resetGhostIdleTimer, { passive: true });

setTimeout(ghostStartupSequence, 3000);
