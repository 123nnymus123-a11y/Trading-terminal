# 🚀 Backend Deployment - Quick Reference

## What's Been Prepared

✅ **Production environment file**: `.env.production`
- Database: `postgresql://tt_app:<set-in-env>@127.0.0.1:5432/trading_terminal`
- Port: `8787`
- CORS origin: `http://api.example.com:8787`

✅ **Deployment script**: `deploy-backend.sh`
- Automated end-to-end deployment to remote server

✅ **Verification script**: `verify-backend.sh`
- Tests if backend is running correctly

✅ **Deployment guide**: `BACKEND_DEPLOYMENT.md`
- Manual step-by-step instructions

---

## 🎯 Quickest Path to Deployment

### Option 1: Automated Deployment (Recommended)

```bash
# Make scripts executable (already done)
chmod +x deploy-backend.sh verify-backend.sh

# Run automated deployment
./deploy-backend.sh ubuntu api.example.com
```

**Note**: Update `REPO_URL` in `deploy-backend.sh` to point to your actual Git repository!

### Option 2: Manual Deployment

1. **Copy environment file to server**:
   ```bash
   scp apps/backend/.env.production ubuntu@api.example.com:/opt/trading-terminal/apps/backend/
   ```

2. **SSH into server and setup**:
   ```bash
   ssh ubuntu@api.example.com
   cd /opt/trading-terminal
   pnpm install
   cd apps/backend
   pnpm build
   ```

3. **Start backend with PM2**:
   ```bash
   npm install -g pm2
   pm2 start "pnpm start" --name "trading-terminal-backend" --env production
   ```

4. **Configure firewall**:
   ```bash
   sudo ufw allow 8787/tcp
   ```

---

## 🔍 Verification

```bash
# Run verification from your local machine
./verify-backend.sh

# Or manually test
curl http://api.example.com:8787/health
```

**Expected**: Backend responds on `http://api.example.com:8787`

---

## 📋 Checklist Before Deployment

- [ ] SSH access configured to server `api.example.com`
- [ ] Database is running and accessible
- [ ] Port 8787 is available on remote server
- [ ] Git repository URL updated in deployment script (if using automated)
- [ ] `.env.production` file is sensitive and .gitignored
- [ ] Firewall rules allow port 8787 inbound

---

## 🛠️ Key Files

│ File | Purpose |
|------|---------|
| `.env.production` | Production environment variables |
| `deploy-backend.sh` | Automated deployment script |
| `verify-backend.sh` | Verification/testing script |
| `BACKEND_DEPLOYMENT.md` | Detailed deployment guide |

---

## 🚨 Important Notes

⚠️ **Security**:
- `.env.production` contains database credentials - never commit to Git
- Consider rotating `JWT_SECRET` before production
- Use HTTPS with reverse proxy (Nginx) in production
- Keep system packages updated

⚠️ **Prerequisites on Remote Server**:
- Node.js 18+
- PostgreSQL (running and configured)
- Redis (optional, for caching)
- PM2 (for process management)
- UFW or appropriate firewall

---

## 📞 Troubleshooting

### Backend won't start
```bash
# SSH to server
ssh ubuntu@api.example.com

# Check logs
pm2 logs trading-terminal-backend

# Check if DB is accessible
psql postgresql://tt_app:<set-in-env>@127.0.0.1:5432/trading_terminal
```

### Port 8787 not accessible
```bash
# Check firewall
sudo ufw status

# Add firewall rule
sudo ufw allow 8787/tcp

# Verify process is listening
netstat -tulpn | grep 8787
```

### Database connection errors
```bash
# Test database directly
psql "postgresql://tt_app:<set-in-env>@127.0.0.1:5432/trading_terminal"

# Check PostgreSQL service
sudo systemctl status postgresql
```

---

## 📈 Next Steps

1. ✅ Deploy backend using automated or manual method
2. ✅ Verify backend is running with `verify-backend.sh`
3. ✅ Test backend endpoints manually
4. ✅ Configure frontend to connect to `http://api.example.com:8787`
5. ✅ Set up monitoring and logging
6. ✅ Configure CI/CD for future deployments

---

## 💡 Helpful Commands

```bash
# Monitor backend in real-time
pm2 monitor

# View all PM2 processes
pm2 status

# Restart backend
pm2 restart trading-terminal-backend

# Stop backend
pm2 stop trading-terminal-backend

# View detailed logs
pm2 logs trading-terminal-backend --lines 100

# SSH to server for debugging
ssh ubuntu@api.example.com
```

---

**Deployment prepared on**: April 1, 2026  
**Target server**: api.example.com:8787
