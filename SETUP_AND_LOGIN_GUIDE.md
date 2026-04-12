# 🚀 Complete Setup & Login Guide - Trading Terminal

## Quick Start Summary

You now have everything configured to run the Trading Terminal with user authentication. Here's the complete flow:

---

## 📋 What's Been Configured

✅ Backend environment (`.env.production`)  
✅ PM2 process management (ecosystem.config.js)  
✅ Database connection  
✅ Bootstrap admin account  
✅ JWT authentication tokens  
✅ Session management  

---

## 🔐 Default Bootstrap Credentials

These are configured in `.env.production` and ready to use:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TRADING TERMINAL - DEFAULT ADMIN LOGIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Email:      admin@example.com
Username:   admin
Password:   <set-in-env>
License:    <set-in-env>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

🔒 **SECURITY**: Change these credentials immediately after first login!

---

## 🎯 Getting Users to Login

### Phase 1: Start the Backend

```bash
# Navigate to project directory
cd /home/ubuntu/projects/TradingTerminal-SourceCode

# Start backend with PM2
pm2 start apps/backend/ecosystem.config.js --env production

# Verify it's running
pm2 status
pm2 logs trading-terminal-backend
```

Expected output:
```
┌─────────────────────────────────────┐
│ trading-terminal-backend            │
│ Mode: cluster, Instances: [4 of 4]  │
│ PID: 12345, uptime: 2m              │
│ Status: online                       │
└─────────────────────────────────────┘
```

### Phase 2: Verify Backend is Accessible

```bash
# Local machine
curl http://localhost:8787/health

# Remote access (from api.example.com)
curl http://api.example.com:8787/health
```

Expected response: `200 OK`

### Phase 3: User Opens Trading Terminal

1. **Desktop App**:
   - Launch the Trading Terminal (electron app)
   - Automatically connects to configured backend

2. **Web Browser**:
   - Navigate to `http://api.example.com:8787`
   - Website loads login page

### Phase 4: User Logs In

**Screen**: Trading Terminal Auth Panel

```
═════════════════════════════════════════════════════════════════
                  TRADING TERMINAL // AUTH
═════════════════════════════════════════════════════════════════
SYSTEM: TRADING COCKPIT v2.0  ©  2026

[ LOGIN ] / CREATE ACCOUNT

IDENTIFIER (EMAIL OR USERNAME)
[admin or admin@example.com.....................]

PASSWORD
[••••••••••••••••••••••••••••••••••••••••••••••••••••••••]

LICENSE KEY
[<set-in-env>............................]

[LOGIN BUTTON]

Status: ✅ Backend online
═════════════════════════════════════════════════════════════════
```

### Phase 5: Backend Validates Credentials

```
User submits credentials
         ↓
POST /api/auth/login
{
  "username": "admin",
  "password": "<set-in-env>",
  "licenseKey": "<set-in-env>"
}
         ↓
Backend checks:
  ✓ User exists in database
  ✓ Password matches (bcrypt verify)
  ✓ License key is valid
  ✓ Account is active
         ↓
✅ ALL CHECKS PASS
         ↓
Backend generates:
  - JWT Access Token (15 min expiry)
  - Refresh Token (14 day expiry)
  - Session record in database
         ↓
Returns to client:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresInSeconds": 900,
  "user": {
    "id": "user-abc123",
    "email": "admin@example.com",
    "username": "admin",
    "tier": "starter",
    "roles": ["admin"],
    "licenseKey": "<set-in-env>"
  }
}
         ↓
✅ CLIENT STORES TOKENS
         ↓
✅ USER SEES TRADING TERMINAL DASHBOARD
```

---

## 👥 Creating Additional Users

### Option 1: Via Admin Panel (When Available)
1. Login with admin account
2. Navigate to "User Management" (admin section)
3. Click "Create New User"
4. Fill in:
   - Email address
   - Username (minimum 3 chars)
   - Temporary password
   - License key
   - Role (admin, operator, analyst, viewer)
5. Click Create
6. Send credentials to new user

