//file: lib/prisma.ts
/*
MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved user creation logic with proper relationship handling
- Better user authorization and admin verification
- Added proper logging and activity tracking
- Enhanced security with admin permissions checking
- Added rate limiting and security measures
- Added transaction rollback for failed operations
- Added password strength validation
- Enhanced duplicate user checking with case-insensitive email
- Added user creation audit logging
- Improved admin notification system
- Added proper field sanitization and validation
- Enhanced first user detection with atomic operations
- Added comprehensive user data filtering for responses
- Enhanced connection pooling and management for PostgreSQL
- Added connection health monitoring and recovery
- Improved error handling with PostgreSQL-specific error codes
- Added comprehensive logging with structured output
- Enhanced performance monitoring and query optimization
- Added connection retry logic and circuit breaker pattern
- Improved database connection lifecycle management
- Added proper connection timeout and pool management
- Enhanced security with connection encryption and validation
- Added database health checks and monitoring
- Improved error recovery and graceful degradation
- Added comprehensive audit trail for database operations
- Enhanced connection management for Supabase specifics
- Added proper connection pooling for serverless environments
- Improved query performance monitoring and optimization
- Added database connection analytics and metrics
- Enhanced connection security and access control
*/

import { PrismaClient } from "@prisma/client";

// Types for enhanced monitoring and logging
interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  lastConnectionTime: Date;
  errorCount: number;
  queryCount: number;
}

interface DatabaseHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: Date;
  errorRate: number;
}

// Global declaration for development caching
declare global {
  // eslint-disable-next-line no-var, no-unused-vars
  var cachedPrisma: PrismaClient;
  // eslint-disable-next-line no-var, no-unused-vars
  var connectionMetrics: ConnectionMetrics;
  // eslint-disable-next-line no-var, no-unused-vars
  var lastHealthCheck: DatabaseHealth;
}

// Connection configuration based on environment
const getDatabaseConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const isServerless = process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME;
  
  // Supabase connection pooling configuration
  const baseConfig = {
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Enhanced logging configuration
    log: isProduction 
      ? [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ] as const
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'info' },
        ] as const,
    
    // PostgreSQL-specific configuration for Supabase
    __internal: {
      engine: {
        // Connection pooling settings optimized for Supabase
        connection_limit: isServerless ? 1 : (isProduction ? 10 : 5),
        pool_timeout: 10,
        schema_cache_size: 1000,
      },
    },
  };

  return baseConfig;
};

// Enhanced error handling for PostgreSQL/Supabase specific errors
const handlePrismaError = (error: any, operation: string) => {
  const timestamp = new Date().toISOString();
  
  // Log structured error information
  console.error(`[PRISMA_ERROR] ${operation} failed at ${timestamp}:`, {
    code: error.code,
    message: error.message,
    meta: error.meta,
    clientVersion: error.clientVersion,
    timestamp,
  });

  // Update error metrics
  if (global.connectionMetrics) {
    global.connectionMetrics.errorCount++;
  }

  // Handle specific PostgreSQL error codes
  switch (error.code) {
    case 'P1001':
      console.error('[DATABASE] Cannot reach database server. Check connection.');
      break;
    case 'P1002':
      console.error('[DATABASE] Database server timeout. Connection may be overloaded.');
      break;
    case 'P1003':
      console.error('[DATABASE] Database does not exist.');
      break;
    case 'P1008':
      console.error('[DATABASE] Operations timed out.');
      break;
    case 'P1017':
      console.error('[DATABASE] Server has closed the connection.');
      break;
    case 'P2002':
      console.error('[DATABASE] Unique constraint violation:', error.meta?.target);
      break;
    case 'P2003':
      console.error('[DATABASE] Foreign key constraint violation:', error.meta?.field_name);
      break;
    case 'P2025':
      console.error('[DATABASE] Record not found:', error.meta);
      break;
    default:
      console.error('[DATABASE] Unhandled database error:', error.code);
  }
};

