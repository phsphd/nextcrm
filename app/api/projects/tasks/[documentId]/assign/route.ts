// file: app/api/projects/tasks/[documentId]/assign/route.ts
/*
This route handles task assignment to documents with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved task assignment logic with proper relationship handling
- Better user authorization and document/task ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added atomic assignment with transactions
- Better duplicate assignment prevention
- Enhanced response format with assignment details
- Optimized queries for PostgreSQL performance
- Added comprehensive validation with Zod
*/

import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

// Enhanced validation schema for task assignment
const taskAssignmentSchema = z.object({
  taskId: z.string()
    .min(10, "Invalid task ID")
    .max(50, "Task ID too long"),
  notes: z.string()
    .max(500, "Notes too long")
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH'])
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
      assigned_user: {
        select: {
          id: true,
          email: true,
        }
      },
      assigned_section: {
        select: {
          id: true,
          board: true,
        }
      }
    }
  });

  if (!task) {
    return { hasPermission: false, task: null, error: "Task not found" };
  }

  // Check if user owns the task or has access through board
  if (task.user === userId) {
    return { hasPermission: true, task, error: null };
  }

  // Check board permissions if task is in a section
  if (task.assigned_section?.board) {
    const board = await prismadb.boards.findUnique({
      where: { id: task.assigned_section.board },
      select: {
        user: true,
        sharedWith: true,
        watchers: {
          where: { userId },
          select: { userId: true }
        }
      }
    });

    if (board) {
      const hasBoardAccess = board.user === userId || 
                            board.sharedWith?.includes(userId) ||
                            board.watchers.length > 0;
      
      if (hasBoardAccess) {
        return { hasPermission: true, task, error: null };
      }
    }
  }

  return { hasPermission: false, task, error: "Forbidden - You don't have permission to assign this task" };
}

// Helper function to check user permissions for a document
async function checkDocumentPermissions(documentId: string, userId: string) {
  const document = await prismadb.documents.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      document_name: true,
      created_by_user: true,
      assigned_user: true,
      visibility: true,
      created_by: {
        select: {
          id: true,
          email: true,
        }
      },
      assigned_to_user: {
        select: {
          id: true,
          email: true,
        }
      }
    }
  });

  if (!document) {
    return { hasPermission: false, document: null, error: "Document not found" };
  }

  // Check if user owns or is assigned to the document
  const hasPermission = document.created_by_user === userId || 
                       document.assigned_user === userId ||
                       document.visibility === 'PUBLIC';

  return { hasPermission, document, error: hasPermission ? null : "Forbidden - You don't have permission to assign tasks to this document" };
}