### Option 2: Direct Database SQL
```sql
-- 1. Create user account
INSERT INTO auth_users (
  id, tenant_id, email, username, tier, is_active, license_key
) VALUES (
  'user-' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12),
  'default-tenant-production',
  'analyst@company.com',
  'jane_analyst',
  'starter',
  TRUE,
  '<set-in-env>'
);

-- 2. Get the user ID
SELECT id INTO uid FROM auth_users WHERE email = 'analyst@company.com';

-- 3. Set password (hash with bcrypt first!)
INSERT INTO auth_credentials (
  user_id, password_hash, password_algo
) VALUES (
  uid,
  '$2b$10$...',  -- Replace with bcrypt hash of password
  'bcrypt'
);

-- 4. Assign role
INSERT INTO auth_user_roles (user_id, role)
VALUES (uid, 'analyst');
```

### Option 3: Via Signup Form
1. Click "CREATE ACCOUNT" tab on login screen
2. Users self-register with:
   - Email
   - Username
   - Password
   - Valid license key
3. Account created automatically
4. User logs in immediately

---

## 🔄 Session & Token Flow

### Access Token (Short-lived)
- **Duration**: 15 minutes (900 seconds)
- **Usage**: Included in every API request
- **Header**: `Authorization: Bearer {access_token}`
- **Auto-refresh**: When expired, automatic refresh happens

### Refresh Token (Long-lived)
- **Duration**: 14 days
- **Usage**: Used to get new access tokens
- **Stored**: In secure local storage
- **Rotation**: New refresh token issued with each refresh

### Session Management
- **Created**: When user logs in
- **Stored**: PostgreSQL `auth_sessions` table
- **Tracking**: User agent, IP address, device label
- **Revoked**: On logout or admin action
- **Multi-device**: Each login creates separate session

---

## 🛡️ Security Features

### Password Protection
- Minimum 8 characters
- Hashed with bcrypt (10 salt rounds)
- Never stored in plain text
- Locked after 5 failed attempts (15 min lockout)

### License Key Validation
- Required for every login
- Validated against user record
- Can be rotated by admin
- Prevents unauthorized access

### JWT Security
- Signed with SECRET key from `.env.production`
- Includes user claims (email, username, roles, tier)
- Token validation on every protected endpoint
- Session ID tracking for audit

### Session Security
- User agent verification
- IP address logging
- Session revocation capability
- Logout clears refresh tokens

### Two-Factor Authentication (Optional)
- TOTP-based (Google Authenticator, Authy)
- Recovery codes for backup
- Configurable per user
- Enforcement policy available

---

## 📊 User Roles & Access Levels

| Role | Description | Capabilities |
|------|-------------|--------------|
| **Admin** | System administrator | User management, system settings, full access |
| **Operator** | Portfolio/trade manager | Execute trades, manage orders, view analytics |
| **Analyst** | Data analyst | Run backtests, create alerts, analyze data |
| **Viewer** | Read-only user | View data, reports, dashboards (no execution) |
| **Service** | API/automation | Limited to programmatic endpoints only |

---

## 🚨 Common Login Issues & Solutions

| Problem | Cause | Solution |
|---------|-------|----------|
| "Invalid Credentials" | Wrong email/username/password | Verify credentials, check case sensitivity |
| "Invalid License Key" | License key doesn't match | Get valid license key from admin |
| "Account Already Exists" | Email/username taken | Use different email/username or login |
| "Cannot Reach Backend" | Backend not running | Start: `pm2 start ecosystem.config.js` |
| "Database Unavailable" | PostgreSQL down | Check: `sudo systemctl status postgresql` |
| "Session Expired" | Tokens expired | Automatic refresh, or re-login if failed |
| "Account Locked" | Too many failed attempts | Wait 15 minutes or admin unlock |

---

## 🔧 Admin Commands

### Check Backend Status
```bash
pm2 status                          # View all processes
pm2 show trading-terminal-backend   # Detailed process info
pm2 logs trading-terminal-backend   # View real-time logs
```

### Manage Backend
```bash
pm2 restart trading-terminal-backend  # Restart
pm2 stop trading-terminal-backend     # Stop
pm2 start trading-terminal-backend    # Start
pm2 delete trading-terminal-backend   # Remove from PM2
```

