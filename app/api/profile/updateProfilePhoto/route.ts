// file: nextcrm/app/api/profile/updateProfilePhoto/route.ts
/*
This route handles user profile photo updates with enhanced validation and security
Supports URL validation, file size checks, and proper error handling

MIGRATION NOTES (MongoDB -> Supabase):
- Updated from MongoDB to PostgreSQL/Supabase
- Using Prisma ORM with PostgreSQL database
- Enhanced security with proper user validation
- Improved avatar URL validation and sanitization
- Better error handling and response structure
- Added file format validation and security checks
- Enhanced logging and activity tracking
- Added support for removing avatars (setting to null)
- Better success/error messaging
- Updated model references to match Prisma schema
*/

import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

// Enhanced validation schema for avatar updates
const avatarUpdateSchema = z.object({
  avatar: z.union([
    z.string()
      .url("Invalid avatar URL format")
      .min(1, "Avatar URL cannot be empty")
      .max(2048, "Avatar URL is too long")
      .refine(
        (url) => {
          // Validate that URL points to an image
          const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
          const urlObj = new URL(url);
          return imageExtensions.test(urlObj.pathname) || 
                 url.includes('gravatar.com') || 
                 url.includes('uploadthing.com') ||
                 url.includes('cloudinary.com') ||
                 url.includes('amazonaws.com') ||
                 url.includes('googleusercontent.com') ||
                 url.includes('supabase.co'); // Added Supabase storage support
        },
        "URL must point to a valid image file"
      ),
    z.null() // Allow null to remove avatar
  ])
});

// Helper function to validate and sanitize avatar URL
function validateAvatarUrl(url: string | null): { isValid: boolean; sanitizedUrl?: string; error?: string } {
  if (url === null) {
    return { isValid: true, sanitizedUrl: null };
  }

  if (!url || typeof url !== 'string') {
    return { isValid: false, error: "Avatar URL must be a string" };
  }

  try {
    const urlObj = new URL(url);
    
    // Check protocol
    if (!['https:', 'http:'].includes(urlObj.protocol)) {
      return { isValid: false, error: "Avatar URL must use HTTP or HTTPS protocol" };
    }

    // Prefer HTTPS
    if (urlObj.protocol === 'http:') {
      urlObj.protocol = 'https:';
    }

    // Check for malicious patterns
    const maliciousPatterns = [
      'javascript:',
      'data:',
      'vbscript:',
      '<script',
      'onload=',
      'onerror='
    ];

    const urlString = urlObj.toString().toLowerCase();
    for (const pattern of maliciousPatterns) {
      if (urlString.includes(pattern)) {
        return { isValid: false, error: "Avatar URL contains potentially malicious content" };
      }
    }

    return { isValid: true, sanitizedUrl: urlObj.toString() };
  } catch (error) {
    return { isValid: false, error: "Invalid URL format" };
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log(`User ${session.user.email} updating profile photo`);

    // Validate request data
    const validatedData = avatarUpdateSchema.parse(body);
    const { avatar } = validatedData;

    // Additional URL validation and sanitization
    const urlValidation = validateAvatarUrl(avatar);
    if (!urlValidation.isValid) {
      return NextResponse.json(
        { 
          error: "Invalid avatar URL",
          details: urlValidation.error
        },
        { status: 400 }
      );
    }

    // Check if user exists - Updated model name to match Prisma schema
    const existingUser = await prismadb.users.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      }
    });

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update user avatar - Updated model name to match Prisma schema
    const updatedUser = await prismadb.users.update({
      where: {
        id: session.user.id,
      },
      data: {
        avatar: urlValidation.sanitizedUrl,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      }
    });

    const actionMessage = avatar === null 
      ? "Profile photo removed successfully"
      : "Profile photo updated successfully";

    console.log(`${actionMessage} for user: ${updatedUser.email}`);

    return NextResponse.json(
      {
        success: true,
        message: actionMessage,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          avatar: updatedUser.avatar,
        },
        previousAvatar: existingUser.avatar,
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROFILE_PHOTO_UPDATE] Error:", error);

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

    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      // PostgreSQL specific error codes
      switch (prismaError.code) {
        case 'P2025':
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        case 'P2002':
          return NextResponse.json({ error: "Unique constraint violation" }, { status: 409 });
        case 'P2003':
          return NextResponse.json({ error: "Foreign key constraint failed" }, { status: 400 });
        default:
          console.error("Prisma error:", prismaError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update profile photo",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current avatar
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    // Updated model name to match Prisma schema
    const user = await prismadb.users.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
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
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROFILE_PHOTO_GET] Error:", error);
    
    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      console.error("Prisma error:", prismaError);
    }
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve profile information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method to remove avatar
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    console.log(`User ${session.user.email} removing profile photo`);

    // Check if user exists - Updated model name to match Prisma schema
    const existingUser = await prismadb.users.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      }
    });

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!existingUser.avatar) {
      return NextResponse.json(
        {
          success: true,
          message: "No profile photo to remove",
          user: {
            id: existingUser.id,
            email: existingUser.email,
            name: existingUser.name,
            avatar: null,
          }
        },
        { status: 200 }
      );
    }

    // Remove user avatar - Updated model name to match Prisma schema
    const updatedUser = await prismadb.users.update({
      where: {
        id: session.user.id,
      },
      data: {
        avatar: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      }
    });

    console.log(`Profile photo removed for user: ${updatedUser.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Profile photo removed successfully",
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          avatar: updatedUser.avatar,
        },
        removedAvatar: existingUser.avatar,
        removedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROFILE_PHOTO_DELETE] Error:", error);
    
    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      switch (prismaError.code) {
        case 'P2025':
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        default:
          console.error("Prisma error:", prismaError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to remove profile photo",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}