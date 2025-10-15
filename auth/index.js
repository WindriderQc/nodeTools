/**
 * DataAPI Authentication Module for NodeTools
 * 
 * Provides standardized authentication middleware for Node.js/Express apps
 * that share sessions with DataAPI (centralized auth server).
 * 
 * @module dataapi-auth
 * @version 1.0.0
 * @author YB (WindriderQc)
 * @license MIT
 */

const { ObjectId } = require('mongodb');

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  loginRedirectUrl: 'https://data.specialblend.ca/login',
  usersCollection: 'users',
  logger: null  // Set to console.log for debugging
};

/**
 * Logger wrapper that checks if logging is enabled
 */
function createLogger(loggerFn) {
  if (!loggerFn || typeof loggerFn !== 'function') {
    return () => {}; // No-op logger
  }
  return (message, level = 'info') => {
    const prefix = level === 'error' ? '[AUTH ERROR]' : '[AUTH]';
    loggerFn(`${prefix} ${message}`);
  };
}

/**
 * Factory function to create authentication middleware
 * 
 * @param {Object} options - Configuration options
 * @param {Function} options.dbGetter - Function that returns MongoDB Db instance from req
 * @param {string} [options.loginRedirectUrl] - URL to redirect for login
 * @param {Function} [options.logger] - Optional logging function (e.g., console.log)
 * @param {string} [options.usersCollection] - Users collection name
 * @returns {Object} Middleware functions (attachUser, requireAuth, optionalAuth, requireAdmin)
 * 
 * @example
 * const auth = createAuthMiddleware({
 *   dbGetter: (req) => req.app.locals.db,
 *   loginRedirectUrl: 'https://data.specialblend.ca/login',
 *   logger: console.log
 * });
 * 
 * app.use(session(sessionOptions));
 * app.use(auth.attachUser);
 * 
 * router.get('/admin', auth.requireAuth, auth.requireAdmin, handler);
 */
