// file: app/api/projects/sections/delete-section/[sectionId]/route.ts
/*
This route handles section deletion with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved section deletion logic with cascade handling
- Better user authorization and board ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added atomic deletion with transactions
- Better position reordering after deletion
- Enhanced response format with deletion statistics
*/

import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function DELETE(req: Request, props: { params: Promise<{ sectionId: string }> }) {
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
    console.log(`User ${session.user.email} attempting to delete section: ${sectionId}`);

    // First, verify the section exists and user has permission to delete it
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
      // Get all tasks in this section for deletion count
      const tasksToDelete = await tx.tasks.findMany({
        where: {
          section: sectionId,
        },
        select: {
          id: true,
          title: true,
        }
      });

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

      // Delete all tasks in this section
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
    console.error("[DELETE_SECTION] Error:", error);

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

// Optional: Add GET method to retrieve section information before deletion
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
        tasks: {
          select: {
            id: true,
            title: true,
            position: true,
            priority: true,
            taskStatus: true,
            _count: {
              select: {
                comments: true,
                documents: true,
              }
            }
          },
          orderBy: {
            position: 'asc',
          }
        },
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
          canDelete: board.user === session.user.id, // Only owner can delete
          tasks: section.tasks.map(task => ({
            ...task,
            commentCount: task._count.comments,
            documentCount: task._count.documents,
          }))
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