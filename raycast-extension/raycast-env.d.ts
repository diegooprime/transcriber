/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** AssemblyAI API Key - Your AssemblyAI API key for transcription */
  "assemblyaiKey": string,
  /** Default Language - Default transcription language */
  "defaultLanguage": "es" | "en" | "pt" | "fr" | "de" | "it" | "ja" | "zh" | "ko",
  /** Default Expected Speakers - Default number of speakers (leave empty for auto-detect) */
  "defaultSpeakers"?: string,
  /** Output Directory - Where to save transcript .md files (default: ~/Desktop) */
  "outputDirectory": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `transcribe` command */
  export type Transcribe = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `transcribe` command */
  export type Transcribe = {}
}

