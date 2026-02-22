import { z } from "zod";

export const ideProfileSchema = z.enum(["zed", "cursor", "vscode", "generic"]);
export type IdeProfile = z.infer<typeof ideProfileSchema>;

export const workspaceConfigSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/i, "Workspace id must be alphanumeric with optional dashes."),
  windowsPath: z.string().min(1),
  wslPath: z.string().min(1),
  defaultSessionKey: z.string().min(1),
  ideProfile: ideProfileSchema.default("generic")
});
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;

export const workspacesFileSchema = z.object({
  workspaces: z.array(workspaceConfigSchema).min(1)
});
export type WorkspacesFile = z.infer<typeof workspacesFileSchema>;

export const featureFlagsSchema = z.object({
  micMode: z.boolean().default(true),
  callMode: z.boolean().default(true),
  autoExecGuarded: z.boolean().default(true)
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const gatewayConfigSchema = z.object({
  binary: z.string().min(1).default("openclaw.cmd"),
  gatewayUrl: z.string().min(1),
  gatewayToken: z.string().optional(),
  profile: z.string().optional()
});
export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export const openAiRealtimeConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1).default("gpt-4o-mini-transcribe"),
  sampleRateHz: z.number().int().positive().default(24000)
});
export type OpenAiRealtimeConfig = z.infer<typeof openAiRealtimeConfigSchema>;

export const elevenLabsConfigSchema = z.object({
  apiKey: z.string().min(1),
  voiceId: z.string().min(1),
  modelId: z.string().min(1).default("eleven_multilingual_v2"),
  baseUrl: z.string().url().default("https://api.elevenlabs.io")
});
export type ElevenLabsConfig = z.infer<typeof elevenLabsConfigSchema>;

export const executionPolicySchema = z.object({
  host: z.enum(["sandbox", "gateway", "node"]).default("node"),
  security: z.enum(["deny", "allowlist", "full"]).default("allowlist"),
  ask: z.enum(["off", "on-miss", "always"]).default("on-miss"),
  allowlistedBins: z.array(z.string()).default([]),
  blockedPatterns: z.array(z.string()).default([]),
  confirmationRequiredPatterns: z.array(z.string()).default([])
});
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

export const callPolicySchema = z.object({
  inboundPolicy: z.enum(["disabled", "allowlist", "pairing", "open"]).default("allowlist"),
  allowFrom: z.array(z.string()).default([]),
  responseSystemPromptRef: z.string().min(1),
  twilioConfigRef: z.string().min(1)
});
export type CallPolicy = z.infer<typeof callPolicySchema>;

export const appConfigSchema = z.object({
  gateway: gatewayConfigSchema,
  openAiRealtime: openAiRealtimeConfigSchema,
  elevenLabs: elevenLabsConfigSchema,
  executionPolicy: executionPolicySchema,
  callPolicy: callPolicySchema,
  featureFlags: featureFlagsSchema,
  workspacesFilePath: z.string().min(1)
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const controlIntentSchema = z.enum([
  "start_listening",
  "stop_listening",
  "pause",
  "resume",
  "confirm",
  "cancel",
  "status",
  "switch_workspace",
  "call_status"
]);
export type ControlIntent = z.infer<typeof controlIntentSchema>;

export const voiceEventTypeSchema = z.enum([
  "transcript.partial",
  "transcript.final",
  "agent.reply",
  "tts.started",
  "tts.stopped",
  "approval.required",
  "error",
  "state.changed",
  "call.status"
]);
export type VoiceEventType = z.infer<typeof voiceEventTypeSchema>;

export const voiceEventSchema = z.object({
  type: voiceEventTypeSchema,
  sessionId: z.string(),
  workspaceId: z.string(),
  timestamp: z.string().datetime(),
  payload: z.unknown()
});
export type VoiceEvent = z.infer<typeof voiceEventSchema>;

export const agentTurnModeSchema = z.enum(["voice", "call", "text"]).default("voice");
export type AgentTurnMode = z.infer<typeof agentTurnModeSchema>;

export const agentTurnRequestSchema = z.object({
  sessionKey: z.string().min(1),
  workspaceId: z.string().min(1),
  text: z.string().min(1),
  mode: agentTurnModeSchema
});
export type AgentTurnRequest = z.infer<typeof agentTurnRequestSchema>;

export const agentTurnResponseSchema = z.object({
  text: z.string(),
  toolSummary: z.string().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  raw: z.unknown().optional()
});
export type AgentTurnResponse = z.infer<typeof agentTurnResponseSchema>;

export const openClawHealthSchema = z.object({
  reachable: z.boolean(),
  url: z.string(),
  detail: z.string().optional()
});
export type OpenClawHealth = z.infer<typeof openClawHealthSchema>;

export interface AcpSnippet {
  editor: IdeProfile;
  title: string;
  content: string;
}

export interface RiskAssessment {
  requiresConfirmation: boolean;
  matchedPattern?: string;
  reason: string;
}