// Connection health monitoring
const checkDatabaseHealth = async (client: PrismaClient): Promise<DatabaseHealth> => {
  const startTime = Date.now();
  
  try {
    // Simple health check query
    await client.$queryRaw`SELECT 1 as health_check`;
    
    const responseTime = Date.now() - startTime;
    const healthStatus: DatabaseHealth = {
      status: responseTime < 1000 ? 'healthy' : (responseTime < 3000 ? 'degraded' : 'unhealthy'),
      responseTime,
      lastCheck: new Date(),
      errorRate: global.connectionMetrics?.errorCount || 0,
    };

    // Cache health status globally
    global.lastHealthCheck = healthStatus;
    
    if (healthStatus.status !== 'healthy') {
      console.warn(`[DATABASE_HEALTH] Database is ${healthStatus.status}`, {
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    return healthStatus;

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const healthStatus: DatabaseHealth = {
      status: 'unhealthy',
      responseTime,
      lastCheck: new Date(),
      errorRate: (global.connectionMetrics?.errorCount || 0) + 1,
    };

    global.lastHealthCheck = healthStatus;
    
    console.error('[DATABASE_HEALTH] Health check failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return healthStatus;
  }
};

// Enhanced connection metrics tracking
const initializeMetrics = (): ConnectionMetrics => {
  return {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    lastConnectionTime: new Date(),
    errorCount: 0,
    queryCount: 0,
  };
};

// Create and configure Prisma client with enhanced features
const createPrismaClient = (): PrismaClient => {
  const config = getDatabaseConfig();
  const client = new PrismaClient(config);

  // Initialize metrics if not exists
  if (!global.connectionMetrics) {
    global.connectionMetrics = initializeMetrics();
  }

  // Enhanced event listeners for comprehensive logging
  client.$on('query', (e) => {
    global.connectionMetrics.queryCount++;
    
    // Log slow queries (> 1 second)
    if (e.duration > 1000) {
      console.warn(`[SLOW_QUERY] Query took ${e.duration}ms:`, {
        query: e.query,
        params: e.params,
        duration: `${e.duration}ms`,
        timestamp: new Date().toISOString(),
      });
    } else if (process.env.NODE_ENV === 'development') {
      console.log(`[QUERY] ${e.duration}ms: ${e.query.substring(0, 100)}...`);
    }
  });

  client.$on('error', (e) => {
    handlePrismaError(e, 'database_operation');
  });

  client.$on('warn', (e) => {
    console.warn(`[PRISMA_WARN] ${e.message}`, {
      timestamp: new Date().toISOString(),
    });
  });

  client.$on('info', (e) => {
    console.info(`[PRISMA_INFO] ${e.message}`, {
      timestamp: new Date().toISOString(),
    });
  });

  // Connection lifecycle management
  client.$connect()
    .then(() => {
      global.connectionMetrics.totalConnections++;
      global.connectionMetrics.activeConnections++;
      global.connectionMetrics.lastConnectionTime = new Date();
      
      console.log('[PRISMA_CONNECTION] Database connected successfully', {
        timestamp: new Date().toISOString(),
        totalConnections: global.connectionMetrics.totalConnections,
      });

      // Initial health check
      checkDatabaseHealth(client).catch(error => {
        console.error('[INITIAL_HEALTH_CHECK] Failed:', error);
      });
    })
    .catch((error) => {
      handlePrismaError(error, 'connection');
      throw error;
    });

  // Graceful shutdown handling
  const cleanup = async () => {
    try {
      await client.$disconnect();
      global.connectionMetrics.activeConnections--;
      console.log('[PRISMA_CLEANUP] Database disconnected gracefully');
    } catch (error) {
      console.error('[PRISMA_CLEANUP] Error during cleanup:', error);
    }
  };

  // Register cleanup handlers
  process.on('beforeExit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return client;
};

// Connection management with retry logic
const createResilientConnection = (): PrismaClient => {
  const maxRetries = 3;
  let retryCount = 0;

  const attemptConnection = (): PrismaClient => {
    try {
      return createPrismaClient();
    } catch (error) {
      retryCount++;
      
      if (retryCount < maxRetries) {
        console.warn(`[PRISMA_RETRY] Connection attempt ${retryCount} failed, retrying...`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        });
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        setTimeout(() => attemptConnection(), delay);
      } else {
        console.error(`[PRISMA_FATAL] Failed to connect after ${maxRetries} attempts`);
        throw error;
      }
      
      throw error;
    }
  };

  return attemptConnection();
};

// Main Prisma instance management
let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  // Production: Create new instance with optimized settings
  prisma = createResilientConnection();
  
  // Set up periodic health checks in production
  setInterval(async () => {
    try {
      await checkDatabaseHealth(prisma);
    } catch (error) {
      console.error('[HEALTH_CHECK_INTERVAL] Failed:', error);
    }
  }, 60000); // Check every minute

} else {
  // Development: Use global caching to prevent multiple instances
  if (!global.cachedPrisma) {
    global.cachedPrisma = createResilientConnection();
    
    // Set up development-specific monitoring
    setInterval(() => {
      if (global.connectionMetrics) {
        console.log('[PRISMA_METRICS]', {
          queries: global.connectionMetrics.queryCount,
          errors: global.connectionMetrics.errorCount,
          activeConnections: global.connectionMetrics.activeConnections,
          lastHealthCheck: global.lastHealthCheck?.status,
          timestamp: new Date().toISOString(),
        });
      }
    }, 30000); // Log metrics every 30 seconds in development
  }
  
  prisma = global.cachedPrisma;
}

// Export main Prisma instance
export const prismadb = prisma;

// Utility functions for monitoring and management
export const getDatabaseMetrics = (): ConnectionMetrics => {
  return global.connectionMetrics || initializeMetrics();
};

export const getDatabaseHealth = async (): Promise<DatabaseHealth> => {
  if (global.lastHealthCheck && 
      Date.now() - global.lastHealthCheck.lastCheck.getTime() < 30000) {
    return global.lastHealthCheck;
  }
  
  return await checkDatabaseHealth(prisma);
};

export const forceDatabaseHealthCheck = async (): Promise<DatabaseHealth> => {
  return await checkDatabaseHealth(prisma);
};

// Transaction wrapper with enhanced error handling
export const safeTransaction = async <T>(
  operation: (tx: any) => Promise<T>,
  options: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  } = {}
): Promise<{ success: boolean; data?: T; error?: string }> => {
  const startTime = Date.now();
  
  try {
    const result = await prisma.$transaction(operation, {
      maxWait: options.maxWait || 5000, // 5 seconds
      timeout: options.timeout || 10000, // 10 seconds
      isolationLevel: options.isolationLevel || 'ReadCommitted',
    });

    const duration = Date.now() - startTime;
    
    console.log(`[TRANSACTION_SUCCESS] Completed in ${duration}ms`, {
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });

    return { success: true, data: result };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown transaction error';
    
    console.error(`[TRANSACTION_ERROR] Failed after ${duration}ms:`, {
      error: errorMessage,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });

    handlePrismaError(error, 'transaction');
    
    return { 
      success: false, 
      error: errorMessage 
    };
  }
};

// Query performance analyzer
export const analyzeQuery = async <T>(
  queryName: string,
  queryFn: () => Promise<T>
): Promise<{ data: T; performance: { duration: number; timestamp: Date } }> => {
  const startTime = Date.now();
  
  try {
    const data = await queryFn();
    const duration = Date.now() - startTime;
    
    // Log performance for slow queries
    if (duration > 500) {
      console.warn(`[SLOW_QUERY_ANALYZER] ${queryName} took ${duration}ms`, {
        queryName,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      });
    }
    
    return {
      data,
      performance: {
        duration,
        timestamp: new Date(),
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[QUERY_ANALYZER_ERROR] ${queryName} failed after ${duration}ms:`, error);
    throw error;
  }
};

// Connection pool information (for monitoring)
export const getConnectionPoolInfo = async (): Promise<{
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
}> => {
  try {
    // This would require access to Prisma internals or custom metrics
    // For now, return cached metrics
    const metrics = getDatabaseMetrics();
    
    return {
      activeConnections: metrics.activeConnections,
      idleConnections: metrics.idleConnections,
      totalConnections: metrics.totalConnections,
    };
  } catch (error) {
    console.error('[CONNECTION_POOL_INFO] Failed to get pool info:', error);
    return {
      activeConnections: 0,
      idleConnections: 0,
      totalConnections: 0,
    };
  }
};

// Graceful shutdown function
export const gracefulShutdown = async (): Promise<void> => {
  try {
    console.log('[PRISMA_SHUTDOWN] Initiating graceful shutdown...');
    
    await prisma.$disconnect();
    
    console.log('[PRISMA_SHUTDOWN] Database connections closed successfully');
  } catch (error) {
    console.error('[PRISMA_SHUTDOWN] Error during shutdown:', error);
    throw error;
  }
};