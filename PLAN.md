# Raycast Extension Plan: Transcriber

## Overview

Convert the web-based transcriber into a native Raycast extension. User selects an audio file, it transcribes via AssemblyAI with speaker diarization, displays the formatted transcript, and offers copy/download actions.

## Architecture Decision: Two Commands

### Command 1: "Transcribe Audio" (Form → Detail)
- Opens a **Form** to select audio file + set language/speakers/title
- On submit: uploads to AssemblyAI, polls, shows **Detail** view with formatted transcript
- Actions: Copy Markdown, Save .md file, Open in editor

### Command 2: "Transcribe from Clipboard" (no-view quick action)
- If clipboard contains a file path to an audio file → auto-transcribe
- Quick trigger for power users

## Project Structure

```
/Users/p/Desktop/v/tools/transcriber/raycast-extension/
├── package.json          # Raycast manifest (commands, preferences)
├── tsconfig.json
├── src/
│   ├── transcribe.tsx    # Main command: Form → submit → Detail view
│   ├── api.ts            # AssemblyAI client (upload, create, poll)
│   ├── preferences.ts    # Type-safe preference access
│   ├── types.ts          # Utterance, TranscriptData interfaces
│   └── format.ts         # Markdown formatting (reuse from web version)
└── assets/
    └── extension-icon.png
```

## Pattern Matching (from your existing extensions)

| Pattern | Source | How We Use It |
|---------|--------|---------------|
| Preferences for API key | FastWhatsApp `preferences.ts` | Store AssemblyAI key as `password` type preference |
| Detail view for markdown output | FastyTranscript `fetch-youtube-transcript.tsx` | Display formatted transcript in Detail view |
| Toast for progress/status | Both extensions | Show upload/processing/done toasts |
| Clipboard integration | FastyTranscript | Copy transcript to clipboard on completion |
| Typed API client | FastWhatsApp `api.ts` | AssemblyAI client with typed interfaces |
| getPreferenceValues<T>() | Both | Type-safe preference reading |

## package.json Manifest

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "transcriber",
  "title": "Transcriber",
  "description": "Transcribe audio files with speaker diarization via AssemblyAI",
  "icon": "extension-icon.png",
  "author": "diegooprime",
  "categories": ["Productivity", "Media"],
  "license": "MIT",
  "commands": [
    {
      "name": "transcribe",
      "title": "Transcribe Audio",
      "description": "Select an audio file to transcribe with speaker labels",
      "mode": "view"
    }
  ],
  "preferences": [
    {
      "name": "assemblyaiKey",
      "title": "AssemblyAI API Key",
      "description": "Your AssemblyAI API key for transcription",
      "type": "password",
      "required": true
    },
    {
      "name": "defaultLanguage",
      "title": "Default Language",
      "description": "Default transcription language",
      "type": "dropdown",
      "required": false,
      "default": "es",
      "data": [
        {"title": "Spanish", "value": "es"},
        {"title": "English", "value": "en"},
        {"title": "Portuguese", "value": "pt"},
        {"title": "French", "value": "fr"},
        {"title": "German", "value": "de"}
      ]
    },
    {
      "name": "defaultSpeakers",
      "title": "Default Expected Speakers",
      "description": "Default number of speakers (leave empty for auto)",
      "type": "textfield",
      "required": false
    }
  ],
  "dependencies": {
    "@raycast/api": "^1.103.10",
    "@raycast/utils": "^1.19.1"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^1.0.8",
    "@types/node": "~20.10.0",
    "@types/react": "^18.2.0",
    "eslint": "^8.54.0",
    "typescript": "^5.3.2"
  },
  "scripts": {
    "build": "ray build -e dist",
    "dev": "ray develop",
    "fix-lint": "ray lint --fix",
    "lint": "ray lint"
  }
}
```

## UX Flow

### Step 1: Form (select file + options)
```
┌─────────────────────────────────────┐
│ 🎙️ Transcribe Audio                │
│                                     │
│ Audio File: [Browse...]      (req)  │
│ Title:      [Meeting notes]  (opt)  │
│ Language:   [Spanish ▾]      (pref) │
│ Speakers:   [2]              (opt)  │
│                                     │
│           [Transcribe →]            │
└─────────────────────────────────────┘
```

### Step 2: Processing (Toast + Loading Detail)
```
Toast: "Uploading audio..." → "Transcribing..." → "Done!"
Detail view shows loading spinner during processing
```

### Step 3: Result (Detail view with actions)
```
┌─────────────────────────────────────┐
│ # Transcripción — Meeting notes     │
│ **Duration:** 21 min 54 sec         │
│ **Participants:** Ben, Diego        │
│                                     │
│ [00:03] **Ben:** Entonces tienes... │
│ [00:58] **Diego:** Es un problema...│
│ ...                                 │
│                                     │
│ Actions:                            │
│ ⌘C Copy Markdown                   │
│ ⌘S Save as .md                     │
│ ⌘⇧C Copy Plain Text               │
└─────────────────────────────────────┘
```

## Key Implementation Details

### api.ts — AssemblyAI Client
```typescript
// Same 3-step flow as web version:
// 1. upload(file: Buffer) → upload_url
// 2. createTranscript(upload_url, opts) → transcript_id
// 3. pollTranscript(id) → TranscriptData

