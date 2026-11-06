# transcriber

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.7. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Watcher reliability

The watcher keeps existing files. Transcript and archive filename collisions get a numbered suffix, such as `Recording (1).md`. A completed response without speaker utterances still saves its plain text. A genuinely empty response is labeled as no detected speech.

The watcher stores a small checkpoint in `WATCH_FOLDER/.transcriber-state/` for each recording name and content hash. These files contain transcript text and service job IDs, so treat them as private. Polling and local-file failures resume the same job. A failure after a submission request but before its ID is saved pauses automatic resubmission, since another request could create a second paid job. The error gives the checkpoint path. Inspect the service result before repairing or removing that checkpoint; do not delete state files as routine cleanup while their source recording remains in the watch folder.

Source recordings stay in place if output or archive writes fail. If the source changes during transcription, the earlier bytes and their transcript are preserved and the newer recording stays available. A replacement caught during the final move is retained under `.processed/.pending-*` and its exact recovery path is logged. Move that recording back to the inbox when ready to transcribe it.

Run only one watcher for a given inbox. Scans run sequentially; failed files wait at least one minute before another attempt. The watcher does not suppress all future recordings merely because a filename was used before.

Local tests do not upload audio or call AssemblyAI:

```sh
bun test
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --noUncheckedIndexedAccess --module Preserve --moduleResolution bundler --target ESNext --lib ESNext --types bun watcher.ts watcher-core.ts watcher.test.ts
```

## Automatic audio inbox

The folder watcher is separate from the existing browser uploader. Its LaunchAgent is `com.transcriber.watcher`.

Current state, October 12, 2026: enabled and running with a local Desktop inbox, using the existing Desktop permission. iCloud Drive access is not needed. A 26-second synthetic English/Spanish recording completed automatically with Universal-3.5 Pro, saved a Markdown transcript on Desktop, and archived the original with an identical SHA-256 hash. No privacy settings were changed.

- Input: `/Users/p/Desktop/Transcriber` (Desktop → Transcriber).
- Output: `/Users/p/Desktop`, one Markdown transcript per recording, with numbered suffixes when names collide.
- Original audio: preserved in the inbox's `.processed` folder after successful transcript and archive writes.
- Model: AssemblyAI **Universal-3.5 Pro**, pinned as `universal-3-5-pro`, with speaker labels and automatic language detection. English/Spanish and natural language switching are supported. The transcript records the model actually returned by the service rather than assuming which model ran.
- Accepted extensions: `.m4a`, `.mp3`, `.wav`, `.caf`, `.aac`, `.ogg`, `.webm`, `.flac`, `.opus`, `.aiff`, `.aif`. Files must finish copying before processing starts.
- Credentials: Bun loads the existing local `.env` from this project's working directory. The LaunchAgent contains paths and language settings, never the API key.
- Logs: `/tmp/transcriber-watcher.log` and `/tmp/transcriber-watcher.err`.

Model sources checked October 12, 2026: [official model selection](https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model) and [Universal-3.5 Pro async release](https://www.assemblyai.com/blog/universal-3-5-pro-async). Universal-3.6 Pro is currently a streaming model; this watcher transcribes completed files.

This setup uses Bun’s existing Desktop permission. A running LaunchAgent with `EPERM` in its error log is not a working watcher; inspect the logs if files are not processed. Do not alter the browser service `com.diegooprime.transcriber`.

```sh
# Stop this watcher (keeps recordings, transcripts, and checkpoints).
launchctl bootout gui/$(id -u)/com.transcriber.watcher
# Start only when explicitly wanted, after granting the needed folder permissions.
launchctl enable gui/$(id -u)/com.transcriber.watcher
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.transcriber.watcher.plist"
# Check whether it is running, then inspect the logs above.
launchctl print gui/$(id -u)/com.transcriber.watcher
```

Launching this watcher processes eligible files already in the input folder. Inspect the inbox before enabling it after a long pause. Keep checkpoints and archives intact to prevent duplicate paid submissions and preserve recordings.
