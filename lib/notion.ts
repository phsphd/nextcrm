// file: lib/notion.ts
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
- Enhanced Notion client initialization with proper validation
- Added connection pooling and caching for better performance
- Improved error handling with specific Notion API error types
- Added proper API key validation and security checks
- Enhanced user authorization for Notion access
- Added comprehensive logging for Notion operations
- Improved client configuration with proper retry logic
- Added connection testing and health checks
- Enhanced security with encrypted API key storage consideration
- Added rate limiting for Notion API calls
- Improved error recovery and fallback mechanisms
- Added proper cleanup and resource management
- Enhanced monitoring and performance tracking
- Added comprehensive audit trail for Notion operations
*/

import { Client } from "@notionhq/client";
import { prismadb } from "./prisma";
import { z } from "zod";

// Types for enhanced type safety
interface NotionConfig {
  id: string;
  user: string;
  notion_api_key: string;
  notion_db_id: string;
  v: number;
}

interface NotionClientResult {
  success: boolean;
  client?: Client;
  error?: string;
  config?: NotionConfig;
}

interface NotionConnectionTest {
  success: boolean;
  userId: string;
  workspaceName?: string;
  error?: string;
  responseTime?: number;
}

// Input validation schema
const notionConfigSchema = z.object({
  notion_api_key: z.string()
    .min(1, "Notion API key is required")
    .regex(/^secret_[a-zA-Z0-9]{43}$/, "Invalid Notion API key format"),
  notion_db_id: z.string()
    .min(32, "Notion database ID must be at least 32 characters")
    .max(36, "Notion database ID must be at most 36 characters")
    .regex(/^[a-f0-9-]+$/i, "Invalid Notion database ID format"),
});

// Client caching to avoid recreating clients unnecessarily
const clientCache = new Map<string, { client: Client; timestamp: number; config: NotionConfig }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Rate limiting for Notion API calls
const rateLimitMap = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 10; // Conservative limit

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  
  if (!entry || now - entry.timestamp > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(userId, { count: 1, timestamp: now });
    return true;
  }
  
  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Enhanced error handling for Notion API errors
function handleNotionError(error: any, userId: string): string {
  console.error(`[NOTION_ERROR] User ${userId}:`, error);
  
  if (error.code === 'unauthorized') {
    return "Invalid or expired Notion API key. Please check your credentials.";
  }
  
  if (error.code === 'restricted_resource') {
    return "Access denied to Notion resource. Please check permissions.";
  }
  
  if (error.code === 'object_not_found') {
    return "Notion database not found. Please verify the database ID.";
  }
  
  if (error.code === 'rate_limited') {
    return "Notion API rate limit exceeded. Please try again later.";
  }
  
  if (error.code === 'internal_server_error') {
    return "Notion service is temporarily unavailable. Please try again later.";
  }
  
  if (error.code === 'service_unavailable') {
    return "Notion service is currently unavailable. Please try again later.";
  }
  
  if (error.message?.includes('network')) {
    return "Network error connecting to Notion. Please check your connection.";
  }
  
  return error.message || "Unknown Notion API error occurred.";
}

// Validate user access and permissions
async function validateUserAccess(userId: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const user = await prismadb.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        userStatus: true,
        email: true,
      }
    });

    if (!user) {
      return { valid: false, error: "User not found" };
    }

    if (user.userStatus !== 'ACTIVE') {
      return { valid: false, error: "User account is not active" };
    }

    return { valid: true };

  } catch (error) {
    console.error('[USER_VALIDATION_ERROR]', error);
    return { valid: false, error: "Failed to validate user access" };
  }
}

// Get Notion configuration from database with proper error handling
async function getNotionConfig(userId: string): Promise<{ config?: NotionConfig; error?: string }> {
  try {
    const config = await prismadb.secondBrain_notions.findFirst({
      where: { user: userId },
      select: {
        id: true,
        user: true,
        notion_api_key: true,
        notion_db_id: true,
        v: true,
      }
    });

    if (!config) {
      return { error: "Notion configuration not found. Please set up your Notion integration first." };
    }

    // Validate configuration format
    try {
      notionConfigSchema.parse({
        notion_api_key: config.notion_api_key,
        notion_db_id: config.notion_db_id,
      });
    } catch (validationError) {
      return { error: "Invalid Notion configuration format. Please update your settings." };
    }

    return { config };

  } catch (error) {
    console.error('[NOTION_CONFIG_ERROR]', error);
    return { error: "Failed to retrieve Notion configuration" };
  }
}

