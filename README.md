# transcriber

Drop audio or video files in the browser and get speaker-tagged transcripts (AssemblyAI).

Runs on the VPS as the `agent` user's systemd unit `transcriber.service` (`withkeys bun run index.ts`, 127.0.0.1:3456), served on the tailnet at https://vps.taildc84b3.ts.net:8449. The key comes from `ASSEMBLYAI_API_KEY` via `withkeys`.

```bash
bun install
withkeys bun run index.ts   # local dev
bun test
```
