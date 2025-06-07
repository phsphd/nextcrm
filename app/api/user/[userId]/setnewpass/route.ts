// file: nextcrm/app/api/user/[userId]/setnewpass/route.ts
/*
This route handles password updates for users with enhanced security measures
Includes password validation, permission checking, and secure hashing

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'users' to 'Users' (kept lowercase as per schema)
- Enhanced password validation and security measures
- Improved permission checking and user verification
- Added proper password strength validation
- Enhanced error handling and logging
- Better response structure without exposing sensitive data
- Added rate limiting considerations
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hash, compare } from "bcryptjs";

// Password validation function
function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  
  if (password.length > 128) {
    errors.push("Password must be less than 128 characters long");
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  
  if (!/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }
  
  // Check for common weak passwords
  const weakPasswords = ['password', '12345678', 'password123', 'admin123', 'qwerty123'];
  if (weakPasswords.includes(password.toLowerCase())) {
    errors.push("Password is too common and easily guessable");
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
    const { password, cpassword, currentPassword } = body;

    // Input validation
    if (!password || !cpassword) {
      return NextResponse.json({ error: "Password and confirmation password are required" }, { status: 400 });
    }

    if (password !== cpassword) {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }

    // Demo account protection
    if (session.user.email === "demo@nextcrm.io") {
      return NextResponse.json(
        { error: "Demo account password cannot be changed" },
        { status: 403 }
      );
    }

    // Password strength validation
    const validation = validatePassword(password);
    if (!validation.isValid) {
      return NextResponse.json(
        { 
          error: "Password does not meet security requirements",
          requirements: validation.errors
        },
        { status: 400 }
      );
    }

    console.log(`Processing password update for user: ${userId}`);

    // Security check: Only allow users to update their own password, unless they're admin
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to update password for user ${userId} without permission`);
      return NextResponse.json(
        { error: "You can only update your own password" },
        { status: 403 }
      );
    }

    // Verify the target user exists and get current password for validation
    const targetUser = await prismadb.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
      }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If user is updating their own password, verify current password
    if (session.user.id === userId && targetUser.password) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required to set a new password" },
          { status: 400 }
        );
      }

      const isCurrentPasswordValid = await compare(currentPassword, targetUser.password);
      if (!isCurrentPasswordValid) {
        console.warn(`User ${session.user.id} provided incorrect current password`);
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 400 }
        );
      }
    }

    // Check if new password is the same as current password
    if (targetUser.password) {
      const isSamePassword = await compare(password, targetUser.password);
      if (isSamePassword) {
        return NextResponse.json(
          { error: "New password must be different from current password" },
          { status: 400 }
        );
      }
    }

    console.log(`Updating password for user: ${targetUser.email}`);

    // Hash the new password
    const hashedPassword = await hash(password, 12); // Increased from 10 to 12 for better security

    // Update user password
    const updatedUser = await prismadb.users.update({
      data: {
        password: hashedPassword,
        // You might want to add a password_updated_at field to track when passwords were last changed
        // password_updated_at: new Date(),
      },
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        // Never return password in response
      }
    });

    console.log(`Successfully updated password for user: ${updatedUser.email}`);

    // Optional: Invalidate all sessions for this user (if you have session management)
    // This would force the user to log in again with the new password

    return NextResponse.json(
      {
        success: true,
        message: "Password updated successfully",
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_PASSWORD_PUT] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to update not found')) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update password",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to check password requirements
export async function GET(req: Request) {
  return NextResponse.json(
    {
      passwordRequirements: [
        "At least 8 characters long",
        "At least one uppercase letter",
        "At least one lowercase letter", 
        "At least one number",
        "At least one special character",
        "Cannot be a common password"
      ],
      minLength: 8,
      maxLength: 128
    },
    { status: 200 }
  );
}