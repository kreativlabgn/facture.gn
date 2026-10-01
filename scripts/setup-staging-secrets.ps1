#Requires -Version 5.1
<#
.SYNOPSIS
  Pose les secrets Fly.io du staging facture.gn (ADR-120).

.DESCRIPTION
  Un seul `fly secrets set` par application : chaque appel déclenche un
  redéploiement, les enchaîner en ferait un par secret.

  Les secrets aléatoires (hex 32 octets) sont GÉNÉRÉS ici, pas à recopier :
  trust-api refuse au démarrage toute valeur ressemblant à un gabarit
  (`changeme`, `example`, 16 caractères identiques) — voir
  apps/trust-api/src/common/secrets.ts. Seuls les éléments que vous seul
  connaissez sont des paramètres.

  MONEY_API_INTERNAL_KEY est généré UNE fois et posé sur trust-api ET
  money-api : c'est un secret partagé, deux valeurs différentes feraient
  échouer chaque appel entre les deux services.

.PARAMETER DryRun
  Affiche les commandes sans rien envoyer à Fly. À utiliser d'abord.

.EXAMPLE
  ./scripts/setup-staging-secrets.ps1 -SupabaseProjectRef abcdefghijklmnop `
      -SupabasePassword 'mon-mot-de-passe' `
      -JwtPrivateKeyPath .\jwt-private.pem -JwtPublicKeyPath .\jwt-public.pem -DryRun
