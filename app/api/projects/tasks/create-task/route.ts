// file: app/api/projects/tasks/create-task/route.ts
/*
This route handles creating new tasks in projects with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task creation logic with proper relationship handling
- Better user authorization and task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added atomic task creation with transactions
- Better notification and email handling
- Enhanced response format with task details
- Optimized queries for PostgreSQL performance
- Added comprehensive validation with Zod
- Support for both Project and CRM task creation
- Improved email notification efficiency

NOTE: This route is similar to /api/projects/tasks/create-task/[boardId]/route.ts
Consider consolidating these routes for better maintainability.
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

import NewTaskFromCRMEmail from "@/emails/NewTaskFromCRM";
import NewTaskFromProject from "@/emails/NewTaskFromProject";
import resendHelper from "@/lib/resend";

// Enhanced validation schema for general task creation
const taskCreationSchema = z.object({
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
    .optional(), // Optional for CRM tasks
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
  account: z.string()
    .min(10, "Invalid account ID")
    .optional(), // For CRM tasks
  dueDateAt: z.string()
    .datetime("Invalid date format")
    .transform(val => new Date(val))
    .optional(),
  tags: z.array(z.string()).optional(),
  section: z.string()
    .min(10, "Invalid section ID")
    .optional(), // If not provided, will use first section
});

// Helper function to check user permissions for a board
async function checkBoardPermissions(boardId: string, userId: string) {
  const board = await prismadb.boards.findUnique({
    where: { id: boardId },
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
        where: { userId },
        select: { userId: true }
      }
    }
  });

  if (!board) {
    return { hasPermission: false, board: null, error: "Board not found" };
  }

  const hasPermission = board.user === userId || 
                       board.sharedWith?.includes(userId) ||
                       board.watchers.length > 0;

  return { hasPermission, board, error: hasPermission ? null : "Forbidden - You don't have permission to create tasks in this board" };
}

// Helper function to verify and get the target section
async function getTargetSection(boardId: string, sectionId?: string) {
  if (sectionId) {
    // Verify specific section exists and belongs to board
    const section = await prismadb.sections.findUnique({
      where: { id: sectionId },
      select: {
        id: true,
        title: true,
        board: true,
        position: true,
      }
    });

    if (!section) {
      return { section: null, error: "Section not found" };
    }

    if (section.board !== boardId) {
      return { section: null, error: "Section does not belong to the specified board" };
    }

    return { section, error: null };
  } else {
    // Get first section from board (lowest position)
    const section = await prismadb.sections.findFirst({
      where: { board: boardId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        board: true,
        position: true,
      }
    });

    if (!section) {
      return { section: null, error: "No sections found in board" };
    }

    return { section, error: null };
  }
}

// Helper function to verify user exists and can be assigned tasks
async function verifyTaskAssignee(userId: string) {
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

// Helper function to verify CRM account if provided
async function verifyCRMAccount(accountId: string, userId: string) {
  const account = await prismadb.crm_Accounts.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      assigned_to: true,
      assigned_to_user: {
        select: {
          id: true,
          name: true,
          email: true,
        }
      }
    }
  });

  if (!account) {
    return { isValid: false, account: null, error: "CRM account not found" };
  }

  // Check if user has access to this account
  const hasAccess = account.assigned_to === userId; // Add more access logic as needed

  return { isValid: hasAccess, account, error: hasAccess ? null : "No access to this CRM account" };
}

export async function POST(req: Request) {
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
    console.log(`User ${session.user.email} creating new task`);

    // Validate request data
    const validatedData = taskCreationSchema.parse(body);
    const {
      title,
      user: assignedUserId,
      board: boardId,
      priority,
      content,
      notionUrl,
      account: accountId,
      dueDateAt,
      tags,
      section: sectionId,
    } = validatedData;

    // Verify assigned user exists and is active
    const { isValid: userValid, user: assignedUser, error: userError } = await verifyTaskAssignee(assignedUserId);
    if (!userValid) {
      return NextResponse.json({ error: userError }, { status: userError === "Assigned user not found" ? 404 : 400 });
    }

    // Determine if this is a project task or CRM task
    const isProjectTask = !!boardId;
    const isCRMTask = !!accountId;

    let board = null;
    let section = null;
    let account = null;

    if (isProjectTask) {
      // Handle project task creation
      if (!boardId) {
        return NextResponse.json({ error: "Board ID is required for project tasks" }, { status: 400 });
      }

      // Check board permissions
      const { hasPermission, board: boardData, error: boardError } = await checkBoardPermissions(boardId, session.user.id);
      if (!hasPermission) {
        return NextResponse.json({ error: boardError }, { status: boardError === "Board not found" ? 404 : 403 });
      }
      board = boardData;

      // Get target section
      const { section: sectionData, error: sectionError } = await getTargetSection(boardId, sectionId);
      if (!sectionData) {
        return NextResponse.json({ error: sectionError }, { status: 404 });
      }
      section = sectionData;

    } else if (isCRMTask) {
      // Handle CRM task creation
      const { isValid: accountValid, account: accountData, error: accountError } = await verifyCRMAccount(accountId!, session.user.id);
      if (!accountValid) {
        return NextResponse.json({ error: accountError }, { status: accountError === "CRM account not found" ? 404 : 403 });
      }
      account = accountData;

    } else {
      return NextResponse.json({ error: "Either board ID (for project tasks) or account ID (for CRM tasks) is required" }, { status: 400 });
    }

    // Prepare content with Notion URL if provided
    let finalContent = content;
    if (notionUrl) {
      finalContent = `${content}\n\n📝 Notion: ${notionUrl}`;
    }

    // Initialize resend for email notifications
    const resend = await resendHelper();

    // Use transaction for atomic task creation
    const taskResult = await prismadb.$transaction(async (tx) => {
      let taskData: any = {
        v: 0,
        priority: priority,
        title: title,
        content: finalContent,
        dueDateAt: dueDateAt,
        createdBy: session.user.id,
        updatedBy: session.user.id,
        user: assignedUserId,
        taskStatus: "ACTIVE",
        tags: tags ? JSON.stringify(tags) : null,
      };

      if (isProjectTask && section) {
        // Get task count for position calculation
        const tasksCount = await tx.tasks.count({
          where: { section: section.id },
        });

        taskData = {
          ...taskData,
          section: section.id,
          position: tasksCount,
        };
      }

      // Create the task
      const newTask = await tx.tasks.create({
        data: taskData,
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

      // Update board if this is a project task
      if (isProjectTask && board) {
        await tx.boards.update({
          where: { id: board.id },
          data: { updatedAt: new Date() },
        });
      }

      // Create CRM account task relationship if this is a CRM task
      if (isCRMTask && account) {
        await tx.crm_Accounts_Tasks.create({
          data: {
            v: 0,
            title: title,
            content: finalContent,
            priority: priority,
            dueDateAt: dueDateAt,
            user: assignedUserId,
            account: account.id,
            taskStatus: "ACTIVE",
            createdBy: session.user.id,
            updatedBy: session.user.id,
          }
        });
      }

      return newTask;
    });

    // Send email notification if task is assigned to someone other than creator
    if (assignedUserId !== session.user.id) {
      try {
        const emailTemplate = isProjectTask ? NewTaskFromProject : NewTaskFromCRMEmail;
        const emailData = isProjectTask ? {
          taskFromUser: session.user.name!,
          username: assignedUser!.name!,
          userLanguage: assignedUser!.userLanguage!,
          taskData: taskResult,
          boardData: board!,
        } : {
          taskFromUser: session.user.name!,
          username: assignedUser!.name!,
          userLanguage: assignedUser!.userLanguage!,
          taskData: taskResult,
          accountData: account!,
        };

        await resend.emails.send({
          from: `${process.env.NEXT_PUBLIC_APP_NAME} <${process.env.EMAIL_FROM}>`,
          to: assignedUser!.email!,
          subject: assignedUser!.userLanguage === "en"
            ? `New task assigned: ${title}`
            : `Nový úkol přiřazen: ${title}`,
          text: `${session.user.name} assigned you a new task: ${title}`,
          react: emailTemplate(emailData as any),
        });
        console.log(`Email notification sent to: ${assignedUser!.email}`);
      } catch (emailError) {
        console.error(`Failed to send email notification:`, emailError);
        // Don't fail the request if email fails
      }
    }

    console.log(`Successfully created ${isProjectTask ? 'project' : 'CRM'} task ${taskResult.id} by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: `${isProjectTask ? 'Project' : 'CRM'} task created successfully`,
        task: {
          id: taskResult.id,
          title: taskResult.title,
          content: taskResult.content,
          priority: taskResult.priority,
          position: taskResult.position,
          status: taskResult.taskStatus,
          dueDate: taskResult.dueDateAt,
          tags: taskResult.tags ? JSON.parse(taskResult.tags as string) : [],
          assignedUser: taskResult.assigned_user,
          createdAt: taskResult.createdAt,
        },
        context: isProjectTask ? {
          type: "project",
          board: {
            id: board!.id,
            title: board!.title,
          },
          section: {
            id: section!.id,
            title: section!.title,
          }
        } : {
          type: "crm",
          account: {
            id: account!.id,
            name: account!.name,
          }
        },
        notifications: {
          emailSent: assignedUserId !== session.user.id,
          assignedTo: assignedUser!.email,
        },
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("[GENERAL_TASK_CREATE] Error:", error);

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
            { error: "Board, section, user, or account not found" },
            { status: 404 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid board, section, user, or account reference" },
            { status: 400 }
          );
        case 'P2002':
          return NextResponse.json(
            { error: "Task with this position already exists" },
            { status: 409 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Task creation failed due to concurrent modification - please try again" },
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
        error: "Failed to create task",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve tasks based on context
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
    const accountId = searchParams.get('accountId');
    const userId = searchParams.get('userId');

    if (!boardId && !accountId && !userId) {
      return NextResponse.json({ error: "At least one filter parameter is required (boardId, accountId, or userId)" }, { status: 400 });
    }

    // Build query conditions
    const whereConditions: any = {};

    if (boardId) {
      // Check board permissions first
      const { hasPermission, error } = await checkBoardPermissions(boardId, session.user.id);
      if (!hasPermission) {
        return NextResponse.json({ error }, { status: 403 });
      }

      // Get all sections in this board
      const sections = await prismadb.sections.findMany({
        where: { board: boardId },
        select: { id: true }
      });

      whereConditions.section = { in: sections.map(s => s.id) };
    }

    if (accountId) {
      // For CRM tasks, we'd need to check CRM account permissions
      // This is a simplified version
      whereConditions.user = session.user.id; // Only show user's own CRM tasks for now
    }

    if (userId) {
      whereConditions.user = userId;
    }

    // Get tasks
    const tasks = await prismadb.tasks.findMany({
      where: whereConditions,
      orderBy: [
        { createdAt: 'desc' }
      ],
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
    });

    return NextResponse.json(
      {
        success: true,
        tasks: tasks.map(task => ({
          ...task,
          tags: task.tags ? JSON.parse(task.tags as string) : [],
          commentCount: task._count.comments,
          documentCount: task._count.documents,
        })),
        totalTasks: tasks.length,
        filters: {
          boardId,
          accountId,
          userId,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[GENERAL_TASKS_GET] Error:", error);
    
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