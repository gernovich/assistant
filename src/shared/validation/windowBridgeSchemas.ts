import { z } from "zod";

// Window actions runtime validation (transport-agnostic).

export const RecordingStartPayloadSchema = z
  .object({
    mode: z.enum(["manual_new", "occurrence_new", "meeting_new", "continue_protocol"]),
    occurrenceKey: z.string().optional(),
    eventSummary: z.string().optional(),
    protocolFilePath: z.string().optional(),
  })
  .strict();

export const WindowActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("close") }).strict(),
  z.object({ kind: z.literal("reminder.startRecording") }).strict(),
  z.object({ kind: z.literal("reminder.createProtocol") }).strict(),
  z.object({ kind: z.literal("reminder.meetingCancelled") }).strict(),
  z.object({ kind: z.literal("recording.stop") }).strict(),
  z.object({ kind: z.literal("recording.pause") }).strict(),
  z.object({ kind: z.literal("recording.resume") }).strict(),
  z.object({ kind: z.literal("recording.openProtocol"), protocolFilePath: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("recording.start"), payload: RecordingStartPayloadSchema }).strict(),
]);
