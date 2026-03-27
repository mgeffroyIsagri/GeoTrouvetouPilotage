# ============================================================
# deploy.ps1 - Build Angular + Deploiement sur Azure
# Executer depuis la racine du projet dans PowerShell
# ============================================================

$WEB_APP        = "GeotrouvetouWeb"
$RESOURCE_GROUP = "rg-geotrouvetou"
$ROOT           = $PSScriptRoot

# Résolution de l'Azure CLI (az n'est pas toujours dans le PATH PowerShell)
$AZ = (Get-Command az -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
if (-not $AZ) { $AZ = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd" }
if (-not (Test-Path $AZ)) { Write-Error "Azure CLI introuvable. Installez-le depuis https://aka.ms/installazurecliwindows"; exit 1 }

# --- 1. Build Angular (production) ---
Write-Host "Build Angular (production)..." -ForegroundColor Cyan
Set-Location "$ROOT\frontend"
npx ng build --configuration=production
if ($LASTEXITCODE -ne 0) { Write-Error "Build Angular echoue"; exit 1 }

# --- 2. Copie du build dans backend\static ---
Write-Host "Copie du build dans backend\static..." -ForegroundColor Cyan
$staticDest = "$ROOT\backend\static"
if (Test-Path $staticDest) { Remove-Item $staticDest -Recurse -Force }
Copy-Item "$ROOT\frontend\dist\geotrouvetou-pilotage\browser" $staticDest -Recurse
Write-Host "   OK -> $staticDest"

# --- 3. Creation du zip (sans .venv ni __pycache__) ---
Write-Host "Creation du zip de deploiement (sans .venv)..." -ForegroundColor Cyan
Set-Location $ROOT

$tempDir = "$ROOT\_deploy_temp"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory $tempDir | Out-Null

# robocopy est integre a Windows et gere parfaitement les exclusions
robocopy "$ROOT\backend" $tempDir /E /XD ".venv" "__pycache__" ".git" /XF "*.pyc" | Out-Null

$zipPath     = "$ROOT\deploy.zip"
$zipPathTemp = "$ROOT\deploy_new.zip"
if (Test-Path $zipPathTemp) { Remove-Item $zipPathTemp -Force }

# Utiliser ZipFile .NET pour avoir des forward slashes (compatibles Linux)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPathTemp, 'Create')
Get-ChildItem $tempDir -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($tempDir.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativePath) | Out-Null
}
$zip.Dispose()

# Remplacer l'ancien zip
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Rename-Item $zipPathTemp $zipPath

Remove-Item $tempDir -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "   OK -> deploy.zip ($sizeMB MB)"

# --- 4. Deploiement Azure ---
Write-Host "Deploiement sur Azure App Service..." -ForegroundColor Cyan
& $AZ webapp deploy `
  --name $WEB_APP `
  --resource-group $RESOURCE_GROUP `
  --src-path $zipPath `
  --type zip

if ($LASTEXITCODE -ne 0) { Write-Error "Deploiement Azure echoue"; exit 1 }

Write-Host ""
Write-Host "Deploiement termine !" -ForegroundColor Green
Write-Host "https://$WEB_APP.azurewebsites.net" -ForegroundColor Green
