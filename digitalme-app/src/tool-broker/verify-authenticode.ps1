param(
  [Parameter(Mandatory = $true)]
  [string]$LiteralPath
)

$ErrorActionPreference = "Stop"
try {
  $sig = Get-AuthenticodeSignature -LiteralPath $LiteralPath
  $subject = ""
  if ($null -ne $sig.SignerCertificate) {
    $subject = [string]$sig.SignerCertificate.Subject
  }
  $payload = @{
    status = [string]$sig.Status
    subject = $subject
  } | ConvertTo-Json -Compress
  Write-Output $payload
  exit 0
} catch {
  $payload = @{
    status = "Error"
    subject = ""
  } | ConvertTo-Json -Compress
  Write-Output $payload
  exit 0
}
