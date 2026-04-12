#!/bin/bash

# Trading Terminal Backend Deployment Script
# This script clones the repository, installs dependencies, and starts the backend

set -e  # Exit on error

# Configuration
REMOTE_USER=${1:-ubuntu}
REMOTE_HOST=${2:-api.example.com}
BACKEND_PORT=8787
REPO_URL="https://github.com/your-org/TradingTerminal-SourceCode.git"  # Update this
DEPLOY_DIR="/opt/trading-terminal"
BACKEND_DIR="$DEPLOY_DIR/apps/backend"

echo "🚀 Trading Terminal Backend Deployment Script"
echo "================================================"
echo "Target: $REMOTE_USER@$REMOTE_HOST"
echo "Deploy Directory: $DEPLOY_DIR"
echo "Backend Port: $BACKEND_PORT"
echo ""

# Step 1: Connect and prepare remote server
echo "📍 Step 1: Preparing remote server..."
ssh $REMOTE_USER@$REMOTE_HOST << 'REMOTE_COMMANDS'
  set -e
  
  # Update system packages
  sudo apt-get update
  sudo apt-get upgrade -y
  
  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  
  # Install pnpm if not present
  if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm
  fi
  
  echo "✅ Remote server ready"
REMOTE_COMMANDS

# Step 2: Clone or update repository
echo "📍 Step 2: Cloning/updating repository..."
ssh $REMOTE_USER@$REMOTE_HOST << REMOTE_COMMANDS
  set -e
  
  if [ -d "$DEPLOY_DIR" ]; then
    echo "Updating existing repository..."
    cd "$DEPLOY_DIR"
    git pull origin main
  else
    echo "Cloning repository..."
    mkdir -p $DEPLOY_DIR
    git clone $REPO_URL $DEPLOY_DIR
    cd $DEPLOY_DIR
  fi
  
  echo "✅ Repository ready"
REMOTE_COMMANDS

# Step 3: Install dependencies
echo "📍 Step 3: Installing dependencies..."
ssh $REMOTE_USER@$REMOTE_HOST << 'REMOTE_COMMANDS'
  set -e
  cd "$DEPLOY_DIR"
  pnpm install
  echo "✅ Dependencies installed"
REMOTE_COMMANDS

# Step 4: Copy environment file (you may need to do this manually for security)
echo "📍 Step 4: Environment configuration"
echo "⚠️  Please ensure .env.production is copied to the server:"
echo "   scp apps/backend/.env.production $REMOTE_USER@$REMOTE_HOST:$BACKEND_DIR/"
echo ""

# Step 5: Build backend
echo "📍 Step 5: Building backend..."
ssh $REMOTE_USER@$REMOTE_HOST << 'REMOTE_COMMANDS'
  set -e
  cd "$DEPLOY_DIR"
  pnpm -C apps/backend build
  echo "✅ Backend built successfully"
REMOTE_COMMANDS

# Step 6: Configure firewall
echo "📍 Step 6: Configuring firewall..."
ssh $REMOTE_USER@$REMOTE_HOST << REMOTE_COMMANDS
  set -e
  
  if command -v ufw &> /dev/null; then
    sudo ufw allow $BACKEND_PORT/tcp
    echo "✅ Firewall rule added for port $BACKEND_PORT"
  fi
REMOTE_COMMANDS

# Step 7: Start backend with PM2 (recommended for production)
echo "📍 Step 7: Starting backend..."
ssh $REMOTE_USER@$REMOTE_HOST << 'REMOTE_COMMANDS'
  set -e
  
  # Install PM2 globally if not present
  if ! npm list -g pm2 &> /dev/null; then
    npm install -g pm2
  fi
  
  cd "$DEPLOY_DIR/apps/backend"
  pm2 start "pnpm start" --name "trading-terminal-backend" --env production
  pm2 save
  
  echo "✅ Backend started on port 8787"
REMOTE_COMMANDS

# Step 8: Verify
echo "📍 Step 8: Verifying deployment..."
echo ""
echo "To check backend status:"
echo "  ssh $REMOTE_USER@$REMOTE_HOST 'pm2 status'"
echo ""
echo "To view logs:"
echo "  ssh $REMOTE_USER@$REMOTE_HOST 'pm2 logs trading-terminal-backend'"
echo ""
echo "To access the backend:"
echo "  https://$REMOTE_HOST"
echo ""
echo "✅ Deployment script complete!"
