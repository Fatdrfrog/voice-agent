Param(
  [Parameter(Mandatory = $true)] [string]$TwilioAccountSid,
  [Parameter(Mandatory = $true)] [string]$TwilioAuthToken,
  [Parameter(Mandatory = $true)] [string]$FromNumber,
  [Parameter(Mandatory = $true)] [string]$AllowFrom,
  [Parameter(Mandatory = $true)] [string]$PublicUrl,
  [string]$WebhookPort = "3334",
  [string]$WebhookPath = "/voice/webhook",
  [string]$StreamPath = "/voice/stream"
)

openclaw plugins enable voice-call
openclaw config set plugins.entries.voice-call.enabled true
openclaw config set plugins.entries.voice-call.config.provider twilio
openclaw config set plugins.entries.voice-call.config.fromNumber $FromNumber
openclaw config set plugins.entries.voice-call.config.inboundPolicy allowlist
openclaw config set plugins.entries.voice-call.config.allowFrom[0] $AllowFrom
openclaw config set plugins.entries.voice-call.config.twilio.accountSid $TwilioAccountSid
openclaw config set plugins.entries.voice-call.config.twilio.authToken $TwilioAuthToken
openclaw config set plugins.entries.voice-call.config.serve.port $WebhookPort
openclaw config set plugins.entries.voice-call.config.serve.path $WebhookPath
openclaw config set plugins.entries.voice-call.config.publicUrl $PublicUrl
openclaw config set plugins.entries.voice-call.config.streaming.enabled true
openclaw config set plugins.entries.voice-call.config.streaming.streamPath $StreamPath
openclaw config set plugins.entries.voice-call.config.streaming.sttProvider openai-realtime
openclaw config set plugins.entries.voice-call.config.tts.provider elevenlabs

openclaw gateway restart
openclaw plugins list