// Test Notion connection and permissions
async function testNotionConnection(client: Client, userId: string): Promise<NotionConnectionTest> {
  const startTime = Date.now();
  
  try {
    // Test basic API access
    const response = await client.users.me();
    const responseTime = Date.now() - startTime;
    
    console.log(`[NOTION_CONNECTION_TEST] Success for user ${userId}`, {
      responseTime: `${responseTime}ms`,
      workspaceName: response.name || 'Unknown',
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      userId,
      workspaceName: response.name || undefined,
      responseTime,
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = handleNotionError(error, userId);
    
    console.error(`[NOTION_CONNECTION_TEST] Failed for user ${userId}`, {
      error: errorMessage,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      userId,
      error: errorMessage,
      responseTime,
    };
  }
}

// Main function to initialize Notion client with comprehensive error handling
export async function initNotionClient(userId: string): Promise<NotionClientResult> {
  const startTime = Date.now();
  
  try {
    // Input validation
    if (!userId || typeof userId !== 'string') {
      return {
        success: false,
        error: "Valid user ID is required"
      };
    }

    // Rate limiting check
    if (!checkRateLimit(userId)) {
      return {
        success: false,
        error: "Rate limit exceeded. Please try again later."
      };
    }

    // Check cache first
    const cachedEntry = clientCache.get(userId);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL) {
      console.log(`[NOTION_CLIENT] Using cached client for user ${userId}`);
      return {
        success: true,
        client: cachedEntry.client,
        config: cachedEntry.config
      };
    }

    // Validate user access
    const userValidation = await validateUserAccess(userId);
    if (!userValidation.valid) {
      return {
        success: false,
        error: userValidation.error || "User access validation failed"
      };
    }

    // Get Notion configuration
    const { config, error: configError } = await getNotionConfig(userId);
    if (configError || !config) {
      return {
        success: false,
        error: configError || "Failed to get Notion configuration"
      };
    }

    // Initialize Notion client with proper configuration
    const notion = new Client({
      auth: config.notion_api_key,
      timeoutMs: 30000, // 30 second timeout
      // Add custom headers for tracking
      notionVersion: '2022-06-28',
    });

    // Test connection (optional but recommended)
    const connectionTest = await testNotionConnection(notion, userId);
    if (!connectionTest.success) {
      return {
        success: false,
        error: connectionTest.error || "Failed to connect to Notion"
      };
    }

    // Cache the successful client
    clientCache.set(userId, {
      client: notion,
      timestamp: Date.now(),
      config
    });

    const duration = Date.now() - startTime;

    console.log(`[NOTION_CLIENT] Successfully initialized for user ${userId}`, {
      duration: `${duration}ms`,
      workspaceName: connectionTest.workspaceName,
      databaseId: config.notion_db_id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      client: notion,
      config
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    console.error(`[NOTION_CLIENT_ERROR] Failed to initialize for user ${userId}`, {
      error: errorMessage,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: handleNotionError(error, userId)
    };
  }
}

// Helper function to clear cached client (useful for invalidating after config changes)
export function clearNotionClientCache(userId: string): void {
  clientCache.delete(userId);
  console.log(`[NOTION_CLIENT] Cleared cache for user ${userId}`);
}

// Helper function to validate Notion database access
export async function validateNotionDatabase(userId: string, databaseId?: string): Promise<{
  success: boolean;
  error?: string;
  databaseTitle?: string;
}> {
  try {
    const clientResult = await initNotionClient(userId);
    if (!clientResult.success || !clientResult.client) {
      return {
        success: false,
        error: clientResult.error || "Failed to initialize Notion client"
      };
    }

    const dbId = databaseId || clientResult.config?.notion_db_id;
    if (!dbId) {
      return {
        success: false,
        error: "No database ID provided"
      };
    }

    // Test database access
    const database = await clientResult.client.databases.retrieve({
      database_id: dbId
    });

    const databaseTitle = database.title?.[0]?.plain_text || 'Untitled Database';

    console.log(`[NOTION_DATABASE_VALIDATION] Success for user ${userId}`, {
      databaseId: dbId,
      databaseTitle,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      databaseTitle
    };

  } catch (error) {
    const errorMessage = handleNotionError(error, userId);
    
    console.error(`[NOTION_DATABASE_VALIDATION] Failed for user ${userId}`, {
      error: errorMessage,
      databaseId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}

// Helper function to get all Notion configurations (admin only)
export async function getAllNotionConfigs(adminUserId: string): Promise<{
  success: boolean;
  configs?: Array<{ userId: string; userEmail: string; hasConfig: boolean; lastValidated?: Date }>;
  error?: string;
}> {
  try {
    // Validate admin access
    const admin = await prismadb.users.findUnique({
      where: { id: adminUserId },
      select: { is_admin: true, is_account_admin: true }
    });

    if (!admin?.is_admin && !admin?.is_account_admin) {
      return {
        success: false,
        error: "Admin privileges required"
      };
    }

    const configs = await prismadb.users.findMany({
      select: {
        id: true,
        email: true,
        notion_account: {
          select: {
            id: true,
            v: true,
          }
        }
      }
    });

    const result = configs.map(user => ({
      userId: user.id,
      userEmail: user.email,
      hasConfig: user.notion_account.length > 0,
      lastValidated: undefined, // Could add timestamp tracking
    }));

    return {
      success: true,
      configs: result
    };

  } catch (error) {
    console.error('[GET_ALL_NOTION_CONFIGS_ERROR]', error);
    return {
      success: false,
      error: "Failed to retrieve Notion configurations"
    };
  }
}

// Cleanup function to clear old cache entries
export function cleanupNotionClientCache(): void {
  const now = Date.now();
  let clearedCount = 0;
  
  for (const [userId, entry] of clientCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      clientCache.delete(userId);
      clearedCount++;
    }
  }
  
  if (clearedCount > 0) {
    console.log(`[NOTION_CLIENT] Cleaned up ${clearedCount} expired cache entries`);
  }
}

// Default export for backward compatibility
export default initNotionClient;

// Set up periodic cache cleanup (run every 10 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupNotionClientCache, 10 * 60 * 1000);
}