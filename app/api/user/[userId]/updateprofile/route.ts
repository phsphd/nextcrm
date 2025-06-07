// file: nextcrm/app/api/user/[userId]/updateprofile/route.ts
/*
This route handles user profile updates including name, username, and account_name
Includes validation, permission checking, and proper error handling

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'users' to 'users' (kept lowercase as per schema)
- Enhanced security with proper permission checking
- Improved validation for profile fields
- Added proper error handling and logging
- Better response structure without exposing sensitive data
- Enhanced input validation and sanitization
- Added username uniqueness checking
- Removed unused bcrypt import
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Validation functions for profile fields
function validateUsername(username: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (username.length < 3) {
    errors.push("Username must be at least 3 characters long");
  }
  
  if (username.length > 30) {
    errors.push("Username must be less than 30 characters long");
  }
  
  // Username should only contain alphanumeric characters, underscores, and hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    errors.push("Username can only contain letters, numbers, underscores, and hyphens");
  }
  
  // Username should not start or end with special characters
  if (/^[-_]|[-_]$/.test(username)) {
    errors.push("Username cannot start or end with underscore or hyphen");
  }
  
  // Check for reserved usernames
  const reservedUsernames = ['admin', 'root', 'user', 'test', 'demo', 'api', 'www', 'mail', 'support'];
  if (reservedUsernames.includes(username.toLowerCase())) {
    errors.push("This username is reserved and cannot be used");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateName(name: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (name.length < 1) {
    errors.push("Name is required");
  }
  
  if (name.length > 100) {
    errors.push("Name must be less than 100 characters long");
  }
  
  // Name should not contain special characters except spaces, hyphens, and apostrophes
  if (!/^[a-zA-Z\s'-]+$/.test(name)) {
    errors.push("Name can only contain letters, spaces, hyphens, and apostrophes");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateAccountName(accountName: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (accountName && accountName.length > 100) {
    errors.push("Account name must be less than 100 characters long");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

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
    const { name, username, account_name } = body;

    // Input validation
    if (!name && !username && account_name === undefined) {
      return NextResponse.json(
        { error: "At least one field (name, username, or account_name) must be provided" },
        { status: 400 }
      );
    }

    console.log(`Processing profile update for user: ${userId}`);

    // Security check: Only allow users to update their own profile, unless they're admin
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to update profile for user ${userId} without permission`);
      return NextResponse.json(
        { error: "You can only update your own profile" },
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
        username: true,
        account_name: true,
        email: true,
      }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    console.log(`Updating profile for user: ${targetUser.email}`);

    // Prepare update data object
    const updateData: any = {};
    const validationErrors: string[] = [];

    // Validate and prepare name update
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return NextResponse.json({ error: "Name must be a string" }, { status: 400 });
      }
      
      const sanitizedName = name.trim();
      const nameValidation = validateName(sanitizedName);
      
      if (!nameValidation.isValid) {
        validationErrors.push(...nameValidation.errors);
      } else {
        updateData.name = sanitizedName;
      }
    }

    // Validate and prepare username update
    if (username !== undefined) {
      if (typeof username !== 'string') {
        return NextResponse.json({ error: "Username must be a string" }, { status: 400 });
      }
      
      const sanitizedUsername = username.trim().toLowerCase();
      const usernameValidation = validateUsername(sanitizedUsername);
      
      if (!usernameValidation.isValid) {
        validationErrors.push(...usernameValidation.errors);
      } else {
        // Check if username is already taken by another user
        if (sanitizedUsername !== targetUser.username) {
          const existingUser = await prismadb.users.findFirst({
            where: {
              username: sanitizedUsername,
              id: { not: userId }, // Exclude current user
            },
            select: { id: true }
          });

          if (existingUser) {
            validationErrors.push("This username is already taken");
          } else {
            updateData.username = sanitizedUsername;
          }
        }
      }
    }

    // Validate and prepare account_name update
    if (account_name !== undefined) {
      if (account_name !== null && typeof account_name !== 'string') {
        return NextResponse.json({ error: "Account name must be a string or null" }, { status: 400 });
      }
      
      if (account_name === null || account_name === '') {
        updateData.account_name = null;
      } else {
        const sanitizedAccountName = account_name.trim();
        const accountNameValidation = validateAccountName(sanitizedAccountName);
        
        if (!accountNameValidation.isValid) {
          validationErrors.push(...accountNameValidation.errors);
        } else {
          updateData.account_name = sanitizedAccountName;
        }
      }
    }

    // Return validation errors if any
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { 
          error: "Validation failed",
          details: validationErrors
        },
        { status: 400 }
      );
    }

    // Check if there are any actual changes
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { 
          success: true,
          message: "No changes to update",
          user: {
            id: targetUser.id,
            name: targetUser.name,
            username: targetUser.username,
            account_name: targetUser.account_name,
            email: targetUser.email,
          }
        },
        { status: 200 }
      );
    }

    // Update user profile
    const updatedUser = await prismadb.users.update({
      data: updateData,
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        username: true,
        account_name: true,
        email: true,
        // Don't return sensitive fields like password
      }
    });

    console.log(`Successfully updated profile for user: ${updatedUser.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
        updatedFields: Object.keys(updateData)
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_PROFILE_PUT] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to update not found')) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      
      if (error.message.includes('Unique constraint failed')) {
        return NextResponse.json(
          { error: "Username is already taken" },
          { status: 409 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update user profile",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current profile
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
    // Security check: Only allow users to view their own profile, unless they're admin
    if (session.user?.id !== userId && !session.user?.is_admin) {
      return NextResponse.json(
        { error: "You can only view your own profile" },
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
        username: true,
        account_name: true,
        email: true,
        avatar: true,
        userLanguage: true,
        userStatus: true,
        created_on: true,
        lastLoginAt: true,
        // Don't return sensitive fields
      }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        user: user
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_PROFILE_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve user profile",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}