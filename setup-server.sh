#!/bin/bash
# Village Inn Sweepstakes — Server Setup Script
# Run this once on the Hetzner server: bash setup-server.sh

echo "Setting up locale and timezone..."
locale-gen en_GB.UTF-8
update-locale LANG=en_GB.UTF-8 LC_ALL=en_GB.UTF-8
timedatectl set-timezone Europe/London
echo "Timezone set to: $(timedatectl | grep 'Time zone')"

echo ""
echo "Creating .env file..."
cat > /root/village-inn-sweepstakes/.env << 'EOF'
BETFAIR_USER=kieran@robeccomputers.ie
BETFAIR_PASS=R0bec0872657795!
BETFAIR_APP_KEY=dhm2ObWhPLttuolf
RACING_API_USER=fuwREPyxqI4LasWJ9NLW7dhP
RACING_API_PASS=lBWdv3TFp78P2gZw8zT472nZ
BETFAIR_CERT=-----BEGIN CERTIFICATE-----
MIIDUTCCAjmgAwIBAgIUcHHTUiVnlX5Vz9NsVSfM39m9PW8wDQYJKoZIhvcNAQEL
BQAwODELMAkGA1UEBhMCSUUxEzARBgNVBAoMClZpbGxhZ2VJbm4xFDASBgNVBAMM
C3N3ZWVwc3Rha2VzMB4XDTI2MDIxOTExNDg0MFoXDTM2MDIxNzExNDg0MFowODEL
MAkGA1UEBhMCSUUxEzARBgNVBAoMClZpbGxhZ2VJbm4xFDASBgNVBAMMC3N3ZWVw
c3Rha2VzMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuW8wEuyLX1Yo
ZE8qvLHVZbUu4dyA62freRdj8ZXJYTeGtHicOerO0wFiRoFxlLXaLIIrorwlyP6b
7gzwZtuVWwoeFGfGkvUSQJbHP5gSyTwo89dS52GCRsULhESZxQ5ArvnOYqpxb0Vz
mDhRbsiX1HnZUJbY8DX8lamnSpul4Cp1fWuTT/xUA9Y0yU5OOsqDm8O1yOUb0yD3
fqnrRUwX31aLjaUyIomyrqxa9L63ziH3iUjLxyBIkTn0YjaO5vRErjGBlK7Ur7Ja
rLTIGwSdckYdyihBStNoyokFDDBxLj/Gt03z5PfSgHt1oW3/MmgnHl8ojnmYD1Ds
3auiL/PnBQIDAQABo1MwUTAdBgNVHQ4EFgQUQfskzZldsp/AgxCtrINlKrwOUucw
HwYDVR0jBBgwFoAUQfskzZldsp/AgxCtrINlKrwOUucwDwYDVR0TAQH/BAUwAwEB
/zANBgkqhkiG9w0BAQsFAAOCAQEAPKVuK0xTC+/BpFnzBDiL5YVQjCTmDT1UpouK
M5z1Cfq79we8X+oU5K6UP8u7uywLNOYW75GScu1VV47SAAGVYSxMR41gOQEH/EwY
dOvMTEkLAinBhfD30Xe71v8wpl5Pci8O5RnRinvBF0zVj2BFf1FAyuktuKY+EZ9V
eBWP+ZQQXN9mDY1VaAZWrfjnDI8jI44Fa43b/uzRxMVGwlHh/tapJHIvXwHE/yPM
EMjilezrvtZvvH6NyrRVg9TDtQ5sLFWp0GWCa318yNFwpah5WQyECebWb0WeJblQ
SRfzDp2Av6Jtc3NT/i85HQ6EQ9PBrSmtvsNu7ZKT64UOM0tgtw==
-----END CERTIFICATE-----

