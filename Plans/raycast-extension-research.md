# Raycast Extension Technical Research
## For: Audio Transcription Extension (AssemblyAI + Speaker Diarization)

---

## 1. Project Structure

```
transcriber-raycast/
├── assets/
│   └── extension-icon.png          # 512x512 PNG (required)
├── src/
│   ├── transcribe.tsx               # Main command entry point
│   └── utils/
│       └── assemblyai.ts            # API helper functions
├── package.json                     # Manifest + metadata (required)
├── tsconfig.json                    # TypeScript config
├── eslint.config.js                 # Linting
├── .prettierrc                      # Formatting
└── raycast-env.d.ts                 # Auto-generated types for preferences
```

**Command name mapping:** A command with `"name": "transcribe"` in package.json maps to `src/transcribe.tsx`.

---

## 2. package.json Manifest

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "transcriber",
  "title": "Audio Transcriber",
  "description": "Transcribe audio files with speaker diarization using AssemblyAI",
  "icon": "extension-icon.png",
  "author": "your-raycast-username",
  "categories": ["Productivity"],
  "license": "MIT",
  "platforms": ["macOS"],
  "commands": [
    {
      "name": "transcribe",
      "title": "Transcribe Audio",
      "subtitle": "AssemblyAI",
      "description": "Select an audio file and transcribe it with speaker labels",
      "mode": "view",
      "keywords": ["audio", "transcript", "speech", "diarization"]
    }
  ],
  "preferences": [
    {
      "name": "assemblyaiApiKey",
      "title": "AssemblyAI API Key",
      "description": "Your AssemblyAI API key for transcription",
      "type": "password",
      "required": true,
      "placeholder": "Enter your AssemblyAI API key"
    },
    {
      "name": "outputDirectory",
      "title": "Output Directory",
      "description": "Where to save transcript markdown files",
      "type": "directory",
      "required": false,
      "placeholder": "~/Desktop"
    }
  ],
  "dependencies": {
    "@raycast/api": "^1.83.0",
    "@raycast/utils": "^1.17.0",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^1.0.11",
    "@types/node": "22.10.2",
    "eslint": "^8.57.0",
    "prettier": "^3.4.2",
    "typescript": "^5.7.2"
  },
  "scripts": {
    "build": "ray build",
    "dev": "ray develop",
    "fix-lint": "ray lint --fix",
    "lint": "ray lint",
    "publish": "npx @raycast/api@latest publish"
  }
}
```

### Command modes:
- `"view"` -- renders a React UI (List, Detail, Form)
- `"no-view"` -- background command, no UI (uses showToast/showHUD)
- `"menu-bar"` -- Menu Bar Extra icon

### Preference types:
- `"textfield"` -- plain text
- `"password"` -- masked text (for API keys)
- `"checkbox"` -- boolean toggle
- `"dropdown"` -- select from options (needs `data` array)
- `"appPicker"` -- pick an application
- `"file"` -- file picker
- `"directory"` -- directory picker

---

## 3. File Input: Form.FilePicker

Raycast has a **native `Form.FilePicker`** component. No need for file drops -- users pick files through a native macOS file dialog.

```tsx
import { Form, ActionPanel, Action } from "@raycast/api";
import { useState } from "react";

interface FormValues {
  audioFile: string[];
}

export default function Command() {
  const [files, setFiles] = useState<string[]>([]);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Transcribe"
            onSubmit={(values: FormValues) => {
              const filePath = values.audioFile[0]; // First selected file
              transcribeFile(filePath);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="audioFile"
        title="Audio File"
        allowMultipleSelection={false}
        canChooseDirectories={false}
        canChooseFiles={true}
        value={files}
        onChange={setFiles}
      />
    </Form>
  );
}
```

### Form.FilePicker Props:
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | string | required | Unique identifier |
| `title` | string | | Label text |
| `allowMultipleSelection` | boolean | false | Multi-select |
| `canChooseFiles` | boolean | true | Allow file selection |
| `canChooseDirectories` | boolean | false | Allow directory selection |
| `showHiddenFiles` | boolean | false | Show hidden files |
| `value` | string[] | | Controlled mode - array of file paths |
| `onChange` | (paths: string[]) => void | | Change handler |
| `storeValue` | boolean | false | Persist after submit |
| `error` | string | | Validation error message |
| `info` | string | | Info tooltip text |

**Return value:** Array of absolute file paths as strings.

---

## 4. Making API Calls

Raycast extensions run in Node.js. Use `node-fetch` or the built-in `fetch` (available in newer Node versions). Also, `@raycast/utils` provides a `useFetch` hook.

### Pattern A: Direct fetch with node-fetch

```tsx
import fetch from "node-fetch";
import * as fs from "fs";
import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  assemblyaiApiKey: string;
  outputDirectory?: string;
}

