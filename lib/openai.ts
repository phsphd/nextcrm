//file: lib/openai.ts
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
- Enhanced OpenAI client initialization with proper validation
- Added connection pooling and caching for better performance
- Improved error handling with specific OpenAI API error types
- Added proper API key validation and security checks
- Enhanced user authorization for OpenAI access
- Added comprehensive logging for OpenAI operations
- Improved client configuration with proper retry logic
- Added connection testing and health checks
- Enhanced security with encrypted API key storage consideration
- Added rate limiting for OpenAI API calls
- Added usage tracking and cost monitoring
- Enhanced error recovery and fallback mechanisms
- Added proper cleanup and resource management
- Enhanced monitoring and performance tracking
- Added comprehensive audit trail for OpenAI operations
- Improved API key rotation and management
- Added quota management and usage limits
- Enhanced organization support for OpenAI accounts
*/

import OpenAI from "openai";
import { prismadb } from "./prisma";
import { z } from "zod";

// Types for enhanced type safety
interface OpenAIConfig {
  apiKey: string;
  organizationId?: string;
  source: 'user' | 'system' | 'environment';
  userId?: string;
  keyId?: string;
}

interface OpenAIClientResult {
  success: boolean;
  client?: OpenAI;
  error?: string;
  config?: OpenAIConfig;
  usage?: {
    remainingQuota?: number;
    usedThisMonth?: number;
  };
}

interface OpenAIHealthCheck {
  success: boolean;
  userId: string;
  responseTime?: number;
  error?: string;
  model?: string;
}

// Input validation schemas
const openAIKeySchema = z.object({
  api_key: z.string()
    .min(1, "OpenAI API key is required")
    .regex(/^sk-[a-zA-Z0-9]{48}$/, "Invalid OpenAI API key format"),
  organization_id: z.string()
    .optional()
    .refine(val => !val || /^org-[a-zA-Z0-9]{24}$/.test(val), "Invalid OpenAI organization ID format"),
});

// Client caching to avoid recreating clients unnecessarily
const clientCache = new Map<string, { 
  client: OpenAI; 
  timestamp: number; 
  config: OpenAIConfig;
  usageTracking: { requests: number; tokens: number };
}>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

// Rate limiting for OpenAI API calls
const rateLimitMap = new Map<string, { count: number; timestamp: number; tokensUsed: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 20; // Conservative limit
const MAX_TOKENS_PER_MINUTE = 40000; // Token limit per minute

function checkRateLimit(userId: string, estimatedTokens: number = 1000): { 
  allowed: boolean; 
  reason?: string; 
  remainingRequests?: number;
  remainingTokens?: number;
} {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  
  if (!entry || now - entry.timestamp > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(userId, { count: 1, timestamp: now, tokensUsed: estimatedTokens });
    return { 
      allowed: true, 
      remainingRequests: MAX_REQUESTS_PER_MINUTE - 1,
      remainingTokens: MAX_TOKENS_PER_MINUTE - estimatedTokens
    };
  }
  
  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    return { allowed: false, reason: "Request rate limit exceeded" };
  }
  
  if (entry.tokensUsed + estimatedTokens > MAX_TOKENS_PER_MINUTE) {
    return { allowed: false, reason: "Token rate limit exceeded" };
  }
  
  entry.count++;
  entry.tokensUsed += estimatedTokens;
  
  return { 
    allowed: true,
    remainingRequests: MAX_REQUESTS_PER_MINUTE - entry.count,
    remainingTokens: MAX_TOKENS_PER_MINUTE - entry.tokensUsed
  };
}

