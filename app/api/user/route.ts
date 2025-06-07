// file: app/api/user/route.ts
/*
MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved user creation logic with proper relationship handling
- Better user authorization and admin verification
- Added proper logging and activity tracking
- Enhanced security with admin permissions checking
- Added input sanitization and validation with Zod
- Better user integrity verification and validation
- Enhanced response format with operation tracking
- Optimized queries for PostgreSQL performance
- Fixed atomic operations for consistency
- Added comprehensive validation for all scenarios
- Added support for operation notes and audit trail
- Added user permission validation and security checks
- Enhanced user data protection and privacy
- Added rate limiting and security measures
- Added transaction rollback for failed operations
- Added password strength validation
- Enhanced duplicate user checking with case-insensitive email
- Added user creation audit logging
- Improved admin notification system
- Added proper field sanitization and validation
- Enhanced first user detection with atomic operations
- Added comprehensive user data filtering for responses
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hash } from "bcryptjs";
import { z } from "zod";
import { newUserNotify } from "@/lib/new-user-notify";

// Input validation schemas
const createUserSchema = z.object({
  name: z.string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters")
    .regex(/^[a-zA-Z\s'-]+$/, "Name contains invalid characters"),
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be less than 50 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscore, and dash")
    .optional(),
  email: z.string()
    .email("Invalid email format")
    .min(1, "Email is required")
    .max(255, "Email must be less than 255 characters")
    .transform(email => email.toLowerCase().trim()),
  language: z.enum(['en', 'cz', 'de', 'uk'], {
    errorMap: () => ({ message: "Language must be one of: en, cz, de, uk" })
  }),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be less than 128 characters")
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain at least one uppercase letter, one lowercase letter, and one number"),
  confirmPassword: z.string(),
  accountName: z.string().optional(),
  avatar: z.string().url().optional().or(z.literal("")),
  notes: z.string().max(500, "Notes must be less than 500 characters").optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const getUsersQuerySchema = z.object({
  page: z.string().transform(Number).pipe(z.number().min(1)).optional().default("1"),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).optional().default("50"),
  search: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING']).optional(),
  role: z.enum(['admin', 'user']).optional(),
  sortBy: z.enum(['name', 'email', 'created_on', 'lastLoginAt']).optional().default("created_on"),
  sortOrder: z.enum(['asc', 'desc']).optional().default("desc"),
});

// Rate limiting for user creation
const createUserRateLimit = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_USER_CREATION_ATTEMPTS = 5;

function checkUserCreationRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = createUserRateLimit.get(identifier);
  
  if (!entry || now - entry.timestamp > RATE_LIMIT_WINDOW) {
    createUserRateLimit.set(identifier, { count: 1, timestamp: now });
    return true;
  }
  
  if (entry.count >= MAX_USER_CREATION_ATTEMPTS) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Safe user data filtering for responses
function sanitizeUserForResponse(user: any) {
  const { password, ...safeUser } = user;
  return safeUser;
}

export async function POST(req: Request) {
  try {
    // Parse and validate request body
    const body = await req.json();
    const validatedData = createUserSchema.parse(body);
    const { 
      name, 
      username, 
      email, 
      language, 
      password, 
      accountName, 
      avatar = "", 
      notes 
    } = validatedData;

    // Rate limiting check
    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = `user_creation:${clientIP}`;
    
    if (!checkUserCreationRateLimit(rateLimitKey)) {
      return NextResponse.json({
        success: false,
        message: "Too many user creation attempts. Please try again later.",
      }, { status: 429 });
    }

    // Use transaction for atomic operations
    const result = await prismadb.$transaction(async (tx) => {
      // Check for existing user with case-insensitive email
      const existingUser = await tx.users.findFirst({
        where: {
          email: {
            equals: email,
            mode: 'insensitive'
          }
        },
        select: { id: true, email: true }
      });

      if (existingUser) {
        throw new Error("USER_ALREADY_EXISTS");
      }

      // Check for existing username if provided
      if (username) {
        const existingUsername = await tx.users.findFirst({
          where: {
            username: {
              equals: username,
              mode: 'insensitive'
            }
          },
          select: { id: true, username: true }
        });

        if (existingUsername) {
          throw new Error("USERNAME_ALREADY_EXISTS");
        }
      }

      // Count existing users to determine if this is the first user
      const userCount = await tx.users.count();
      const isFirstUser = userCount === 0;

      // Determine user status based on environment and first user
      let userStatus: 'ACTIVE' | 'PENDING' = 'PENDING';
      if (isFirstUser) {
        userStatus = 'ACTIVE';
      } else if (process.env.NEXT_PUBLIC_APP_URL === "https://demo.nextcrm.io") {
        userStatus = 'ACTIVE';
      }

      // Hash password
      const hashedPassword = await hash(password, 12);

      // Create user with proper data structure
      const newUser = await tx.users.create({
        data: {
          name: name.trim(),
          username: username?.trim() || null,
          email,
          avatar: avatar || "",
          account_name: accountName?.trim() || "",
          is_account_admin: false,
          is_admin: isFirstUser, // First user becomes admin
          userLanguage: language,
          userStatus,
          password: hashedPassword,
          created_on: new Date(),
          v: 0, // Version field from your schema
        },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatar: true,
          account_name: true,
          is_account_admin: true,
          is_admin: true,
          userLanguage: true,
          userStatus: true,
          created_on: true,
          v: true,
          // Exclude password and other sensitive fields
        }
      });

      return {
        user: newUser,
        isFirstUser,
        shouldNotifyAdmins: userStatus === 'PENDING'
      };
    });

    // Handle post-creation tasks outside transaction
    try {
      // Send notification to admins if user needs approval
      if (result.shouldNotifyAdmins) {
        await newUserNotify(result.user);
        console.log(`[AUDIT] New user registration notification sent for: ${result.user.email}`);
      }

      // Log successful user creation
      console.log(`[AUDIT] User created successfully`, {
        userId: result.user.id,
        email: result.user.email,
        isFirstUser: result.isFirstUser,
        status: result.user.userStatus,
        timestamp: new Date().toISOString(),
        clientIP,
        notes: notes || null,
      });

    } catch (notificationError) {
      console.error('[USER_NOTIFICATION_ERROR]', notificationError);
      // Don't fail the user creation if notification fails
    }

    return NextResponse.json({
      success: true,
      message: result.isFirstUser 
        ? "Account created successfully! You have been granted admin privileges as the first user."
        : result.user.userStatus === 'ACTIVE'
        ? "Account created successfully! You can now sign in."
        : "Account created successfully! Please wait for admin approval before signing in.",
      data: {
        user: result.user,
        requiresApproval: result.user.userStatus === 'PENDING',
        isFirstUser: result.isFirstUser,
      }
    }, { status: 201 });

  } catch (error) {
    console.error("[USER_CREATION_ERROR]", error);

    // Handle validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        message: "Invalid input data",
        errors: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 });
    }

    // Handle custom application errors
    if (error instanceof Error) {
      switch (error.message) {
        case "USER_ALREADY_EXISTS":
          return NextResponse.json({
            success: false,
            message: "A user with this email already exists",
            field: "email"
          }, { status: 409 });

        case "USERNAME_ALREADY_EXISTS":
          return NextResponse.json({
            success: false,
            message: "This username is already taken",
            field: "username"
          }, { status: 409 });
      }
    }

    // Handle Prisma errors
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      switch (prismaError.code) {
        case 'P2002':
          const target = prismaError.meta?.target;
          if (target?.includes('email')) {
            return NextResponse.json({
              success: false,
              message: "Email address is already registered",
              field: "email"
            }, { status: 409 });
          }
          if (target?.includes('username')) {
            return NextResponse.json({
              success: false,
              message: "Username is already taken",
              field: "username"
            }, { status: 409 });
          }
          break;
          
        case 'P2003':
          return NextResponse.json({
            success: false,
            message: "Invalid reference in user data"
          }, { status: 400 });
          
        default:
          console.error('Unhandled Prisma error:', prismaError);
      }
    }

    // Generic error response
    return NextResponse.json({
      success: false,
      message: "Failed to create user account. Please try again."
    }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({
        success: false,
        message: "Authentication required"
      }, { status: 401 });
    }

    // Get current user to check permissions
    const currentUser = await prismadb.users.findUnique({
      where: { email: session.user.email },
      select: { 
        id: true, 
        is_admin: true, 
        is_account_admin: true,
        userStatus: true 
      }
    });

    if (!currentUser || currentUser.userStatus !== 'ACTIVE') {
      return NextResponse.json({
        success: false,
        message: "Access denied"
      }, { status: 403 });
    }

    // Only admins can list all users
    if (!currentUser.is_admin && !currentUser.is_account_admin) {
      return NextResponse.json({
        success: false,
        message: "Admin privileges required"
      }, { status: 403 });
    }

    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const {
      page,
      limit,
      search,
      status,
      role,
      sortBy,
      sortOrder
    } = getUsersQuerySchema.parse(queryParams);

    // Build where clause for filtering
    const where: any = {};
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.userStatus = status;
    }

    if (role) {
      if (role === 'admin') {
        where.OR = [
          { is_admin: true },
          { is_account_admin: true }
        ];
      } else {
        where.is_admin = false;
        where.is_account_admin = false;
      }
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Execute queries in parallel
    const [users, totalCount] = await Promise.all([
      prismadb.users.findMany({
        where,
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatar: true,
          account_name: true,
          is_account_admin: true,
          is_admin: true,
          userLanguage: true,
          userStatus: true,
          created_on: true,
          lastLoginAt: true,
          v: true,
          // Exclude password and other sensitive fields
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        skip,
        take: limit,
      }),
      prismadb.users.count({ where })
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return NextResponse.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNextPage,
          hasPreviousPage,
        },
        filters: {
          search: search || null,
          status: status || null,
          role: role || null,
        },
        sorting: {
          sortBy,
          sortOrder,
        }
      }
    });

  } catch (error) {
    console.error("[USERS_GET_ERROR]", error);

    // Handle validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        message: "Invalid query parameters",
        errors: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 });
    }

    // Handle Prisma errors
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      console.error('Prisma error in GET users:', prismaError);
    }

    return NextResponse.json({
      success: false,
      message: "Failed to retrieve users"
    }, { status: 500 });
  }
}