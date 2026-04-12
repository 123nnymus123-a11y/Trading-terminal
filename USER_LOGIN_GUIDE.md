# Trading Terminal - User Login Guide

## 🔐 Authentication Overview

The Trading Terminal uses a **license-key based authentication system** with username/email login.

### Required Credentials for Login:
1. **Email OR Username**
2. **Password** (minimum 8 characters)
3. **License Key** (provided by administrator)

---

## 🚀 Login Flow

### Step 1: Open the Terminal
Launch the Trading Terminal desktop application. If you're not authenticated, you'll see the login screen.

### Step 2: Access the Auth Panel
The login screen shows a **Bloomberg-style interface** with two tabs:
- **LOGIN** - For existing users
- **CREATE ACCOUNT** - For new users

### Step 3: Enter Credentials

**For Existing Users (LOGIN tab):**
```
IDENTIFIER:  your-email@company.com  or  username
PASSWORD:    YourSecurePassword123
LICENSE KEY: [provided-by-admin]
```

**For New Users (CREATE ACCOUNT tab):**
```
EMAIL:       user@company.com
USERNAME:    your_username
PASSWORD:    YourSecurePassword123
LICENSE KEY: [provided-by-admin]
```

### Step 4: Authentication Request
The client sends credentials to the backend via:
```
POST /api/auth/login
```

or for signup:
```
POST /api/auth/signup
```

### Step 5: Token Generation
On successful authentication, the backend returns:
- **Access Token** (JWT, expires in 15 minutes by default)
- **Refresh Token** (longer-lived token for session renewal)
- **Session Data** (user info, tier, roles)

### Step 6: Session Storage
Tokens are stored locally in the application and used for subsequent API requests.

---

## 📋 Default Bootstrap Account

A default account is pre-configured for initial deployment:

| Field | Value |
|-------|-------|
| **Email** | `admin@example.com` |
| **Username** | `admin` |
| **Password** | `(see ENV: AUTH_BOOTSTRAP_PASSWORD)` |
| **License Key** | `(see ENV: AUTH_BOOTSTRAP_LICENSE_KEY)` |
| **Role** | Admin |
| **Tier** | Starter |

**These are set in `.env.production` during backend configuration.**

### Initial Login Steps:
1. Open Trading Terminal
2. Click **LOGIN** tab
3. Enter default credentials (from your `.env.production`)
4. Click **LOGIN**

---

## 🎯 How to Set Up Bootstrap Credentials

### Step 1: Configure Environment
Edit `.env.production` before starting the backend:

```bash
# Bootstrap account credentials
AUTH_BOOTSTRAP_EMAIL=admin@example.com
AUTH_BOOTSTRAP_USERNAME=admin
AUTH_BOOTSTRAP_PASSWORD=<set-in-secret-manager>
AUTH_BOOTSTRAP_LICENSE_KEY=<set-in-secret-manager>
```

### Step 2: Start Backend
```bash
pm2 start ecosystem.config.js --env production
```

### Step 3: Use Bootstrap Account
Use the credentials from `.env.production` to login for the first time.

---

## 👥 Creating Additional User Accounts

### Option 1: Via Trading Terminal UI
1. Login with admin account
2. Look for "User Management" or "Administration" section
3. Click "Create User" or similar option
4. Provide:
   - Email
   - Username
   - Temporary password
   - License key
   - Role (Admin, Operator, Analyst, Viewer)
5. New user can now login with provided credentials

### Option 2: Directly via Database
```sql
-- Insert new user
INSERT INTO auth_users (id, email, username, tier, is_active, license_key)
VALUES (
  'user-' || substr(encode(gen_random_bytes(12), 'base64'), 1, 12),
  'newuser@company.com',
  'newuser',
  'starter',
  TRUE,
  'LICENSE-KEY-HERE'
);

-- Get the user ID from above query results
SELECT id FROM auth_users WHERE email = 'newuser@company.com';

-- Insert credentials (replace {user-id} with actual ID)
INSERT INTO auth_credentials (user_id, password_hash, password_algo)
VALUES ('{user-id}', '$2b$10$...', 'bcrypt');

-- Add role
INSERT INTO auth_user_roles (user_id, role)
VALUES ('{user-id}', 'viewer');
```

**Note**: Use `bcrypt` for password hashing. For simplicity, use the admin UI when available.

---

## 🔑 License Key Management

### What is a License Key?
A unique identifier that authorizes users to access the Trading Terminal.

### Where to Get License Keys
- **Development**: Use `007` (included as development shortcut)
- **Production**: Provided by your administrator or licensing system

### Setting License Keys

**In `.env.production`:**
```bash
# Bootstrap license key (for default account)
AUTH_BOOTSTRAP_LICENSE_KEY=<set-in-secret-manager>

# All new accounts must use a valid license key
```

**When creating users:**
Each user must have a valid license key. The system validates:
1. License key matches user's registered key
2. License key hasn't expired
3. License key is in the valid format

---

## 🔒 Security Policies

### Password Requirements
- **Minimum length**: 8 characters
- **Recommended**: Mix of uppercase, lowercase, numbers, symbols
- **Not stored in plain text**: Hashed with bcrypt (salt: 10 rounds)

