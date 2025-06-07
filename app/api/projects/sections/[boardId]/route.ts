// file: app/api/projects/sections/[boardId]/route.ts
/*
This route handles section creation with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved section creation logic with input validation
- Better user authorization and board ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better position calculation and conflict handling
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// Enhanced validation schema for section creation
const sectionCreateSchema = z.object({
  title: z.string()
    .min(1, "Section title cannot be empty")
    .max(100, "Section title is too long")
    .trim()
    .refine(
      (title) => title.length > 0,
      "Section title cannot be only whitespace"
    ),
  position: z.number().int().min(0).optional(), // Allow manual position override
});

export async function POST(req: Request, props: { params: Promise<{ boardId: string }> }) {
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
  if (!params.boardId) {
    return NextResponse.json({ error: "Missing board ID" }, { status: 400 });
  }

  const { boardId } = params;

  // Validate boardId format (assuming CUID)
  if (typeof boardId !== 'string' || boardId.length < 10) {
    return NextResponse.json({ error: "Invalid board ID format" }, { status: 400 });
  }

  try {
    const body = await req.json();
    console.log(`User ${session.user.email} creating section in board: ${boardId}`);

    // Validate request data
    const validatedData = sectionCreateSchema.parse(body);
    const { title, position: manualPosition } = validatedData;

    // First, verify the board exists and user has permission to create sections
    const existingBoard = await prismadb.boards.findUnique({
      where: {
        id: boardId,
      },
      select: {
        id: true,
        title: true,
        user: true,
        sharedWith: true,
        assigned_user: {
          select: {
            id: true,
            email: true,
          }
        },
        watchers: {
          where: {
            userId: session.user.id,
          },
          select: {
            userId: true,
          }
        }
      }
    });

    if (!existingBoard) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user has permission to create sections in this board
    const hasPermission = existingBoard.user === session.user.id || 
                         existingBoard.sharedWith?.includes(session.user.id) ||
                         existingBoard.watchers.length > 0;

    if (!hasPermission) {
      console.log(`Unauthorized section creation attempt by ${session.user.email} for board owned by ${existingBoard.assigned_user?.email}`);
      return NextResponse.json({ error: "Forbidden - You don't have permission to create sections in this board" }, { status: 403 });
    }

    // Check if a section with the same title already exists in this board
    const existingSection = await prismadb.sections.findFirst({
      where: {
        board: boardId,
        title: {
          equals: title,
          mode: 'insensitive', // Case-insensitive comparison for PostgreSQL
        },
      },
    });

    if (existingSection) {
      return NextResponse.json(
        { 
          error: "Section with this title already exists in this board",
          existingSectionId: existingSection.id 
        }, 
        { status: 409 }
      );
    }

    // Use transaction to ensure atomic section creation with position calculation
    const newSection = await prismadb.$transaction(async (tx) => {
      // Calculate position - either use manual position or auto-calculate
      let sectionPosition: number;
      
      if (manualPosition !== undefined) {
        // If manual position is provided, use it but ensure it's valid
        const maxPosition = await tx.sections.count({
          where: { board: boardId },
        });
        sectionPosition = Math.min(manualPosition, maxPosition);
      } else {
        // Auto-calculate position as the next position
        sectionPosition = await tx.sections.count({
          where: { board: boardId },
        });
      }

      console.log(`Creating section "${title}" at position ${sectionPosition} in board ${boardId}`);

      // Create the new section
      const createdSection = await tx.sections.create({
        data: {
          v: 0,
          board: boardId,
          title: title,
          position: sectionPosition,
        },
        select: {
          id: true,
          title: true,
          position: true,
          board: true,
          v: true,
        }
      });

      return createdSection;
    });

    console.log(`Successfully created section "${newSection.title}" (ID: ${newSection.id}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Section created successfully",
        section: {
          id: newSection.id,
          title: newSection.title,
          position: newSection.position,
          board: newSection.board,
          v: newSection.v,
        },
        boardInfo: {
          id: existingBoard.id,
          title: existingBoard.title,
        },
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("[NEW_SECTION_POST] Error:", error);

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

    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      switch (prismaError.code) {
        case 'P2002':
          return NextResponse.json(
            { error: "Section with this title already exists in this board" },
            { status: 409 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid board reference - board may not exist" },
            { status: 400 }
          );
        case 'P2025':
          return NextResponse.json(
            { error: "Board not found" },
            { status: 404 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Transaction failed due to write conflict - please try again" },
            { status: 409 }
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

    // Handle connection errors
    if (error instanceof Error) {
      if (error.message.includes('connect') || error.message.includes('timeout')) {
        return NextResponse.json(
          { error: "Database connection error - please try again" },
          { status: 503 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to create section",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve all sections for a board
export async function GET(req: Request, props: { params: Promise<{ boardId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.boardId) {
    return NextResponse.json({ error: "Missing board ID" }, { status: 400 });
  }

  const { boardId } = params;

  try {
    // Verify user has access to this board
    const board = await prismadb.boards.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        user: true,
        sharedWith: true,
        watchers: {
          where: { userId: session.user.id },
          select: { userId: true }
        }
      }
    });

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    const hasAccess = board.user === session.user.id || 
                     board.sharedWith?.includes(session.user.id) ||
                     board.watchers.length > 0;

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden - You don't have access to this board" }, { status: 403 });
    }

    // Get all sections for this board, ordered by position
    const sections = await prismadb.sections.findMany({
      where: { board: boardId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        title: true,
        position: true,
        board: true,
        v: true,
        _count: {
          select: {
            tasks: true,
          }
        }
      }
    });

    return NextResponse.json(
      {
        success: true,
        sections: sections.map(section => ({
          ...section,
          taskCount: section._count.tasks,
        })),
        totalSections: sections.length,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[SECTIONS_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve sections",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}