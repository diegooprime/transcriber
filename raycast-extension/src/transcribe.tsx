import {
  Form,
  Detail,
  ActionPanel,
  Action,
  showToast,
  Toast,
  useNavigation,
  Icon,
} from "@raycast/api";
import { useState } from "react";
import { writeFileSync } from "fs";
import { join } from "path";
import { transcribeFile } from "./api";
import { formatMarkdown, getSpeakers } from "./format";
import { getPreferences, getOutputDir } from "./preferences";
import type { TranscriptData, FormValues } from "./types";

export default function Command() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [title, setTitle] = useState("");
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const { push } = useNavigation();

  const prefs = getPreferences();

  async function handleSubmit(values: FormValues) {
    const filePath = values.audioFile?.[0];
    if (!filePath) {
      await showToast({ style: Toast.Style.Failure, title: "No file selected" });
      return;
    }

    const docTitle = values.title || filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "Transcript";
    setTitle(docTitle);
    setIsTranscribing(true);

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Uploading audio...",
    });

    try {
      const data = await transcribeFile(
        filePath,
        {
          language: values.language || prefs.defaultLanguage || "es",
          speakersExpected: values.speakers ? Number(values.speakers) : undefined,
          title: docTitle,
        },
        (phase) => {
          toast.title = phase;
        }
      );

      setTranscriptData(data);
      const md = formatMarkdown(data, docTitle);
      setMarkdown(md);

      toast.style = Toast.Style.Success;
      toast.title = "Transcription complete!";
      const mins = Math.floor(data.duration / 60);
      const secs = Math.floor(data.duration % 60);
      toast.message = `${data.utterances.length} utterances · ${mins}m ${secs}s`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.style = Toast.Style.Failure;
      toast.title = "Transcription failed";
      toast.message = msg;
      setIsTranscribing(false);
    }
  }

  function saveFile() {
    const dir = getOutputDir();
    const safeName = title.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
    const filePath = join(dir, `${safeName}_transcript.md`);
    writeFileSync(filePath, markdown, "utf-8");
    showToast({ style: Toast.Style.Success, title: "Saved!", message: filePath });
    return filePath;
  }

  function updateSpeakerNames(names: Record<string, string>) {
    setSpeakerNames(names);
    if (transcriptData) {
      const md = formatMarkdown(transcriptData, title, names);
      setMarkdown(md);
    }
  }

  // Show transcript result
  if (transcriptData && markdown) {
    const speakers = getSpeakers(transcriptData);

    return (
      <Detail
        markdown={markdown}
        metadata={
          <Detail.Metadata>
            <Detail.Metadata.Label title="Duration" text={`${Math.floor(transcriptData.duration / 60)}m ${Math.floor(transcriptData.duration % 60)}s`} />
            <Detail.Metadata.Label title="Utterances" text={String(transcriptData.utterances.length)} />
            <Detail.Metadata.Label title="Speakers" text={speakers.map((s) => speakerNames[s] || s).join(", ")} />
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label title="Title" text={title} />
          </Detail.Metadata>
        }
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Markdown" content={markdown} />
            <Action
              title="Save as .md"
              icon={Icon.Document}
              onAction={() => {
                const path = saveFile();
                showToast({ style: Toast.Style.Success, title: "Saved", message: path });
              }}
            />
            <Action
              title="Save and Open in Finder"
              icon={Icon.Finder}
              shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
              onAction={async () => {
                const path = saveFile();
                const { exec } = await import("child_process");
                exec(`open -R "${path}"`);
              }}
            />
            {speakers.length >= 2 && (
              <Action
                title="Rename Speakers"
                icon={Icon.PersonCircle}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={() => {
                  push(
                    <RenameSpeakers
                      speakers={speakers}
                      currentNames={speakerNames}
                      onSubmit={updateSpeakerNames}
                    />
                  );
                }}
              />
            )}
          </ActionPanel>
        }
      />
    );
  }

  // Show loading state
  if (isTranscribing) {
    return <Detail isLoading={true} markdown="## Transcribing...\n\nThis usually takes 30-90 seconds. Check the toast for progress." />;
  }

  // Show form
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Transcribe" icon={Icon.Microphone} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="audioFile"
        title="Audio File"
        allowMultipleSelection={false}
        canChooseDirectories={false}
      />
      <Form.TextField id="title" title="Title" placeholder="Auto from filename" />
      <Form.Separator />
      <Form.Dropdown id="language" title="Language" defaultValue={prefs.defaultLanguage || "es"}>
        <Form.Dropdown.Item value="es" title="Spanish" />
        <Form.Dropdown.Item value="en" title="English" />
        <Form.Dropdown.Item value="pt" title="Portuguese" />
        <Form.Dropdown.Item value="fr" title="French" />
        <Form.Dropdown.Item value="de" title="German" />
        <Form.Dropdown.Item value="it" title="Italian" />
        <Form.Dropdown.Item value="ja" title="Japanese" />
        <Form.Dropdown.Item value="zh" title="Chinese" />
        <Form.Dropdown.Item value="ko" title="Korean" />
      </Form.Dropdown>
      <Form.TextField
        id="speakers"
        title="Expected Speakers"
        placeholder="auto-detect"
        defaultValue={prefs.defaultSpeakers || ""}
      />
    </Form>
  );
}

function RenameSpeakers({
  speakers,
  currentNames,
  onSubmit,
}: {
  speakers: string[];
  currentNames: Record<string, string>;
  onSubmit: (names: Record<string, string>) => void;
}) {
  const { pop } = useNavigation();

  function handleSubmit(values: Record<string, string>) {
    const names: Record<string, string> = {};
    for (const s of speakers) {
      const val = values[`speaker_${s}`]?.trim();
      if (val) names[s] = val;
    }
    onSubmit(names);
    pop();
    showToast({ style: Toast.Style.Success, title: "Speakers renamed!" });
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Apply Names" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Map speaker labels to real names" />
      {speakers.map((s) => (
        <Form.TextField
          key={s}
          id={`speaker_${s}`}
          title={`${s} →`}
          placeholder={s}
          defaultValue={currentNames[s] || ""}
        />
      ))}
    </Form>
  );
}
