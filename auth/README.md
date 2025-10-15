# DataAPI Authentication Module for NodeTools

## Overview

This module provides standardized authentication middleware for Node.js/Express applications that share sessions with **DataAPI** (your centralized authentication server). It allows multiple applications to leverage DataAPI's user management without duplicating authentication logic.

## Features

- 🔐 **Session Sharing** - Multiple apps recognize the same login session
- 🔑 **Centralized Auth** - DataAPI is the single source of truth for user credentials
- 🛡️ **Flexible Middleware** - Public pages, protected routes, and admin-only sections
- 📝 **Detailed Logging** - Track authentication flow for debugging
- ⚡ **Zero Dependencies** - Only requires MongoDB ObjectId (already in your stack)

## Architecture

```
┌─────────────┐
│   DataAPI   │ ← Login/Register/User Management
│  (Port 3003)│    Validates credentials
└──────┬──────┘    Creates session in MongoDB
       │
       │ Session Cookie: 'data-api.sid'
       │
       ├──────────────────┬──────────────────┐
       ↓                  ↓                  ↓
  ┌─────────┐       ┌─────────┐       ┌─────────┐
  │  SBQC   │       │  App2   │       │  App3   │
  │(Port 3001)│     │(Port ???)│      │(Port ???)│
  └─────────┘       └─────────┘       └─────────┘
       ↑                  ↑                  ↑
       └──────────────────┴──────────────────┘
            All apps read same session from MongoDB
```

## Installation

### Option 1: Add to existing nodeTools package

```bash
cd /path/to/nodeTools
mkdir -p auth
# Copy dataapi-auth.js to auth/dataapi-auth.js
```

Then in your nodeTools `index.js`:
```javascript
module.exports = {
  // ... existing exports
  auth: require('./auth/dataapi-auth')
};
```

### Option 2: Standalone npm package

```bash
# Create new package
mkdir dataapi-auth
cd dataapi-auth
npm init -y
# Copy dataapi-auth.js as index.js
```

## Usage

### 1. Configure Session Store

In your Express app (e.g., `sbqc_serv.js`):

```javascript
const express = require('express');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const { createAuthMiddleware } = require('nodetools').auth; // or require('dataapi-auth')

const app = express();
const IN_PROD = process.env.NODE_ENV === 'production';

// CRITICAL: Session configuration must match DataAPI exactly
const SESSION_DB_NAME = IN_PROD ? 'datas' : 'devdatas';

const mongoStore = new MongoDBStore({
  uri: process.env.MONGO_CLOUD,
  databaseName: SESSION_DB_NAME,  // Same as DataAPI
  collection: 'mySessions'         // Same as DataAPI
});

const sessionOptions = {
  name: 'data-api.sid',            // Same as DataAPI
  secret: process.env.SESS_SECRET, // Same as DataAPI's SESSION_SECRET
  resave: false,
  saveUninitialized: false,
  store: mongoStore,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,   // 24 hours
    httpOnly: true,
    sameSite: 'lax',
    secure: IN_PROD
  }
};

// Apply middleware
app.use(session(sessionOptions));

// Create auth middleware factory
const auth = createAuthMiddleware({
  dbGetter: (req) => req.app.locals.db,           // How to get DB connection
  loginRedirectUrl: 'https://data.specialblend.ca/login',
  logger: console.log                              // Optional custom logger
});

// Attach user to all requests
app.use(auth.attachUser);
```

### 2. Protect Routes

