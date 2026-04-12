# Login Quick Reference

## 🎯 Default Bootstrap Account

Use these credentials for first login (from `.env.production`):

```
Email:       admin@example.com
Username:    admin
Password:    (set in AUTH_BOOTSTRAP_PASSWORD)
License Key: (set in AUTH_BOOTSTRAP_LICENSE_KEY)
```

---

## 📲 Login Steps

### Desktop App
1. **Launch** Trading Terminal desktop application
2. **See** login screen with "LOGIN" and "CREATE ACCOUNT" tabs
3. **Click** LOGIN tab
4. **Enter** identifier (email or username)
5. **Enter** password
6. **Enter** license key
7. **Click** LOGIN button
8. ✅ **Done!** You're in the terminal

### Web Browser
1. Navigate to `http://localhost:8787` or `http://api.example.com:8787`
2. Same login form as desktop
3. Enter credentials
4. Click LOGIN

---

## 🆕 Creating New Account

1. Click **CREATE ACCOUNT** tab
2. Fill in:
   - Email address
   - Username (minimum 3 characters)
   - Password (minimum 8 characters)
   - License key
3. Click **CREATE ACCOUNT**
4. ✅ Account created and logged in!

---

## 🔑 License Key

- **Development**: Use `007`
- **Production**: Provided by administrator
- **Required for every login**

---

## ❌ Common Issues

| Issue | Solution |
|-------|----------|
| Invalid Credentials | Check email/username/password spelling |
| Invalid License Key | Verify license key from admin |
| Cannot Reach Backend | Backend not running: `pm2 status` |
| Database Unavailable | Check: `sudo systemctl status postgresql` |
| Account Already Exists | Use LOGIN tab, not CREATE ACCOUNT |

---

## Backend Status Check

```bash
# Is PM2 running?
pm2 status

# View logs
pm2 logs trading-terminal-backend

# Test backend
curl http://api.example.com:8787/health
```

---

## 📊 Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    USER LOGIN FLOW                          │
└─────────────────────────────────────────────────────────────┘

1. User opens Trading Terminal
   ↓
2. Sees login screen (not authenticated)
   ↓
3. Enters credentials:
   - Email or Username
   - Password
   - License Key
   ↓
4. Clicks LOGIN button
   ↓
5. Client sends to backend:
   POST /api/auth/login {email/username, password, licenseKey}
   ↓
6. Backend validates:
   ✓ User exists?
   ✓ Password correct?
   ✓ License key valid?
   ✓ Account active?
   ↓
7a. ✅ SUCCESS
   - Generate JWT access token (15 min expiry)
   - Generate refresh token (14 day expiry)
   - Create session in database
   - Return tokens to client
   ↓
7b. ❌ FAILURE
   - Return error: invalid_credentials, invalid_license_key, etc.
   - User sees error message
   - Can retry
   ↓
8. Client stores tokens locally
   ↓
9. Client redirects to main terminal UI
   ↓
10. User sees Trading Terminal dashboard
    ✅ LOGGED IN & AUTHENTICATED

```

---

## 🔐 Token Management

After login, the app automatically:
- Stores access token locally
- Uses token for API requests
- Refreshes token when expiring (uses refresh token)
- Clears tokens on logout

**You don't need to manage tokens manually** - the app does it.

---

## 🚀 Getting Started

### Step 1: Start Backend
```bash
cd /home/ubuntu/projects/TradingTerminal-SourceCode
pm2 start apps/backend/ecosystem.config.js --env production
```

### Step 2: Verify Running
```bash
pm2 status
pm2 logs trading-terminal-backend
```

### Step 3: Open Trading Terminal
- Local: `http://localhost:8787`
- Remote: `http://api.example.com:8787`

### Step 4: Login
Use default bootstrap credentials from `.env.production`

### Step 5: Create More Users
Use admin panel or database to create additional accounts

---

## 📚 Full Documentation

See `USER_LOGIN_GUIDE.md` for:
- Detailed authentication flow
- API endpoint documentation
- User role types
- Security policies
- Troubleshooting guide
- Database schema

---

**Quick Test**: 
```bash
# Test login endpoint directly
curl -X POST http://api.example.com:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD","licenseKey":"YOUR_LICENSE_KEY"}'
```

Expected response:
```json
{
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresInSeconds": 900,
  "user": {...}
}
```
