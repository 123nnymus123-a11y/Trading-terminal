# PM2 Quick Reference - Trading Terminal Backend

## 🚀 Getting Started

### Initial Setup
```bash
# Run automated setup
chmod +x setup-pm2.sh
./setup-pm2.sh
```

### Manual Start
```bash
cd apps/backend
pm2 start ecosystem.config.js --env production
pm2 save
```

---

## 📊 Common Commands

| Command | Purpose |
|---------|---------|
| `pm2 status` | Show all processes |
| `pm2 logs trading-terminal-backend` | View live logs |
| `pm2 restart trading-terminal-backend` | Restart process |
| `pm2 stop trading-terminal-backend` | Stop process |
| `pm2 start trading-terminal-backend` | Start process |
| `pm2 monit` | Real-time dashboard |
| `pm2 show trading-terminal-backend` | Detailed info |
| `pm2 delete trading-terminal-backend` | Remove from PM2 |

---

## 🔍 Debugging

### View Errors
```bash
# Last 100 lines of error log
pm2 logs trading-terminal-backend --err --lines 100

# Watch log file directly
tail -f /var/log/pm2/trading-terminal-backend-error.log
```

### Check Memory/CPU
```bash
# Detailed process info
pm2 show trading-terminal-backend

# Quick stats
pm2 stats
```

### Test Port
```bash
# Check if 8787 is in use
lsof -i :8787
netstat -tulpn | grep 8787
```

---

## 💾 State Management

```bash
# Save current state
pm2 save

# Load saved state (runs on boot)
pm2 startup

# Clear saved state
pm2 unstartup
```

---

## 🔄 Restarting Strategies

### Graceful Restart (No downtime)
```bash
pm2 reload trading-terminal-backend
```

### Force Restart
```bash
pm2 restart trading-terminal-backend
```

### Restart All
```bash
pm2 restart all
```

### Restart with Delay
```bash
pm2 restart trading-terminal-backend --update-env
```

---

## 📈 Monitoring

### Live Dashboard
```bash
pm2 monit
```

### Web Dashboard (optional)
```bash
npm install -g pm2-web
pm2-web
# Access at http://localhost:9615
```

### Export Logs
```bash
pm2 logs trading-terminal-backend > backend.log
```

---

## 🛠️ Troubleshooting

### Process won't start
```bash
# Check why it's failing
pm2 logs trading-terminal-backend --err

# Try manual run
cd apps/backend && pnpm start
```

### Stuck in restart loop
```bash
# Delete and start fresh
pm2 delete trading-terminal-backend
pm2 start ecosystem.config.js --env production
```

### Check permissions
```bash
# Verify log directory
ls -la /var/log/pm2/

# Fix if needed
sudo chmod 755 /var/log/pm2
sudo chown -R $USER:$USER /var/log/pm2
```

### System startup not working
```bash
# Reinstall startup
pm2 unstartup
sudo env PATH=$PATH:/usr/local/bin pm2 startup systemd -u $USER --hp $HOME
pm2 save
```

---

## 🔧 Configuration Files

### Main Config
📄 `apps/backend/ecosystem.config.js`
- Process settings
- Environment variables
- Memory/CPU limits
- Restart policies

### Detailed Guide
📄 `PM2_CONFIGURATION.md`
- Full documentation
- Advanced settings
- Best practices

### Setup Script
🔨 `setup-pm2.sh`
- Automated one-time setup
- Directory creation
- Startup configuration

---

## ✨ Key Features Configured

✅ **Cluster Mode**: Uses all CPU cores  
✅ **Auto-restart**: On crash or memory limit  
✅ **Graceful Shutdown**: 5-second timeout  
✅ **Centralized Logging**: `/var/log/pm2/`  
✅ **Memory Limit**: 500MB before restart  
✅ **System Startup**: Auto-start on reboot  
✅ **Process Name**: `trading-terminal-backend`  
✅ **Port**: 8787  

---

## 🎯 Your Setup at a Glance

```
Backend Process: trading-terminal-backend
Config File: apps/backend/ecosystem.config.js
Port: 8787
Memory Limit: 500MB
Restart Policy: 10 max restarts
Logs: /var/log/pm2/trading-terminal-backend-*.log
Mode: Cluster (all CPU cores)
```

---

## 🚨 Production Reminders

- PM2 runs as your current user (`ubuntu`)
- Logs are in `/var/log/pm2/` (check permissions if issues)
- Save state after changes: `pm2 save`
- Test startup: restart system and verify with `pm2 status`
- Monitor regularly: `pm2 monit`
- Rotate logs (consider logrotate)

---

**Quick Start**: `./setup-pm2.sh`  
**View Status**: `pm2 status`  
**View Logs**: `pm2 logs trading-terminal-backend`  
**Dashboard**: `pm2 monit`