#>
[CmdletBinding()]
param(
    # Référence du projet Supabase (Dashboard → Settings → General → Reference ID).
    [string]$SupabaseProjectRef = '<VOTRE_REF_PROJET_SUPABASE>',

    # Mot de passe de la base Supabase (Dashboard → Settings → Database).
    [string]$SupabasePassword = '<VOTRE_MOT_DE_PASSE_SUPABASE>',

    # Hôte du pooler, dépend de la région du projet Supabase.
    [string]$SupabasePoolerHost = 'aws-0-eu-west-3.pooler.supabase.com',

    # Redis managé (Upstash, Fly Redis…). Format redis:// ou rediss://.
    [string]$RedisUrl = '<VOTRE_URL_REDIS>',

    # Paire RS256 des jetons d'authentification (ADR-011). Fichiers PEM.
    #   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
    #   openssl rsa -pubout -in jwt-private.pem -out jwt-public.pem
    [string]$JwtPrivateKeyPath = '<CHEMIN_VERS_jwt-private.pem>',
    [string]$JwtPublicKeyPath = '<CHEMIN_VERS_jwt-public.pem>',

    [string]$TrustApiApp = 'facture-gn-trust-api',
    [string]$MoneyApiApp = 'facture-gn-money-api',
    [string]$WebApp = 'facture-gn-web',

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function New-HexSecret {
    # 32 octets → 64 caractères hexadécimaux, ce qu'attendent les formats
    # `hex64` et `hexMin32` de secrets.ts.
    $bytes = New-Object 'System.Byte[]' 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# --- Garde : aucun placeholder ne doit subsister -----------------------------
$placeholders = @{
    'SupabaseProjectRef' = $SupabaseProjectRef
    'SupabasePassword'   = $SupabasePassword
    'RedisUrl'           = $RedisUrl
    'JwtPrivateKeyPath'  = $JwtPrivateKeyPath
    'JwtPublicKeyPath'   = $JwtPublicKeyPath
}
$restants = $placeholders.GetEnumerator() | Where-Object { $_.Value -match '^<.*>$' } | ForEach-Object { $_.Key }
if ($restants) {
    throw "Paramètres non renseignés : $($restants -join ', '). Relancez en passant ces valeurs."
}

foreach ($p in @($JwtPrivateKeyPath, $JwtPublicKeyPath)) {
    if (-not (Test-Path $p)) { throw "Fichier PEM introuvable : $p" }
}

# --- Valeurs dérivées --------------------------------------------------------
# Runtime : pooler en mode transaction (6543). Prisma désactive les prepared
# statements grâce à ?pgbouncer=true.
$databaseUrl = "postgresql://postgres.$SupabaseProjectRef`:$SupabasePassword@$SupabasePoolerHost`:6543/postgres?pgbouncer=true"
# CLI Prisma uniquement (migrate) : connexion DIRECTE, port 5432, sans pooler.
$directUrl = "postgresql://postgres:$SupabasePassword@db.$SupabaseProjectRef.supabase.co:5432/postgres"

$jwtPrivateKey = Get-Content -Path $JwtPrivateKeyPath -Raw
$jwtPublicKey = Get-Content -Path $JwtPublicKeyPath -Raw

$moneyApiInternalKey = New-HexSecret   # partagé trust-api ↔ money-api

$trustApiSecrets = [ordered]@{
    DATABASE_URL                          = $databaseUrl
    DIRECT_URL                            = $directUrl
    REDIS_URL                             = $RedisUrl
    JWT_PRIVATE_KEY                       = $jwtPrivateKey
    JWT_PUBLIC_KEY                        = $jwtPublicKey
    CERTIFICATION_PRIVATE_KEY             = (New-HexSecret)
    CERTIFICATION_MASTER_KEY              = (New-HexSecret)
    MONEY_API_INTERNAL_KEY                = $moneyApiInternalKey
    DGI_VERIFICATION_INTERNAL_KEY         = (New-HexSecret)
    COMMERCIAL_AGENT_GRANT_INTERNAL_KEY   = (New-HexSecret)
    COMMISSION_BYPASS_REVIEW_INTERNAL_KEY = (New-HexSecret)
    DATA_RIGHTS_INTERNAL_KEY              = (New-HexSecret)
    CREDITS_INTERNAL_KEY                  = (New-HexSecret)
    DATA_RIGHTS_SUBJECT_HASH_PEPPER       = (New-HexSecret)
    APIP_WEBHOOK_SECRET                   = (New-HexSecret)
}

$moneyApiSecrets = [ordered]@{
    DATABASE_URL           = $databaseUrl
    DIRECT_URL             = $directUrl
    REDIS_URL              = $RedisUrl
    MONEY_API_INTERNAL_KEY = $moneyApiInternalKey
}

# web n'a aucun secret : TRUST_API_URL est déjà dans [env] de fly.toml, c'est
# une adresse du réseau privé Fly et non une valeur sensible. Le bloc reste ici
# pour le cas où l'on voudrait la surcharger sans redéployer.
$webSecrets = [ordered]@{}

function Set-FlySecrets {
    param([string]$App, [System.Collections.Specialized.OrderedDictionary]$Secrets)

    if ($Secrets.Count -eq 0) {
        Write-Host "  $App : aucun secret a poser (tout est dans fly.toml)" -ForegroundColor DarkGray
        return
    }

    $arguments = @('secrets', 'set')
    foreach ($name in $Secrets.Keys) { $arguments += "$name=$($Secrets[$name])" }
    $arguments += @('--app', $App)

    Write-Host ""
    Write-Host "== $App ==" -ForegroundColor Cyan
    foreach ($name in $Secrets.Keys) {
        $valeur = [string]$Secrets[$name]
        # Jamais la valeur en clair a l'ecran : un secret affiche est un secret
        # dans l'historique du terminal, puis dans une capture d'ecran.
        $apercu = if ($valeur.Length -gt 12) { $valeur.Substring(0, 6) + '…(' + $valeur.Length + ' car.)' } else { '…' }
        Write-Host ("  {0,-38} {1}" -f $name, $apercu)
    }

    if ($DryRun) {
        Write-Host "  [DryRun] fly secrets set <$($Secrets.Count) secrets> --app $App" -ForegroundColor Yellow
        return
    }
    & fly @arguments
    if ($LASTEXITCODE -ne 0) { throw "fly secrets set a echoue pour $App (code $LASTEXITCODE)" }
}

if (-not $DryRun -and -not (Get-Command fly -ErrorAction SilentlyContinue)) {
    throw "flyctl introuvable. Installez-le (https://fly.io/docs/flyctl/install/) ou relancez avec -DryRun."
}

Set-FlySecrets -App $TrustApiApp -Secrets $trustApiSecrets
Set-FlySecrets -App $MoneyApiApp -Secrets $moneyApiSecrets
Set-FlySecrets -App $WebApp -Secrets $webSecrets

Write-Host ""
Write-Host "Termine." -ForegroundColor Green
Write-Host "Les cles de certification viennent d'etre generees : une rotation de" -ForegroundColor Yellow
Write-Host "CERTIFICATION_PRIVATE_KEY ou CERTIFICATION_MASTER_KEY apres la premiere" -ForegroundColor Yellow
Write-Host "facture certifiee ferait echouer GET /verify sur toutes les anterieures" -ForegroundColor Yellow
Write-Host "(ADR-026). Sauvegardez-les des maintenant hors de Fly." -ForegroundColor Yellow
