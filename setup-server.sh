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
