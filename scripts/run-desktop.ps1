Param(
  [switch]$Install
)

$root = "C:\Users\User\OneDrive\Desktop\indie\voice-dev-agent"
Set-Location $root

if ($Install) {
  pnpm install
}

pnpm dev
