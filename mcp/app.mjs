import * as z from 'zod/v4';
import { GEMINI_VOICES } from '../src/gemini-voices.js';

export const app = "ai-voice-comic-maker";
export const prefix = "voicecomic";
export const port = 45935;
export const operation = "render_page";
export const description = "Render the comic image selected in the connected page. Gemini TTS can assign a built-in voice to each detected speaker by exact name and a separate voice to the title. Wait for job_get to verify the MP4.";
const voice = z.enum(GEMINI_VOICES);
export const input = z.object({
  geminiVoices: z.array(z.object({ speaker: z.string().min(1).max(120), voice }).strict()).max(100).optional(),
  geminiTitleVoice: voice.optional(),
  geminiIncludePageText: z.boolean().optional(),
}).strict();
export const output = z.object({ title: z.string().max(500), videoPath: z.string().min(1).max(1024), videoFilename: z.string().min(1).max(255) }).strict();
