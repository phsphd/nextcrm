// file: nextcrm/app/api/user/[userId]/set-language/route.ts
/*
This route updates a user's language preference in the database
Supports the Language enum defined in the Prisma schema (cz, en, de, uk)

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'users' to 'Users' (Pascal case for Prisma)
- Added language validation against schema enum values
- Enhanced security with user permission checking
- Improved error handling and validation
- Added proper input sanitization
- Better logging and response structure
- Removed unused bcrypt import
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Define valid languages based on your Prisma schema enum
const VALID_LANGUAGES = ['cz', 'en', 'de', 'uk'] as const;
type Language = typeof VALID_LANGUAGES[number];

export async function PUT(req: Request, props: { params: Promise<{ userId: string }> }) {
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
    const { language } = body;

    if (!language) {
      return NextResponse.json({ error: "Language is required" }, { status: 400 });
    }

    // Validate language against enum values
    if (!VALID_LANGUAGES.includes(language)) {
      return NextResponse.json(
        { 
          error: "Invalid language",
          validLanguages: VALID_LANGUAGES,
          provided: language
        },
        { status: 400 }
      );
    }

    console.log(`Processing language update for user: ${userId} to language: ${language}`);

    // Security check: Only allow users to update their own language, unless they're admin
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to update language for user ${userId} without permission`);
      return NextResponse.json(
        { error: "You can only update your own language preference" },
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
        userLanguage: true,
      }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    console.log(`Current language for user ${targetUser.email}: ${targetUser.userLanguage}`);

    // Update user language
    const updatedUser = await prismadb.users.update({
      data: {
        userLanguage: language as Language,
      },
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        userLanguage: true,
      }
    });

    console.log(`Successfully updated language for user ${updatedUser.email} to: ${updatedUser.userLanguage}`);

    return NextResponse.json(
      {
        success: true,
        message: "Language updated successfully",
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          language: updatedUser.userLanguage,
        },
        previousLanguage: targetUser.userLanguage,
        newLanguage: updatedUser.userLanguage,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_LANGUAGE_PUT] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to update not found')) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      
      if (error.message.includes('Invalid enum value')) {
        return NextResponse.json(
          { 
            error: "Invalid language value",
            validLanguages: VALID_LANGUAGES 
          },
          { status: 400 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update user language",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current language preference
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
    // Security check: Only allow users to view their own language, unless they're admin
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only view your own language preference" },
        { status: 403 }
      );
    }

    const user = await prismadb.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        userLanguage: true,
      }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          language: user.userLanguage,
        },
        availableLanguages: VALID_LANGUAGES,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_LANGUAGE_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve user language",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}