BETFAIR_KEY=-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5bzAS7ItfVihk
Tyq8sdVltS7h3IDrZ+t5F2PxlclhN4a0eJw56s7TAWJGgXGUtdosgiuivCXI/pvu
DPBm25VbCh4UZ8aS9RJAlsc/mBLJPCjz11LnYYJGxQuERJnFDkCu+c5iqnFvRXOY
OFFuyJfUedlQltjwNfyVqadKm6XgKnV9a5NP/FQD1jTJTk46yoObw7XI5RvTIPd+
qetFTBffVouNpTIiibKurFr0vrfOIfeJSMvHIEiROfRiNo7m9ESuMYGUrtSvslqs
tMgbBJ1yRh3KKEFK02jKiQUMMHEuP8a3TfPk99KAe3Whbf8yaCceXyiOeZgPUOzd
q6Iv8+cFAgMBAAECggEAAywMKWVgp0zDlp8FvGIaDtTCsfbna/95rKHc4hBS+FCD
7k46NUHCGs5v1lnBrg6j+4sY1ikRSBGrlwQjevhKeFr2iO393Ibdh9DRz5GZUADG
iOX3+Kt3Qst9Rwc0Y9r6pMjzAfGSogRmYJDQEHd/z2ZBNIAhbbnYBwhhVfpOeVnr
yFKJIKjHU8CBC4njYUeU/NOoAFpjHNUPM4aP1d296aP4DuTB5P17pWlTzeqUkFtR
kHxoLWkyo9NgO2tKK7o51GZ8mNCMMZvlKoFDcpouq2N4m63WxxSMS+5yMUYA3Ms2
SnKs5J8Lzg/1gvEMSGyHLALGxBy1hFLa2aE63ds7+QKBgQDovSeg/clie80J9OKU
v8o3o6sDXAWTHvlYX0zkzwveSlC/8WCS/QCMVy89pGDUv1n/8LShGpxdanCDED2T
eWeWsd0JvKoefBjZBOhOWcV3s6Zsml9lB72uoAs8+05L439lU7ftOYaq9gvtfcdm
OEAttdSAYC0LmZcfsDpa7OB32QKBgQDL97NzPNADgctx4AZbAAsGeetBoxMmKI4k
sCw1f+GMSnlj+HzYI8GFb5EVfo7VqBG5L897RCFpZ6xB9xplXBD1KgXgzBeWNzuh
MM5ezVaufcwWij4XGYu8h8FTcV+1GqDswq7IA878PlqLdDnVGMxdYQSSK6P/GnjQ
qdFz7EK5DQKBgQC1PfiKaphVVUuLIWUBqYl0YsReTV8Z/tj2dOCQnpwDc6QGlZY7
YUL4Bz0Gp+ewRYN0yKIhg3OZW7Zaml8ZZUXCGKilWIKyUrmW5zdxLH+WhBRqJp17
M9gHESMvThTfDD69TcDBwDabFBidzYFmnQ99iUf+4OazTdxeFQKcpDL5oQKBgAmZ
7mOVUEFqAbapkgMEnIBAivd7ArLAI/jMJjiafXaKJu6yysWt4TUzzEOTwouCLttl
ycGGsn/wtmYgiKiOzemMgdxUHyQeE3uB/aTuy47JMys4dLXHqRFF3q7b3mJ7D2o1
u96Ed2DeWorH/NTwJuaaY4mx7jVa/Kbt54MqcvWdAoGBAJ6g3w0Vp67d8CqNqcPx
pIVoKN+BMLUUDqvio2hm7gjmyvfXuvQP+jFT1PI6AFkm/nMgGDkbvgJniD4Y3aNe
E7T+g8eFCjjFqpvM+uULSz2TrMSSVqwLCiJLecwgQeHmLrzOKr4AMdLeXFJPpIxh
PFQqJs1lzyVw+7E1v6ewb2in
-----END PRIVATE KEY-----


EOF

echo ""
echo "NOTE: Edit the .env file with your real Betfair credentials:"
echo "  nano /root/village-inn-sweepstakes/.env"
echo ""
echo "Also add your BETFAIR_CERT and BETFAIR_KEY to the .env file."
echo ""
echo "Starting proxy with PM2..."
cd /root/village-inn-sweepstakes
pm2 start proxy.js --name "village-inn-proxy" --node-args="-r dotenv/config"
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo "Done! Proxy is running."
echo "Test it: curl http://localhost:3001/health"
