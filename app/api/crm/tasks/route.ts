// file: nextcrm/app/api/crm/tasks/route.ts
/*
This route handles deletion of CRM Account Tasks and their associated comments
Includes proper cascade deletion and relationship cleanup

MIGRATION NOTES (MongoDB -> Supabase):
- Fixed comment deletion logic to use correct relationship field
- Updated model names to match Prisma schema
- Improved error handling and validation
- Added proper cascade deletion handling
- Enhanced logging and response structure
- Fixed permission checking and user validation
- Better transaction handling for data consistency
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Delete CRM Account Task API endpoint
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log("Delete request body:", body);
    
    const { id, section } = body;

    if (!id) {
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
    }

    console.log(`Processing deletion request for CRM task: ${id}`);

    // First, verify the task exists and get its details
    const currentTask = await prismadb.crm_Accounts_Tasks.findUnique({
      where: {
        id,
      },
      include: {
        assigned_user: {
          select: {
            id: true,
            name: true,
          }
        },
        crm_accounts: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    });

    if (!currentTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    console.log(`Found task: ${currentTask.title} assigned to account: ${currentTask.crm_accounts?.name}`);

    // Check if user has permission to delete this task
    // Allow deletion if: user is the assignee, creator, or admin
    const canDelete = 
      currentTask.user === session.user.id || 
      currentTask.createdBy === session.user.id ||
      session.user.is_admin;

    if (!canDelete) {
      console.warn(`User ${session.user.id} attempted to delete task ${id} without permission`);
      return NextResponse.json({ error: "Insufficient permissions to delete this task" }, { status: 403 });
    }

    // Use a transaction to ensure data consistency
    const result = await prismadb.$transaction(async (tx) => {
      console.log("Starting transaction for task deletion...");

      // Delete associated comments first (using correct relationship field)
      // Based on the schema, CRM task comments use 'assigned_crm_account_task' field
      const deletedComments = await tx.tasksComments.deleteMany({
        where: {
          assigned_crm_account_task: id,
        },
      });

      console.log(`Deleted ${deletedComments.count} comments for task ${id}`);

      // Delete any document relationships if they exist
      // Note: Based on schema, documents can be related via DocumentsTocrm_Accounts_Tasks junction table
      const deletedDocumentRelations = await tx.documentsTocrm_Accounts_Tasks.deleteMany({
        where: {
          B: id, // B field represents the task ID in the junction table
        },
      });

      console.log(`Deleted ${deletedDocumentRelations.count} document relations for task ${id}`);

      // Finally, delete the task itself
      const deletedTask = await tx.crm_Accounts_Tasks.delete({
        where: {
          id,
        },
      });

      console.log(`Successfully deleted task: ${deletedTask.title}`);

      return {
        deletedTask,
        deletedCommentsCount: deletedComments.count,
        deletedDocumentRelationsCount: deletedDocumentRelations.count,
      };
    });

    console.log("Transaction completed successfully");

    return NextResponse.json(
      {
        success: true,
        message: "Task deleted successfully",
        deletedTask: {
          id: result.deletedTask.id,
          title: result.deletedTask.title,
          account: currentTask.crm_accounts?.name,
        },
        deletedCommentsCount: result.deletedCommentsCount,
        deletedDocumentRelationsCount: result.deletedDocumentRelationsCount,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[CRM_TASK_DELETE] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to delete does not exist')) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      
      if (error.message.includes('Foreign key constraint')) {
        return NextResponse.json(
          { error: "Cannot delete task due to existing dependencies" },
          { status: 409 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete task",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for retrieving CRM tasks
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');

    const whereClause: any = {};

    if (accountId) {
      whereClause.account = accountId;
    }

    if (userId) {
      whereClause.user = userId;
    }

    if (status) {
      whereClause.taskStatus = status;
    }

    const tasks = await prismadb.crm_Accounts_Tasks.findMany({
      where: whereClause,
      include: {
        assigned_user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        crm_accounts: {
          select: {
            id: true,
            name: true,
          }
        },
        comments: {
          include: {
            assigned_user: {
              select: {
                id: true,
                name: true,
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json(
      {
        success: true,
        tasks,
        count: tasks.length
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[CRM_TASK_GET] Error:", error);
    
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