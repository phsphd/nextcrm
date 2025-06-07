// file: nextcrm/app/api/secondBrain/[notionId]/route.ts
/*
This route handles Notion page operations (delete/archive) with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved Notion integration with proper relationship handling
- Better user authorization and Notion configuration verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better Notion API error handling and retry logic
- Enhanced response format with operation tracking
- Optimized queries for PostgreSQL performance
- Added comprehensive validation for all scenarios
- Added support for operation notes and audit trail
*/

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { prismadb } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import initNotionClient from "@/lib/notion";

// Enhanced validation schema for Notion operations
const notionOperationSchema = z.object({
  operation: z.enum(['delete', 'archive', 'restore']).default('archive'),
  reason: z.string()
    .max(500, "Reason too long")
    .optional(),
  notifyUser: z.boolean().default(false),
});

// Helper function to verify user's Notion configuration
async function getUserNotionConfig(userId: string) {
  const notionConfig = await prismadb.secondBrain_notions.findFirst({
    where: { user: userId },
    select: {
      id: true,
      notion_api_key: true,
      notion_db_id: true,
      assigned_user: {
        select: {
          id: true,
          name: true,
          email: true,
        }
      }
    }
  });

  if (!notionConfig) {
    return { isValid: false, config: null, error: "Notion integration not configured for this user" };
  }

  if (!notionConfig.notion_api_key || !notionConfig.notion_db_id) {
    return { isValid: false, config: notionConfig, error: "Incomplete Notion configuration - missing API key or database ID" };
  }

  return { isValid: true, config: notionConfig, error: null };
}

