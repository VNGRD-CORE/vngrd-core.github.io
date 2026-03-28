---
name: web3
description: Web3, wallet, Metamask, ethers.js, NFT vault, Alchemy API, ERC-20/721, sovereign mode, signing
---

# VNGRD Web3 Skill

## Stack
- **ethers.js v5.7.2** — wallet/contract interactions
- **Metamask** — `window.ethereum` provider
- **Alchemy API** — NFT vault scanning (key via `ALCHEMY_KEY`)
- **Modes**: "sovereign" (Metamask connected) / "guest" (unauthenticated)

## Rules
- Never hardcode private keys or API keys — use `.env` / GitHub Actions secrets
- Alchemy key lives in `.env.example` as `ALCHEMY_KEY`; falls back to demo key
- Always check `window.ethereum` exists before calling it
- Wrap wallet calls in try/catch — users may reject or have no wallet
- Message signing must be triggered by a user gesture

## Common Patterns

### Connect wallet
```js
const provider = new ethers.providers.Web3Provider(window.ethereum);
await provider.send("eth_requestAccounts", []);
const signer = provider.getSigner();
```

### Sign message
```js
const sig = await signer.signMessage("VNGRD//AUTH");
```

### Query NFTs via Alchemy
```js
const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner?owner=${address}`;
```

## Debugging Checklist
- [ ] Is `window.ethereum` defined? (Metamask installed?)
- [ ] Did user approve the connection request?
- [ ] Is the Alchemy key valid and not rate-limited?
- [ ] Are you on the correct network (mainnet vs testnet)?
- [ ] Is ethers.js loaded before any Web3 calls?
- [ ] Check CORS — Alchemy calls must come from allowed origins