// Upload file to AssemblyAI
async function uploadFile(filePath: string): Promise<string> {
  const { assemblyaiApiKey } = getPreferenceValues<Preferences>();

  const fileBuffer = fs.readFileSync(filePath);

  const response = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      authorization: assemblyaiApiKey,
      "content-type": "application/octet-stream",
    },
    body: fileBuffer,
  });

  const data = (await response.json()) as { upload_url: string };
  return data.upload_url;
}

// Start transcription with speaker diarization
async function startTranscription(audioUrl: string): Promise<string> {
  const { assemblyaiApiKey } = getPreferenceValues<Preferences>();

  const response = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: assemblyaiApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
    }),
  });

  const data = (await response.json()) as { id: string };
  return data.id;
}

// Poll for completion
async function pollTranscription(transcriptId: string): Promise<TranscriptResult> {
  const { assemblyaiApiKey } = getPreferenceValues<Preferences>();

  while (true) {
    const response = await fetch(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      {
        headers: { authorization: assemblyaiApiKey },
      }
    );

    const data = (await response.json()) as TranscriptResult;

    if (data.status === "completed") return data;
    if (data.status === "error") throw new Error(data.error || "Transcription failed");

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
```

### Pattern B: useFetch hook (for simpler GET requests)

```tsx
import { useFetch } from "@raycast/utils";

function TranscriptStatus({ transcriptId }: { transcriptId: string }) {
  const { assemblyaiApiKey } = getPreferenceValues<Preferences>();

  const { data, isLoading } = useFetch(
    `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
    {
      headers: { authorization: assemblyaiApiKey },
    }
  );

  // ...
}
```

---

## 5. Progress / Loading States

### Animated Toast (primary pattern for async operations):

```tsx
import { showToast, Toast } from "@raycast/api";

async function transcribeWithProgress(filePath: string) {
  // Show animated loading toast
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Uploading audio file...",
  });

  try {
    const uploadUrl = await uploadFile(filePath);

    toast.title = "Starting transcription...";
    const transcriptId = await startTranscription(uploadUrl);

    toast.title = "Transcribing...";
    toast.message = "This may take a few minutes";
    const result = await pollTranscription(transcriptId);

    toast.style = Toast.Style.Success;
    toast.title = "Transcription complete!";
    toast.message = undefined;

    return result;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Transcription failed";
    toast.message = String(error);
    throw error;
  }
}
```

### Component-level loading:

```tsx
// Detail and Form both support isLoading prop
<Detail markdown={transcript} isLoading={isProcessing} />
<Form isLoading={isUploading}>...</Form>
```

### Toast.Style values:
- `Toast.Style.Animated` -- spinning indicator, for in-progress operations
- `Toast.Style.Success` -- green checkmark
- `Toast.Style.Failure` -- red X mark

### Toast properties (mutable after creation):
- `toast.style` -- change the style
- `toast.title` -- update title
- `toast.message` -- update subtitle message
- `toast.hide()` -- dismiss the toast
- `toast.show()` -- show a hidden toast

---

## 6. Displaying Formatted Text (Detail Component)

The `Detail` component renders **CommonMark markdown** with optional metadata sidebar.

```tsx
import { Detail } from "@raycast/api";

interface TranscriptResult {
  utterances: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
  }>;
  text: string;
}

function TranscriptView({ result }: { result: TranscriptResult }) {
  const markdown = formatTranscript(result);

  return (
    <Detail
      markdown={markdown}
      navigationTitle="Transcript"
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy as Markdown"
            content={markdown}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <Action
            title="Save as File"
            shortcut={{ modifiers: ["cmd"], key: "s" }}
            onAction={() => saveTranscriptFile(markdown)}
          />
          <Action.CopyToClipboard
            title="Copy Plain Text"
            content={result.text}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Speakers"
            text={`${countSpeakers(result)} detected`}
          />
          <Detail.Metadata.Label
            title="Duration"
            text={formatDuration(result)}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Words"
            text={`${result.text.split(" ").length}`}
          />
        </Detail.Metadata>
      }
    />
  );
}

function formatTranscript(result: TranscriptResult): string {
  let md = "# Transcript\n\n";

  for (const utterance of result.utterances) {
    const timestamp = formatTimestamp(utterance.start);
    md += `**Speaker ${utterance.speaker}** _[${timestamp}]_\n\n`;
    md += `${utterance.text}\n\n---\n\n`;
  }

  return md;
}
```

### Detail Props:
| Prop | Type | Description |
|------|------|-------------|
| `markdown` | string | CommonMark content to render |
| `isLoading` | boolean | Shows loading bar |
| `navigationTitle` | string | Title in the navigation bar |
| `metadata` | ReactNode | Right-side metadata panel |
| `actions` | ReactNode | ActionPanel |

### Detail.Metadata subcomponents:
- `Detail.Metadata.Label` -- key-value pair with optional icon
- `Detail.Metadata.Link` -- clickable link
- `Detail.Metadata.TagList` -- colored tags
- `Detail.Metadata.Separator` -- visual divider

---

## 7. Clipboard & File Operations

### Copy to clipboard:

```tsx
import { Clipboard } from "@raycast/api";

// Programmatic copy
await Clipboard.copy("text to copy");
await Clipboard.copy({ text: "plain", html: "<b>rich</b>" });

// As an Action component
<Action.CopyToClipboard content={markdownText} title="Copy Transcript" />
```

### Save file to disk:

```tsx
import { environment, showToast, Toast, open } from "@raycast/api";
import * as fs from "fs/promises";
import * as path from "path";

async function saveTranscriptFile(markdown: string, filename: string) {
  const { outputDirectory } = getPreferenceValues<Preferences>();

  // Use user's preferred directory, or fallback to Desktop
  const dir = outputDirectory || path.join(process.env.HOME || "", "Desktop");
  const filePath = path.join(dir, `${filename}.md`);

  await fs.writeFile(filePath, markdown, "utf-8");

  await showToast({
    style: Toast.Style.Success,
    title: "Transcript saved",
    message: filePath,
    primaryAction: {
      title: "Open File",
      onAction: () => open(filePath),
    },
  });
}
```

### Show in Finder:

```tsx
<Action.ShowInFinder path={savedFilePath} title="Show in Finder" />
```

### Open file:

```tsx
<Action.Open target={filePath} title="Open Transcript" />
```

### Environment paths:
- `environment.supportPath` -- persistent storage per extension (for caches, databases)
- `environment.assetsPath` -- read-only assets directory

---

## 8. Preferences (API Key Storage)

### Define in package.json:

```json
{
  "preferences": [
    {
      "name": "assemblyaiApiKey",
      "title": "AssemblyAI API Key",
      "description": "API key from assemblyai.com/dashboard",
      "type": "password",
      "required": true,
      "placeholder": "Enter your API key"
    }
  ]
}
```

### Access in code:

```tsx
import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  assemblyaiApiKey: string;
  outputDirectory?: string;
}

export default function Command() {
  const { assemblyaiApiKey, outputDirectory } = getPreferenceValues<Preferences>();

  // assemblyaiApiKey is guaranteed to exist (required: true)
  // outputDirectory may be undefined (required: false)
}
```

### Type mapping:
| package.json type | TypeScript type |
|---|---|
| `"textfield"` | `string` |
| `"password"` | `string` |
| `"checkbox"` | `boolean` |
| `"dropdown"` | `string` |
| `"appPicker"` | `Application` |
| `"file"` | `string` (file path) |
| `"directory"` | `string` (directory path) |

### Auto-generated types:
Raycast generates `raycast-env.d.ts` with a `Preferences` namespace. You can reference `Preferences.Transcribe` (matching command name) for command-specific preferences.

**Password type** is critical for API keys -- it masks the input and prevents it from being included in form drafts.

---

## 9. Scaffolding with create-raycast-extension

```bash
npx create-raycast-extension@latest
```

### Interactive prompts:
1. **Extension name** -- unique slug
2. **Extension title** -- display name
3. **Template** -- Detail, Form, List, etc.
4. **Location** -- parent directory

### Or with flags:
```bash
npx create-raycast-extension@latest \
  --name transcriber \
  --title "Audio Transcriber" \
  --template detail
```

### What it creates:
```
transcriber/
├── assets/
│   └── extension-icon.png
├── src/
│   └── index.tsx              # Template-based starter
├── package.json               # Pre-configured manifest
├── tsconfig.json
├── eslint.config.js
├── .prettierrc
└── raycast-env.d.ts
```

### Running in development:
```bash
cd transcriber
npm install
npm run dev
```

`npm run dev` starts hot-reloading. Edit code, save, and changes appear instantly in Raycast. Press Ctrl+C to stop.

---

## 10. Key API Components Reference

### Form -- Collect user input
```tsx
<Form actions={<ActionPanel>...</ActionPanel>}>
  <Form.TextField id="name" title="Name" />
  <Form.FilePicker id="file" title="File" />
  <Form.Dropdown id="type" title="Type">
    <Form.Dropdown.Item value="mp3" title="MP3" />
    <Form.Dropdown.Item value="wav" title="WAV" />
  </Form.Dropdown>
  <Form.Checkbox id="diarize" label="Speaker diarization" defaultValue={true} />
  <Form.Separator />
  <Form.Description text="Select an audio file to transcribe" />
</Form>
```

### List -- Display scrollable items
```tsx
<List isLoading={loading}>
  <List.Item title="Item" subtitle="description" />
  <List.Section title="Section">
    <List.Item title="Grouped Item" />
  </List.Section>
</List>
```

### Detail -- Show rich markdown content
```tsx
<Detail
  markdown="# Title\n\nBody text..."
  isLoading={false}
  metadata={<Detail.Metadata>...</Detail.Metadata>}
  actions={<ActionPanel>...</ActionPanel>}
/>
```

### ActionPanel -- User actions
```tsx
<ActionPanel>
  <ActionPanel.Section title="Transcript">
    <Action.CopyToClipboard content={text} title="Copy" />
    <Action.Paste content={text} title="Paste" />
    <Action
      title="Custom Action"
      icon={Icon.Download}
      onAction={() => doSomething()}
    />
  </ActionPanel.Section>
  <ActionPanel.Section title="File">
    <Action.ShowInFinder path={filePath} />
    <Action.Open target={filePath} />
    <Action.Trash paths={filePath} />
  </ActionPanel.Section>
</ActionPanel>
```

### showToast -- Notifications
```tsx
// Quick success
await showToast(Toast.Style.Success, "Done!");

// Animated with updates
const toast = await showToast({ style: Toast.Style.Animated, title: "Working..." });
toast.title = "Almost done...";
toast.style = Toast.Style.Success;
toast.title = "Complete!";
```

### Action.Push -- Navigation
```tsx
<Action.Push
  title="View Transcript"
  target={<TranscriptDetail result={data} />}
/>
```

### useNavigation -- Programmatic navigation
```tsx
import { useNavigation } from "@raycast/api";

const { push, pop } = useNavigation();
push(<TranscriptDetail result={data} />);
```

---

## Complete Extension Architecture for Transcriber

```
User Flow:
1. User triggers "Transcribe Audio" command
2. Form appears with Form.FilePicker
3. User selects audio file, presses Enter
4. Animated toast: "Uploading..."
5. Upload file to AssemblyAI /v2/upload
6. Toast updates: "Transcribing..."
7. Start transcription with speaker_labels: true
8. Poll /v2/transcript/{id} every 3 seconds
9. Toast updates: "Processing... 50%"  (if percentage available)
10. On completion: push Detail view with formatted markdown
11. Actions: Copy as Markdown, Save as .md, Copy Plain Text
```

### Skeleton implementation:

```tsx
// src/transcribe.tsx
import {
  Form,
  ActionPanel,
  Action,
  Detail,
  showToast,
  Toast,
  getPreferenceValues,
  useNavigation,
  Icon,
  Clipboard,
  open,
} from "@raycast/api";
import { useState } from "react";
import fetch from "node-fetch";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

interface Preferences {
  assemblyaiApiKey: string;
  outputDirectory?: string;
}

interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface TranscriptResult {
  id: string;
  status: string;
  text: string;
  utterances: Utterance[];
  error?: string;
  audio_duration?: number;
}

// ---- API Functions ----

async function uploadAudio(filePath: string, apiKey: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const res = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/octet-stream",
    },
    body: fileBuffer,
  });
  const data = (await res.json()) as { upload_url: string };
  return data.upload_url;
}

async function createTranscript(audioUrl: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
    }),
  });
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function pollTranscript(id: string, apiKey: string): Promise<TranscriptResult> {
  while (true) {
    const res = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    const data = (await res.json()) as TranscriptResult;
    if (data.status === "completed") return data;
    if (data.status === "error") throw new Error(data.error || "Transcription failed");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---- Formatting ----

function formatTimestamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0
    ? `${h}:${pad(m % 60)}:${pad(s % 60)}`
    : `${m}:${pad(s % 60)}`;
}

function formatMarkdown(result: TranscriptResult, fileName: string): string {
  let md = `# Transcript: ${fileName}\n\n`;
  const speakers = new Set(result.utterances.map((u) => u.speaker));
  md += `**${speakers.size} speakers detected**\n\n---\n\n`;

  for (const u of result.utterances) {
    md += `**Speaker ${u.speaker}** _[${formatTimestamp(u.start)}]_\n\n`;
    md += `${u.text}\n\n---\n\n`;
  }
  return md;
}

// ---- Views ----

function TranscriptDetail({ result, fileName }: { result: TranscriptResult; fileName: string }) {
  const markdown = formatMarkdown(result, fileName);
  const speakers = new Set(result.utterances.map((u) => u.speaker));

  async function saveFile() {
    const { outputDirectory } = getPreferenceValues<Preferences>();
    const dir = outputDirectory || path.join(process.env.HOME || "", "Desktop");
    const safeName = fileName.replace(/\.[^.]+$/, "");
    const filePath = path.join(dir, `${safeName}-transcript.md`);
    await fsp.writeFile(filePath, markdown, "utf-8");
    await showToast({
      style: Toast.Style.Success,
      title: "Saved",
      message: filePath,
      primaryAction: {
        title: "Open File",
        onAction: () => open(filePath),
      },
    });
  }

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`Transcript: ${fileName}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Speakers" text={`${speakers.size}`} />
          <Detail.Metadata.Label title="Words" text={`${result.text.split(" ").length}`} />
          {result.audio_duration && (
            <Detail.Metadata.Label title="Duration" text={formatTimestamp(result.audio_duration * 1000)} />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy as Markdown"
            content={markdown}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <Action
            title="Save as Markdown File"
            icon={Icon.Download}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
            onAction={saveFile}
          />
          <Action.CopyToClipboard
            title="Copy Plain Text"
            content={result.text}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}

// ---- Main Command ----

export default function Command() {
  const { push } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { audioFile: string[] }) {
    const filePath = values.audioFile[0];
    if (!filePath) {
      await showToast(Toast.Style.Failure, "No file selected");
      return;
    }

    const fileName = path.basename(filePath);
    const { assemblyaiApiKey } = getPreferenceValues<Preferences>();
    setIsLoading(true);

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Uploading audio...",
      message: fileName,
    });

    try {
      const uploadUrl = await uploadAudio(filePath, assemblyaiApiKey);

      toast.title = "Starting transcription...";
      const transcriptId = await createTranscript(uploadUrl, assemblyaiApiKey);

      toast.title = "Transcribing audio...";
      toast.message = "This may take a few minutes";
      const result = await pollTranscript(transcriptId, assemblyaiApiKey);

      toast.style = Toast.Style.Success;
      toast.title = "Transcription complete!";
      toast.message = undefined;

      push(<TranscriptDetail result={result} fileName={fileName} />);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Transcription failed";
      toast.message = String(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Transcribe" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="audioFile"
        title="Audio File"
        allowMultipleSelection={false}
        canChooseDirectories={false}
      />
      <Form.Separator />
      <Form.Description text="Supported: MP3, WAV, M4A, FLAC, OGG, WebM, and more" />
    </Form>
  );
}
```

---

## Sources

- [Raycast API Documentation](https://developers.raycast.com)
- [File Structure](https://developers.raycast.com/information/file-structure)
- [Manifest / package.json](https://developers.raycast.com/information/manifest)
- [Form API (FilePicker)](https://developers.raycast.com/api-reference/user-interface/form)
- [Detail Component](https://developers.raycast.com/api-reference/user-interface/detail)
- [Actions Reference](https://developers.raycast.com/api-reference/user-interface/actions)
- [ActionPanel](https://developers.raycast.com/api-reference/user-interface/action-panel)
- [Toast API](https://developers.raycast.com/api-reference/feedback/toast)
- [Clipboard API](https://developers.raycast.com/api-reference/clipboard)
- [Preferences API](https://developers.raycast.com/api-reference/preferences)
- [Environment API](https://developers.raycast.com/api-reference/environment)
- [Create First Extension](https://developers.raycast.com/basics/create-your-first-extension)
- [Utility Hooks](https://developers.raycast.com/utilities/getting-started)