### Session Management
| Setting | Value |
|---------|-------|
| **Access Token TTL** | 15 minutes (900 seconds) |
| **Refresh Token TTL** | 14 days (1,209,600 seconds) |
| **Session Timeout** | 14 days |
| **Max Restarts** | 10 within window |
| **Graceful Logout** | Revokes all sessions on demand |

### Multi-Factor Authentication (Optional)
The system supports **TOTP-based 2FA**:
- Can be enabled per user
- Uses authenticator apps (Google Authenticator, Authy, etc.)
- Recovery codes provided for account recovery

### Account Lockout
```
Failed Login Attempts: System tracks failed attempts
After 5 consecutive failures: Account temporarily locked
Lockout Duration: 15 minutes
```

---

## 🐛 Troubleshooting Login Issues

### "Invalid Credentials"
**Cause**: Email/username or password incorrect

**Solution**:
- Double-check email or username format
- Verify password is correct (case-sensitive)
- Confirm license key is valid
- If using bootstrap account, check `.env.production`

### "Invalid License Key"
**Cause**: License key doesn't match or is invalid

**Solution**:
- Verify license key from administrator
- Check for typos or extra spaces
- Ensure license key hasn't expired
- For dev: use `007`

### "Account Already Exists" (During Signup)
**Cause**: Email or username is already registered

**Solution**:
- Use LOGIN tab instead
- Choose a different username/email
- Contact admin to reset password if needed

### "Cannot Reach Backend Server"
**Cause**: Backend not running or connection issues

**Solution**:
```bash
# Verify backend is running
pm2 status

# Check logs for errors
pm2 logs trading-terminal-backend

# Verify backend URL in config
# Desktop app should point to: http://localhost:8787 (local)
# Or: http://api.example.com:8787 (remote)

# Test connectivity
curl http://api.example.com:8787/health
```

### "Authentication Service Unavailable"
**Cause**: Database not accessible or down

**Solution**:
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Verify database is running
psql postgresql://tt_app:***@127.0.0.1:5432/trading_terminal

# Check backend logs
pm2 logs trading-terminal-backend --err
```

### "Session Expired"
**Cause**: Access token or refresh token expired

**Solution**:
- Tokens auto-refresh when accessing API
- If refresh fails, login again
- Refresh happens transparently in background

---

## 🔄 Token Refresh Flow

The system automatically handles token refresh:

1. **Client makes API request** with access token
2. **Backend checks token expiration**
3. **If expired**: Backend attempts automatic refresh using refresh token
4. **If refresh succeeds**: New token issued, request continues
5. **If refresh fails**: Client must re-login

This is handled automatically by the `apiClient` library.

---

## 📱 Login Endpoints

### Backend API Endpoints

**Login:**
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@company.com",      // OR "username"
  "password": "SecurePassword123",
  "licenseKey": "LICENSE-KEY-2026"
}

Response (200):
{
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresInSeconds": 900,
  "user": {
    "id": "user-abc123",
    "email": "user@company.com",
    "username": "john_doe",
    "tier": "pro",
    "roles": ["analyst", "operator"],
    "licenseKey": "LICENSE-KEY-2026"
  }
}
```

**Signup:**
```
POST /api/auth/signup
Content-Type: application/json

{
  "email": "newuser@company.com",
  "username": "jane_doe",
  "password": "SecurePassword123",
  "licenseKey": "LICENSE-KEY-2026"
}

Response (201): Same as login response
```

**Refresh Token:**
```
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGc..."
}

Response (200):
{
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresInSeconds": 900
}
```

**Logout:**
```
POST /api/auth/logout
Content-Type: application/json

{
  "refreshToken": "eyJhbGc...",
  "allSessions": false  // true = logout all devices
}

Response (200): { "ok": true }
```

---

## 🎓 User Roles & Permissions

| Role | Description | Permissions |
|------|-------------|------------|
| **Admin** | System administrator | Full access, user management, settings |
| **Operator** | Portfolio manager | Trade execution, order management |
| **Analyst** | Research specialist | Data analysis, reports, backtesting |
| **Viewer** | Read-only user | View data, reports (no execution) |
| **Service** | API/automation | Limited to specific endpoints |

Roles are assigned during user creation and managed by administrators.

---

## ⚡ Quick Reference

### For First-Time Users:
1. Get credentials from administrator
2. Open Trading Terminal
3. Click **CREATE ACCOUNT** or **LOGIN** depending on status
4. Enter email/username, password, and license key
5. Click LOGIN button
6. Access the terminal

### For Administrators:
1. Set up bootstrap account in `.env.production`
2. Start backend: `pm2 start ecosystem.config.js`
3. Login with bootstrap credentials
4. Create additional users through admin panel or database
5. Distribute credentials and license keys to users

### Backend Management:
```bash
pm2 status                          # Check backend running
pm2 logs trading-terminal-backend   # View authentication logs
psql -d trading_terminal            # Query auth database directly
```

---

**Last Updated**: April 1, 2026  
**Version**: 1.0  
**Related Files**:
- `.env.production` - Configuration
- `apps/backend/src/auth.ts` - Authentication logic
- `apps/backend/src/server.ts` - API endpoints
- `apps/desktop/src/renderer/components/AuthPanel.tsx` - Login UI
