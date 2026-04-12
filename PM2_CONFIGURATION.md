# PM2 Configuration Guide - Trading Terminal Backend

## Overview

PM2 is a production process manager for Node.js applications. It provides:
- **Process Management**: Start, stop, restart applications
- **Auto-restart**: Automatic restart on crashes or memory limits
- **Clustering**: Run multiple instances across CPU cores
- **Logging**: Centralized log management
- **Monitoring**: Real-time resource monitoring
- **Startup**: Auto-start on system boot

## Configuration Files

### `ecosystem.config.js`
Main PM2 configuration file for the Trading Terminal backend.

**Key Settings:**

| Setting | Value | Purpose |
|---------|-------|---------|
| `name` | `trading-terminal-backend` | Process identifier |
| `exec_mode` | `cluster` | Run in cluster mode (multi-CPU) |
| `instances` | `max` | Run on all available CPU cores |
| `max_memory_restart` | `500M` | Restart if memory exceeds 500MB |
| `restart_delay` | `4000ms` | Wait 4s before restarting after crash |
| `max_restarts` | `10` | Max 10 restarts within time window |
| `min_uptime` | `10s` | Reset restart counter if running for 10s+ |
| `NODE_ENV` | `production` | Production environment |
| `PORT` | `8787` | Listening port |

## Setup Instructions

### Automated Setup (Recommended)

```bash
# Make script executable
chmod +x setup-pm2.sh

# Run setup
./setup-pm2.sh
```

This will:
1. Install PM2 globally
2. Create log directories
3. Start backend with ecosystem configuration
4. Save PM2 state
5. Configure system startup

### Manual Setup

#### 1. Install PM2
```bash
npm install -g pm2
```

#### 2. Create log directories
```bash
sudo mkdir -p /var/log/pm2
sudo chmod 755 /var/log/pm2
```

#### 3. Start backend with ecosystem file
```bash
cd apps/backend
pm2 start ecosystem.config.js --env production
```

#### 4. Save PM2 configuration
```bash
pm2 save
```

#### 5. Configure system startup
```bash
# For systemd (Ubuntu/Debian)
sudo env PATH=$PATH:/usr/local/bin pm2 startup systemd -u $USER --hp $HOME

# Then verify it saved
pm2 startup
```

#### 6. Verify it's running
```bash
pm2 status
pm2 logs trading-terminal-backend
```

## Managing the Backend

### View Status
```bash
# Simple status view
pm2 status

# Detailed monit dashboard
pm2 monit
```

### View Logs
```bash
# Live logs (Ctrl+C to exit)
pm2 logs trading-terminal-backend

# Last 50 lines
pm2 logs trading-terminal-backend --lines 50

# Filter by log level or search
pm2 logs trading-terminal-backend --grep "ERROR"

# View specific log file
tail -f /var/log/pm2/trading-terminal-backend-error.log
tail -f /var/log/pm2/trading-terminal-backend-out.log
```

### Control Process
```bash
# Start
pm2 start trading-terminal-backend

# Stop (graceful)
pm2 stop trading-terminal-backend

# Restart
pm2 restart trading-terminal-backend

# Reload (zero-downtime restart)
pm2 reload trading-terminal-backend

# Delete from PM2
pm2 delete trading-terminal-backend
```

### Save/Load State
```bash
# Save current state
pm2 save

# Load saved state on boot
pm2 startup
pm2 unstartup              # Remove from startup

# Full state dump (for backup)
pm2 dump
```

## Monitoring & Performance

### Real-time Monitoring
```bash
# Interactive dashboard
pm2 monit

# Web dashboard (requires pm2-web)
npm install -g pm2-web
pm2-web                    # Accessible at http://localhost:9615
```

### Health Checks
```bash
# Set up health check endpoint in app
# Backend should respond to /health with 200 OK

# PM2 will monitor and restart if unhealthy
pm2 start app.js --cron "0 0 * * *"   # Restart daily at midnight
```

### Memory & CPU Monitoring
```bash
# Show memory and CPU usage
pm2 show trading-terminal-backend

# Get stats
pm2 stats
```

## Advanced Configuration

### Cluster Mode Details

