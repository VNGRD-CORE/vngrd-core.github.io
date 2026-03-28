---
name: p2p
description: P2P calling, WebRTC, PeerJS, peer connections, guest mode bridge, streaming audio/video
---

# VNGRD P2P / WebRTC Skill

## Stack
- **PeerJS v1.5.2** — decentralized peer-to-peer calling
- **WebRTC** — direct audio/video streaming
- **Guest Mode** — WebRTC bridge for unauthenticated peers

## Rules (from CLAUDE.md)
- Always use `secure: true` and `port: 443` in PeerJS config
- Redirect ALL peer/call logging to the `GHOST> ` terminal in the UI — NOT `console.log`
- Never expose raw ICE candidates or SDP in the UI

## Correct PeerJS Config
```js
const peer = new Peer(peerId, {
  secure: true,
  port: 443,
  // optional: host: 'your-signaling-server.com'
});
```

## Logging to GHOST Terminal
```js
function ghostLog(msg) {
  const terminal = document.querySelector('#ghost-terminal') // adjust selector
  if (terminal) terminal.innerText += `\nGHOST> ${msg}`;
}
```

## Call Flow
```js
// Caller
const call = peer.call(remotePeerId, localStream);
call.on('stream', remoteStream => { /* attach to <video> */ });

// Receiver
peer.on('call', call => {
  call.answer(localStream);
  call.on('stream', remoteStream => { /* attach to <video> */ });
});
```

## Debugging Checklist
- [ ] Is `secure: true` and `port: 443` set?
- [ ] Does the user have camera/mic permissions?
- [ ] Is `getUserMedia` called before `peer.call()`?
- [ ] Are errors going to GHOST terminal, not console?
- [ ] Check for ICE connection failures (firewall/NAT issues)
- [ ] Is PeerJS signaling server reachable?
- [ ] Is the remote peer ID correct and online?
