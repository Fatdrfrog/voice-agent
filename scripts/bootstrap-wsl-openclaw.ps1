Param(
  [string]$Distro = "Ubuntu"
)

$scriptPath = "/mnt/c/Users/User/OneDrive/Desktop/indie/voice-dev-agent/scripts/bootstrap-wsl-openclaw.sh"

wsl -d $Distro -- bash -lc "chmod +x $scriptPath && $scriptPath"
