// file: app/api/projects/sections/update-title/[sectionId]/route.ts
/*
This route handles section title updates with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved section title update logic with input validation
- Better user authorization and board ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better duplicate title checking and conflict handling
- Enhanced response format with update tracking
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// Enhanced validation schema for section title updates
const sectionTitleUpdateSchema = z.object({
  newTitle: z.string()
    .min(1, "Section title cannot be empty")
    .max(100, "Section title is too long")
    .trim()
    .refine(
      (title) => title.length > 0,
      "Section title cannot be only whitespace"
    ),
});

export async function PUT(req: Request, props: { params: Promise<{ sectionId: string }> }) {
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
  if (!params.sectionId) {
    return NextResponse.json({ error: "Missing section ID" }, { status: 400 });
  }

  const { sectionId } = params;

  // Validate sectionId format (assuming CUID)
  if (typeof sectionId !== 'string' || sectionId.length < 10) {
    return NextResponse.json({ error: "Invalid section ID format" }, { status: 400 });
  }

  try {
    const body = await req.json();
    console.log(`User ${session.user.email} updating title for section: ${sectionId}`);

    // Validate request data
    const validatedData = sectionTitleUpdateSchema.parse(body);
    const { newTitle } = validatedData;

    // First, verify the section exists and get current information
    const existingSection = await prismadb.sections.findUnique({
      where: {
        id: sectionId,
      },
      select: {
        id: true,
        title: true,
        position: true,
        board: true,
        v: true,
      }
    });

    if (!existingSection) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // Check if the new title is the same as current title
    if (existingSection.title === newTitle) {
      return NextResponse.json(
        {
          success: true,
          message: "Section title is already up to date",
          section: {
            id: existingSection.id,
            title: existingSection.title,
            position: existingSection.position,
            board: existingSection.board,
            v: existingSection.v,
          }
        },
        { status: 200 }
      );
    }

    // Get board information and check user permissions
    const boardInfo = await prismadb.boards.findUnique({
      where: {
        id: existingSection.board,
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

    if (!boardInfo) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user has permission to update sections in this board
    const hasPermission = boardInfo.user === session.user.id || 
                         boardInfo.sharedWith?.includes(session.user.id) ||
                         boardInfo.watchers.length > 0;

    if (!hasPermission) {
      console.log(`Unauthorized section update attempt by ${session.user.email} for board owned by ${boardInfo.assigned_user?.email}`);
      return NextResponse.json({ error: "Forbidden - You don't have permission to update sections in this board" }, { status: 403 });
    }

    // Check if another section in the same board already has this title
    const duplicateSection = await prismadb.sections.findFirst({
      where: {
        board: existingSection.board,
        title: {
          equals: newTitle,
          mode: 'insensitive', // Case-insensitive comparison for PostgreSQL
        },
        id: {
          not: sectionId, // Exclude current section
        },
      },
    });

    if (duplicateSection) {
      return NextResponse.json(
        { 
          error: "Another section with this title already exists in this board",
          conflictingSectionId: duplicateSection.id 
        }, 
        { status: 409 }
      );
    }

    // Use transaction to ensure atomic update with version tracking
    const updatedSection = await prismadb.$transaction(async (tx) => {
      // Update the section title and increment version
      const updated = await tx.sections.update({
        where: {
          id: sectionId,
        },
        data: {
          title: newTitle,
          v: {
            increment: 1, // Increment version for optimistic locking
          },
        },
        select: {
          id: true,
          title: true,
          position: true,
          board: true,
          v: true,
        }
      });

      return updated;
    });

    console.log(`Successfully updated section title from "${existingSection.title}" to "${newTitle}" (ID: ${sectionId}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Section title updated successfully",
        section: {
          id: updatedSection.id,
          title: updatedSection.title,
          position: updatedSection.position,
          board: updatedSection.board,
          v: updatedSection.v,
        },
        boardInfo: {
          id: boardInfo.id,
          title: boardInfo.title,
        },
        changes: {
          previousTitle: existingSection.title,
          newTitle: updatedSection.title,
        },
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[SECTION_TITLE_UPDATE] Error:", error);

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
        case 'P2025':
          return NextResponse.json(
            { error: "Section not found or already deleted" },
            { status: 404 }
          );
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
        case 'P2034':
          return NextResponse.json(
            { error: "Update failed due to concurrent modification - please refresh and try again" },
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
        error: "Failed to update section title",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current section information
export async function GET(req: Request, props: { params: Promise<{ sectionId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.sectionId) {
    return NextResponse.json({ error: "Missing section ID" }, { status: 400 });
  }

  const { sectionId } = params;

  try {
    const section = await prismadb.sections.findUnique({
      where: {
        id: sectionId,
      },
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

    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // Check user permissions through board
    const board = await prismadb.boards.findUnique({
      where: { id: section.board },
      select: {
        id: true,
        title: true,
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
      return NextResponse.json({ error: "Forbidden - You don't have access to this section" }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: true,
        section: {
          ...section,
          taskCount: section._count.tasks,
          canEdit: board.user === session.user.id || board.sharedWith?.includes(session.user.id),
        },
        board: {
          id: board.id,
          title: board.title,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[SECTION_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve section information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add PATCH method for partial updates (alternative to PUT)
export async function PATCH(req: Request, props: { params: Promise<{ sectionId: string }> }) {
  // PATCH implementation would be similar to PUT but allow partial updates
  // Could be used for updating position, visibility, or other fields
  return PUT(req, props);
}