// Key difference: use fs.readFile instead of FormData
// Raycast runs in Node.js, not browser
```

### transcribe.tsx — Main Command
```typescript
// Phase 1: Form view (file picker, title, language, speakers)
// Phase 2: On submit → switch to Detail view with isLoading=true
// Phase 3: Upload + poll with toast updates
// Phase 4: Render markdown in Detail view
// Phase 5: ActionPanel with Copy, Save, Open actions
```

### Speaker Renaming
- After transcript loads, show Action: "Rename Speakers"
- Push a new Form view for speaker name mapping
- On submit, re-render the Detail view with updated names

### File Selection
- Raycast Form has `Form.FilePicker` component
- Accepts file path, we read it with `fs.readFile`
- Filter for audio extensions

## Implementation Steps

1. **Scaffold** — `npx create-raycast-extension` or manual setup matching fasty/wapp patterns
2. **Types + Preferences** — `types.ts`, `preferences.ts` (copy pattern from FastWhatsApp)
3. **API Client** — `api.ts` with upload/create/poll (port from web index.ts)
4. **Formatter** — `format.ts` with markdown builder (port from web app.ts buildMarkdown)
5. **Main Command** — `transcribe.tsx` Form → Detail flow
6. **Actions** — Copy, Save, Rename speakers
7. **Test** — `ray develop`, transcribe a test file
8. **Polish** — Icon, error handling, edge cases

## Files to Create

| File | Lines (est) | What it does |
|------|-------------|-------------|
| `package.json` | 70 | Manifest |
| `tsconfig.json` | 15 | TypeScript config |
| `src/types.ts` | 25 | Interfaces |
| `src/preferences.ts` | 20 | Preference helpers |
| `src/api.ts` | 90 | AssemblyAI client |
| `src/format.ts` | 40 | Markdown builder |
| `src/transcribe.tsx` | 180 | Main command |
| **Total** | ~440 | |

## Risk: Long-Running Requests

AssemblyAI transcription takes 30-90 seconds. Raycast extensions shouldn't freeze. Solution:
- Use `useEffect` + `useState` for async state (same pattern as FastyTranscript)
- Show `isLoading=true` on Detail while polling
- Toast updates for each phase (uploading → processing → done)
- Raycast keeps the view alive during loading — this is the standard pattern

## Risk: Large File Uploads

Audio files can be 50-500MB. Solution:
- Read file as Buffer with `Bun.file()` or `fs.readFile`
- Stream to AssemblyAI upload endpoint
- Show toast with file size during upload
