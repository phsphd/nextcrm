// file: app/api/projects/[projectId]/route.ts
/*
This route handles project/board deletion with proper cascade handling and enhanced security
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved cascade deletion logic
- Better user authorization and validation
- Added proper logging and activity tracking
- Enhanced security with user ownership verification
*/

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prismadb } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

export async function DELETE(req: Request, props: { params: Promise<{ projectId: string }> }) {
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
  if (!params.projectId) {
    return NextResponse.json({ error: "Missing project ID" }, { status: 400 });
  }

  const boardId = params.projectId;

  // Validate boardId format (assuming CUID)
  if (typeof boardId !== 'string' || boardId.length < 10) {
    return NextResponse.json({ error: "Invalid project ID format" }, { status: 400 });
  }

  try {
    console.log(`User ${session.user.email} attempting to delete board: ${boardId}`);

    // First, verify the board exists and user has permission to delete it
    const existingBoard = await prismadb.boards.findUnique({
      where: {
        id: boardId,
      },
      select: {
        id: true,
        title: true,
        user: true,
        assigned_user: {
          select: {
            id: true,
            email: true,
          }
        }
      }
    });

    if (!existingBoard) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user owns the board or has permission to delete it
    if (existingBoard.user !== session.user.id) {
      console.log(`Unauthorized deletion attempt by ${session.user.email} for board owned by ${existingBoard.assigned_user?.email}`);
      return NextResponse.json({ error: "Forbidden - You don't have permission to delete this board" }, { status: 403 });
    }

    // Use PostgreSQL transaction for atomic deletion
    // This ensures all related data is deleted together or none at all
    const deletionResult = await prismadb.$transaction(async (tx) => {
      // Get all sections for this board
      const sections = await tx.sections.findMany({
        where: {
          board: boardId,
        },
        select: {
          id: true,
        }
      });

      const sectionIds = sections.map(section => section.id);

      // Delete all tasks in all sections of this board
      if (sectionIds.length > 0) {
        const deletedTasks = await tx.tasks.deleteMany({
          where: {
            section: {
              in: sectionIds,
            },
          },
        });
        console.log(`Deleted ${deletedTasks.count} tasks from board ${boardId}`);
      }

      // Delete all sections for this board
      const deletedSections = await tx.sections.deleteMany({
        where: {
          board: boardId,
        },
      });
      console.log(`Deleted ${deletedSections.count} sections from board ${boardId}`);

      // Delete any user watching relationships for this board
      const deletedWatchers = await tx.userWatchingBoards.deleteMany({
        where: {
          boardId: boardId,
        },
      });
      console.log(`Deleted ${deletedWatchers.count} watcher relationships for board ${boardId}`);

      // Finally, delete the board itself
      const deletedBoard = await tx.boards.delete({
        where: {
          id: boardId,
        },
      });

      return {
        board: deletedBoard,
        deletedTasksCount: sectionIds.length > 0 ? (await tx.tasks.count({ where: { section: { in: sectionIds } } })) : 0,
        deletedSectionsCount: deletedSections.count,
        deletedWatchersCount: deletedWatchers.count,
      };
    });

    console.log(`Successfully deleted board ${boardId} (${existingBoard.title}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Board deleted successfully",
        deletedBoard: {
          id: deletionResult.board.id,
          title: deletionResult.board.title,
        },
        statistics: {
          sectionsDeleted: deletionResult.deletedSectionsCount,
          watchersDeleted: deletionResult.deletedWatchersCount,
        },
        deletedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROJECT_DELETE] Error:", error);

    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      switch (prismaError.code) {
        case 'P2025':
          return NextResponse.json({ error: "Board not found or already deleted" }, { status: 404 });
        case 'P2003':
          return NextResponse.json({ error: "Cannot delete board due to foreign key constraints" }, { status: 409 });
        case 'P2034':
          return NextResponse.json({ error: "Transaction failed due to write conflict" }, { status: 409 });
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
        error: "Failed to delete board",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve board information before deletion
export async function GET(req: Request, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.projectId) {
    return NextResponse.json({ error: "Missing project ID" }, { status: 400 });
  }

  try {
    const board = await prismadb.boards.findUnique({
      where: {
        id: params.projectId,
      },
      include: {
        assigned_user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        watchers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              }
            }
          }
        },
        _count: {
          select: {
            watchers: true,
          }
        }
      }
    });

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user has access to view this board
    const hasAccess = board.user === session.user.id || 
                     board.sharedWith?.includes(session.user.id) ||
                     board.watchers.some(watcher => watcher.userId === session.user.id);

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden - You don't have access to this board" }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: true,
        board: {
          id: board.id,
          title: board.title,
          description: board.description,
          owner: board.assigned_user,
          watchers: board.watchers.map(w => w.user),
          watcherCount: board._count.watchers,
          canDelete: board.user === session.user.id, // Only owner can delete
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROJECT_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve board information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}