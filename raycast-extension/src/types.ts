export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface TranscriptData {
  utterances: Utterance[];
  duration: number;
  text: string;
}

export interface TranscriptOptions {
  language: string;
  speakersExpected?: number;
  title?: string;
}

export interface FormValues {
  audioFile: string[];
  title: string;
  language: string;
  speakers: string;
}
