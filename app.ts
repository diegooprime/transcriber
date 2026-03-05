const dropzone = document.getElementById("dropzone")!;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const statusEl = document.getElementById("status")!;
const progressBar = document.getElementById("progressBar")!;
const progressFill = document.getElementById("progressFill")!;
const resultEl = document.getElementById("result")!;
const transcriptEl = document.getElementById("transcript")!;
const resultTitle = document.getElementById("resultTitle")!;
const speakerMapEl = document.getElementById("speakerMap")!;
const speakerRowsEl = document.getElementById("speakerRows")!;
const fileQueueEl = document.getElementById("fileQueue")!;
const queueActionsEl = document.getElementById("queueActions")!;
const docTitleInput = document.getElementById("docTitle") as HTMLInputElement;

interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface TranscriptData {
  utterances: Utterance[];
  duration: number;
  text: string;
}

let currentData: TranscriptData | null = null;
let currentFilename = "";
let speakerNames: Record<string, string> = {};
let queuedFiles: File[] = [];

function getDocTitle(): string {
  return docTitleInput.value.trim() || currentFilename;
}

// --- File Queue ---

function renderQueue() {
  if (queuedFiles.length === 0) {
    fileQueueEl.classList.remove("visible");
    queueActionsEl.classList.remove("visible");
    return;
  }

  fileQueueEl.classList.add("visible");
  queueActionsEl.classList.add("visible");
  fileQueueEl.innerHTML = "";

  const totalSize = queuedFiles.reduce((sum, f) => sum + f.size, 0);

  for (let i = 0; i < queuedFiles.length; i++) {
    const f = queuedFiles[i];
    const size = (f.size / (1024 * 1024)).toFixed(1);
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `
      <span class="file-num">${i + 1}</span>
      <span class="file-name">${f.name}</span>
      <span class="file-size">${size} MB</span>
      <span class="file-remove" data-idx="${i}">&times;</span>
    `;
    fileQueueEl.appendChild(div);
  }

  const totalDiv = document.createElement("div");
  totalDiv.className = "file-count";
  totalDiv.textContent = `${queuedFiles.length} file${queuedFiles.length > 1 ? "s" : ""} \u00b7 ${(totalSize / (1024 * 1024)).toFixed(1)} MB total${queuedFiles.length > 1 ? " \u2014 will be stitched in order" : ""}`;
  fileQueueEl.appendChild(totalDiv);

  fileQueueEl.querySelectorAll<HTMLSpanElement>(".file-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      queuedFiles.splice(idx, 1);
      renderQueue();
    });
  });
}

function addFiles(files: FileList | File[]) {
  for (const f of files) {
    queuedFiles.push(f);
  }
  if (!docTitleInput.value && queuedFiles.length > 0) {
    currentFilename = queuedFiles[0].name.replace(/\.[^.]+$/, "");
  }
  renderQueue();
}

// --- Drag & Drop ---

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) {
    addFiles(fileInput.files);
    fileInput.value = "";
  }
});

// --- Queue Actions ---

document.getElementById("transcribeBtn")!.addEventListener("click", () => {
  if (queuedFiles.length > 0) transcribe();
});

document.getElementById("clearBtn")!.addEventListener("click", () => {
  queuedFiles = [];
  renderQueue();
  setStatus("");
});

// --- Transcribe ---

async function transcribe() {
  const lang = (document.getElementById("lang") as HTMLSelectElement).value;
  const speakers = (document.getElementById("speakers") as HTMLInputElement).value;

  if (!currentFilename && queuedFiles.length > 0) {
    currentFilename = queuedFiles[0].name.replace(/\.[^.]+$/, "");
  }

  dropzone.classList.add("processing");
  progressBar.classList.add("active");
  resultEl.classList.remove("visible");
  speakerMapEl.classList.remove("visible");
  speakerNames = {};

  const totalSize = queuedFiles.reduce((s, f) => s + f.size, 0);
  setStatus(`Uploading ${queuedFiles.length} file${queuedFiles.length > 1 ? "s" : ""} (${(totalSize / (1024 * 1024)).toFixed(1)} MB)...`);
  progressFill.style.width = "10%";

  const formData = new FormData();
  for (const f of queuedFiles) {
    formData.append("audio", f);
  }
  formData.append("language", lang);
  if (speakers) formData.append("speakers_expected", speakers);

  try {
    setStatus(`Uploading & transcribing... (${queuedFiles.length > 1 ? "stitching + " : ""}30-90 seconds)`);
    progressFill.style.width = "30%";

    let progress = 30;
    const interval = setInterval(() => {
      progress = Math.min(progress + 0.5, 90);
      progressFill.style.width = progress + "%";
    }, 1000);

    const res = await fetch("/api/transcribe", { method: "POST", body: formData });
    clearInterval(interval);

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Transcription failed");
    }

    const data: TranscriptData = await res.json();
    currentData = data;

    progressFill.style.width = "100%";
    const mins = Math.floor(data.duration / 60);
    const secs = Math.floor(data.duration % 60);
    setStatus(`Done! ${data.utterances.length} utterances, ${mins}m ${secs}s`);

    renderTranscript(data);
    showSpeakerMap(data);
  } catch (err: any) {
    setStatus("Error: " + err.message);
    progressFill.style.width = "0%";
  } finally {
    dropzone.classList.remove("processing");
    setTimeout(() => progressBar.classList.remove("active"), 2000);
  }
}

