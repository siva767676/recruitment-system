<#
.SYNOPSIS
  Bridge Docker containers to the remote vLLM GPU host.

.DESCRIPTION
  The Docker (WSL2) bridge network cannot route to the GPU machine on the
  physical LAN (172.20.7.22), but the Windows host CAN. This script adds a
  Windows portproxy so traffic to the host on LISTEN_PORT is forwarded to the
  GPU's vLLM port, plus a firewall rule allowing the Docker/WSL subnet to reach
  it. The backend container then targets host.docker.internal:LISTEN_PORT.

  RUN THIS IN AN ELEVATED (Administrator) PowerShell, once. It survives reboot.

.NOTES
  Undo with:  .\setup-gpu-portproxy.ps1 -Remove
#>
param(
  [string]$GpuHost = "172.20.7.22",
  [int]$GpuPort    = 8000,
  [int]$ListenPort = 8001,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run as Administrator (right-click PowerShell > Run as administrator)."
  }
}

Assert-Admin
$ruleName = "vLLM GPU portproxy ($ListenPort)"

if ($Remove) {
  netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 2>$null
  Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  Write-Host "Removed portproxy on :$ListenPort and firewall rule '$ruleName'."
  netsh interface portproxy show v4tov4
  return
}

# 1. Forward host:ListenPort -> GPU:GpuPort
netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 2>$null
netsh interface portproxy add v4tov4 `
  listenport=$ListenPort listenaddress=0.0.0.0 `
  connectport=$GpuPort   connectaddress=$GpuHost

# 2. Allow inbound on the listen port (Docker/WSL subnets are local, but be explicit)
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $ListenPort | Out-Null
}

Write-Host "`n=== portproxy rules ==="
netsh interface portproxy show v4tov4

Write-Host "`n=== verifying host -> GPU through the proxy (127.0.0.1:$ListenPort) ==="
$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port $ListenPort -WarningAction SilentlyContinue
if ($ok.TcpTestSucceeded) {
  Write-Host "OK: host:$ListenPort forwards to ${GpuHost}:${GpuPort}." -ForegroundColor Green
  Write-Host "Now set VLLM_BASE_URL=http://host.docker.internal:$ListenPort in backend/.env and run: docker compose up"
} else {
  Write-Warning "Proxy added but host:$ListenPort did not connect. Check the GPU host/port and that vLLM is up."
}
