// file: app/api/projects/tasks/create-task/[boardId]/route.ts
/*
This route handles creating a new task in a project board with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task creation logic with proper relationship handling
- Better user authorization and task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better board and section verification before task creation
- Enhanced response format with task tracking
- Optimized queries for PostgreSQL performance
- Fixed atomic operations for consistency
- Added comprehensive validation for all scenarios
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

import NewTaskFromProject from "@/emails/NewTaskFromProject";
import resendHelper from "@/lib/resend";

// Enhanced validation schemas for task creation
const quickTaskSchema = z.object({
  section: z.string().min(10, "Invalid section ID"),
  boardId: z.string().min(10, "Invalid board ID").optional(),
});

const fullTaskSchema = z.object({
  title: z.string()
    .min(1, "Task title cannot be empty")
    .max(200, "Task title is too long")
    .trim(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high', 'normal'])
    .transform(val => val.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH')
    .refine(val => ['LOW', 'MEDIUM', 'HIGH'].includes(val), "Invalid priority"),
  content: z.string()
    .max(5000, "Task content is too long")
    .optional()
    .default(""),
  section: z.string().min(10, "Invalid section ID"),
  user: z.string().min(10, "Invalid user ID"),
  dueDateAt: z.string()
    .datetime("Invalid date format")
    .transform(val => new Date(val))
    .optional(),
  tags: z.array(z.string()).optional(),
  boardId: z.string().min(10, "Invalid board ID").optional(),
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

// Helper function to verify section belongs to board
async function verifySectionInBoard(sectionId: string, boardId: string) {
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
    return { isValid: false, section: null, error: "Section not found" };
  }

  if (section.board !== boardId) {
    return { isValid: false, section, error: "Section does not belong to the specified board" };
  }

  return { isValid: true, section, error: null };
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
    console.log(`User ${session.user.email} creating task in board: ${boardId}`);

    // Check board permissions first
    const { hasPermission, board, error: boardError } = await checkBoardPermissions(boardId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error: boardError }, { status: boardError === "Board not found" ? 404 : 403 });
    }

    // Determine if this is a quick task creation or full task creation
    const isQuickTask = !body.title || !body.user || !body.priority || !body.content;

    if (isQuickTask) {
      // Quick task creation (empty task placeholder)
      const validatedData = quickTaskSchema.parse({ 
        section: body.section, 
        boardId: body.boardId || boardId 
      });

      // Verify section belongs to board
      const { isValid: sectionValid, section, error: sectionError } = await verifySectionInBoard(validatedData.section, boardId);
      if (!sectionValid) {
        return NextResponse.json({ error: sectionError }, { status: sectionError === "Section not found" ? 404 : 400 });
      }

      // Use transaction for atomic task creation and board update
      const taskResult = await prismadb.$transaction(async (tx) => {
        // Get current task count for position calculation
        const tasksCount = await tx.tasks.count({
          where: { section: validatedData.section },
        });

        // Create quick task
        const newTask = await tx.tasks.create({
          data: {
            v: 0,
            priority: "MEDIUM", // Use enum value instead of string
            title: "New task",
            content: "",
            section: validatedData.section,
            createdBy: session.user.id,
            updatedBy: session.user.id,
            position: tasksCount,
            user: session.user.id,
            taskStatus: "ACTIVE",
          },
          select: {
            id: true,
            title: true,
            priority: true,
            position: true,
            taskStatus: true,
            createdAt: true,
          }
        });

        // Update board's updatedAt to trigger re-render
        await tx.boards.update({
          where: { id: boardId },
          data: { updatedAt: new Date() },
        });

        return newTask;
      });

      console.log(`Successfully created quick task ${taskResult.id} in section ${section!.title} by user ${session.user.email}`);

      return NextResponse.json(
        {
          success: true,
          message: "Quick task created successfully",
          task: {
            id: taskResult.id,
            title: taskResult.title,
            priority: taskResult.priority,
            position: taskResult.position,
            status: taskResult.taskStatus,
            createdAt: taskResult.createdAt,
          },
          boardInfo: {
            id: board!.id,
            title: board!.title,
          },
          sectionInfo: {
            id: section!.id,
            title: section!.title,
          },
        },
        { status: 201 }
      );

    } else {
      // Full task creation with all details
      const validatedData = fullTaskSchema.parse({ 
        ...body, 
        boardId: body.boardId || boardId 
      });

      // Verify section belongs to board
      const { isValid: sectionValid, section, error: sectionError } = await verifySectionInBoard(validatedData.section, boardId);
      if (!sectionValid) {
        return NextResponse.json({ error: sectionError }, { status: sectionError === "Section not found" ? 404 : 400 });
      }

      // Verify assigned user exists and is active
      const { isValid: userValid, user: assignedUser, error: userError } = await verifyTaskAssignee(validatedData.user);
      if (!userValid) {
        return NextResponse.json({ error: userError }, { status: userError === "Assigned user not found" ? 404 : 400 });
      }

      // Initialize resend for email notifications
      const resend = await resendHelper();

      // Use transaction for atomic task creation and board update
      const taskResult = await prismadb.$transaction(async (tx) => {
        // Get current task count for position calculation
        const tasksCount = await tx.tasks.count({
          where: { section: validatedData.section },
        });

        // Create full task
        const newTask = await tx.tasks.create({
          data: {
            v: 0,
            priority: validatedData.priority,
            title: validatedData.title,
            content: validatedData.content,
            dueDateAt: validatedData.dueDateAt,
            section: validatedData.section,
            createdBy: session.user.id, // Task creator is the session user
            updatedBy: session.user.id,
            position: tasksCount,
            user: validatedData.user, // Assigned user
            taskStatus: "ACTIVE",
            tags: validatedData.tags ? JSON.stringify(validatedData.tags) : null,
          },
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
            }
          }
        });

        // Update board's updatedAt to trigger re-render
        await tx.boards.update({
          where: { id: boardId },
          data: { updatedAt: new Date() },
        });

        return newTask;
      });

      // Send email notification if task is assigned to someone other than creator
      if (validatedData.user !== session.user.id) {
        try {
          await resend.emails.send({
            from: `${process.env.NEXT_PUBLIC_APP_NAME} <${process.env.EMAIL_FROM}>`,
            to: assignedUser!.email!,
            subject: assignedUser!.userLanguage === "en"
              ? `New task assigned: ${validatedData.title}`
              : `Nový úkol přiřazen: ${validatedData.title}`,
            text: `${session.user.name} assigned you a new task: ${validatedData.title}`,
            react: NewTaskFromProject({
              taskFromUser: session.user.name!,
              username: assignedUser!.name!,
              userLanguage: assignedUser!.userLanguage!,
              taskData: taskResult,
              boardData: board!,
            }),
          });
          console.log(`Email notification sent to: ${assignedUser!.email}`);
        } catch (emailError) {
          console.error(`Failed to send email notification:`, emailError);
          // Don't fail the request if email fails
        }
      }

      console.log(`Successfully created full task ${taskResult.id} in section ${section!.title} by user ${session.user.email}`);

      return NextResponse.json(
        {
          success: true,
          message: "Task created successfully",
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
          boardInfo: {
            id: board!.id,
            title: board!.title,
          },
          sectionInfo: {
            id: section!.id,
            title: section!.title,
          },
          notifications: {
            emailSent: validatedData.user !== session.user.id,
            assignedTo: assignedUser!.email,
          },
        },
        { status: 201 }
      );
    }

  } catch (error) {
    console.error("[TASK_CREATE] Error:", error);

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
            { error: "Board, section, or user not found" },
            { status: 404 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid board, section, or user reference" },
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

// Optional: Add GET method to retrieve tasks for a board/section
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

  try {
    const { searchParams } = new URL(req.url);
    const sectionId = searchParams.get('sectionId');

    // Check board permissions
    const { hasPermission, board, error } = await checkBoardPermissions(params.boardId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Board not found" ? 404 : 403 });
    }

    // Build query conditions
    const whereConditions: any = {};
    if (sectionId) {
      whereConditions.section = sectionId;
    } else {
      // Get all tasks in all sections of this board
      const sections = await prismadb.sections.findMany({
        where: { board: params.boardId },
        select: { id: true }
      });
      whereConditions.section = { in: sections.map(s => s.id) };
    }

    // Get tasks
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
        board: {
          id: board!.id,
          title: board!.title,
        },
        tasks: tasks.map(task => ({
          ...task,
          tags: task.tags ? JSON.parse(task.tags as string) : [],
          commentCount: task._count.comments,
          documentCount: task._count.documents,
        })),
        totalTasks: tasks.length,
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