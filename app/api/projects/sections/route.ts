// file: app/api/projects/sections/route.ts
/*
This route handles section operations with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved section deletion logic with efficient cascade handling
- Better user authorization and board ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added atomic deletion with transactions
- Better position reordering after deletion
- Enhanced response format with deletion statistics
- Optimized queries to avoid fetching all tasks
*/

import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

// Enhanced validation schema for section deletion
const sectionDeleteSchema = z.object({
  id: z.string()
    .min(10, "Invalid section ID format")
    .max(50, "Section ID is too long"),
});

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);

  // Enhanced authentication check
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log(`User ${session.user.email} attempting to delete section via body request`);

    // Validate request data
    const validatedData = sectionDeleteSchema.parse(body);
    const { id: sectionId } = validatedData;

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
        _count: {
          select: {
            tasks: true,
          }
        }
      }
    });

    if (!existingSection) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    console.log(`Found section "${existingSection.title}" with ${existingSection._count.tasks} tasks`);

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

    // Check if user has permission to delete sections in this board
    const hasPermission = boardInfo.user === session.user.id || 
                         boardInfo.sharedWith?.includes(session.user.id) ||
                         boardInfo.watchers.length > 0;

    if (!hasPermission) {
      console.log(`Unauthorized section deletion attempt by ${session.user.email} for board owned by ${boardInfo.assigned_user?.email}`);
      return NextResponse.json({ error: "Forbidden - You don't have permission to delete sections in this board" }, { status: 403 });
    }

    // Use PostgreSQL transaction for atomic deletion and position reordering
    const deletionResult = await prismadb.$transaction(async (tx) => {
      // Get all tasks in this section for deletion tracking
      const tasksToDelete = await tx.tasks.findMany({
        where: {
          section: sectionId,
        },
        select: {
          id: true,
          title: true,
        }
      });

      console.log(`Found ${tasksToDelete.length} tasks to delete in section ${sectionId}`);

      // Delete all task comments first (if they exist)
      if (tasksToDelete.length > 0) {
        const taskIds = tasksToDelete.map(task => task.id);
        
        const deletedComments = await tx.tasksComments.deleteMany({
          where: {
            task: {
              in: taskIds,
            },
          },
        });
        console.log(`Deleted ${deletedComments.count} task comments from section ${sectionId}`);
      }

      // Delete all document relationships for tasks in this section
      if (tasksToDelete.length > 0) {
        const taskIds = tasksToDelete.map(task => task.id);
        
        const deletedDocumentTasks = await tx.documentTasks.deleteMany({
          where: {
            taskId: {
              in: taskIds,
            },
          },
        });
        console.log(`Deleted ${deletedDocumentTasks.count} document-task relationships from section ${sectionId}`);
      }

      // Delete all tasks in this section (more efficient than original loop)
      const deletedTasks = await tx.tasks.deleteMany({
        where: {
          section: sectionId,
        },
      });
      console.log(`Deleted ${deletedTasks.count} tasks from section ${sectionId}`);

      // Delete the section itself
      const deletedSection = await tx.sections.delete({
        where: {
          id: sectionId,
        },
      });

      // Reorder positions of remaining sections in the same board
      // Get all sections in the same board with position greater than deleted section
      const sectionsToReorder = await tx.sections.findMany({
        where: {
          board: existingSection.board,
          position: {
            gt: existingSection.position,
          },
        },
        select: {
          id: true,
          position: true,
        },
        orderBy: {
          position: 'asc',
        }
      });

      // Update positions to fill the gap
      for (const section of sectionsToReorder) {
        await tx.sections.update({
          where: {
            id: section.id,
          },
          data: {
            position: section.position - 1,
          },
        });
      }

      console.log(`Reordered ${sectionsToReorder.length} sections after deletion`);

      return {
        deletedSection,
        deletedTasks,
        tasksDeleted: tasksToDelete,
        sectionsReordered: sectionsToReorder.length,
      };
    });

    console.log(`Successfully deleted section ${sectionId} (${existingSection.title}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Section deleted successfully",
        deletedSection: {
          id: deletionResult.deletedSection.id,
          title: deletionResult.deletedSection.title,
          position: deletionResult.deletedSection.position,
        },
        boardInfo: {
          id: boardInfo.id,
          title: boardInfo.title,
        },
        statistics: {
          tasksDeleted: deletionResult.deletedTasks.count,
          sectionsReordered: deletionResult.sectionsReordered,
          taskTitles: deletionResult.tasksDeleted.map(task => task.title),
        },
        deletedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROJECT_SECTION_DELETE] Error:", error);

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
          return NextResponse.json({ error: "Section not found or already deleted" }, { status: 404 });
        case 'P2003':
          return NextResponse.json({ error: "Cannot delete section due to foreign key constraints" }, { status: 409 });
        case 'P2034':
          return NextResponse.json({ error: "Transaction failed due to write conflict - please try again" }, { status: 409 });
        case 'P1008':
          return NextResponse.json({ error: "Database timeout - please try again" }, { status: 504 });
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
        error: "Failed to delete section",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve all sections across boards (with filtering)
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const boardId = searchParams.get('boardId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where clause based on filters
    const whereClause: any = {};

    if (boardId) {
      // If boardId is specified, check user has access to that board
      const board = await prismadb.boards.findUnique({
        where: { id: boardId },
        select: {
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

      whereClause.board = boardId;
    } else {
      // Get all boards user has access to
      const accessibleBoards = await prismadb.boards.findMany({
        where: {
          OR: [
            { user: session.user.id },
            { sharedWith: { has: session.user.id } },
            { watchers: { some: { userId: session.user.id } } }
          ]
        },
        select: { id: true }
      });

      whereClause.board = {
        in: accessibleBoards.map(board => board.id)
      };
    }

    // Get sections with pagination
    const sections = await prismadb.sections.findMany({
      where: whereClause,
      orderBy: [
        { board: 'asc' },
        { position: 'asc' }
      ],
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
      },
      skip: offset,
      take: limit,
    });

    // Get total count for pagination
    const totalSections = await prismadb.sections.count({
      where: whereClause,
    });

    return NextResponse.json(
      {
        success: true,
        sections: sections.map(section => ({
          ...section,
          taskCount: section._count.tasks,
        })),
        pagination: {
          total: totalSections,
          limit,
          offset,
          hasMore: offset + limit < totalSections,
        }
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