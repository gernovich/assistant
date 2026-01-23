import { z } from "zod";
import { WindowActionSchema } from "./windowBridgeSchemas";

export const WindowRequestSchema = z
  .object({
    id: z.string().min(1),
    ts: z.number().finite(),
    action: WindowActionSchema,
  })
  .strict();

export const WindowResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string().min(1), ok: z.literal(true) }).strict(),
  z
    .object({
      id: z.string().min(1),
      ok: z.literal(false),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          cause: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);