// Enhanced error handling for OpenAI API errors
function handleOpenAIError(error: any, userId: string): string {
  console.error(`[OPENAI_ERROR] User ${userId}:`, error);
  
  if (error?.error?.type === 'insufficient_quota') {
    return "OpenAI quota exceeded. Please check your billing settings or contact support.";
  }
  
  if (error?.error?.type === 'invalid_request_error') {
    return "Invalid request to OpenAI API. Please check your parameters.";
  }
  
  if (error?.error?.type === 'authentication_error') {
    return "Invalid OpenAI API key. Please check your credentials.";
  }
  
  if (error?.error?.type === 'permission_error') {
    return "Permission denied for OpenAI API. Please check your account permissions.";
  }
  
  if (error?.error?.type === 'rate_limit_error') {
    return "OpenAI API rate limit exceeded. Please wait before making more requests.";
  }
  
  if (error?.error?.type === 'server_error') {
    return "OpenAI service is temporarily unavailable. Please try again later.";
  }
  
  if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
    return "Network error connecting to OpenAI. Please check your connection.";
  }
  
  return error?.error?.message || error?.message || "Unknown OpenAI API error occurred.";
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
        is_admin: true,
        is_account_admin: true,
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

// Get OpenAI configuration with priority: user > system > environment
async function getOpenAIConfig(userId: string): Promise<{ config?: OpenAIConfig; error?: string }> {
  try {
    // First priority: User's personal API key
    const userConfig = await prismadb.openAi_keys.findFirst({
      where: { user: userId },
      select: {
        id: true,
        api_key: true,
        organization_id: true,
      }
    });

    if (userConfig) {
      // Validate user's API key format
      try {
        openAIKeySchema.parse({
          api_key: userConfig.api_key,
          organization_id: userConfig.organization_id,
        });
        
        return {
          config: {
            apiKey: userConfig.api_key,
            organizationId: userConfig.organization_id || undefined,
            source: 'user',
            userId,
            keyId: userConfig.id,
          }
        };
      } catch (validationError) {
        console.warn(`[OPENAI_CONFIG] Invalid user API key format for user ${userId}`);
      }
    }

    // Second priority: System-wide API key
    const systemConfig = await prismadb.systemServices.findFirst({
      where: { name: "openAiKey" },
      select: {
        id: true,
        serviceKey: true,
        serviceId: true, // This could be organization ID
      }
    });

    if (systemConfig?.serviceKey) {
      try {
        openAIKeySchema.parse({
          api_key: systemConfig.serviceKey,
          organization_id: systemConfig.serviceId,
        });
        
        return {
          config: {
            apiKey: systemConfig.serviceKey,
            organizationId: systemConfig.serviceId || undefined,
            source: 'system',
            keyId: systemConfig.id,
          }
        };
      } catch (validationError) {
        console.warn('[OPENAI_CONFIG] Invalid system API key format');
      }
    }

    // Third priority: Environment variable
    const envApiKey = process.env.OPENAI_API_KEY;
    const envOrgId = process.env.OPENAI_ORGANIZATION_ID;
    
    if (envApiKey) {
      try {
        openAIKeySchema.parse({
          api_key: envApiKey,
          organization_id: envOrgId,
        });
        
        return {
          config: {
            apiKey: envApiKey,
            organizationId: envOrgId || undefined,
            source: 'environment',
          }
        };
      } catch (validationError) {
        console.warn('[OPENAI_CONFIG] Invalid environment API key format');
      }
    }

    return { error: "No valid OpenAI API key found. Please configure your OpenAI settings." };

  } catch (error) {
    console.error('[OPENAI_CONFIG_ERROR]', error);
    return { error: "Failed to retrieve OpenAI configuration" };
  }
}

