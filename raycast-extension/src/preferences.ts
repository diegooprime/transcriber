import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  assemblyaiKey: string;
  defaultLanguage: string;
  defaultSpeakers: string;
  outputDirectory: string;
}

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function getApiKey(): string {
  return getPreferences().assemblyaiKey;
}

export function getOutputDir(): string {
  const dir = getPreferences().outputDirectory || "~/Desktop";
  return dir.replace(/^~/, process.env.HOME || "/tmp");
}
