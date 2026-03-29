// NeuralGlitch — receives THREE as constructor arg

const GLITCH_VERT = `
uniform float uTime; uniform float uBeat; uniform float uCrush;
varying vec3 vNormal; varying float vDisplace;
float hash(vec3 p){ p=fract(p*vec3(443.8975,397.2973,491.1871)); p+=dot(p.zxy,p.yxz+19.19); return fract(p.x*p.y*p.z); }
void main(){
    vNormal=normalMatrix*normal;
    vec3 pos=position;
    float n=hash(pos*2.3+uTime*0.4)*0.18;
    n+=uBeat*0.55*(0.5+0.5*sin(pos.y*8.0+uTime*12.0));
    pos*=1.0+n;
    pos.x+=uCrush*sin(pos.y*14.0+uTime*20.0)*0.25;
    pos.y+=uCrush*cos(pos.x*12.0+uTime*18.0)*0.25;
    vDisplace=n;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}`;

const GLITCH_FRAG = `
uniform float uTime; uniform float uBeat; uniform float uCrush;
varying vec3 vNormal; varying float vDisplace;
void main(){
    vec3 N=normalize(vNormal);
    float stripe=step(0.5,fract(N.y*18.0+uTime*0.5));
    vec3 cold=mix(vec3(0.0,0.6,0.9),vec3(0.7,0.0,0.9),vDisplace*3.0);
    cold=mix(cold,vec3(1.0,0.3,0.0),uCrush);
    cold=mix(cold,vec3(1.0),uBeat*0.7);
    cold*=0.7+stripe*0.3;
    float rim=pow(1.0-abs(dot(N,vec3(0.0,0.0,1.0))),2.2);
    cold+=rim*vec3(0.0,0.9,1.0)*0.6;
    gl_FragColor=vec4(cold,1.0);
}`;

const PAT = {
    kick:  [1,0,0,0, 1,0,0,1, 0,0,1,0, 1,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
    hat:   [1,1,0,1, 1,1,0,1, 1,1,0,1, 1,0,1,1],
};

export class NeuralGlitch {
    constructor(scene, audioCtx, THREE) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._T      = THREE;
        this._mesh   = null;
        this._uni    = null;
        this._active = false;
        this._mGain  = null;
        this._crushIn = null;
        this._script = null;
        this._bitDepth = 16;
        this._step   = 0;
        this._nextTime = 0;
        this._timer  = null;
        this._beatFlash = 0;
    }

    async init() {
        const T = this._T;
        this._uni = { uTime:{value:0}, uBeat:{value:0}, uCrush:{value:0} };
        const geo = new T.SphereGeometry(2.4, 72, 72);
        const mat = new T.ShaderMaterial({ uniforms:this._uni, vertexShader:GLITCH_VERT, fragmentShader:GLITCH_FRAG, side:T.DoubleSide });
        this._mesh = new T.Mesh(geo, mat);
        this._mesh.visible = false;
        this._scene.add(this._mesh);
        this._buildAudio();
    }

    _buildAudio() {
        const ctx = this._ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 6;
        this._mGain = ctx.createGain(); this._mGain.gain.value = 0;
        comp.connect(this._mGain); this._mGain.connect(ctx.destination);
        this._crushIn = ctx.createGain(); this._crushIn.gain.value = 1;
        this._script = ctx.createScriptProcessor(4096, 1, 1);
        this._script.onaudioprocess = (e) => {
            const inp = e.inputBuffer.getChannelData(0);
            const out = e.outputBuffer.getChannelData(0);
            const steps = Math.pow(2, this._bitDepth);
            for (let i=0; i<inp.length; i++) out[i] = Math.round(inp[i]*steps)/steps;
        };
        this._crushIn.connect(this._script); this._script.connect(comp);
    }

    _sched(time, type) {
        const ctx = this._ctx;
        const osc = ctx.createOscillator(), env = ctx.createGain();
        osc.connect(env); env.connect(this._crushIn);
        if (type === 'kick') {
            osc.type='sine'; osc.frequency.setValueAtTime(160,time); osc.frequency.exponentialRampToValueAtTime(40,time+0.12);
            env.gain.setValueAtTime(1.2,time); env.gain.exponentialRampToValueAtTime(0.001,time+0.22);
            osc.start(time); osc.stop(time+0.25); this._beatFlash=1.0;
        } else if (type === 'snare') {
            osc.type='triangle'; osc.frequency.value=220;
            const nb=ctx.createBuffer(1,4096,ctx.sampleRate); const nd=nb.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
            const ns=ctx.createBufferSource(); ns.buffer=nb; ns.loop=true;
            const nEnv=ctx.createGain(); nEnv.gain.setValueAtTime(0.4,time); nEnv.gain.exponentialRampToValueAtTime(0.001,time+0.15);
            ns.connect(nEnv); nEnv.connect(this._crushIn); ns.start(time); ns.stop(time+0.18);
            env.gain.setValueAtTime(0.5,time); env.gain.exponentialRampToValueAtTime(0.001,time+0.1);
            osc.start(time); osc.stop(time+0.12);
        } else {
            osc.type='square'; osc.frequency.value=8000+Math.random()*4000;
            env.gain.setValueAtTime(0.15,time); env.gain.exponentialRampToValueAtTime(0.001,time+0.04);
            osc.start(time); osc.stop(time+0.05);
        }
    }

    _tick() {
        if (!this._active) return;
        while (this._nextTime < this._ctx.currentTime + 0.1) {
            const s = this._step % 16;
            if (PAT.kick[s])  this._sched(this._nextTime,'kick');
            if (PAT.snare[s]) this._sched(this._nextTime,'snare');
            if (PAT.hat[s])   this._sched(this._nextTime,'hat');
            this._nextTime += 60/142/4;
            this._step++;
        }
    }

    _processHands(hr) {
        if (!hr || !hr.multiHandLandmarks) return;
        for (let hi=0; hi<hr.multiHandLandmarks.length; hi++) {
            const lms=hr.multiHandLandmarks[hi], hand=hr.multiHandedness[hi];
            if (hand && hand.label==='Right') {
                const wrist=lms[0];
                if (wrist) {
                    this._uni.uCrush.value = Math.max(0, Math.min(1, 1-wrist.y));
                    this._bitDepth = Math.round(16 - this._uni.uCrush.value * 14);
                }
            }
        }
    }

    activate() {
        this._active=true; this._mesh.visible=true;
        if (this._mGain) this._mGain.gain.setTargetAtTime(0.8,this._ctx.currentTime,0.1);
        this._nextTime=this._ctx.currentTime+0.1; this._step=0;
        this._timer=setInterval(()=>this._tick(),25);
    }

    deactivate() {
        this._active=false; this._mesh.visible=false;
        if (this._mGain) this._mGain.gain.setTargetAtTime(0,this._ctx.currentTime,0.1);
        if (this._timer) { clearInterval(this._timer); this._timer=null; }
    }

    update(hr, t) {
        if (!this._active) return;
        this._uni.uTime.value=t;
        this._beatFlash=Math.max(0,this._beatFlash-0.05);
        this._uni.uBeat.value=this._beatFlash;
        this._mesh.rotation.y=t*0.15;
        this._mesh.rotation.x=Math.sin(t*0.1)*0.2;
        this._processHands(hr);
    }
}