function createAuthMiddleware(options = {}) {
  // Merge with defaults
  const config = { ...DEFAULT_CONFIG, ...options };
  
  // Validate required options
  if (!config.dbGetter || typeof config.dbGetter !== 'function') {
    throw new Error('dataapi-auth: dbGetter function is required');
  }
  
  const log = createLogger(config.logger);
  
  /**
   * attachUser Middleware
   * 
   * Checks session for userId and loads user from MongoDB.
   * Sets res.locals.user with user data or null.
   * Never blocks requests - always calls next().
   * 
   * @middleware
   */
  const attachUser = async (req, res, next) => {
    const path = req.originalUrl || req.path || 'unknown';
    const sessionId = req.sessionID || 'none';
    
    log(`attachUser: Checking session for ${path} - Session ID: ${sessionId}`);
    res.locals.user = null;
    
    if (req.session && req.session.userId) {
      log(`attachUser: Session found with userId: ${req.session.userId}`);
      
      try {
        const db = config.dbGetter(req);
        
        if (!db) {
          log('attachUser: Database connection not available', 'error');
          return next();
        }
        
        const usersCollection = db.collection(config.usersCollection);
        
        if (!ObjectId.isValid(req.session.userId)) {
          log(`attachUser: Invalid userId format in session: ${req.session.userId}`, 'error');
          return next();
        }
        
        const user = await usersCollection.findOne({ 
          _id: new ObjectId(req.session.userId) 
        });
        
        if (user) {
          log(`attachUser: User found: ${user.name} (${user.email})`);
          
          // Attach sanitized user data to res.locals
          res.locals.user = {
            _id: user._id,
            name: user.name,
            email: user.email,
            isAdmin: user.isAdmin || false
          };
        } else {
          log(`attachUser: No user found for userId: ${req.session.userId}`, 'error');
        }
      } catch (err) {
        log(`attachUser: Error fetching user: ${err.message}`, 'error');
      }
    } else {
      log('attachUser: No session or userId found');
    }
    
    next();
  };
  
  /**
   * requireAuth Middleware
   * 
   * Protects routes that require authentication.
   * - API requests: Returns 401 JSON
   * - Web requests: Redirects to login with returnTo URL
   * 
   * @middleware
   */
  const requireAuth = (req, res, next) => {
    const path = req.originalUrl || req.path || 'unknown';
    const sessionId = req.sessionID || 'none';
    
    log(`requireAuth: Path: ${path}, Session ID: ${sessionId}`);
    
    const isApiRequest = req.originalUrl && req.originalUrl.startsWith('/api');
    
    // Check if session middleware is present
    if (!req.session) {
      log('requireAuth: req.session is undefined. Ensure express-session is applied before auth middleware.', 'error');
      
      if (isApiRequest) {
        return res.status(401).json({ 
          status: 'error', 
          message: 'Unauthorized' 
        });
      }
      return res.redirect(config.loginRedirectUrl);
    }
    
    if (!req.session.userId) {
      log(`requireAuth: No user ID for session. Path: ${path}`);
      
      // For API requests, return 401 JSON
      if (isApiRequest) {
        return res.status(401).json({ 
          status: 'error', 
          message: 'Unauthorized' 
        });
      }
      
      // For web requests, set returnTo and redirect to login
      try {
        req.session.returnTo = req.originalUrl || req.url;
      } catch (e) {
        log(`requireAuth: Failed to set returnTo on session: ${e}`, 'error');
      }
      
      if (typeof req.session.save === 'function') {
        req.session.save(err => {
          if (err) {
            log(`requireAuth: ERROR SAVING SESSION: ${err}`, 'error');
          }
          return res.redirect(config.loginRedirectUrl);
        });
      } else {
        return res.redirect(config.loginRedirectUrl);
      }
      
      return; // Prevent further execution
    }
    
    // User is authenticated, proceed
    next();
  };
  
  /**
   * optionalAuth Middleware
   * 
   * For public pages with enhanced features when logged in.
   * Never blocks access, but attaches user if available.
   * 
   * @middleware
   */
  const optionalAuth = async (req, res, next) => {
    log(`optionalAuth: Path: ${req.originalUrl || req.path || 'unknown'}`);
    
    // Use attachUser to populate res.locals.user if session exists
    await attachUser(req, res, () => {
      // Always proceed, whether user is found or not
      next();
    });
  };
  
  /**
   * requireAdmin Middleware
   * 
   * Protects routes that require admin privileges.
   * Checks res.locals.user.isAdmin flag.
   * Should be used AFTER requireAuth.
   * 
   * @middleware
   */
  const requireAdmin = (req, res, next) => {
    const isApiRequest = req.originalUrl && req.originalUrl.startsWith('/api');
    
    // Check if user is attached and has admin flag
    if (res.locals.user && res.locals.user.isAdmin) {
      return next();
    }
    
    // User is not admin
    if (isApiRequest) {
      return res.status(403).json({ 
        status: 'error', 
        message: 'Forbidden: Admin access required' 
      });
    }
    
    return res.redirect('/');
  };
  
  // Return middleware functions
  return {
    attachUser,
    requireAuth,
    optionalAuth,
    requireAdmin
  };
}

/**
 * Helper function to create session configuration matching DataAPI
 * 
 * @param {Object} options - Session configuration options
 * @param {string} options.mongoUri - MongoDB connection string
 * @param {string} options.secret - Session secret (must match DataAPI)
 * @param {boolean} [options.isProduction] - Production mode flag
 * @param {number} [options.maxAge] - Session max age in ms (default: 24h)
 * @returns {Object} Session options for express-session
 * 
 * @example
 * const MongoDBStore = require('connect-mongodb-session')(session);
 * const sessionOptions = createSessionConfig({
 *   mongoUri: process.env.MONGO_CLOUD,
 *   secret: process.env.SESS_SECRET,
 *   isProduction: process.env.NODE_ENV === 'production'
 * });
 * 
 * app.use(session(sessionOptions));
 */
function createSessionConfig(options) {
  const {
    mongoUri,
    secret,
    isProduction = false,
    maxAge = 1000 * 60 * 60 * 24  // 24 hours
  } = options;
  
  if (!mongoUri) {
    throw new Error('dataapi-auth: mongoUri is required for session config');
  }
  
  if (!secret) {
    throw new Error('dataapi-auth: secret is required for session config');
  }
  
  const SESSION_DB_NAME = isProduction ? 'datas' : 'devdatas';
  
  // Note: Caller must create MongoDBStore instance
  // This just returns the configuration object
  return {
    name: 'data-api.sid',           // MUST match DataAPI
    secret: secret,
    resave: false,
    saveUninitialized: false,
    // store: mongoStore,  // Caller must provide this
    databaseName: SESSION_DB_NAME,  // For MongoDBStore
    collection: 'mySessions',       // For MongoDBStore
    cookie: {
      maxAge: maxAge,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction
    }
  };
}

// Export both factory and helper
module.exports = {
  createAuthMiddleware,
  createSessionConfig
};