export async function POST(req: Request, props: { params: Promise<{ documentId: string }> }) {
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
  if (!params.documentId) {
    return NextResponse.json({ error: "Missing document ID" }, { status: 400 });
  }

  const { documentId } = params;

  // Validate documentId format (assuming CUID)
  if (typeof documentId !== 'string' || documentId.length < 10) {
    return NextResponse.json({ error: "Invalid document ID format" }, { status: 400 });
  }

  try {
    const body = await req.json();
    console.log(`User ${session.user.email} attempting to assign task to document: ${documentId}`);

    // Validate request data
    const validatedData = taskAssignmentSchema.parse(body);
    const { taskId, notes, priority } = validatedData;

    // Check if task exists and user has permission
    const { hasPermission: hasTaskPermission, task, error: taskError } = await checkTaskPermissions(taskId, session.user.id);
    if (!hasTaskPermission) {
      return NextResponse.json({ error: taskError }, { status: taskError === "Task not found" ? 404 : 403 });
    }

    // Check if document exists and user has permission
    const { hasPermission: hasDocPermission, document, error: docError } = await checkDocumentPermissions(documentId, session.user.id);
    if (!hasDocPermission) {
      return NextResponse.json({ error: docError }, { status: docError === "Document not found" ? 404 : 403 });
    }

    // Check if task is already assigned to this document
    const existingAssignment = await prismadb.documentTasks.findUnique({
      where: {
        documentId_taskId: {
          documentId: documentId,
          taskId: taskId,
        }
      }
    });

    if (existingAssignment) {
      return NextResponse.json(
        { 
          success: true,
          message: "Task is already assigned to this document",
          assignment: {
            documentId,
            taskId,
            taskTitle: task!.title,
            documentName: document!.document_name,
          }
        },
        { status: 200 }
      );
    }

    // Use transaction to ensure atomic assignment
    const assignmentResult = await prismadb.$transaction(async (tx) => {
      // Create the many-to-many relationship
      const newAssignment = await tx.documentTasks.create({
        data: {
          documentId: documentId,
          taskId: taskId,
        }
      });

      // Update task with assignment info and metadata
      const updatedTask = await tx.tasks.update({
        where: { id: taskId },
        data: {
          updatedBy: session.user.id,
          lastEditedAt: new Date(),
          ...(priority && { priority }),
        },
        select: {
          id: true,
          title: true,
          priority: true,
          taskStatus: true,
          updatedAt: true,
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      // Update document with assignment metadata
      const updatedDocument = await tx.documents.update({
        where: { id: documentId },
        data: {
          last_updated: new Date(),
          updatedAt: new Date(),
        },
        select: {
          id: true,
          document_name: true,
          document_type: true,
          updatedAt: true,
        }
      });

      return {
        assignment: newAssignment,
        task: updatedTask,
        document: updatedDocument,
      };
    });

    console.log(`Successfully assigned task ${taskId} (${task!.title}) to document ${documentId} (${document!.document_name}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Task assigned to document successfully",
        assignment: {
          documentId: assignmentResult.document.id,
          taskId: assignmentResult.task.id,
          taskTitle: assignmentResult.task.title,
          documentName: assignmentResult.document.document_name,
          taskPriority: assignmentResult.task.priority,
          taskStatus: assignmentResult.task.taskStatus,
          assignedBy: {
            id: session.user.id,
            email: session.user.email,
          },
          assignedUser: assignmentResult.task.assigned_user,
          notes,
        },
        assignedAt: new Date().toISOString(),
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("[TASK_DOCUMENT_ASSIGN] Error:", error);

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
            { error: "Task or document not found" },
            { status: 404 }
          );
        case 'P2002':
          return NextResponse.json(
            { error: "Task is already assigned to this document" },
            { status: 409 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid task or document reference" },
            { status: 400 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Assignment failed due to concurrent modification - please try again" },
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
        error: "Failed to assign task to document",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method to unassign task from document
export async function DELETE(req: Request, props: { params: Promise<{ documentId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.documentId) {
    return NextResponse.json({ error: "Missing document ID" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json({ error: "Missing task ID" }, { status: 400 });
    }

    // Check permissions
    const { hasPermission: hasTaskPermission, task, error: taskError } = await checkTaskPermissions(taskId, session.user.id);
    if (!hasTaskPermission) {
      return NextResponse.json({ error: taskError }, { status: taskError === "Task not found" ? 404 : 403 });
    }

    const { hasPermission: hasDocPermission, document, error: docError } = await checkDocumentPermissions(params.documentId, session.user.id);
    if (!hasDocPermission) {
      return NextResponse.json({ error: docError }, { status: docError === "Document not found" ? 404 : 403 });
    }

    // Check if assignment exists
    const existingAssignment = await prismadb.documentTasks.findUnique({
      where: {
        documentId_taskId: {
          documentId: params.documentId,
          taskId: taskId,
        }
      }
    });

    if (!existingAssignment) {
      return NextResponse.json({ error: "Task is not assigned to this document" }, { status: 404 });
    }

    // Remove assignment
    await prismadb.documentTasks.delete({
      where: {
        documentId_taskId: {
          documentId: params.documentId,
          taskId: taskId,
        }
      }
    });

    console.log(`Successfully unassigned task ${taskId} from document ${params.documentId} by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Task unassigned from document successfully",
        unassignment: {
          documentId: params.documentId,
          taskId: taskId,
          taskTitle: task!.title,
          documentName: document!.document_name,
        },
        unassignedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_DOCUMENT_UNASSIGN] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to unassign task from document",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve task assignments for a document
export async function GET(req: Request, props: { params: Promise<{ documentId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  if (!params.documentId) {
    return NextResponse.json({ error: "Missing document ID" }, { status: 400 });
  }

  try {
    // Check document permissions
    const { hasPermission, document, error } = await checkDocumentPermissions(params.documentId, session.user.id);
    if (!hasPermission) {
      return NextResponse.json({ error }, { status: error === "Document not found" ? 404 : 403 });
    }

    // Get all tasks assigned to this document
    const assignments = await prismadb.documentTasks.findMany({
      where: { documentId: params.documentId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            priority: true,
            taskStatus: true,
            dueDateAt: true,
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
                board: true,
              }
            }
          }
        }
      }
    });

    return NextResponse.json(
      {
        success: true,
        document: {
          id: document!.id,
          name: document!.document_name,
        },
        assignments: assignments.map(assignment => ({
          taskId: assignment.task.id,
          taskTitle: assignment.task.title,
          priority: assignment.task.priority,
          status: assignment.task.taskStatus,
          dueDate: assignment.task.dueDateAt,
          assignedUser: assignment.task.assigned_user,
          section: assignment.task.assigned_section,
        })),
        totalAssignments: assignments.length,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_DOCUMENT_ASSIGNMENTS_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve task assignments",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}