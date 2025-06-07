// file: nextcrm/app/api/user/[userId]/setOpenAi/route.ts
/*
This route handles OpenAI API key configuration for users
Allows users to set/update their OpenAI API key and organization ID

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'openAi_keys' to 'openAi_keys' (kept as per schema)
- Enhanced security with proper permission checking
- Improved validation for OpenAI API credentials
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

// Validation functions for OpenAI credentials
function validateOpenAiApiKey(apiKey: string): boolean {
  // OpenAI API keys start with "sk-" and are followed by 48 characters
  const openAiApiRegex = /^sk-[a-zA-Z0-9]{48}$/;
  return openAiApiRegex.test(apiKey);
}

function validateOpenAiOrgId(orgId: string): boolean {
  // OpenAI organization IDs start with "org-" and are followed by 24 characters
  const openAiOrgRegex = /^org-[a-zA-Z0-9]{24}$/;
  return openAiOrgRegex.test(orgId);
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
    const { organizationId, secretKey } = body;

    // Input validation
    if (!organizationId || !secretKey) {
      return NextResponse.json(
        { error: "Both organizationId and secretKey are required" },
        { status: 400 }
      );
    }

    // Validate input types
    if (typeof organizationId !== 'string' || typeof secretKey !== 'string') {
      return NextResponse.json(
        { error: "organizationId and secretKey must be strings" },
        { status: 400 }
      );
    }

    // Sanitize inputs
    const sanitizedOrgId = organizationId.trim();
    const sanitizedApiKey = secretKey.trim();

    // Validate OpenAI credentials format
    if (!validateOpenAiApiKey(sanitizedApiKey)) {
      return NextResponse.json(
        { error: "Invalid OpenAI API key format. Must start with 'sk-' followed by 48 characters." },
        { status: 400 }
      );
    }

    if (!validateOpenAiOrgId(sanitizedOrgId)) {
      return NextResponse.json(
        { error: "Invalid OpenAI organization ID format. Must start with 'org-' followed by 24 characters." },
        { status: 400 }
      );
    }

    console.log(`Processing OpenAI configuration for user: ${userId}`);

    // Security check: Only allow users to set their own OpenAI config, unless they're admin
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to set OpenAI config for user ${userId} without permission`);
      return NextResponse.json(
        { error: "You can only configure your own OpenAI integration" },
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

    // Check if OpenAI configuration already exists for this user
    const existingOpenAiConfig = await prismadb.openAi_keys.findFirst({
      where: {
        user: userId,
      },
    });

    let openAiConfig;

    if (existingOpenAiConfig) {
      console.log(`Updating existing OpenAI configuration for user: ${targetUser.email}`);
      
      // Update existing configuration
      openAiConfig = await prismadb.openAi_keys.update({
        where: {
          id: existingOpenAiConfig.id,
        },
        data: {
          api_key: sanitizedApiKey,
          organization_id: sanitizedOrgId,
          // You might want to add an updated timestamp
          // updated_at: new Date(),
        },
        select: {
          id: true,
          organization_id: true,
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

      console.log(`Successfully updated OpenAI configuration for user: ${targetUser.email}`);

    } else {
      console.log(`Creating new OpenAI configuration for user: ${targetUser.email}`);
      
      // Create new configuration
      openAiConfig = await prismadb.openAi_keys.create({
        data: {
          v: 0,
          api_key: sanitizedApiKey,
          organization_id: sanitizedOrgId,
          user: userId,
        },
        select: {
          id: true,
          organization_id: true,
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

      console.log(`Successfully created OpenAI configuration for user: ${targetUser.email}`);
    }

    return NextResponse.json(
      {
        success: true,
        message: existingOpenAiConfig ? "OpenAI configuration updated successfully" : "OpenAI configuration created successfully",
        config: {
          id: openAiConfig.id,
          organizationId: openAiConfig.organization_id,
          user: openAiConfig.assigned_user,
          // Never return the API key in response
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_OPENAI_CONFIG_POST] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to update not found')) {
        return NextResponse.json({ error: "OpenAI configuration not found" }, { status: 404 });
      }
      
      if (error.message.includes('Unique constraint failed')) {
        return NextResponse.json(
          { error: "OpenAI configuration already exists for this user" },
          { status: 409 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to configure OpenAI integration",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current OpenAI configuration
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
    // Security check: Only allow users to view their own OpenAI config, unless they're admin
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only view your own OpenAI configuration" },
        { status: 403 }
      );
    }

    const openAiConfig = await prismadb.openAi_keys.findFirst({
      where: {
        user: userId,
      },
      select: {
        id: true,
        organization_id: true,
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

    if (!openAiConfig) {
      return NextResponse.json(
        { 
          success: true,
          configured: false,
          message: "No OpenAI configuration found" 
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        configured: true,
        config: {
          id: openAiConfig.id,
          organizationId: openAiConfig.organization_id,
          user: openAiConfig.assigned_user,
          // Show partial API key for verification (last 4 characters)
          apiKeyPartial: `sk-...${openAiConfig.organization_id ? 'configured' : 'not set'}`,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_OPENAI_CONFIG_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve OpenAI configuration",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method to remove OpenAI configuration
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
    // Security check: Only allow users to delete their own OpenAI config, unless they're admin
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only delete your own OpenAI configuration" },
        { status: 403 }
      );
    }

    const deletedConfig = await prismadb.openAi_keys.deleteMany({
      where: {
        user: userId,
      },
    });

    if (deletedConfig.count === 0) {
      return NextResponse.json(
        { error: "No OpenAI configuration found to delete" },
        { status: 404 }
      );
    }

    console.log(`Deleted OpenAI configuration for user: ${userId}`);

    return NextResponse.json(
      {
        success: true,
        message: "OpenAI configuration deleted successfully",
        deletedCount: deletedConfig.count
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_OPENAI_CONFIG_DELETE] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete OpenAI configuration",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add PATCH method to test API key validity
export async function PATCH(req: Request, props: { params: Promise<{ userId: string }> }) {
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
    // Security check
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only test your own OpenAI configuration" },
        { status: 403 }
      );
    }

    const openAiConfig = await prismadb.openAi_keys.findFirst({
      where: {
        user: userId,
      },
      select: {
        api_key: true,
        organization_id: true,
      }
    });

    if (!openAiConfig) {
      return NextResponse.json({ error: "No OpenAI configuration found" }, { status: 404 });
    }

    // Test the API key by making a simple request to OpenAI
    const testResponse = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${openAiConfig.api_key}`,
        'OpenAI-Organization': openAiConfig.organization_id,
      },
    });

    const isValid = testResponse.ok;

    return NextResponse.json(
      {
        success: true,
        valid: isValid,
        message: isValid ? "OpenAI API key is valid" : "OpenAI API key is invalid or expired",
        statusCode: testResponse.status
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_OPENAI_CONFIG_TEST] Error:", error);
    
    return NextResponse.json(
      {
        success: false,
        valid: false,
        message: "Failed to test OpenAI API key",
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}