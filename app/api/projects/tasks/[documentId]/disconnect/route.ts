// file: app/api/projects/tasks/[documentId]/disconnect/route.ts
/*
This route handles disconnecting a document from a task with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved document disconnection logic with proper relationship handling
- Better user authorization and task/document ownership verification
- Added proper logging and activity tracking
- Enhanced security with user permissions checking
- Added input sanitization and validation with Zod
- Better connection verification before disconnection
- Enhanced response format with disconnection tracking
- Optimized queries for PostgreSQL performance
- Fixed redundant database operations
*/

import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

// Enhanced validation schema for task disconnection
const taskDisconnectionSchema = z.object({
  taskId: z.string()
    .min(10, "Invalid task ID")
    .max(50, "Task ID too long"),
  reason: z.string()
    .max(500, "Reason too long")
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
      taskStatus: true,
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

  return { hasPermission: false, task, error: "Forbidden - You don't have permission to modify this task" };
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
      document_type: true,
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

  return { hasPermission, document, error: hasPermission ? null : "Forbidden - You don't have permission to modify this document" };
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
    console.log(`User ${session.user.email} attempting to disconnect task from document: ${documentId}`);

    // Validate request data
    const validatedData = taskDisconnectionSchema.parse(body);
    const { taskId, reason } = validatedData;

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

    // Check if task is actually connected to this document
    const existingConnection = await prismadb.documentTasks.findUnique({
      where: {
        documentId_taskId: {
          documentId: documentId,
          taskId: taskId,
        }
      }
    });

    if (!existingConnection) {
      return NextResponse.json(
        { 
          success: true,
          message: "Task is not connected to this document",
          disconnection: {
            documentId,
            taskId,
            taskTitle: task!.title,
            documentName: document!.document_name,
            status: "already_disconnected"
          }
        },
        { status: 200 }
      );
    }

    // Use transaction to ensure atomic disconnection
    const disconnectionResult = await prismadb.$transaction(async (tx) => {
      // Remove the many-to-many relationship
      await tx.documentTasks.delete({
        where: {
          documentId_taskId: {
            documentId: documentId,
            taskId: taskId,
          }
        }
      });

      // Update task with disconnection info and metadata
      const updatedTask = await tx.tasks.update({
        where: { id: taskId },
        data: {
          updatedBy: session.user.id,
          lastEditedAt: new Date(),
        },
        select: {
          id: true,
          title: true,
          taskStatus: true,
          priority: true,
          updatedAt: true,
          assigned_user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          },
          _count: {
            select: {
              documents: true,
            }
          }
        }
      });

      // Update document with disconnection metadata
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
          _count: {
            select: {
              tasks: true,
            }
          }
        }
      });

      return {
        task: updatedTask,
        document: updatedDocument,
      };
    });

    console.log(`Successfully disconnected task ${taskId} (${task!.title}) from document ${documentId} (${document!.document_name}) by user ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "Task disconnected from document successfully",
        disconnection: {
          documentId: disconnectionResult.document.id,
          taskId: disconnectionResult.task.id,
          taskTitle: disconnectionResult.task.title,
          documentName: disconnectionResult.document.document_name,
          taskStatus: disconnectionResult.task.taskStatus,
          disconnectedBy: {
            id: session.user.id,
            email: session.user.email,
          },
          reason,
        },
        statistics: {
          remainingTaskDocuments: disconnectionResult.task._count.documents,
          remainingDocumentTasks: disconnectionResult.document._count.tasks,
        },
        disconnectedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_DOCUMENT_DISCONNECT] Error:", error);

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
            { error: "Task, document, or connection not found" },
            { status: 404 }
          );
        case 'P2003':
          return NextResponse.json(
            { error: "Invalid task or document reference" },
            { status: 400 }
          );
        case 'P2034':
          return NextResponse.json(
            { error: "Disconnection failed due to concurrent modification - please try again" },
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
        error: "Failed to disconnect task from document",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to check connection status
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
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
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

    // Check connection status
    const connection = await prismadb.documentTasks.findUnique({
      where: {
        documentId_taskId: {
          documentId: params.documentId,
          taskId: taskId,
        }
      }
    });

    return NextResponse.json(
      {
        success: true,
        connection: {
          documentId: params.documentId,
          taskId: taskId,
          isConnected: !!connection,
          taskTitle: task!.title,
          documentName: document!.document_name,
          canDisconnect: true, // User has permission if they reached this point
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_DOCUMENT_CONNECTION_CHECK] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to check connection status",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method as alternative to POST for disconnection
export async function DELETE(req: Request, props: { params: Promise<{ documentId: string }> }) {
  // DELETE implementation would be similar to POST but follows RESTful conventions
  return POST(req, props);
}