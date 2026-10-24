$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$vite = Join-Path $projectRoot "node_modules\vite\bin\vite.js"

if (-not (Test-Path -LiteralPath $python)) {
    throw "ChatCart's Python environment is missing. Follow the setup steps in README.md first."
}
if (-not (Test-Path -LiteralPath $vite)) {
    throw "ChatCart's frontend dependencies are missing. Run npm install from the project folder first."
}

$backendCommand = "Set-Location -LiteralPath '$projectRoot'; & '$python' -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000"
$frontendCommand = "Set-Location -LiteralPath '$projectRoot'; node '$vite' --host 127.0.0.1"

Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -WorkingDirectory $projectRoot
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -WorkingDirectory $projectRoot

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:5173"