// --- Speaker Rename ---

document.getElementById("applySpeakers")!.addEventListener("click", () => {
  const inputs = speakerMapEl.querySelectorAll<HTMLInputElement>("input[data-speaker]");
  for (const input of inputs) {
    const orig = input.dataset.speaker!;
    const name = input.value.trim();
    if (name) speakerNames[orig] = name;
  }
  if (currentData) renderTranscript(currentData);
});

// --- Copy & Download ---

document.getElementById("copyBtn")!.addEventListener("click", () => {
  navigator.clipboard.writeText(buildMarkdown()).then(() => setStatus("Copied to clipboard!"));
});

document.getElementById("downloadBtn")!.addEventListener("click", downloadTranscript);

// --- Rendering ---

function setStatus(msg: string) {
  const isProcessing = msg.includes("...") || msg.includes("Uploading");
  statusEl.innerHTML = isProcessing ? '<span class="spinner"></span>' + msg : msg;
}

function renderTranscript(data: TranscriptData) {
  transcriptEl.innerHTML = "";
  for (const u of data.utterances) {
    const m = Math.floor(u.start / 60000);
    const s = Math.floor((u.start % 60000) / 1000);
    const ts = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    const name = speakerNames[u.speaker] || u.speaker;
    const div = document.createElement("div");
    div.className = "utterance";
    div.innerHTML = `
      <div class="meta"><span class="timestamp">[${ts}]</span> <span class="speaker">${name}</span></div>
      <div class="text">${u.text}</div>
    `;
    transcriptEl.appendChild(div);
  }

  const title = getDocTitle();
  const mins = Math.floor(data.duration / 60);
  const secs = Math.floor(data.duration % 60);
  resultTitle.textContent = `${title} \u2014 ${mins}m ${secs}s \u00b7 ${data.utterances.length} utterances`;
  resultEl.classList.add("visible");
}

function showSpeakerMap(data: TranscriptData) {
  const speakers = [...new Set(data.utterances.map((u) => u.speaker))].sort();
  if (speakers.length < 2) return;
  speakerRowsEl.innerHTML = "";
  for (const s of speakers) {
    const row = document.createElement("div");
    row.className = "speaker-row";
    row.innerHTML = `<label>${s} \u2192</label><input type="text" data-speaker="${s}" placeholder="${s}">`;
    speakerRowsEl.appendChild(row);
  }
  speakerMapEl.classList.add("visible");
}

function buildMarkdown(): string {
  if (!currentData) return "";
  const d = currentData;
  const title = getDocTitle();
  const mins = Math.floor(d.duration / 60);
  const secs = Math.floor(d.duration % 60);
  const speakers = [...new Set(d.utterances.map((u) => speakerNames[u.speaker] || u.speaker))];
  let md = `# Transcripci\u00f3n \u2014 ${title}\n`;
  md += `**Duraci\u00f3n:** ${mins} minutos ${secs} segundos\n`;
  md += `**Modelo:** AssemblyAI universal-3-pro\n`;
  md += `**Participantes:** ${speakers.join(", ")}\n`;
  md += `**Fecha:** ${new Date().toISOString().split("T")[0]}\n\n---\n\n`;
  for (const u of d.utterances) {
    const m = Math.floor(u.start / 60000);
    const s = Math.floor((u.start % 60000) / 1000);
    const ts = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    const name = speakerNames[u.speaker] || u.speaker;
    md += `**[${ts}] ${name}:** ${u.text}\n\n`;
  }
  return md;
}

function downloadTranscript() {
  const md = buildMarkdown();
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const title = getDocTitle().replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
  a.download = title + ".md";
  a.click();
  URL.revokeObjectURL(url);
}