```javascript
const { requireAuth, optionalAuth, requireAdmin } = auth;

// Public page with enhanced features when logged in
router.get('/iot', optionalAuth, (req, res) => {
  // res.locals.user is available if logged in, null otherwise
  if (res.locals.user) {
    // Show enhanced IoT dashboard
  } else {
    // Show public IoT dashboard
  }
});

// Protected route - requires login
router.get('/admin/devices', requireAuth, requireAdmin, (req, res) => {
  // Only logged-in admins can access
  res.render('admin-devices', { user: res.locals.user });
});

// API endpoint with optional auth
router.get('/api/devices/latest-batch', optionalAuth, async (req, res) => {
  if (res.locals.user) {
    const devices = await getDevicesForUser(res.locals.user._id);
    res.json({ status: 'success', data: devices });
  } else {
    res.json({ status: 'info', data: [] }); // Empty for unauthenticated
  }
});

// API endpoint requiring auth
router.post('/api/devices', requireAuth, async (req, res) => {
  // Only authenticated users can create devices
  const device = await createDevice(req.body, res.locals.user._id);
  res.json({ status: 'success', data: device });
});
```

### 3. Access User Data

After authentication middleware runs:

```javascript
// In any route handler or middleware
function myHandler(req, res) {
  if (res.locals.user) {
    console.log('User ID:', res.locals.user._id);
    console.log('Name:', res.locals.user.name);
    console.log('Email:', res.locals.user.email);
    console.log('Is Admin:', res.locals.user.isAdmin);
  } else {
    console.log('No user logged in');
  }
}
```

## Environment Variables

Your app's `.env` must include:

```bash
# CRITICAL: Must match DataAPI's SESSION_SECRET exactly
SESS_SECRET=your_shared_secret_here

# MongoDB connection - must be same server as DataAPI
MONGO_CLOUD=mongodb://username:password@host:27017/

# Environment determines database name
NODE_ENV=development  # uses 'devdatas'
# or
NODE_ENV=production   # uses 'datas'
```

## API Reference

### `createAuthMiddleware(options)`

Factory function that creates authentication middleware.

**Options:**
```javascript
{
  dbGetter: (req) => Db,              // Function to get MongoDB Db instance
  loginRedirectUrl: string,            // URL to redirect for login (default: DataAPI)
  logger: function,                    // Optional logging function
  usersCollection: string              // Users collection name (default: 'users')
}
```

**Returns:**
```javascript
{
  attachUser,      // Middleware: loads user from session
  requireAuth,     // Middleware: protects routes
  optionalAuth,    // Middleware: public with enhancements
  requireAdmin     // Middleware: admin-only routes
}
```

### Middleware Functions

#### `attachUser(req, res, next)`
- **Purpose:** Checks session for userId and loads user from MongoDB
- **Sets:** `res.locals.user` with user data or `null`
- **Behavior:** Never blocks requests, always calls `next()`
- **Use:** Apply globally after session middleware

#### `requireAuth(req, res, next)`
- **Purpose:** Protects routes requiring authentication
- **API Requests:** Returns `401 JSON` if not authenticated
- **Web Requests:** Redirects to login with `returnTo` URL
- **Use:** Apply to protected routes

#### `optionalAuth(req, res, next)`
- **Purpose:** Public pages with enhanced features when logged in
- **Behavior:** Uses `attachUser`, never blocks
- **Use:** Apply to public pages that show extra content for logged-in users

#### `requireAdmin(req, res, next)`
- **Purpose:** Protects admin-only routes
- **Checks:** `res.locals.user.isAdmin` flag
- **API Requests:** Returns `403 JSON` if not admin
- **Web Requests:** Redirects to home page
- **Use:** Apply after `requireAuth` for admin routes

## Session Sharing Configuration Checklist

For session sharing to work, **all applications** must have:

- ✅ Same MongoDB server connection
- ✅ Same database name (`datas` in prod, `devdatas` in dev)
- ✅ Same session collection (`mySessions`)
- ✅ Same session name (`data-api.sid`)
- ✅ Same session secret (SESS_SECRET = SESSION_SECRET)
- ✅ Same cookie settings (`httpOnly: true`, `sameSite: 'lax'`)

## Testing

### Test Session Sharing

1. **Login to DataAPI:**
   ```bash
   # Visit https://data.specialblend.ca/login
   # Enter credentials
   # Check browser cookies for 'data-api.sid'
   ```

2. **Visit Your App:**
   ```bash
   # Visit http://localhost:3001
   # Check server console for logs:
   [AUTH] attachUser: User found: <name> (<email>)
   ```

