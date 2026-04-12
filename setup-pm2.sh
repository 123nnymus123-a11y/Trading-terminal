#!/bin/bash

# PM2 Setup Script for Trading Terminal Backend
# Configures PM2 for production deployment with ecosystem file

set -e

echo "🚀 PM2 Setup for Trading Terminal Backend"
echo "=========================================="
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
  echo "⚠️  Some commands require sudo. You may be prompted for your password."
fi

# Step 1: Install PM2 globally
echo "📍 Step 1: Installing PM2..."
if npm list -g pm2 &> /dev/null; then
  echo "✅ PM2 already installed"
else
  npm install -g pm2
  echo "✅ PM2 installed globally"
fi

# Step 2: Create log directory
echo "📍 Step 2: Setting up log directories..."
sudo mkdir -p /var/log/pm2
sudo chmod 755 /var/log/pm2
echo "✅ Log directories created"

# Step 3: Navigate to backend directory
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📍 Step 3: Backend directory: $BACKEND_DIR"
cd "$BACKEND_DIR"

# Step 4: Start backend with ecosystem file
echo "📍 Step 4: Starting backend with PM2..."
pm2 start ecosystem.config.js --env production
echo "✅ Backend started with PM2"

# Step 5: Save PM2 configuration
echo "📍 Step 5: Saving PM2 configuration..."
pm2 save
echo "✅ PM2 configuration saved"

# Step 6: Setup PM2 startup
echo "📍 Step 6: Configuring PM2 startup on system boot..."
sudo env PATH=$PATH:/usr/local/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
echo "✅ PM2 startup configured"

# Step 7: Display status
echo ""
echo "📍 Step 7: Current PM2 status..."
pm2 status

# Step 8: Display logs
echo ""
echo "📍 Backend logs:"
pm2 logs trading-terminal-backend --lines 10 --nostream 2>/dev/null || echo "(No logs yet)"

# Summary
echo ""
echo "=========================================="
echo "✅ PM2 Configuration Complete!"
echo ""
echo "Quick Commands:"
echo "  pm2 status                              - View process status"
echo "  pm2 logs trading-terminal-backend       - View live logs"
echo "  pm2 restart trading-terminal-backend    - Restart backend"
echo "  pm2 stop trading-terminal-backend       - Stop backend"
echo "  pm2 start trading-terminal-backend      - Start backend"
echo "  pm2 delete trading-terminal-backend     - Remove from PM2"
echo "  pm2 monit                               - Real-time monitoring"
echo ""
echo "Backend running on: http://localhost:8787"
echo "=========================================="
