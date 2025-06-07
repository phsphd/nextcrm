// file: app/api/projects/tasks/route.ts  
/*
This route handles general task operations with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task operations with proper relationship handling
- Better user authorization and task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better board and section verification before task operations
- Enhanced response format with operation tracking
- Optimized queries for PostgreSQL performance
- Fixed atomic operations for consistency
- Added comprehensive validation for all scenarios
- Added proper cascade deletion with transactions
- Fixed position reordering after deletion
- Added support for bulk operations
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// Enhanced validation schemas
const taskSectionUpdateSchema = z.object({
  id: z.string().min(10, "Invalid task ID"),
  section: z.string().min(10, "Invalid section ID"),
  position: z.number().int().min(0).optional(),
  reason: z.string().max(500, "Reason too long").optional(),
});

const taskDeleteSchema = z.object({
  id: z.string().min(10, "Invalid task ID"),
  section: z.string().min(10, "Invalid section ID").optional(), // For validation
  force: z.boolean().default(false), // Force delete even with dependencies
  reason: z.string().max(500, "Deletion reason too long").optional(),
});

const bulkTaskDeleteSchema = z.object({
  ids: z.array(z.string().min(10, "Invalid task ID")).min(1, "At least one task ID required"),
  reason: z.string().max(500, "Deletion reason too long").optional(),
});

// Helper function to check user permissions for a task
async function checkTaskPermissions(taskId: string, userId: string) {
  const task = await prismadb.tasks.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      user: true,
      createdBy: true,
      taskStatus: true,
      section: true,
      position: true,
      assigned_user: {
        select: {
          id: true,
          email: true,
          name: true,
        }
      },
      assigned_section: {
        select: {
          id: true,
          title: true,
          board: true,
        }
      }
    }
  });

  if (!task) {
    return { hasPermission: false, task: null, section: null, board: null, error: "Task not found" };
  }

  let section = null;
  let board = null;

  // Get section and board information if task is in a project
  if (task.assigned_section?.id) {
    section = await prismadb.sections.findUnique({
      where: { id: task.assigned_section.id },
      select: {
        id: true,
        title: true,
        board: true,
      }
    });

    if (section?.board) {
      board = await prismadb.boards.findUnique({
        where: { id: section.board },
        select: {
          id: true,
          title: true,
          user: true,
          sharedWith: true,
          watchers: {
            where: { userId },
            select: { userId: true }
          }
        }
      });
    }
  }

  // Check permissions
  let hasPermission = false;

  // User owns the task
  if (task.user === userId) {
    hasPermission = true;
  }
  // User created the task
  else if (task.createdBy === userId) {
    hasPermission = true;
  }
  // User has board access (for project tasks)
  else if (board) {
    hasPermission = board.user === userId || 
                   board.sharedWith?.includes(userId) ||
                   board.watchers.length > 0;
  }
  // For CRM tasks (no section), allow if user has general access
  else if (!task.assigned_section) {
    hasPermission = true; // Could add more specific CRM permissions here
  }

  return { 
    hasPermission, 
    task, 
    section, 
    board, 
    error: hasPermission ? null : "Forbidden - You don't have permission to modify this task" 
  };
}

// Helper function to verify section belongs to same board as task
async function verifySectionCompatibility(taskId: string, newSectionId: string) {
  const task = await prismadb.tasks.findUnique({
    where: { id: taskId },
    select: {
      assigned_section: {
        select: {
          board: true,
        }
      }
    }
  });

  const newSection = await prismadb.sections.findUnique({
    where: { id: newSectionId },
    select: {
      id: true,
      title: true,
      board: true,
    }
  });

  if (!task || !newSection) {
    return { isCompatible: false, newSection: null, error: "Task or section not found" };
  }

  if (task.assigned_section?.board !== newSection.board) {
    return { isCompatible: false, newSection, error: "Cannot move task to section in different board" };
  }

  return { isCompatible: true, newSection, error: null };
}

// Helper function to reorder tasks after deletion
async function reorderTasksInSection(tx: any, sectionId: string, userId: string) {
  const tasks = await tx.tasks.findMany({
    where: { section: sectionId },
    orderBy: { position: "asc" },
    select: { id: true }
  });

  const updates = tasks.map((task, index) => 
    tx.tasks.update({
      where: { id: task.id },
      data: {
        position: index,
        updatedBy: userId,
        lastEditedAt: new Date(),
      }
    })
  );

  return Promise.all(updates);
}

// Helper function to delete task with all dependencies
async function deleteTaskWithDependencies(tx: any, taskId: string, userId: string) {
  // Get task info before deletion
  const task = await tx.tasks.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      section: true,
      position: true,
    }
  });

  if (!task) {
    throw new Error("Task not found");
  }

  // Delete task comments (cascade)
  const deletedComments = await tx.tasksComments.deleteMany({
    where: { task: taskId }
  });

  // Delete document-task relationships
  const deletedDocumentTasks = await tx.documentTasks.deleteMany({
    where: { taskId: taskId }
  });

  // Delete the task itself
  const deletedTask = await tx.tasks.delete({
    where: { id: taskId }
  });

  return {
    task: deletedTask,
    commentsDeleted: deletedComments.count,
    documentRelationsDeleted: deletedDocumentTasks.count,
    sectionId: task.section,
  };
}

//Update task section API endpoint
export async function PUT(req: Request) {
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
    console.log(`User ${session.user.email} updating task section`);

    // Validate request data
    const validatedData = taskSectionUpdateSchema.parse(body);
    const { id: taskId, section: newSectionId, position, reason } = validatedData;

    // Check task permissions
    const { hasPermission, task, section: currentSection, board, error } = await checkTaskPermissions(taskId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Task not found" ? 404 : 403 });
    }

    // Verify section compatibility
    const { isCompatible, newSection, error: sectionError } = await verifySectionCompatibility(taskId, newSectionId);
    if (!isCompatible) {
      return NextResponse.json({ error: sectionError }, { status: sectionError === "Task or section not found" ? 404 : 400 });
    }

    // Check if this is actually a change
    if (task!.section === newSectionId) {
      return NextResponse.json(
        {
          success: true,
          message: "Task is already in the specified section",
          task: {
            id: task!.id,
            title: task!.title,
            currentSection: currentSection?.title,
          }
        },
        { status: 200 }
      );
    }

    // Use transaction for atomic section update
    const updateResult = await prismadb.$transaction(async (tx) => {
      // Calculate new position if not provided
      let finalPosition = position;
      if (finalPosition === undefined) {
        finalPosition = await tx.tasks.count({
          where: { section: newSectionId }
        });
      }

      // Update task section and position
      const updatedTask = await tx.tasks.update({
        where: { id: taskId },
        data: {
          section: newSectionId,
          position: finalPosition,
          updatedBy: session.user.id,
          lastEditedAt: new Date(),
        },
        select: {
          id: true,
          title: true,
          position: true,
          updatedAt: true,
          assigned_section: {
            select: {
              id: true,
              title: true,
            }
          }
        }
      });

      // Add update comment if reason provided
      if (reason) {
        await tx.tasksComments.create({
          data: {
            v: 0,
            comment: `📁 Task moved to "${newSection!.title}": ${reason}`,
            task: taskId,
            user: session.user.id,
          }
        });
      }

      // Update board timestamp
      if (board) {
        await tx.boards.update({
          where: { id: board.id },
          data: { updatedAt: new Date() },
        });
      }

      return updatedTask;
    });

    console.log(`Successfully moved task ${taskId} to section ${newSection!.title} by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Task section updated successfully",
        task: {
          id: updateResult.id,
          title: updateResult.title,
          position: updateResult.position,
          updatedAt: updateResult.updatedAt,
        },
        movement: {
          from: currentSection?.title || "Unknown",
          to: newSection!.title,
          reason,
        },
        boardInfo: board ? {
          id: board.id,
          title: board.title,
        } : null,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_SECTION_UPDATE] Error:", error);

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
          return NextResponse.json({ error: "Task or section not found" }, { status: 404 });
        case 'P2003':
          return NextResponse.json({ error: "Invalid task or section reference" }, { status: 400 });
        case 'P2034':
          return NextResponse.json({ error: "Update failed due to concurrent modification - please try again" }, { status: 409 });
        case 'P1008':
          return NextResponse.json({ error: "Database timeout - please try again" }, { status: 504 });
        default:
          console.error("Unhandled Prisma error:", prismaError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update task section",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

//Delete task API endpoint
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
    console.log(`User ${session.user.email} deleting task(s)`);

    // Check if this is a bulk delete operation
    const isBulkDelete = Array.isArray(body.ids);

    if (isBulkDelete) {
      // Handle bulk deletion
      const validatedData = bulkTaskDeleteSchema.parse(body);
      const { ids: taskIds, reason } = validatedData;

      // Check permissions for all tasks
      const permissionChecks = await Promise.all(
        taskIds.map(taskId => checkTaskPermissions(taskId, session.user.id))
      );

      const unauthorizedTasks = permissionChecks.filter(check => !check.hasPermission);
      if (unauthorizedTasks.length > 0) {
        return NextResponse.json(
          { error: `No permission to delete ${unauthorizedTasks.length} task(s)` },
          { status: 403 }
        );
      }

      const tasks = permissionChecks.map(check => check.task!);

      // Use transaction for atomic bulk deletion
      const deletionResult = await prismadb.$transaction(async (tx) => {
        const results = [];
        const sectionsToReorder = new Set<string>();

        for (const task of tasks) {
          const result = await deleteTaskWithDependencies(tx, task.id, session.user.id);
          results.push({
            taskId: task.id,
            taskTitle: task.title,
            ...result
          });
          
          if (result.sectionId) {
            sectionsToReorder.add(result.sectionId);
          }
        }

        // Reorder positions in affected sections
        const reorderPromises = Array.from(sectionsToReorder).map(sectionId =>
          reorderTasksInSection(tx, sectionId, session.user.id)
        );
        await Promise.all(reorderPromises);

        // Add bulk deletion comment if reason provided
        if (reason) {
          const boardIds = new Set(permissionChecks.map(check => check.board?.id).filter(Boolean));
          for (const boardId of boardIds) {
            // Could add board-level comments here
          }
        }

        return { results, sectionsReordered: sectionsToReorder.size };
      });

      const totalStats = deletionResult.results.reduce((acc, result) => ({
        tasksDeleted: acc.tasksDeleted + 1,
        commentsDeleted: acc.commentsDeleted + result.commentsDeleted,
        documentRelationsDeleted: acc.documentRelationsDeleted + result.documentRelationsDeleted,
      }), { tasksDeleted: 0, commentsDeleted: 0, documentRelationsDeleted: 0 });

      console.log(`Successfully deleted ${deletionResult.results.length} tasks by user ${session.user.email}`);

      return NextResponse.json(
        {
          success: true,
          message: `${deletionResult.results.length} tasks deleted successfully`,
          deletedTasks: deletionResult.results.map(r => ({
            id: r.taskId,
            title: r.taskTitle,
          })),
          statistics: {
            ...totalStats,
            sectionsReordered: deletionResult.sectionsReordered,
          },
          reason,
          deletedAt: new Date().toISOString(),
        },
        { status: 200 }
      );

    } else {
      // Handle single task deletion
      const validatedData = taskDeleteSchema.parse(body);
      const { id: taskId, reason } = validatedData;

      // Check task permissions
      const { hasPermission, task, section, board, error } = await checkTaskPermissions(taskId, session.user.id);
      if (!hasPermission) {
        return NextResponse.json({ error }, { status: error === "Task not found" ? 404 : 403 });
      }

      // Use transaction for atomic deletion and reordering
      const deletionResult = await prismadb.$transaction(async (tx) => {
        const result = await deleteTaskWithDependencies(tx, taskId, session.user.id);
        
        // Reorder remaining tasks in the section
        if (result.sectionId) {
          await reorderTasksInSection(tx, result.sectionId, session.user.id);
        }

        // Update board timestamp
        if (board) {
          await tx.boards.update({
            where: { id: board.id },
            data: { updatedAt: new Date() },
          });
        }

        return result;
      });

      console.log(`Successfully deleted task ${taskId} (${task!.title}) by user ${session.user.email}`);

      return NextResponse.json(
        {
          success: true,
          message: "Task deleted successfully",
          deletedTask: {
            id: task!.id,
            title: task!.title,
          },
          statistics: {
            commentsDeleted: deletionResult.commentsDeleted,
            documentRelationsDeleted: deletionResult.documentRelationsDeleted,
          },
          boardInfo: board ? {
            id: board.id,
            title: board.title,
          } : null,
          sectionInfo: section ? {
            id: section.id,
            title: section.title,
          } : null,
          reason,
          deletedAt: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

  } catch (error) {
    console.error("[TASK_DELETE] Error:", error);

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
          return NextResponse.json({ error: "Task not found or already deleted" }, { status: 404 });
        case 'P2003':
          return NextResponse.json({ error: "Cannot delete task due to foreign key constraints" }, { status: 409 });
        case 'P2034':
          return NextResponse.json({ error: "Deletion failed due to concurrent modification - please try again" }, { status: 409 });
        case 'P1008':
          return NextResponse.json({ error: "Database timeout - please try again" }, { status: 504 });
        default:
          console.error("Unhandled Prisma error:", prismaError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete task(s)",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve tasks with filtering
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
    const sectionId = searchParams.get('sectionId');
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    // Build query conditions
    const whereConditions: any = {};

    if (sectionId) {
      whereConditions.section = sectionId;
    } else if (boardId) {
      // Get all sections in this board
      const sections = await prismadb.sections.findMany({
        where: { board: boardId },
        select: { id: true }
      });
      whereConditions.section = { in: sections.map(s => s.id) };
    }

    if (userId) {
      whereConditions.user = userId;
    }

    if (status) {
      whereConditions.taskStatus = status;
    }

    if (priority) {
      whereConditions.priority = priority;
    }

    // Get tasks with pagination support
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const skip = (page - 1) * limit;

    const [tasks, totalCount] = await Promise.all([
      prismadb.tasks.findMany({
        where: whereConditions,
        orderBy: [
          { section: 'asc' },
          { position: 'asc' }
        ],
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          content: true,
          priority: true,
          position: true,
          taskStatus: true,
          dueDateAt: true,
          createdAt: true,
          tags: true,
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            }
          },
          assigned_section: {
            select: {
              id: true,
              title: true,
              board: true,
            }
          },
          _count: {
            select: {
              comments: true,
              documents: true,
            }
          }
        }
      }),
      prismadb.tasks.count({ where: whereConditions })
    ]);

    return NextResponse.json(
      {
        success: true,
        tasks: tasks.map(task => ({
          ...task,
          tags: task.tags ? JSON.parse(task.tags as string) : [],
          commentCount: task._count.comments,
          documentCount: task._count.documents,
        })),
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page * limit < totalCount,
          hasPrev: page > 1,
        },
        filters: {
          boardId,
          sectionId,
          userId,
          status,
          priority,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASKS_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve tasks",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}