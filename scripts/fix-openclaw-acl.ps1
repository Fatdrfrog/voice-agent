$openClawRoot = Join-Path $env:USERPROFILE ".openclaw"
$cred = Join-Path $openClawRoot "credentials"

if (Test-Path $cred) {
  icacls "$cred" /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"
}

if (Test-Path $openClawRoot) {
  icacls "$openClawRoot" /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"
}

openclaw security audit
