$ErrorActionPreference = 'Stop'
$certDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')) 'artifacts/docker-validation/certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=smtp', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('smtp')
$san.AddDnsName('localhost')
$request.CertificateExtensions.Add($san.Build())
$cert = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddDays(2))
[IO.File]::WriteAllBytes((Join-Path $certDir 'smtp.pfx'), $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, 'docker-test-only'))
$base64 = [Convert]::ToBase64String($cert.RawData, [Base64FormattingOptions]::InsertLineBreaks)
[IO.File]::WriteAllText((Join-Path $certDir 'ca.pem'), "-----BEGIN CERTIFICATE-----`n$base64`n-----END CERTIFICATE-----`n", [Text.Encoding]::ASCII)
$cert.Dispose()
$rsa.Dispose()
Write-Output 'Created isolated test certificate (trusted only by validation containers).'
