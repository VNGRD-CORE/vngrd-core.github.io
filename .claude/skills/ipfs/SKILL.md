---
name: ipfs
description: IPFS, Pinata, NFT pinning, media upload, decentralized storage, CID, IPFS gateway, export
---

# VNGRD IPFS Skill

## Stack
- **Pinata** — IPFS pinning service
- **Backend endpoint**: `POST /export-to-pinata` (`backend/main.py`)
- **Auth**: `PINATA_JWT` in `backend/.env`

## Pinata Upload (from backend)
```python
import httpx

async def pin_to_ipfs(file_bytes: bytes, filename: str, jwt: str) -> str:
    url = "https://api.pinata.cloud/pinning/pinFileToIPFS"
    headers = {"Authorization": f"Bearer {jwt}"}
    files = {"file": (filename, file_bytes)}
    async with httpx.AsyncClient() as client:
        r = await client.post(url, headers=headers, files=files)
        r.raise_for_status()
        cid = r.json()["IpfsHash"]
    return f"ipfs://{cid}"
```

## Accessing Pinned Content
```js
// Public gateway (for display/preview)
const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
// or
const gatewayUrl = `https://ipfs.io/ipfs/${cid}`;
```

## Frontend → Backend Upload Flow
```js
const formData = new FormData();
formData.append('file', blob, 'recording.webm');
const res = await fetch('/export-to-pinata', { method: 'POST', body: formData });
const { cid } = await res.json();
```

## Use Cases in VNGRD
- Pin recorded WebM broadcasts to IPFS
- Pin AI-generated images (FAL/Pollinations output)
- Store NFT metadata JSON on IPFS before minting
- Archive transcription SRT files

## Debugging Checklist
- [ ] `PINATA_JWT` set in `backend/.env`?
- [ ] Backend server running before frontend calls `/export-to-pinata`?
- [ ] File size within Pinata free tier limits?
- [ ] CID returned and stored? (needed to retrieve later)
- [ ] Using HTTPS gateway URLs (not raw `ipfs://`) for browser display?