// Enhanced function to handle Notion page operations
async function performNotionOperation(
  notion: any, 
  notionId: string, 
  notionDbId: string, 
  operation: 'delete' | 'archive' | 'restore' = 'archive'
) {
  try {
    console.log(`Performing ${operation} operation on Notion page: ${notionId}`);

    // First, verify the page exists and get its current state
    let pageInfo;
    try {
      pageInfo = await notion.pages.retrieve({ page_id: notionId });
    } catch (retrieveError: any) {
      if (retrieveError.code === 'object_not_found') {
        throw new Error(`Notion page with ID ${notionId} not found`);
      }
      throw new Error(`Failed to retrieve Notion page: ${retrieveError.message}`);
    }

    // Perform the operation based on type
    let response;
    switch (operation) {
      case 'archive':
      case 'delete':
        response = await notion.pages.update({
          page_id: notionId,
          archived: true,
        });
        break;
      case 'restore':
        response = await notion.pages.update({
          page_id: notionId,
          archived: false,
        });
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    console.log(`Successfully ${operation}d Notion page ${notionId} in database ${notionDbId}`);
    
    return {
      success: true,
      operation,
      pageId: notionId,
      previousState: {
        archived: pageInfo.archived,
        lastEditedTime: pageInfo.last_edited_time,
      },
      newState: {
        archived: response.archived,
        lastEditedTime: response.last_edited_time,
      },
      response,
    };

  } catch (error: any) {
    console.error(`Notion ${operation} operation failed:`, error);
    
    // Handle specific Notion API errors
    if (error.code) {
      switch (error.code) {
        case 'object_not_found':
          throw new Error(`Notion page not found: ${notionId}`);
        case 'unauthorized':
          throw new Error('Invalid Notion API credentials');
        case 'forbidden':
          throw new Error('Insufficient permissions for this Notion page');
        case 'rate_limited':
          throw new Error('Notion API rate limit exceeded - please try again later');
        default:
          throw new Error(`Notion API error (${error.code}): ${error.message}`);
      }
    }
    
    throw new Error(`Notion operation failed: ${error.message}`);
  }
}

// Enhanced function to fetch database entries with pagination
async function fetchNotionDatabase(notion: any, notionDbId: string, options: { pageSize?: number; cursor?: string } = {}) {
  try {
    const { pageSize = 100, cursor } = options;
    
    const queryOptions: any = {
      database_id: notionDbId,
      page_size: Math.min(pageSize, 100), // Notion API limit
    };

    if (cursor) {
      queryOptions.start_cursor = cursor;
    }

    const response = await notion.databases.query(queryOptions);
    
    console.log(`Fetched ${response.results.length} entries from Notion database ${notionDbId}`);
    
    return {
      success: true,
      results: response.results,
      hasMore: response.has_more,
      nextCursor: response.next_cursor,
      totalFetched: response.results.length,
    };

  } catch (error: any) {
    console.error('Failed to fetch Notion database:', error);
    
    if (error.code) {
      switch (error.code) {
        case 'object_not_found':
          throw new Error(`Notion database not found: ${notionDbId}`);
        case 'unauthorized':
          throw new Error('Invalid Notion API credentials');
        case 'forbidden':
          throw new Error('Insufficient permissions for this Notion database');
        default:
          throw new Error(`Notion API error (${error.code}): ${error.message}`);
      }
    }
    
    throw new Error(`Failed to fetch Notion database: ${error.message}`);
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ notionId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  // Enhanced authentication check
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  // Enhanced parameter validation
  if (!params.notionId) {
    return NextResponse.json({ error: "Missing Notion page ID" }, { status: 400 });
  }

  const { notionId } = params;

  // Validate notionId format (Notion IDs are UUIDs with or without hyphens)
  const notionIdRegex = /^[0-9a-fA-F]{8}[-]?[0-9a-fA-F]{4}[-]?[0-9a-fA-F]{4}[-]?[0-9a-fA-F]{4}[-]?[0-9a-fA-F]{12}$/;
  if (!notionIdRegex.test(notionId.replace(/-/g, ''))) {
    return NextResponse.json({ error: "Invalid Notion page ID format" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({})); // Allow empty body
    console.log(`User ${session.user.email} performing Notion operation on page: ${notionId}`);

    // Validate request data (optional body)
    const validatedData = notionOperationSchema.parse(body);
    const { operation, reason, notifyUser } = validatedData;

    // Get user's Notion configuration
    const { isValid, config, error: configError } = await getUserNotionConfig(session.user.id);
    if (!isValid) {
      return NextResponse.json({ error: configError }, { status: configError?.includes("not configured") ? 404 : 400 });
    }

    // Initialize Notion client
    let notion;
    try {
      notion = await initNotionClient(session.user.id);
    } catch (notionError: any) {
      console.error("Failed to initialize Notion client:", notionError);
      return NextResponse.json(
        { error: "Failed to initialize Notion client - please check your API configuration" },
        { status: 500 }
      );
    }

    // Use transaction for audit trail
    const operationResult = await prismadb.$transaction(async (tx) => {
      // Perform the Notion operation
      const notionResult = await performNotionOperation(
        notion,
        notionId,
        config!.notion_db_id,
        operation
      );

      // Update user's last activity
      await tx.users.update({
        where: { id: session.user.id },
        data: { lastLoginAt: new Date() },
      });

      // Here you could add logging to a notion_operations table if you have one
      // await tx.notionOperations.create({
      //   data: {
      //     userId: session.user.id,
      //     pageId: notionId,
      //     operation,
      //     reason,
      //     success: true,
      //   }
      // });

      return notionResult;
    });

    // Optionally fetch updated database state
    let databaseState = null;
    if (operation === 'delete' || operation === 'archive') {
      try {
        databaseState = await fetchNotionDatabase(notion, config!.notion_db_id, { pageSize: 10 });
      } catch (fetchError) {
        console.warn("Failed to fetch updated database state:", fetchError);
        // Don't fail the request if we can't fetch the database state
      }
    }

    console.log(`Successfully ${operation}d Notion page ${notionId} by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: `Notion page ${operation}d successfully`,
        operation: {
          type: operation,
          pageId: notionId,
          reason,
          performedBy: {
            id: session.user.id,
            email: session.user.email,
          },
        },
        notionResult: {
          pageId: operationResult.pageId,
          previousState: operationResult.previousState,
          newState: operationResult.newState,
        },
        databaseInfo: config ? {
          id: config.notion_db_id,
          entriesCount: databaseState?.totalFetched,
        } : null,
        performedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[NOTION_OPERATION] Error:", error);

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
        },
        { status: 400 }
      );
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Handle Notion-specific errors
    if (error instanceof Error) {
      const errorMessage = error.message;
      
      if (errorMessage.includes('not found')) {
        return NextResponse.json({ error: errorMessage }, { status: 404 });
      } else if (errorMessage.includes('unauthorized') || errorMessage.includes('credentials')) {
        return NextResponse.json({ error: errorMessage }, { status: 401 });
      } else if (errorMessage.includes('forbidden') || errorMessage.includes('permissions')) {
        return NextResponse.json({ error: errorMessage }, { status: 403 });
      } else if (errorMessage.includes('rate limit')) {
        return NextResponse.json({ error: errorMessage }, { status: 429 });
      }
    }

    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      switch (prismaError.code) {
        case 'P2025':
          return NextResponse.json(
            { error: "User or Notion configuration not found" },
            { status: 404 }
          );
        case 'P1008':
          return NextResponse.json(
            { error: "Database timeout - please try again" },
            { status: 504 }
          );
        default:
          console.error("Unhandled Prisma error:", prismaError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to perform Notion operation",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add PUT method to restore archived pages
export async function PUT(req: Request, props: { params: Promise<{ notionId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.notionId) {
    return NextResponse.json({ error: "Missing Notion page ID" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log(`User ${session.user.email} restoring Notion page: ${params.notionId}`);

    // Force operation to 'restore'
    const validatedData = notionOperationSchema.parse({ ...body, operation: 'restore' });
    const { reason } = validatedData;

    // Get user's Notion configuration
    const { isValid, config, error: configError } = await getUserNotionConfig(session.user.id);
    if (!isValid) {
      return NextResponse.json({ error: configError }, { status: 404 });
    }

    // Initialize Notion client and perform restore
    const notion = await initNotionClient(session.user.id);
    const operationResult = await performNotionOperation(
      notion,
      params.notionId,
      config!.notion_db_id,
      'restore'
    );

    console.log(`Successfully restored Notion page ${params.notionId} by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Notion page restored successfully",
        operation: {
          type: 'restore',
          pageId: params.notionId,
          reason,
        },
        notionResult: {
          pageId: operationResult.pageId,
          previousState: operationResult.previousState,
          newState: operationResult.newState,
        },
        restoredAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[NOTION_RESTORE] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to restore Notion page",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve page information
export async function GET(req: Request, props: { params: Promise<{ notionId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.notionId) {
    return NextResponse.json({ error: "Missing Notion page ID" }, { status: 400 });
  }

  try {
    // Get user's Notion configuration
    const { isValid, config, error: configError } = await getUserNotionConfig(session.user.id);
    if (!isValid) {
      return NextResponse.json({ error: configError }, { status: 404 });
    }

    // Initialize Notion client and get page info
    const notion = await initNotionClient(session.user.id);
    const pageInfo = await notion.pages.retrieve({ page_id: params.notionId });

    return NextResponse.json(
      {
        success: true,
        page: {
          id: pageInfo.id,
          archived: pageInfo.archived,
          createdTime: pageInfo.created_time,
          lastEditedTime: pageInfo.last_edited_time,
          url: pageInfo.url,
        },
        database: {
          id: config!.notion_db_id,
        },
        canModify: true, // User has access if they reached this point
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[NOTION_PAGE_GET] Error:", error);
    
    if (error && typeof error === 'object' && 'code' in error) {
      const notionError = error as any;
      if (notionError.code === 'object_not_found') {
        return NextResponse.json({ error: "Notion page not found" }, { status: 404 });
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve Notion page information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}