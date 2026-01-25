$certName = "BraddRDT_SelfSigned"
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -match $certName }

if (-not $cert) {
    Write-Host "Creating new self-signed certificate: $certName..."
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=$certName" -CertStoreLocation Cert:\CurrentUser\My
    Write-Host "Certificate created. Thumbprint: $($cert.Thumbprint)"
    
    Write-Host "Exporting certificate to BraddRDT.cer (You must install this to 'Trusted Root Certification Authorities' on client machines)"
    Export-Certificate -Cert $cert -FilePath ".\BraddRDT.cer"
} else {
    Write-Host "Using existing certificate: $($cert.Thumbprint)"
}

$exePath = $args[0]
if (-not $exePath) {
    Write-Error "Please provide the path to the executable."
    exit 1
}

if (-not (Test-Path $exePath)) {
    Write-Error "Executable not found: $exePath"
    exit 1
}

Write-Host "Signing $exePath..."
Set-AuthenticodeSignature -Certificate $cert -FilePath $exePath -TimestampServer "http://timestamp.digicert.com"

Write-Host "Done. Note: To suppress SmartScreen on other machines, you must install BraddRDT.cer to the 'Trusted Root Certification Authorities' store."