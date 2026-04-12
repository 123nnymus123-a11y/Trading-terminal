# Trading Terminal Backend Deployment Guide

## Quick Start - Manual Deployment

### Step 1: Copy environment file to remote server
```bash
scp apps/backend/.env.production ubuntu@api.example.com:/opt/trading-terminal/apps/backend/
```

### Step 2: SSH into the remote server
```bash
ssh ubuntu@api.example.com
```

### Step 3: Navigate to backend directory
```bash
cd /opt/trading-terminal/apps/backend
```

### Step 4: Install dependencies
```bash
pnpm install
```

### Step 5: Build the backend
```bash
pnpm build
```

### Step 6: Start the backend
```bash
# Option A: Direct start (for testing/debugging)
pnpm start

# Option B: Using PM2 for production (recommended)
npm install -g pm2
pm2 start "pnpm start" --name "trading-terminal-backend" --env production
pm2 save
pm2 startup
```

### Step 7: Configure firewall
```bash
sudo ufw allow 8787/tcp
sudo ufw enable
```

### Step 8: Verify the backend is running
```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs trading-terminal-backend

# Test connectivity
curl http://localhost:8787/health
```

## Configuration Details

### Environment Variables
- **NODE_ENV**: `production`
- **PORT**: `8787`
- **DATABASE_URL**: `postgresql://tt_app:<set-in-env>@127.0.0.1:5432/trading_terminal`
- **CORS_ORIGIN**: `http://api.example.com:8787`

### Database Prerequisites
Ensure PostgreSQL is running on the remote server:
```bash
sudo systemctl status postgresql

# If not installed
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Redis Prerequisites
Ensure Redis is running (if configured):
```bash
sudo systemctl status redis-server

# If not installed
sudo apt-get install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

## Accessing the Backend

Once deployed and running, the backend will be accessible at:
```
http://api.example.com:8787
```

## Troubleshooting

### Backend won't start
1. Check environment file exists: `ls -la .env.production`
2. Check logs: `pm2 logs trading-terminal-backend`
3. Ensure database is accessible: `psql $DATABASE_URL`

### Port 8787 not accessible
1. Check firewall: `sudo ufw status`
2. Add rule: `sudo ufw allow 8787/tcp`
3. Check if process is listening: `netstat -tulpn | grep 8787`

### Database connection errors
1. Verify PostgreSQL is running: `sudo systemctl status postgresql`
2. Test connection: `psql postgresql://tt_app:<set-in-env>@127.0.0.1:5432/trading_terminal`
3. Check database exists: `psql -U postgres -l`

## Monitoring & Management

### View logs
```bash
pm2 logs trading-terminal-backend
```

### Restart backend
```bash
pm2 restart trading-terminal-backend
```

### Stop backend
```bash
pm2 stop trading-terminal-backend
```

### Remove from PM2
```bash
pm2 delete trading-terminal-backend
```

## Security Recommendations

⚠️ **Production Considerations:**
- [ ] Change JWT_SECRET in `.env.production` to a strong unique value
- [ ] Use HTTPS (configure reverse proxy like Nginx)
- [ ] Rotate database password regularly
- [ ] Keep system packages updated: `sudo apt-get update && sudo apt-get upgrade`
- [ ] Use SSH key authentication instead of passwords
- [ ] Configure firewall to only allow necessary ports
- [ ] Set up monitoring and alerting (Prometheus, etc.)
- [ ] Regular backups of PostgreSQL database
- [ ] Use `.gitignore` to never commit `.env.production`