3. **Verify in MongoDB:**
   ```javascript
   use datas  // or devdatas
   db.mySessions.find().pretty()
   // Should see one session with your userId
   ```

### Test Middleware

```javascript
// Test public page with optional auth
router.get('/test-optional', optionalAuth, (req, res) => {
  res.json({
    authenticated: !!res.locals.user,
    user: res.locals.user
  });
});

// Test protected route
router.get('/test-protected', requireAuth, (req, res) => {
  res.json({
    message: 'You are authenticated',
    user: res.locals.user
  });
});

// Test admin route
router.get('/test-admin', requireAuth, requireAdmin, (req, res) => {
  res.json({
    message: 'You are an admin',
    user: res.locals.user
  });
});
```

## Troubleshooting

### Session Not Shared

**Check 1: MongoDB Connection**
```bash
# Both apps must connect to SAME MongoDB server
echo $MONGO_CLOUD  # in your app
echo $MONGO_URL    # in DataAPI
```

**Check 2: Session Secret**
```bash
# Both secrets must match exactly
echo $SESS_SECRET     # in your app
echo $SESSION_SECRET  # in DataAPI
```

**Check 3: Database Name**
- Verify `NODE_ENV` is same in both apps
- Production: both use `datas`
- Development: both use `devdatas`

### User Not Recognized

**Check: DB Connection in Middleware**
```javascript
// Ensure dbGetter returns valid Db instance
const auth = createAuthMiddleware({
  dbGetter: (req) => {
    const db = req.app.locals.db;
    if (!db) {
      console.error('DB not available!');
    }
    return db;
  }
});
```

**Check: Users Collection Exists**
```javascript
use datas  // or devdatas
db.users.find().pretty()
// Should see users with matching userId from session
```

## Security Best Practices

1. **HTTPS in Production**
   - Set `secure: true` in cookie options
   - Requires HTTPS for both apps

2. **Strong Secret Key**
   ```bash
   # Generate secure secret
   openssl rand -hex 32
   ```

3. **Environment Variables**
   - Never commit `.env` files
   - Use `.env.example` as template
   - Keep secrets in secure vault (e.g., AWS Secrets Manager)

4. **Database Access**
   - Use read-only credentials when possible
   - Limit network access to MongoDB
   - Enable MongoDB authentication

5. **Session Lifetime**
   - Set appropriate `maxAge` (default: 24 hours)
   - Implement session refresh for long-lived sessions
   - Clear sessions on logout

## Benefits of Centralized Auth

✅ **Single Source of Truth** - User credentials managed in one place
✅ **Consistent Experience** - Login once, access all apps
✅ **Easier Maintenance** - Update auth logic in one location
✅ **Better Security** - Centralized password policies and MFA
✅ **Simplified Development** - Drop-in auth for new projects
✅ **User Management** - Admin panel in DataAPI for all apps

## Migration from Token-Based Auth

If migrating from `req.session.userToken` pattern:

```javascript
// OLD (token-based)
router.get('/api/data', async (req, res) => {
  const token = req.session.userToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  const data = await fetchDataWithToken(token);
  res.json(data);
});

// NEW (session-based)
router.get('/api/data', requireAuth, async (req, res) => {
  // User is already authenticated by middleware
  // res.locals.user contains user info
  
  const data = await fetchDataForUser(res.locals.user._id);
  res.json({ status: 'success', data });
});
```

## Examples

See complete examples in:
- SBQC Server: `/home/yb/servers/SBQC`
- Documentation: `docs/AUTHENTICATION_SETUP.md`
- Architecture: `AUTHENTICATION_ARCHITECTURE.md`

## Support

For issues or questions:
- GitHub: https://github.com/WindriderQc/nodeTools
- DataAPI: https://github.com/WindriderQc/DataAPI

## License

MIT License - Same as your nodeTools package

---

**Version:** 1.0.0  
**Compatible with:** DataAPI v1.x, Node.js 14+, Express 4+  
**Author:** YB (WindriderQc)
