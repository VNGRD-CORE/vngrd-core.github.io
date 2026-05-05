// ═══════════════════════════════════════════════════════════════
// GIF DECODER MODULE — LZW decode + frame compositor for captureStream recording
// Extracted from main.js. No external dependencies.
// Exports: _gifLzwDecode, _decodeGIF (globals)
// ═══════════════════════════════════════════════════════════════

// ═══ INLINE GIF DECODER — extracts every frame as a canvas for captureStream recording ═══
// Parses GIF89a binary: LZW decode → composite frames → store canvases with delays
function _gifLzwDecode(data, mcs, count) {
    var cc=1<<mcs,eof=cc+1,cs=mcs+1,nc=eof+1,bp=0;
    var tbl=[],i; for(i=0;i<cc;i++)tbl[i]=[i]; tbl[cc]=[]; tbl[eof]=[];
    function rc(){var v=0;for(var b=0;b<cs;b++){var B=bp>>3,bi=bp&7;if(B<data.length)v|=((data[B]>>bi)&1)<<b;bp++;}return v;}
    var out=[],code=rc(),prev;
    if(code===cc){tbl=[];for(i=0;i<cc;i++)tbl[i]=[i];tbl[cc]=[];tbl[eof]=[];cs=mcs+1;nc=eof+1;code=rc();}
    prev=code; if(tbl[code])out.push.apply(out,tbl[code]);
    while(out.length<count){
        code=rc(); if(code===eof)break;
        if(code===cc){tbl=[];for(i=0;i<cc;i++)tbl[i]=[i];tbl[cc]=[];tbl[eof]=[];cs=mcs+1;nc=eof+1;code=rc();prev=code;if(tbl[code])out.push.apply(out,tbl[code]);continue;}
        var e=tbl[code]!=null?tbl[code]:(tbl[prev]?[...tbl[prev],tbl[prev][0]]:[0]);
        out.push.apply(out,e);
        if(tbl[prev]&&e.length)tbl[nc++]=[...tbl[prev],e[0]];
        if(nc>=(1<<cs)&&cs<12)cs++; prev=code;
    }
    return out;
}
function _decodeGIF(buf) {
    var u=new Uint8Array(buf),p=6;
    var sw=u[p]|u[p+1]<<8,sh=u[p+2]|u[p+3]<<8,fl=u[p+4];
    var hasGCT=(fl>>7)&1,gctSz=3*(2<<(fl&7)); p+=7;
    var gct=hasGCT?u.slice(p,p+gctSz):null; if(hasGCT)p+=gctSz;
    var frames=[],delay=100,transIdx=-1,disposal=0;
    var cc=document.createElement('canvas'); cc.width=sw; cc.height=sh;
    var cctx=cc.getContext('2d');
    var prevSnap=null;
    while(p<u.length){
        var b=u[p++];
        if(b===0x21){
            var lbl=u[p++];
            if(lbl===0xF9&&u[p]===4){
                p++; var gf=u[p++]; disposal=(gf>>2)&7;
                delay=(u[p]|u[p+1]<<8)*10; p+=2;
                transIdx=(gf&1)?u[p++]:-1; if(!(gf&1))p++; p++;
            } else { var sz2; while((sz2=u[p++])>0)p+=sz2; }
        } else if(b===0x2C){
            var ix=u[p]|u[p+1]<<8,iy=u[p+2]|u[p+3]<<8,iw=u[p+4]|u[p+5]<<8,ih=u[p+6]|u[p+7]<<8;
            var ilf=u[p+8],hasLCT=(ilf>>7)&1,interlace=(ilf>>6)&1,lctSz=3*(2<<(ilf&7)); p+=9;
            var ct=gct; if(hasLCT){ct=u.slice(p,p+lctSz);p+=lctSz;}
            var mcs2=u[p++],lzw=[],sz3; while((sz3=u[p++])>0){for(var j=0;j<sz3;j++)lzw.push(u[p++]);}
            var pxl=_gifLzwDecode(new Uint8Array(lzw),mcs2,iw*ih);
            if(disposal===3&&prevSnap)cctx.putImageData(prevSnap,0,0);
            var snap=null; if(disposal===3)snap=cctx.getImageData(0,0,sw,sh);
            var imgd=cctx.getImageData(ix,iy,iw,ih),d=imgd.data;
            // Build interlace row map
            var rowMap=new Uint16Array(ih);
            if(interlace){var ri2=0,ps=[[0,8],[4,8],[2,4],[1,2]];ps.forEach(function(ps){for(var r=ps[0];r<ih;r+=ps[1])rowMap[r]=ri2++;});}
            else{for(var ri3=0;ri3<ih;ri3++)rowMap[ri3]=ri3;}
            for(var row=0;row<ih;row++){var srcRow=interlace?rowMap[row]:row;for(var col=0;col<iw;col++){var pi2=(row*iw+col)*4,cidx=pxl[srcRow*iw+col];if(cidx===transIdx){d[pi2+3]=0;continue;}var ci3=cidx*3;d[pi2]=ct[ci3];d[pi2+1]=ct[ci3+1];d[pi2+2]=ct[ci3+2];d[pi2+3]=255;}}
            cctx.putImageData(imgd,ix,iy);
            var fc=document.createElement('canvas');fc.width=sw;fc.height=sh;fc.getContext('2d').drawImage(cc,0,0);
            frames.push({canvas:fc,delay:delay||100});
            prevSnap=snap;
            if(disposal===2)cctx.clearRect(ix,iy,iw,ih);
            delay=100;transIdx=-1;disposal=0;
        } else if(b===0x3B){break;}
        else{var sz4;while(p<u.length&&(sz4=u[p++])>0)p+=sz4;}
    }
    return{frames:frames,width:sw,height:sh};
}

