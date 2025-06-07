// file: nextcrm/app/api/user/[userId]/route.ts
/*
This route handles user CRUD operations (GET and DELETE)
Includes proper security, validation, and cascade deletion handling

MIGRATION NOTES (MongoDB -> Supabase):
- Fixed GET method: changed findMany to findUnique for single user lookup
- Updated model name from 'users' to 'users' (kept lowercase as per schema)
- Enhanced security with proper permission checking
- Improved error handling and validation
- Added proper cascade deletion handling for related records
- Better response structure without exposing sensitive data
- Enhanced logging and transaction safety
- Added admin permission requirements for user deletion
*/
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prismadb } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  const { userId } = params;

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    console.log(`Retrieving user data for: ${userId}`);

    // Security check: Only allow users to view their own data, unless they're admin
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to access user ${userId} data without permission`);
      return NextResponse.json(
        { error: "You can only access your own user data" },
        { status: 403 }
      );
    }

    // Use findUnique instead of findMany for single user lookup
    const user = await prismadb.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        account_name: true,
        avatar: true,
        userLanguage: true,
        userStatus: true,
        is_admin: true,
        is_account_admin: true,
        created_on: true,
        lastLoginAt: true,
        // Don't return sensitive fields like password
        
        // Include related data counts for admin users
        ...(session.user.is_admin && {
          _count: {
            select: {
              boards: true,
              tasks: true,
              assigned_contacts: true,
              assigned_invoices: true,
              crm_accounts_tasks: true,
              assigned_documents: true,
            }
          }
        })
      }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    console.log(`Successfully retrieved user data for: ${user.email}`);

    return NextResponse.json(
      {
        success: true,
        user: user
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve user data",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  const { userId } = params;

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    console.log(`Processing delete request for user: ${userId}`);

    // Security check: Only admins can delete users, and users cannot delete themselves
    if (!session.user.is_admin) {
      console.warn(`Non-admin user ${session.user.id} attempted to delete user ${userId}`);
      return NextResponse.json(
        { error: "Only administrators can delete users" },
        { status: 403 }
      );
    }

    // Prevent self-deletion
    if (session.user.id === userId) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 }
      );
    }

    // Verify the target user exists and get related data info
    const targetUser = await prismadb.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        is_admin: true,
        _count: {
          select: {
            boards: true,
            tasks: true,
            assigned_contacts: true,
            assigned_invoices: true,
            crm_accounts_tasks: true,
            assigned_documents: true,
            created_by_documents: true,
            openAi_key: true,
            notion_account: true,
          }
        }
      }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if this is the last admin user
    if (targetUser.is_admin) {
      const adminCount = await prismadb.users.count({
        where: {
          is_admin: true,
        }
      });

      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last administrator user" },
          { status: 400 }
        );
      }
    }

    console.log(`Deleting user: ${targetUser.email} with ${Object.values(targetUser._count).reduce((a, b) => a + b, 0)} related records`);

    // Use transaction to ensure data consistency during deletion
    const deletionResult = await prismadb.$transaction(async (tx) => {
      console.log("Starting user deletion transaction...");

      // Delete user's API configurations first
      const deletedOpenAiKeys = await tx.openAi_keys.deleteMany({
        where: { user: userId }
      });

      const deletedNotionAccounts = await tx.secondBrain_notions.deleteMany({
        where: { user: userId }
      });

      // Update or delete user's content based on business rules
      // Option 1: Transfer ownership to admin user (recommended)
      // Option 2: Delete all content (use with caution)
      
      // For this example, we'll transfer ownership to the deleting admin
      const transferredBoards = await tx.boards.updateMany({
        where: { user: userId },
        data: { user: session.user.id }
      });

      const transferredTasks = await tx.tasks.updateMany({
        where: { user: userId },
        data: { user: session.user.id }
      });

      const transferredCrmTasks = await tx.crm_Accounts_Tasks.updateMany({
        where: { user: userId },
        data: { user: session.user.id }
      });

      // Update assignments to null for contacts, invoices, documents, etc.
      const updatedContacts = await tx.crm_Contacts.updateMany({
        where: { assigned_to: userId },
        data: { assigned_to: null }
      });

      const updatedInvoices = await tx.invoices.updateMany({
        where: { assigned_user_id: userId },
        data: { assigned_user_id: null }
      });

      const updatedDocuments = await tx.documents.updateMany({
        where: { 
          OR: [
            { assigned_user: userId },
            { created_by_user: userId }
          ]
        },
        data: { 
          assigned_user: null,
          // Keep created_by_user for audit trail, or set to null if preferred
        }
      });

      // Delete user watching relationships (these will cascade)
      const deletedWatchingBoards = await tx.userWatchingBoards.deleteMany({
        where: { userId: userId }
      });

      const deletedWatchingAccounts = await tx.userWatchingAccounts.deleteMany({
        where: { userId: userId }
      });

      // Finally, delete the user
      const deletedUser = await tx.users.delete({
        where: { id: userId }
      });

      console.log("User deletion transaction completed successfully");

      return {
        deletedUser,
        transferredContent: {
          boards: transferredBoards.count,
          tasks: transferredTasks.count,
          crmTasks: transferredCrmTasks.count,
        },
        updatedAssignments: {
          contacts: updatedContacts.count,
          invoices: updatedInvoices.count,
          documents: updatedDocuments.count,
        },
        deletedConfigurations: {
          openAiKeys: deletedOpenAiKeys.count,
          notionAccounts: deletedNotionAccounts.count,
          watchingBoards: deletedWatchingBoards.count,
          watchingAccounts: deletedWatchingAccounts.count,
        }
      };
    });

    console.log(`Successfully deleted user: ${targetUser.email}`);

    return NextResponse.json(
      {
        success: true,
        message: "User deleted successfully",
        deletedUser: {
          id: deletionResult.deletedUser.id,
          name: deletionResult.deletedUser.name,
          email: deletionResult.deletedUser.email,
        },
        contentTransferred: deletionResult.transferredContent,
        assignmentsUpdated: deletionResult.updatedAssignments,
        configurationsDeleted: deletionResult.deletedConfigurations,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[USER_DELETE] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to delete does not exist')) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      
      if (error.message.includes('Foreign key constraint')) {
        return NextResponse.json(
          { error: "Cannot delete user due to existing dependencies. Please contact support." },
          { status: 409 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete user",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}