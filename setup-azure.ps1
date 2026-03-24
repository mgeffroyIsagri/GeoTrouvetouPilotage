# ============================================================
# setup-azure.ps1 — Création des ressources Azure
# À exécuter UNE SEULE FOIS depuis PowerShell
# ============================================================

$SUBSCRIPTION    = "6733f186-92da-40fe-a079-53f7a42d16b9"
$RESOURCE_GROUP  = "rg-geotrouvetou"
$LOCATION        = "francecentral"
$APP_PLAN        = "asp-geotrouvetou"
$WEB_APP         = "GeotrouvetouWeb"

Write-Host "🔐 Connexion Azure..." -ForegroundColor Cyan
az login
az account set --subscription $SUBSCRIPTION

Write-Host "📦 Création du Resource Group..." -ForegroundColor Cyan
az group create --name $RESOURCE_GROUP --location $LOCATION

Write-Host "🖥️  Création de l'App Service Plan (Linux B1)..." -ForegroundColor Cyan
az appservice plan create `
  --name $APP_PLAN `
  --resource-group $RESOURCE_GROUP `
  --location $LOCATION `
  --is-linux `
  --sku B1

Write-Host "🌐 Création de la Web App (Python 3.11)..." -ForegroundColor Cyan
az webapp create `
  --name $WEB_APP `
  --resource-group $RESOURCE_GROUP `
  --plan $APP_PLAN `
  --runtime "PYTHON:3.11"

Write-Host "⚙️  Configuration du démarrage..." -ForegroundColor Cyan
az webapp config set `
  --name $WEB_APP `
  --resource-group $RESOURCE_GROUP `
  --startup-file "startup.sh"

Write-Host "⚙️  Configuration des App Settings..." -ForegroundColor Cyan
az webapp config appsettings set `
  --name $WEB_APP `
  --resource-group $RESOURCE_GROUP `
  --settings `
    SCM_DO_BUILD_DURING_DEPLOYMENT=true `
    WEBSITE_RUN_FROM_PACKAGE=0 `
    AZURE_URL="https://$WEB_APP.azurewebsites.net"

Write-Host ""
Write-Host "✅ Ressources Azure créées !" -ForegroundColor Green
Write-Host "   URL : https://$WEB_APP.azurewebsites.net" -ForegroundColor Green
Write-Host ""
Write-Host "👉 Prochaine étape : lancer deploy.ps1 pour déployer l'application"
Write-Host "👉 Puis uploader geotrouvetou.db via le Kudu Console :"
Write-Host "   https://$WEB_APP.scm.azurewebsites.net/newui/fileManager"
