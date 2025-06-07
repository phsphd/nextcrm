// file: app/api/projects/tasks/update-task/[taskId]/route.ts
/*
This route handles updating a task with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task update logic with proper relationship handling
- Better user authorization and task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better board and section verification before task update
- Enhanced response format with task tracking
- Optimized queries for PostgreSQL performance
- Fixed atomic operations for consistency
- Added comprehensive validation for all scenarios
- Added support for update notes and change tracking
- Added notification system for task updates
- Fixed unnecessary section lookup and position counting
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

import UpdatedTaskFromProject from "@/emails/UpdatedTaskFromProject";
import resendHelper from "@/lib/resend";

// Enhanced validation schema for task updates
const taskUpdateSchema = z.object({
  title: z.string()
    .min(1, "Task title cannot be empty")
    .max(200, "Task title is too long")
    .trim(),
  user: z.string()
    .min(10, "Invalid user ID")
    .max(50, "User ID too long"),
  board: z.string()
    .min(10, "Invalid board ID")
    .max(50, "Board ID too long")
    .optional(), // For backward compatibility
  boardId: z.string()
    .min(10, "Invalid board ID")
    .max(50, "Board ID too long")
    .optional(), // For backward compatibility
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high', 'normal'])
    .transform(val => {
      const normalized = val.toLowerCase();
      if (normalized === 'normal') return 'MEDIUM';
      return normalized.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH';
    }),
  content: z.string()
    .max(5000, "Task content is too long")
    .default(""),
  notionUrl: z.string()
    .url("Invalid Notion URL")
    .optional(),
  dueDateAt: z.string()
    .datetime("Invalid date format")
    .transform(val => new Date(val))
    .optional()
    .nullable(),
  tags: z.array(z.string()).optional(),
  updateNotes: z.string()
    .max(1000, "Update notes are too long")
    .optional(),
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
      priority: true,
      content: true,
      dueDateAt: true,
      assigned_user: {
        select: {
          id: true,
          email: true,
          name: true,
          userLanguage: true,
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
    error: hasPermission ? null : "Forbidden - You don't have permission to update this task" 
  };
}

// Helper function to verify assigned user exists and is active
async function verifyAssignedUser(userId: string) {
  const user = await prismadb.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      userLanguage: true,
      userStatus: true,
    }
  });

  if (!user) {
    return { isValid: false, user: null, error: "Assigned user not found" };
  }

  if (user.userStatus !== 'ACTIVE') {
    return { isValid: false, user, error: "Cannot assign tasks to inactive user" };
  }

  return { isValid: true, user, error: null };
}

// Helper function to detect and track changes
function detectChanges(original: any, updated: any) {
  const changes: Array<{ field: string; from: any; to: any }> = [];

  const fieldsToCheck = ['title', 'priority', 'content', 'user', 'dueDateAt'];
  
  fieldsToCheck.forEach(field => {
    const originalValue = original[field];
    const updatedValue = updated[field];
    
    // Handle different data types
    if (field === 'dueDateAt') {
      const origDate = originalValue ? new Date(originalValue).toISOString() : null;
      const updDate = updatedValue ? new Date(updatedValue).toISOString() : null;
      if (origDate !== updDate) {
        changes.push({ field, from: origDate, to: updDate });
      }
    } else if (originalValue !== updatedValue) {
      changes.push({ field, from: originalValue, to: updatedValue });
    }
  });

  return changes;
}

export async function PUT(req: Request, props: { params: Promise<{ taskId: string }> }) {
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
  if (!params.taskId) {
    return NextResponse.json({ error: "Missing task ID" }, { status: 400 });
  }

  const { taskId } = params;

  // Validate taskId format (assuming CUID)
  if (typeof taskId !== 'string' || taskId.length < 10) {
    return NextResponse.json({ error: "Invalid task ID format" }, { status: 400 });
  }

  try {
    const body = await req.json();
    console.log(`User ${session.user.email} updating task: ${taskId}`);

    // Validate request data
    const validatedData = taskUpdateSchema.parse(body);
    const {
      title,
      user: assignedUserId,
      board,
      boardId,
      priority,
      content,
      notionUrl,
      dueDateAt,
      tags,
      updateNotes,
    } = validatedData;

    // Determine board ID (prefer boardId over board for clarity)
    const finalBoardId = boardId || board;

    // Check task permissions
    const { hasPermission, task, section, board: taskBoard, error } = await checkTaskPermissions(taskId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Task not found" ? 404 : 403 });
    }

    // If task is in a project, verify the board ID matches
    if (taskBoard && finalBoardId && taskBoard.id !== finalBoardId) {
      return NextResponse.json(
        { error: "Task does not belong to the specified board" },
        { status: 400 }
      );
    }

    // Verify assigned user exists and is active
    const { isValid: userValid, user: assignedUser, error: userError } = await verifyAssignedUser(assignedUserId);
    if (!userValid) {
      return NextResponse.json({ error: userError }, { status: userError === "Assigned user not found" ? 404 : 400 });
    }

    // Prepare content with Notion URL if provided
    let finalContent = content;
    if (notionUrl) {
      finalContent = `${content}\n\n📝 Notion: ${notionUrl}`;
    }

    // Detect changes for audit trail
    const changes = detectChanges(task, {
      title,
      priority,
      content: finalContent,
      user: assignedUserId,
      dueDateAt,
    });

    // Initialize resend for email notifications
    const resend = await resendHelper();

    // Use transaction for atomic task update
    const updateResult = await prismadb.$transaction(async (tx) => {
      // Update the task
      const updatedTask = await tx.tasks.update({
        where: { id: taskId },
        data: {
          title,
          priority,
          content: finalContent,
          user: assignedUserId,
          dueDateAt,
          updatedBy: session.user.id,
          lastEditedAt: new Date(),
          tags: tags ? JSON.stringify(tags) : undefined,
        },
        select: {
          id: true,
          title: true,
          content: true,
          priority: true,
          taskStatus: true,
          dueDateAt: true,
          updatedAt: true,
          tags: true,
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
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

      // Update board timestamp if this is a project task
      if (taskBoard || finalBoardId) {
        const boardIdToUpdate = taskBoard?.id || finalBoardId;
        await tx.boards.update({
          where: { id: boardIdToUpdate },
          data: { updatedAt: new Date() },
        });
      }

      // Add update comment if there are significant changes or update notes
      if (changes.length > 0 || updateNotes) {
        let commentText = "📝 Task updated:";
        
        if (updateNotes) {
          commentText += `\n${updateNotes}`;
        }
        
        if (changes.length > 0) {
          commentText += "\n\nChanges:";
          changes.forEach(change => {
            const fieldName = change.field === 'user' ? 'assignee' : change.field;
            commentText += `\n• ${fieldName}: ${change.from || 'none'} → ${change.to || 'none'}`;
          });
        }

        await tx.tasksComments.create({
          data: {
            v: 0,
            comment: commentText,
            task: taskId,
            user: session.user.id,
          }
        });
      }

      return updatedTask;
    });

    // Send email notification if task is assigned to someone other than updater
    if (assignedUserId !== session.user.id) {
      try {
        const boardData = taskBoard || (finalBoardId ? await prismadb.boards.findUnique({
          where: { id: finalBoardId }
        }) : null);

        await resend.emails.send({
          from: `${process.env.NEXT_PUBLIC_APP_NAME} <${process.env.EMAIL_FROM}>`,
          to: assignedUser!.email!,
          subject: assignedUser!.userLanguage === "en"
            ? `Task updated: ${title}`
            : `Úkol aktualizován: ${title}`,
          text: `${session.user.name} updated the task: ${title}`,
          react: UpdatedTaskFromProject({
            taskFromUser: session.user.name!,
            username: assignedUser!.name!,
            userLanguage: assignedUser!.userLanguage!,
            taskData: updateResult,
            boardData: boardData,
          }),
        });
        console.log(`Update notification sent to: ${assignedUser!.email}`);
      } catch (emailError) {
        console.error(`Failed to send update notification:`, emailError);
        // Don't fail the request if email fails
      }
    }

    console.log(`Successfully updated task ${taskId} (${title}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Task updated successfully",
        task: {
          id: updateResult.id,
          title: updateResult.title,
          content: updateResult.content,
          priority: updateResult.priority,
          status: updateResult.taskStatus,
          dueDate: updateResult.dueDateAt,
          tags: updateResult.tags ? JSON.parse(updateResult.tags as string) : [],
          assignedUser: updateResult.assigned_user,
          section: updateResult.assigned_section,
          updatedAt: updateResult.updatedAt,
        },
        changes: {
          fieldsChanged: changes.length,
          details: changes,
          hasUpdateNotes: !!updateNotes,
        },
        context: {
          boardInfo: taskBoard ? {
            id: taskBoard.id,
            title: taskBoard.title,
          } : null,
          sectionInfo: section ? {
            id: section.id,
            title: section.title,
          } : null,
        },
        notifications: {
          emailSent: assignedUserId !== session.user.id,
          assignedTo: assignedUser!.email,
        },
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_UPDATE] Error:", error);

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
            { error: "Task, board, or user not found" },
            { status: 404 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid task, board, or user reference" },
            { status: 400 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Task update failed due to concurrent modification - please refresh and try again" },
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
        error: "Failed to update task",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve task information before update
export async function GET(req: Request, props: { params: Promise<{ taskId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.taskId) {
    return NextResponse.json({ error: "Missing task ID" }, { status: 400 });
  }

  try {
    // Check task permissions
    const { hasPermission, task, section, board, error } = await checkTaskPermissions(params.taskId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Task not found" ? 404 : 403 });
    }

    return NextResponse.json(
      {
        success: true,
        task: {
          id: task!.id,
          title: task!.title,
          content: task!.content,
          priority: task!.priority,
          status: task!.taskStatus,
          dueDate: task!.dueDateAt,
          assignedUser: task!.assigned_user,
          canEdit: true, // User has permission if they reached this point
        },
        context: {
          boardInfo: board ? {
            id: board.id,
            title: board.title,
          } : null,
          sectionInfo: section ? {
            id: section.id,
            title: section.title,
          } : null,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve task information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}