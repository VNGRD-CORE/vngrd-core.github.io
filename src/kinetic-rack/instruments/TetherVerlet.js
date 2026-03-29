// TetherVerlet — receives THREE as constructor arg

const TETHER_VERT = `varying vec3 vNormal; varying vec3 vPos;
void main(){ vNormal=normalMatrix*normal; vPos=(modelViewMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const TETHER_FRAG = `uniform vec3 uColor; uniform float uGlow; varying vec3 vNormal; varying vec3 vPos;
void main(){ vec3 N=normalize(vNormal); vec3 V=normalize(-vPos); float rim=pow(1.0-abs(dot(N,V)),2.5); gl_FragColor=vec4(uColor+rim*uColor*uGlow,1.0); }`;

const CABLE_COLORS_HEX = [0x00ffcc, 0xff00cc, 0x00aaff, 0xffaa00];

export class TetherVerlet {
    constructor(scene, audioCtx, THREE) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._T      = THREE;
        this._mode   = 'CORE';
        this._active = false;
        this._coreMeshes = [];
        this._coreUni    = [];
        this._snapPts    = null;
        this._snapGeo    = null;
        this._snapActive = false;
        this._snapTimer  = 0;
        this._constLines = null;
        this._constGeo   = null;
        this._flowArr    = [];
        this._mGain = null;
        this._delay = null;
        this._fbGain = null;
    }

    async init() {
        const T = this._T;
        // CORE meshes
        for (let i=0; i<4; i++) {
            const uni = { uColor:{value:new T.Color(CABLE_COLORS_HEX[i])}, uGlow:{value:1.0} };
            const mat = new T.ShaderMaterial({ uniforms:uni, vertexShader:TETHER_VERT, fragmentShader:TETHER_FRAG, side:T.DoubleSide });
            const geo = new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(-1,0,0),new T.Vector3(0,0.5,0),new T.Vector3(1,0,0)]),12,0.04,6,false);
            const mesh = new T.Mesh(geo, mat);
            mesh.visible=false; this._scene.add(mesh);
            this._coreMeshes.push(mesh); this._coreUni.push(uni);
        }
        // Snap burst
        const snapPos=new Float32Array(600*3);
        this._snapGeo=new T.BufferGeometry(); this._snapGeo.setAttribute('position',new T.BufferAttribute(snapPos,3));
        this._snapPts=new T.Points(this._snapGeo,new T.PointsMaterial({color:0xffffff,size:0.08,transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false}));
        this._snapPts.visible=false; this._scene.add(this._snapPts);
        // CONSTELLATION
        const cPos=new Float32Array(210*2*3);
        this._constGeo=new T.BufferGeometry(); this._constGeo.setAttribute('position',new T.BufferAttribute(cPos,3));
        this._constLines=new T.LineSegments(this._constGeo,new T.LineBasicMaterial({color:0x00ffaa,transparent:true,opacity:0.7,blending:T.AdditiveBlending,depthWrite:false}));
        this._constLines.visible=false; this._scene.add(this._constLines);
        // FLOW trails
        for (let f=0;f<10;f++) {
            const arr=new Float32Array(42*3);
            const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.BufferAttribute(arr,3));
            const pts=new T.Points(geo,new T.PointsMaterial({color:f%2===0?0x00ffcc:0xff00cc,size:0.06,transparent:true,opacity:0.8,blending:T.AdditiveBlending,depthWrite:false}));
            pts.visible=false; this._scene.add(pts);
            this._flowArr.push({pts,geo,trail:[],lastPos:null});
        }
        this._buildAudio();
    }

    _lm2w(lm, cam) {
        const T=this._T;
        const ndc=new T.Vector3(-(lm.x*2-1),-(lm.y*2-1),0.5);
        ndc.unproject(cam);
        const dir=ndc.sub(cam.position).normalize();
        const dist=-cam.position.z/dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    _distCurve(k) {
        const n=256, c=new Float32Array(n*2+1);
        for (let i=-n;i<=n;i++) { const x=i/n; c[i+n]=(Math.PI+k)*x/(Math.PI+k*Math.abs(x)); }
        return c;
    }

    _buildAudio() {
        const ctx=this._ctx;
        this._mGain=ctx.createGain(); this._mGain.gain.value=0; this._mGain.connect(ctx.destination);
        this._delay=ctx.createDelay(1.0);
        this._fbGain=ctx.createGain(); this._fbGain.gain.value=0.4;
        this._delay.connect(this._fbGain); this._fbGain.connect(this._delay); this._delay.connect(this._mGain);
    }

    _playSnap() {
        const ctx=this._ctx, now=ctx.currentTime;
        const osc=ctx.createOscillator(), env=ctx.createGain();
        osc.type='sawtooth'; osc.frequency.setValueAtTime(880,now); osc.frequency.exponentialRampToValueAtTime(55,now+0.15);
        env.gain.setValueAtTime(0.5,now); env.gain.exponentialRampToValueAtTime(0.001,now+0.18);
        osc.connect(env); env.connect(this._mGain); osc.start(); osc.stop(now+0.2);
    }

    _snapBurst(origin, t) {
        this._snapTimer=t;
        const pos=this._snapGeo.attributes.position.array;
        for (let i=0;i<pos.length;i+=3) {
            pos[i]=origin.x+(Math.random()-0.5)*0.4;
            pos[i+1]=origin.y+(Math.random()-0.5)*0.4;
            pos[i+2]=origin.z+(Math.random()-0.5)*0.4;
        }
        this._snapGeo.attributes.position.needsUpdate=true;
        this._snapPts.material.opacity=1.0; this._snapPts.visible=true; this._snapActive=true;
    }

    _updateCore(hr, cam, t) {
        if (!hr || !hr.multiHandLandmarks || !hr.multiHandLandmarks.length) return;
        const T=this._T, lms=hr.multiHandLandmarks[0];
        const fingers=[[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
        fingers.forEach((joints,ci) => {
            const mesh=this._coreMeshes[ci], uni=this._coreUni[ci];
            const pts=joints.map(j=>{ const lm=lms[j]; return lm?this._lm2w(lm,cam):new T.Vector3(); });
            pts[1].y-=0.15; pts[2].y-=0.1;
            mesh.geometry.dispose();
            const lm3=lms[joints[3]], lm2=lms[joints[2]];
            let tension=0;
            if (lm3&&lm2) tension=Math.min(1,Math.hypot(lm3.x-lm2.x,lm3.y-lm2.y)*8);
            mesh.geometry=new T.TubeGeometry(new T.CatmullRomCurve3(pts),12,0.04+tension*0.03,6,false);
            mesh.visible=true;
            uni.uColor.value.lerpColors(new T.Color(CABLE_COLORS_HEX[ci]),new T.Color(1,1,1),tension);
            uni.uGlow.value=1.0+tension*4.0;
            if (tension>0.85) { this._snapBurst(this._lm2w(lms[joints[3]],cam),t); this._playSnap(); }
        });
        if (this._snapActive) {
            const op=Math.max(0,1-(t-this._snapTimer)*3);
            this._snapPts.material.opacity=op;
            if (op<=0) { this._snapActive=false; this._snapPts.visible=false; }
            else {
                const pos=this._snapGeo.attributes.position.array;
                for (let i=0;i<pos.length;i++) pos[i]*=1.04;
                this._snapGeo.attributes.position.needsUpdate=true;
            }
        }
    }

    _updateConst(hr, cam) {
        if (!hr || !hr.multiHandLandmarks) return;
        const pos=this._constGeo.attributes.position.array; let ptr=0;
        for (const lms of hr.multiHandLandmarks) {
            const pts=lms.map(lm=>this._lm2w(lm,cam));
            for (let a=0;a<pts.length;a++) for (let b=a+1;b<pts.length;b++) {
                if (ptr+6>pos.length) break;
                pos[ptr++]=pts[a].x; pos[ptr++]=pts[a].y; pos[ptr++]=pts[a].z;
                pos[ptr++]=pts[b].x; pos[ptr++]=pts[b].y; pos[ptr++]=pts[b].z;
            }
        }
        this._constGeo.setDrawRange(0,ptr/3); this._constGeo.attributes.position.needsUpdate=true;
    }

    _updateFlow(hr, cam) {
        if (!hr || !hr.multiHandLandmarks) return;
        let fi=0;
        for (const lms of hr.multiHandLandmarks) {
            for (const tipIdx of [4,8,12,16,20]) {
                if (fi>=this._flowArr.length) break;
                const fp=this._flowArr[fi++], lm=lms[tipIdx]; if (!lm) continue;
                const wp=this._lm2w(lm,cam);
                fp.trail.unshift(wp.clone());
                if (fp.trail.length>42) fp.trail.pop();
                const arr=fp.geo.attributes.position.array;
                fp.trail.forEach((p,i)=>{ arr[i*3]=p.x; arr[i*3+1]=p.y; arr[i*3+2]=p.z; });
                fp.geo.setDrawRange(0,fp.trail.length); fp.geo.attributes.position.needsUpdate=true;
                fp.pts.visible=true;
            }
        }
    }

    setMode(mode) {
        this._mode=mode; this._setVis();
    }

    _setVis() {
        const core=this._mode==='CORE', cnst=this._mode==='CONSTELLATION', flow=this._mode==='FLOW';
        this._coreMeshes.forEach(m=>{m.visible=core&&this._active;});
        if (this._snapPts) this._snapPts.visible=false;
        if (this._constLines) this._constLines.visible=cnst&&this._active;
        this._flowArr.forEach(f=>{f.pts.visible=false; f.trail=[];});
    }

    activate() {
        this._active=true; this._setVis();
        if (this._mGain) this._mGain.gain.setTargetAtTime(0.7,this._ctx.currentTime,0.2);
    }

    deactivate() {
        this._active=false;
        this._coreMeshes.forEach(m=>{m.visible=false;});
        if (this._snapPts) this._snapPts.visible=false;
        if (this._constLines) this._constLines.visible=false;
        this._flowArr.forEach(f=>{f.pts.visible=false; f.trail=[];});
        if (this._mGain) this._mGain.gain.setTargetAtTime(0,this._ctx.currentTime,0.1);
    }

    update(hr, t, cam) {
        if (!this._active) return;
        if (this._mode==='CORE')           this._updateCore(hr, cam, t);
        else if (this._mode==='CONSTELLATION') this._updateConst(hr, cam);
        else if (this._mode==='FLOW')      this._updateFlow(hr, cam);
    }
}