### Database Access
```bash
# Connect to database
psql "postgresql://tt_app:<set-in-env>@127.0.0.1:5432/trading_terminal"

# List users
SELECT id, email, username, is_active, tier FROM auth_users;

# View active sessions
SELECT id, user_id, status, created_at FROM auth_sessions WHERE status = 'active';

# Reset user password
UPDATE auth_credentials 
SET password_hash = '$2b$10$...'
WHERE user_id = 'user-xyz';
```

### Test API
```bash
# Test login endpoint
curl -X POST http://api.example.com:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username":"admin",
    "password":"<set-in-env>",
    "licenseKey":"<set-in-env>"
  }'

# Test with token
curl -H "Authorization: Bearer {token}" \
  http://api.example.com:8787/api/me
```

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `.env.production` | Configuration & bootstrap credentials |
| `apps/backend/ecosystem.config.js` | PM2 process config |
| `apps/backend/src/auth.ts` | Authentication logic |
| `apps/backend/src/server.ts` | API endpoints |
| `apps/desktop/src/renderer/components/AuthPanel.tsx` | Login UI |
| `USER_LOGIN_GUIDE.md` | Detailed auth documentation |
| `LOGIN_QUICKREF.md` | Quick reference card |

---

## ✅ Deployment Checklist

Before going to production:

- [ ] Bootstrap credentials set in `.env.production`
- [ ] Backend started with PM2: `pm2 start ecosystem.config.js`
- [ ] Backend accessible from remote IP
- [ ] Firewall allows port 8787
- [ ] PostgreSQL running and accessible
- [ ] Test login with default credentials
- [ ] Created admin account
- [ ] Created test user accounts
- [ ] Tested token refresh flow
- [ ] Verified logout revokes session
- [ ] Changed default password (security)
- [ ] Configured backup strategy
- [ ] Set up monitoring/alerts

---

## 🎓 Example Login Scenarios

### Scenario 1: First Admin Login
```
1. Admin receives credentials:
   - admin@example.com
   - <set-in-env>
   - <set-in-env>

2. Opens Trading Terminal app
3. Sees login screen
4. Enters credentials
5. Clicks LOGIN
6. ✅ Redirected to dashboard
7. Uses "User Management" to create team accounts
```

### Scenario 2: New User Signup
```
1. Team member clicks "CREATE ACCOUNT"
2. Fills in:
   - Email: analyst@company.com
   - Username: jane_analyst
   - Password: personal secure password
   - License Key: <set-in-env> (shared by org)
3. Clicks CREATE
4. ✅ Account created and logged in
5. Routed to dashboard
```

### Scenario 3: Token Refresh
```
1. User logged in for 14 minutes
2. User clicks "Generate Report"
3. Access token is 14 min old (expires in 1 min)
4. Backend detects expiry
5. Automatically uses refresh token to get new access token
6. Request continues seamlessly
7. ✅ User sees generated report (no re-login needed)
```

### Scenario 4: Session Across Devices
```
1. User logs in on Desktop (Session #1)
   - Token + refresh token stored locally
   
2. User logs in on Laptop (Session #2)
   - New token + refresh token issued
   - New session created in database
   
3. Both devices can use Trading Terminal independently
4. Each session tracked separately in database
5. User can logout all sessions at once if desired
```

---

## 🌐 Accessing the Terminal

### Local Development
- Frontend: `http://localhost:3000` (if web app)
- Backend: `http://localhost:8787`
- Desktop: Launch electron app

### Remote Server (api.example.com)
- Backend: `http://api.example.com:8787`
- Desktop app configured to connect to this URL

### Advanced: Nginx Reverse Proxy
```nginx
server {
  listen 80;
  server_name trading.company.com;
  
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Authorization $http_authorization;
  }
}
```

---

## 📞 Support

For issues, check:
1. **Backend logs**: `pm2 logs trading-terminal-backend`
2. **Database**: `psql -d trading_terminal`
3. **Network**: `curl http://api.example.com:8787/health`
4. **Documentation**: `USER_LOGIN_GUIDE.md`

---

**Setup Date**: April 1, 2026  
**Backend Version**: v2.0  
**Status**: ✅ Ready for User Login