The current configuration uses:
- **exec_mode: cluster** - Multiple instances load balancer
- **instances: max** - Automatically scales to CPU count

#### Benefits:
- Utilizes all CPU cores
- Built-in load balancing
- Can restart individual instances without downtime

#### Alternative modes:
```javascript
// Fork mode (single process)
exec_mode: 'fork',
instances: 1,

// Cluster with fixed instances
exec_mode: 'cluster',
instances: 4,  // Run exactly 4 instances
```

### Environment Variables

Set per-environment in ecosystem file:

```javascript
env: {
  NODE_ENV: 'production',
  PORT: 8787,
  LOG_LEVEL: 'info'
},

env_development: {
  NODE_ENV: 'development',
  PORT: 3000
}
```

Then start with:
```bash
pm2 start ecosystem.config.js --env production
pm2 start ecosystem.config.js --env development
```

### Watch Mode (Development Only)

For auto-restart on file changes:

```javascript
watch: true,
ignore_watch: ['node_modules', 'dist'],
```

⚠️ **Note**: Not recommended for production

### Memory Limits

```javascript
// Restart if exceeds memory
max_memory_restart: '500M',

// Set Node.js heap size
max_old_space_size: 512,  // 512MB
```

## Troubleshooting

### Process won't start
```bash
# Check logs
pm2 logs trading-terminal-backend --err

# Test the start command manually
cd apps/backend
pnpm start
```

### Process keeps restarting
```bash
# Check logs for errors
pm2 logs trading-terminal-backend

# Check memory usage
pm2 show trading-terminal-backend

# Increase max_memory_restart if needed
```

### Port already in use
```bash
# Find what's using port 8787
lsof -i :8787
sudo netstat -tlnp | grep 8787

# Kill existing process and restart
pm2 restart trading-terminal-backend
```

### Logs not writing
```bash
# Check log directory permissions
ls -la /var/log/pm2/

# Fix permissions if needed
sudo chmod 755 /var/log/pm2
sudo chown -R $USER:$USER /var/log/pm2
```

### Startup not working after system restart
```bash
# Reinstall startup script
pm2 unstartup
sudo env PATH=$PATH:/usr/local/bin pm2 startup systemd -u $USER --hp $HOME

# Verify
cat /etc/systemd/system/pm2-$USER.service

# Check service status
systemctl status pm2-$USER
```

## Best Practices

✅ **DO:**
- Use ecosystem file for consistency
- Set appropriate memory limits
- Monitor logs regularly
- Test restarts in development
- Use PM2+ for enterprise features

❌ **DON'T:**
- Run with watch mode in production
- Set too many max_restarts
- Ignore repeated restart loops
- Store credentials in ecosystem file
- Use fork mode for high-traffic apps

## Production Checklist

- [ ] PM2 installed globally
- [ ] Log directory writable by backend user
- [ ] ecosystem.config.js deployed with backend
- [ ] PM2 configured for system startup
- [ ] Restart policies sensible for your workload
- [ ] Log rotation configured (consider logrotate)
- [ ] Memory limits appropriate for your server
- [ ] Restart hooks won't cause issues
- [ ] Tested graceful shutdown
- [ ] Backup of ecosystem.config.js

## Useful PM2 Plugins

```bash
# PM2 Plus (paid, enterprise features)
pm2 plus

# PM2 Web UI
npm install -g pm2-web

# PM2 Monitoring
npm install -g pm2-auto-pull

# PM2 Keymetrics (monitoring dashboard)
pm2 install pm2-auto-pull
```

## Log Rotation

For automatic log rotation, use logrotate:

```bash
# Create logrotate config
sudo nano /etc/logrotate.d/pm2-backend
```

Add:
```
/var/log/pm2/trading-terminal-backend-*.log {
  daily
  rotate 14
  copytruncate
  delaycompress
  compress
  notifempty
  create 0640 ubuntu ubuntu
}
```

Then test:
```bash
sudo logrotate -f /etc/logrotate.d/pm2-backend
```

---

**Configuration created**: April 1, 2026  
**Backend**: Trading Terminal Backend  
**Process**: trading-terminal-backend  
**Port**: 8787