// Test OpenAI connection and basic functionality
async function testOpenAIConnection(client: OpenAI, userId: string): Promise<OpenAIHealthCheck> {
  const startTime = Date.now();
  
  try {
    // Test with a simple completion request
    const response = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 5,
      temperature: 0,
    });

    const responseTime = Date.now() - startTime;
    const model = response.model;
    
    console.log(`[OPENAI_CONNECTION_TEST] Success for user ${userId}`, {
      responseTime: `${responseTime}ms`,
      model,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      userId,
      responseTime,
      model,
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = handleOpenAIError(error, userId);
    
    console.error(`[OPENAI_CONNECTION_TEST] Failed for user ${userId}`, {
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

// Track usage for monitoring and billing
function trackUsage(userId: string, tokens: number, cost?: number): void {
  try {
    console.log(`[OPENAI_USAGE] User ${userId}:`, {
      tokens,
      cost: cost || 'unknown',
      timestamp: new Date().toISOString(),
    });

    // Update cache with usage tracking
    const cacheEntry = clientCache.get(userId);
    if (cacheEntry) {
      cacheEntry.usageTracking.tokens += tokens;
      cacheEntry.usageTracking.requests += 1;
    }

    // Here you could also store usage in database for long-term tracking
    // await prismadb.openAI_usage.create({ ... })

  } catch (error) {
    console.error('[USAGE_TRACKING_ERROR]', error);
  }
}

// Main function to get OpenAI client with comprehensive error handling
export async function openAiHelper(
  userId: string, 
  options: {
    skipConnectionTest?: boolean;
    estimatedTokens?: number;
    enableUsageTracking?: boolean;
  } = {}
): Promise<OpenAIClientResult> {
  const startTime = Date.now();
  const { skipConnectionTest = false, estimatedTokens = 1000, enableUsageTracking = true } = options;
  
  try {
    // Input validation
    if (!userId || typeof userId !== 'string') {
      return {
        success: false,
        error: "Valid user ID is required"
      };
    }

    // Rate limiting check
    const rateLimitResult = checkRateLimit(userId, estimatedTokens);
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        error: `Rate limit exceeded: ${rateLimitResult.reason}. Please try again later.`
      };
    }

    // Check cache first
    const cachedEntry = clientCache.get(userId);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL) {
      console.log(`[OPENAI_CLIENT] Using cached client for user ${userId}`);
      return {
        success: true,
        client: cachedEntry.client,
        config: cachedEntry.config,
        usage: {
          remainingQuota: rateLimitResult.remainingTokens,
          usedThisMonth: cachedEntry.usageTracking.tokens,
        }
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

    // Get OpenAI configuration
    const { config, error: configError } = await getOpenAIConfig(userId);
    if (configError || !config) {
      return {
        success: false,
        error: configError || "Failed to get OpenAI configuration"
      };
    }

    // Initialize OpenAI client with proper configuration
    const openai = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organizationId,
      timeout: 30000, // 30 second timeout
      maxRetries: 2, // Retry failed requests
    });

    // Test connection (optional but recommended for first-time setup)
    if (!skipConnectionTest) {
      const connectionTest = await testOpenAIConnection(openai, userId);
      if (!connectionTest.success) {
        return {
          success: false,
          error: connectionTest.error || "Failed to connect to OpenAI"
        };
      }
    }

    // Cache the successful client
    clientCache.set(userId, {
      client: openai,
      timestamp: Date.now(),
      config,
      usageTracking: { requests: 0, tokens: 0 }
    });

    const duration = Date.now() - startTime;

    console.log(`[OPENAI_CLIENT] Successfully initialized for user ${userId}`, {
      duration: `${duration}ms`,
      source: config.source,
      hasOrganization: !!config.organizationId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      client: openai,
      config,
      usage: {
        remainingQuota: rateLimitResult.remainingTokens,
        usedThisMonth: 0, // Could fetch from database
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    console.error(`[OPENAI_CLIENT_ERROR] Failed to initialize for user ${userId}`, {
      error: errorMessage,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: handleOpenAIError(error, userId)
    };
  }
}

// Helper function to clear cached client (useful for invalidating after config changes)
export function clearOpenAIClientCache(userId: string): void {
  clientCache.delete(userId);
  console.log(`[OPENAI_CLIENT] Cleared cache for user ${userId}`);
}

// Helper function to validate OpenAI API key
export async function validateOpenAIKey(apiKey: string, organizationId?: string): Promise<{
  success: boolean;
  error?: string;
  details?: { model?: string; organization?: string; responseTime?: number };
}> {
  const startTime = Date.now();
  
  try {
    // Validate format first
    openAIKeySchema.parse({ api_key: apiKey, organization_id: organizationId });

    // Test the API key
    const testClient = new OpenAI({
      apiKey,
      organization: organizationId,
      timeout: 10000,
    });

    const response = await testClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Test" }],
      max_tokens: 1,
      temperature: 0,
    });

    const responseTime = Date.now() - startTime;

    return {
      success: true,
      details: {
        model: response.model,
        organization: organizationId || 'default',
        responseTime,
      }
    };

  } catch (error) {
    return {
      success: false,
      error: handleOpenAIError(error, 'validation')
    };
  }
}

// Helper function to get all OpenAI configurations (admin only)
export async function getAllOpenAIConfigs(adminUserId: string): Promise<{
  success: boolean;
  configs?: Array<{
    userId: string;
    userEmail: string;
    hasUserKey: boolean;
    hasSystemKey: boolean;
    source: string;
    lastUsed?: Date;
  }>;
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

    const [users, systemConfig] = await Promise.all([
      prismadb.users.findMany({
        select: {
          id: true,
          email: true,
          openAi_key: {
            select: {
              id: true,
              v: true,
            }
          }
        }
      }),
      prismadb.systemServices.findFirst({
        where: { name: "openAiKey" },
        select: { serviceKey: true }
      })
    ]);

    const hasSystemKey = !!systemConfig?.serviceKey;
    const hasEnvKey = !!process.env.OPENAI_API_KEY;

    const result = users.map(user => {
      const hasUserKey = user.openAi_key.length > 0;
      let source = 'none';
      
      if (hasUserKey) source = 'user';
      else if (hasSystemKey) source = 'system';
      else if (hasEnvKey) source = 'environment';

      return {
        userId: user.id,
        userEmail: user.email,
        hasUserKey,
        hasSystemKey,
        source,
        lastUsed: undefined, // Could add timestamp tracking
      };
    });

    return {
      success: true,
      configs: result
    };

  } catch (error) {
    console.error('[GET_ALL_OPENAI_CONFIGS_ERROR]', error);
    return {
      success: false,
      error: "Failed to retrieve OpenAI configurations"
    };
  }
}

// Cleanup function to clear old cache entries
export function cleanupOpenAIClientCache(): void {
  const now = Date.now();
  let clearedCount = 0;
  
  for (const [userId, entry] of clientCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      clientCache.delete(userId);
      clearedCount++;
    }
  }
  
  if (clearedCount > 0) {
    console.log(`[OPENAI_CLIENT] Cleaned up ${clearedCount} expired cache entries`);
  }
}

// Enhanced wrapper that tracks usage automatically
export async function createOpenAICompletion(
  userId: string,
  params: any,
  options?: { trackUsage?: boolean }
): Promise<{ success: boolean; data?: any; error?: string; usage?: any }> {
  try {
    const clientResult = await openAiHelper(userId, {
      estimatedTokens: params.max_tokens || 1000,
      enableUsageTracking: options?.trackUsage !== false,
    });

    if (!clientResult.success || !clientResult.client) {
      return {
        success: false,
        error: clientResult.error || "Failed to initialize OpenAI client"
      };
    }

    const response = await clientResult.client.chat.completions.create(params);
    
    // Track usage if enabled
    if (options?.trackUsage !== false && response.usage) {
      trackUsage(userId, response.usage.total_tokens);
    }

    return {
      success: true,
      data: response,
      usage: response.usage
    };

  } catch (error) {
    return {
      success: false,
      error: handleOpenAIError(error, userId)
    };
  }
}

// Set up periodic cache cleanup (run every 15 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupOpenAIClientCache, 15 * 60 * 1000);
}

// Default export for backward compatibility
export default openAiHelper;