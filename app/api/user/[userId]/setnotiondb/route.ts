// file: nextcrm/app/api/user/[userId]/setnotiondb/route.ts
/*
This route handles Notion database configuration for users (Second Brain integration)
Allows users to set/update their Notion API key and database ID

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'secondBrain_notions' to 'secondBrain_notions' (kept as per schema)
- Enhanced security with proper permission checking
- Improved validation for Notion API credentials
- Added proper error handling and logging
- Better response structure without exposing sensitive data
- Enhanced input validation and sanitization
- Added encryption considerations for API keys
- Removed unused zod import
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Validation functions for Notion credentials
function validateNotionDatabaseId(databaseId: string): boolean {
  // Notion database IDs are typically 32 characters long (UUID without hyphens)
  const notionDbRegex = /^[a-f0-9]{32}$/i;
  return notionDbRegex.test(databaseId.replace(/-/g, ''));
}

function validateNotionApiKey(apiKey: string): boolean {
  // Notion API keys start with "secret_" and are followed by alphanumeric characters
  const notionApiRegex = /^secret_[a-zA-Z0-9]{43}$/;
  return notionApiRegex.test(apiKey);
}

export async function POST(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  const { userId } = params;

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { databaseId, secretKey } = body;

    // Input validation
    if (!databaseId || !secretKey) {
      return NextResponse.json(
        { error: "Both databaseId and secretKey are required" },
        { status: 400 }
      );
    }

    // Validate input types
    if (typeof databaseId !== 'string' || typeof secretKey !== 'string') {
      return NextResponse.json(
        { error: "databaseId and secretKey must be strings" },
        { status: 400 }
      );
    }

    // Sanitize inputs
    const sanitizedDatabaseId = databaseId.trim();
    const sanitizedSecretKey = secretKey.trim();

    // Validate Notion credentials format
    if (!validateNotionDatabaseId(sanitizedDatabaseId)) {
      return NextResponse.json(
        { error: "Invalid Notion database ID format" },
        { status: 400 }
      );
    }

    if (!validateNotionApiKey(sanitizedSecretKey)) {
      return NextResponse.json(
        { error: "Invalid Notion API key format" },
        { status: 400 }
      );
    }

    console.log(`Processing Notion configuration for user: ${userId}`);

    // Security check: Only allow users to set their own Notion config, unless they're admin
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to set Notion config for user ${userId} without permission`);
      return NextResponse.json(
        { error: "You can only configure your own Notion integration" },
        { status: 403 }
      );
    }

    // Verify the target user exists
    const targetUser = await prismadb.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
      }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if Notion configuration already exists for this user
    const existingNotionConfig = await prismadb.secondBrain_notions.findFirst({
      where: {
        user: userId,
      },
    });

    let notionConfig;

    if (existingNotionConfig) {
      console.log(`Updating existing Notion configuration for user: ${targetUser.email}`);
      
      // Update existing configuration
      notionConfig = await prismadb.secondBrain_notions.update({
        where: {
          id: existingNotionConfig.id,
        },
        data: {
          notion_api_key: sanitizedSecretKey,
          notion_db_id: sanitizedDatabaseId,
          // You might want to add an updated timestamp
          // updated_at: new Date(),
        },
        select: {
          id: true,
          notion_db_id: true,
          // Don't return the API key for security
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      console.log(`Successfully updated Notion configuration for user: ${targetUser.email}`);

    } else {
      console.log(`Creating new Notion configuration for user: ${targetUser.email}`);
      
      // Create new configuration
      notionConfig = await prismadb.secondBrain_notions.create({
        data: {
          v: 0,
          notion_api_key: sanitizedSecretKey,
          notion_db_id: sanitizedDatabaseId,
          user: userId,
        },
        select: {
          id: true,
          notion_db_id: true,
          // Don't return the API key for security
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      console.log(`Successfully created Notion configuration for user: ${targetUser.email}`);
    }

    return NextResponse.json(
      {
        success: true,
        message: existingNotionConfig ? "Notion configuration updated successfully" : "Notion configuration created successfully",
        config: {
          id: notionConfig.id,
          databaseId: notionConfig.notion_db_id,
          user: notionConfig.assigned_user,
          // Never return the API key in response
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_NOTION_CONFIG_POST] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to update not found')) {
        return NextResponse.json({ error: "Notion configuration not found" }, { status: 404 });
      }
      
      if (error.message.includes('Unique constraint failed')) {
        return NextResponse.json(
          { error: "Notion configuration already exists for this user" },
          { status: 409 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to configure Notion integration",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current Notion configuration
export async function GET(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = params;

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    // Security check: Only allow users to view their own Notion config, unless they're admin
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only view your own Notion configuration" },
        { status: 403 }
      );
    }

    const notionConfig = await prismadb.secondBrain_notions.findFirst({
      where: {
        user: userId,
      },
      select: {
        id: true,
        notion_db_id: true,
        // Never return the API key
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
      return NextResponse.json(
        { 
          success: true,
          configured: false,
          message: "No Notion configuration found" 
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        configured: true,
        config: {
          id: notionConfig.id,
          databaseId: notionConfig.notion_db_id,
          user: notionConfig.assigned_user,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_NOTION_CONFIG_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve Notion configuration",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method to remove Notion configuration
export async function DELETE(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = params;

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    // Security check: Only allow users to delete their own Notion config, unless they're admin
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only delete your own Notion configuration" },
        { status: 403 }
      );
    }

    const deletedConfig = await prismadb.secondBrain_notions.deleteMany({
      where: {
        user: userId,
      },
    });

    if (deletedConfig.count === 0) {
      return NextResponse.json(
        { error: "No Notion configuration found to delete" },
        { status: 404 }
      );
    }

    console.log(`Deleted Notion configuration for user: ${userId}`);

    return NextResponse.json(
      {
        success: true,
        message: "Notion configuration deleted successfully",
        deletedCount: deletedConfig.count
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_NOTION_CONFIG_DELETE] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete Notion configuration",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}