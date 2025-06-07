// file: app/api/projects/tasks/update-kanban-position/route.ts
/*
This route handles updating task positions in a project board with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task position update logic with proper relationship handling
- Better user authorization and task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better board and section verification before task position update
- Fixed atomic operations to prevent inconsistent state
- Added comprehensive validation for kanban operations
- Optimized bulk updates for better performance
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// Enhanced validation schema for kanban position updates
const taskPositionSchema = z.object({
  id: z.string().min(10, "Invalid task ID"),
  title: z.string().optional(), // For validation purposes
  position: z.number().int().min(0).optional(), // May be calculated
});

const kanbanUpdateSchema = z.object({
  resourceList: z.array(taskPositionSchema)
    .min(0, "Resource list cannot be negative length")
    .max(100, "Too many tasks in resource list"),
  destinationList: z.array(taskPositionSchema)
    .min(0, "Destination list cannot be negative length")
    .max(100, "Too many tasks in destination list"),
  resourceSectionId: z.string()
    .min(10, "Invalid resource section ID"),
  destinationSectionId: z.string()
    .min(10, "Invalid destination section ID"),
  boardId: z.string()
    .min(10, "Invalid board ID")
    .optional(), // Will be derived from sections if not provided
});

// Helper function to check user permissions for sections and their board
async function checkSectionPermissions(sectionIds: string[], userId: string) {
  // Get all sections and their boards
  const sections = await prismadb.sections.findMany({
    where: { id: { in: sectionIds } },
    select: {
      id: true,
      title: true,
      board: true,
    }
  });

  if (sections.length !== sectionIds.length) {
    const foundIds = sections.map(s => s.id);
    const missingIds = sectionIds.filter(id => !foundIds.includes(id));
    return { hasPermission: false, sections: null, boards: null, error: `Sections not found: ${missingIds.join(', ')}` };
  }

  // Get unique board IDs
  const boardIds = [...new Set(sections.map(s => s.board))];
  
  if (boardIds.length > 1) {
    return { hasPermission: false, sections, boards: null, error: "Cannot move tasks between different boards" };
  }

  // Check permissions for the board
  const boards = await prismadb.boards.findMany({
    where: { id: { in: boardIds } },
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

  if (boards.length === 0) {
    return { hasPermission: false, sections, boards: null, error: "Board not found" };
  }

  const board = boards[0];
  const hasPermission = board.user === userId || 
                       board.sharedWith?.includes(userId) ||
                       board.watchers.length > 0;

  return { 
    hasPermission, 
    sections, 
    boards, 
    error: hasPermission ? null : "Forbidden - You don't have permission to move tasks in this board" 
  };
}

// Helper function to verify all tasks exist and belong to expected sections
async function verifyTasksAndSections(resourceList: any[], destinationList: any[], resourceSectionId: string, destinationSectionId: string) {
  const allTaskIds = [
    ...resourceList.map(t => t.id),
    ...destinationList.map(t => t.id)
  ];

  // Remove duplicates (task might appear in both lists during move)
  const uniqueTaskIds = [...new Set(allTaskIds)];

  const tasks = await prismadb.tasks.findMany({
    where: { id: { in: uniqueTaskIds } },
    select: {
      id: true,
      title: true,
      section: true,
      position: true,
      taskStatus: true,
    }
  });

  if (tasks.length !== uniqueTaskIds.length) {
    const foundIds = tasks.map(t => t.id);
    const missingIds = uniqueTaskIds.filter(id => !foundIds.includes(id));
    return { isValid: false, tasks: null, error: `Tasks not found: ${missingIds.join(', ')}` };
  }

  // Verify task sections are valid for the operation
  const validSectionIds = [resourceSectionId, destinationSectionId];
  const invalidTasks = tasks.filter(task => !validSectionIds.includes(task.section!));
  
  if (invalidTasks.length > 0) {
    return { 
      isValid: false, 
      tasks, 
      error: `Tasks not in expected sections: ${invalidTasks.map(t => t.title).join(', ')}` 
    };
  }

  return { isValid: true, tasks, error: null };
}

// Helper function to perform bulk position updates efficiently
async function updateTaskPositions(tx: any, tasks: any[], sectionId: string, userId: string) {
  const updates = tasks.map((task, index) => 
    tx.tasks.update({
      where: { id: task.id },
      data: {
        section: sectionId,
        position: index,
        updatedBy: userId,
        lastEditedAt: new Date(),
      }
    })
  );

  return Promise.all(updates);
}

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
    console.log(`User ${session.user.email} updating kanban task positions`);

    // Validate request data
    const validatedData = kanbanUpdateSchema.parse(body);
    const {
      resourceList,
      destinationList,
      resourceSectionId,
      destinationSectionId,
      boardId,
    } = validatedData;

    // Check if this is a move operation or just reordering
    const isMoveOperation = resourceSectionId !== destinationSectionId;
    
    // Verify sections exist and user has permissions
    const uniqueSectionIds = [...new Set([resourceSectionId, destinationSectionId])];
    const { hasPermission, sections, boards, error: permissionError } = await checkSectionPermissions(uniqueSectionIds, session.user.id);
    
    if (!hasPermission) {
      return NextResponse.json({ error: permissionError }, { status: permissionError?.includes("not found") ? 404 : 403 });
    }

    // Verify all tasks exist and belong to valid sections
    const { isValid: tasksValid, tasks, error: taskError } = await verifyTasksAndSections(
      resourceList, 
      destinationList, 
      resourceSectionId, 
      destinationSectionId
    );
    
    if (!tasksValid) {
      return NextResponse.json({ error: taskError }, { status: 400 });
    }

    // Prepare task lists for update (reverse for correct positioning)
    const resourceListReversed = [...resourceList].reverse();
    const destinationListReversed = [...destinationList].reverse();

    // Use transaction for atomic updates
    const updateResult = await prismadb.$transaction(async (tx) => {
      const updateStats = {
        resourceUpdates: 0,
        destinationUpdates: 0,
        totalTasks: 0,
      };

      // Update resource list positions (only if different from destination)
      if (isMoveOperation && resourceListReversed.length > 0) {
        await updateTaskPositions(tx, resourceListReversed, resourceSectionId, session.user.id);
        updateStats.resourceUpdates = resourceListReversed.length;
      }

      // Update destination list positions
      if (destinationListReversed.length > 0) {
        await updateTaskPositions(tx, destinationListReversed, destinationSectionId, session.user.id);
        updateStats.destinationUpdates = destinationListReversed.length;
      }

      updateStats.totalTasks = updateStats.resourceUpdates + updateStats.destinationUpdates;

      // Update board timestamp to trigger re-render
      if (boards && boards.length > 0) {
        await tx.boards.update({
          where: { id: boards[0].id },
          data: { updatedAt: new Date() },
        });
      }

      return updateStats;
    });

    const operationType = isMoveOperation ? "moved between sections" : "reordered within section";
    console.log(`Successfully ${operationType} ${updateResult.totalTasks} tasks by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Task positions updated successfully",
        operation: {
          type: isMoveOperation ? "move" : "reorder",
          resourceSection: sections?.find(s => s.id === resourceSectionId)?.title,
          destinationSection: sections?.find(s => s.id === destinationSectionId)?.title,
          tasksAffected: updateResult.totalTasks,
        },
        statistics: {
          resourceUpdates: updateResult.resourceUpdates,
          destinationUpdates: updateResult.destinationUpdates,
          totalUpdates: updateResult.totalTasks,
        },
        boardInfo: boards && boards.length > 0 ? {
          id: boards[0].id,
          title: boards[0].title,
        } : null,
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[KANBAN_POSITION_UPDATE] Error:", error);

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
            { error: "One or more tasks, sections, or board not found" },
            { status: 404 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid task, section, or board reference" },
            { status: 400 }
          );
        case 'P2002':
          return NextResponse.json(
            { error: "Position conflict detected - please refresh and try again" },
            { status: 409 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Position update failed due to concurrent modification - please refresh and try again" },
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
        error: "Failed to update task positions",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve current kanban state
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

    if (!boardId && !sectionId) {
      return NextResponse.json({ error: "Either boardId or sectionId is required" }, { status: 400 });
    }

    let whereConditions: any = {};

    if (sectionId) {
      // Get tasks for specific section
      whereConditions.section = sectionId;
      
      // Verify section permissions
      const { hasPermission, error } = await checkSectionPermissions([sectionId], session.user.id);
      if (!hasPermission) {
        return NextResponse.json({ error }, { status: 403 });
      }
    } else if (boardId) {
      // Get all tasks for board
      const sections = await prismadb.sections.findMany({
        where: { board: boardId },
        select: { id: true }
      });

      // Verify board permissions
      const { hasPermission, error } = await checkSectionPermissions(sections.map(s => s.id), session.user.id);
      if (!hasPermission) {
        return NextResponse.json({ error }, { status: 403 });
      }

      whereConditions.section = { in: sections.map(s => s.id) };
    }

    // Get tasks ordered by section and position
    const tasks = await prismadb.tasks.findMany({
      where: whereConditions,
      orderBy: [
        { section: 'asc' },
        { position: 'asc' }
      ],
      select: {
        id: true,
        title: true,
        content: true,
        priority: true,
        position: true,
        taskStatus: true,
        dueDateAt: true,
        section: true,
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
          }
        }
      }
    });

    // Group tasks by section
    const tasksBySection = tasks.reduce((acc, task) => {
      const sectionId = task.section!;
      if (!acc[sectionId]) {
        acc[sectionId] = [];
      }
      acc[sectionId].push(task);
      return acc;
    }, {} as Record<string, any[]>);

    return NextResponse.json(
      {
        success: true,
        kanbanState: {
          tasksBySection,
          totalTasks: tasks.length,
          sections: Object.keys(tasksBySection),
        },
        filters: {
          boardId,
          sectionId,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[KANBAN_STATE_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve kanban state",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}