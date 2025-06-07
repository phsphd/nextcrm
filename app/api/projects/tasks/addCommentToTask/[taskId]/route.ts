// file: app/api/projects/tasks/addCommentToTask/[taskId]/route.ts
/*
This route handles adding comments to tasks with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task comment logic with proper relationship handling
- Better user authorization and task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added atomic comment creation with transactions
- Better notification and email handling
- Enhanced response format with comment details
- Optimized queries for PostgreSQL performance
- Added comprehensive validation with Zod
- Fixed board watchers relationship handling
- Improved email notification efficiency
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

import NewTaskCommentEmail from "@/emails/NewTaskComment";
import resendHelper from "@/lib/resend";

// Enhanced validation schema for task comments
const taskCommentSchema = z.object({
  comment: z.string()
    .min(1, "Comment cannot be empty")
    .max(2000, "Comment is too long")
    .trim()
    .refine(
      (comment) => comment.length > 0,
      "Comment cannot be only whitespace"
    ),
  mentions: z.array(z.string().min(10, "Invalid user ID")).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
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
  // User is assigned to the task
  else if (task.assigned_user?.id === userId) {
    hasPermission = true;
  }
  // User has board access (for project tasks)
  else if (board) {
    hasPermission = board.user === userId || 
                   board.sharedWith?.includes(userId) ||
                   board.watchers.length > 0;
  }
  // For CRM tasks (no section), allow if user has general CRM access
  else if (!task.assigned_section) {
    hasPermission = true; // Could add more specific CRM permissions here
  }

  return { 
    hasPermission, 
    task, 
    section, 
    board, 
    error: hasPermission ? null : "Forbidden - You don't have permission to comment on this task" 
  };
}

// Helper function to get email recipients efficiently
async function getEmailRecipients(task: any, section: any, board: any, commenterId: string) {
  const recipients = new Set<string>();

  if (board) {
    // Get board watchers
    const boardWatchers = await prismadb.userWatchingBoards.findMany({
      where: { 
        boardId: board.id,
        userId: { not: commenterId }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            userLanguage: true,
          }
        }
      }
    });

    boardWatchers.forEach(watcher => {
      if (watcher.user.email) {
        recipients.add(JSON.stringify({
          id: watcher.user.id,
          email: watcher.user.email,
          name: watcher.user.name,
          userLanguage: watcher.user.userLanguage,
        }));
      }
    });

    // Add board owner
    if (board.user !== commenterId) {
      const boardOwner = await prismadb.users.findUnique({
        where: { id: board.user },
        select: {
          id: true,
          email: true,
          name: true,
          userLanguage: true,
        }
      });

      if (boardOwner?.email) {
        recipients.add(JSON.stringify(boardOwner));
      }
    }
  }

  // Add task creator
  if (task.createdBy && task.createdBy !== commenterId) {
    const taskCreator = await prismadb.users.findUnique({
      where: { id: task.createdBy },
      select: {
        id: true,
        email: true,
        name: true,
        userLanguage: true,
      }
    });

    if (taskCreator?.email) {
      recipients.add(JSON.stringify(taskCreator));
    }
  }

  // Add task assignee
  if (task.assigned_user?.id && task.assigned_user.id !== commenterId) {
    const assignee = await prismadb.users.findUnique({
      where: { id: task.assigned_user.id },
      select: {
        id: true,
        email: true,
        name: true,
        userLanguage: true,
      }
    });

    if (assignee?.email) {
      recipients.add(JSON.stringify(assignee));
    }
  }

  // Convert Set back to array of user objects
  return Array.from(recipients).map(recipient => JSON.parse(recipient));
}

export async function POST(
  req: Request,
  props: { params: Promise<{ taskId: string }> }
) {
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
    console.log(`User ${session.user.email} adding comment to task: ${taskId}`);

    // Validate request data
    const validatedData = taskCommentSchema.parse(body);
    const { comment, mentions, priority } = validatedData;

    // Check task permissions
    const { hasPermission, task, section, board, error } = await checkTaskPermissions(taskId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Task not found" ? 404 : 403 });
    }

    // Initialize resend for email notifications
    const resend = await resendHelper();

    // Use transaction to ensure atomic comment creation and board watcher update
    const commentResult = await prismadb.$transaction(async (tx) => {
      // Create the comment
      const newComment = await tx.tasksComments.create({
        data: {
          v: 0,
          comment: comment,
          task: taskId,
          user: session.user.id,
        },
        select: {
          id: true,
          comment: true,
          createdAt: true,
          v: true,
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          },
          assigned_task: {
            select: {
              id: true,
              title: true,
            }
          }
        }
      });

      // Add user as board watcher if this is a project task
      if (board) {
        // Check if user is already watching the board
        const existingWatcher = await tx.userWatchingBoards.findUnique({
          where: {
            userId_boardId: {
              userId: session.user.id,
              boardId: board.id,
            }
          }
        });

        if (!existingWatcher) {
          await tx.userWatchingBoards.create({
            data: {
              userId: session.user.id,
              boardId: board.id,
            }
          });
          console.log(`Added user ${session.user.email} as watcher to board ${board.id}`);
        }
      }

      // Update task's last activity
      await tx.tasks.update({
        where: { id: taskId },
        data: {
          lastEditedAt: new Date(),
          updatedBy: session.user.id,
        }
      });

      return newComment;
    });

    // Get email recipients (outside transaction for better performance)
    const emailRecipients = await getEmailRecipients(task, section, board, session.user.id);

    // Send email notifications
    if (emailRecipients.length > 0) {
      console.log(`Sending comment notifications to ${emailRecipients.length} recipients`);
      
      const emailPromises = emailRecipients.map(async (recipient) => {
        try {
          await resend.emails.send({
            from: `${process.env.NEXT_PUBLIC_APP_NAME} <${process.env.EMAIL_FROM}>`,
            to: recipient.email,
            subject: recipient.userLanguage === "en"
              ? `New comment on task ${task!.title}`
              : `Nový komentář k úkolu ${task!.title}`,
            text: `${session.user.name} commented: ${comment}`,
            react: NewTaskCommentEmail({
              commentFromUser: session.user.name!,
              username: recipient.name!,
              userLanguage: recipient.userLanguage!,
              taskId: task!.id,
              comment: comment,
            }),
          });
          console.log(`Email sent to: ${recipient.email}`);
        } catch (emailError) {
          console.error(`Failed to send email to ${recipient.email}:`, emailError);
        }
      });

      // Send emails in parallel but don't wait for them to complete
      Promise.allSettled(emailPromises).then(results => {
        const successful = results.filter(result => result.status === 'fulfilled').length;
        const failed = results.filter(result => result.status === 'rejected').length;
        console.log(`Email notifications: ${successful} successful, ${failed} failed`);
      });
    }

    console.log(`Successfully added comment to task ${taskId} by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Comment added successfully",
        comment: {
          id: commentResult.id,
          comment: commentResult.comment,
          createdAt: commentResult.createdAt,
          author: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          },
          task: {
            id: task!.id,
            title: task!.title,
          },
        },
        notifications: {
          emailsSent: emailRecipients.length,
          boardWatcherAdded: !!board,
        },
        boardInfo: board ? {
          id: board.id,
          title: board.title,
        } : null,
        sectionInfo: section ? {
          id: section.id,
          title: section.title,
        } : null,
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("[TASK_COMMENT_POST] Error:", error);

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
            { error: "Task not found" },
            { status: 404 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid task reference" },
            { status: 400 }
          );
        case 'P2002':
          return NextResponse.json(
            { error: "Duplicate watcher relationship" },
            { status: 409 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Comment creation failed due to concurrent modification - please try again" },
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
        error: "Failed to add comment to task",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve comments for a task
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
    const { hasPermission, task, error } = await checkTaskPermissions(params.taskId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Task not found" ? 404 : 403 });
    }

    // Get all comments for the task
    const comments = await prismadb.tasksComments.findMany({
      where: { task: params.taskId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        comment: true,
        createdAt: true,
        v: true,
        assigned_user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        }
      }
    });

    return NextResponse.json(
      {
        success: true,
        task: {
          id: task!.id,
          title: task!.title,
        },
        comments: comments.map(comment => ({
          id: comment.id,
          comment: comment.comment,
          createdAt: comment.createdAt,
          author: comment.assigned_user,
        })),
        totalComments: comments.length,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_COMMENTS_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve task comments",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}