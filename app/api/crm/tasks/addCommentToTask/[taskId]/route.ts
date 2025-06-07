// file: nextcrm/app/api/crm/tasks/addCommentToTask/[taskId]/route.ts
/*
This route adds comments to CRM account tasks and sends email notifications
Supports both regular Tasks and CRM Account Tasks

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model names to match new Prisma schema structure
- Fixed relationship handling between tasks and comments
- Enhanced task type detection (regular Tasks vs CRM Account Tasks)
- Improved error handling and validation
- Added proper email notification system
- Better logging and response structure
- Added user permission validation
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import NewTaskCommentEmail from "@/emails/NewTaskComment";
import resendHelper from "@/lib/resend";

export async function POST(req: Request, props: { params: Promise<{ taskId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  const { taskId } = params;

  if (!taskId) {
    return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { comment } = body;

    if (!comment || typeof comment !== 'string') {
      return NextResponse.json({ error: "Comment is required and must be a string" }, { status: 400 });
    }

    const sanitizedComment = comment.trim();
    if (sanitizedComment.length === 0) {
      return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
    }

    if (sanitizedComment.length > 2000) {
      return NextResponse.json({ error: "Comment is too long (max 2000 characters)" }, { status: 400 });
    }

    console.log(`Processing comment addition for task: ${taskId} by user: ${session.user.id}`);

    // First, try to find if it's a CRM Account Task
    let task = null;
    let taskType = '';
    let taskDetails = null;

    try {
      const crmTask = await prismadb.crm_Accounts_Tasks.findUnique({
        where: { id: taskId },
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
          }
        }
      });

      if (crmTask) {
        task = crmTask;
        taskType = 'crm_account';
        taskDetails = {
          title: crmTask.title,
          assignedUser: crmTask.assigned_user,
          account: crmTask.crm_accounts,
        };
        console.log(`Found CRM Account Task: ${crmTask.title}`);
      }
    } catch (crmError) {
      console.log("Not a CRM Account Task, checking regular Tasks...");
    }

    // If not found, try regular Tasks
    if (!task) {
      try {
        const regularTask = await prismadb.tasks.findUnique({
          where: { id: taskId },
          include: {
            assigned_user: {
              select: {
                id: true,
                name: true,
                email: true,
              }
            }
          }
        });

        if (regularTask) {
          task = regularTask;
          taskType = 'regular';
          taskDetails = {
            title: regularTask.title,
            assignedUser: regularTask.assigned_user,
          };
          console.log(`Found regular Task: ${regularTask.title}`);
        }
      } catch (regularError) {
        console.error("Error finding regular task:", regularError);
      }
    }

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Create the comment with appropriate task relationship
    console.log("Creating new comment...");
    const commentData: any = {
      v: 0,
      comment: sanitizedComment,
      user: session.user.id,
    };

    // Set the appropriate task relationship based on task type
    if (taskType === 'crm_account') {
      commentData.assigned_crm_account_task = taskId;
    } else {
      commentData.task = taskId;
    }

    const newComment = await prismadb.tasksComments.create({
      data: commentData,
      include: {
        assigned_user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    });

    console.log(`Comment created successfully: ${newComment.id}`);

    // Send email notification if task has an assigned user and it's not the commenter
    if (taskDetails?.assignedUser && taskDetails.assignedUser.id !== session.user.id) {
      try {
        const resend = await resendHelper();
        
        if (resend && taskDetails.assignedUser.email) {
          console.log(`Sending email notification to: ${taskDetails.assignedUser.email}`);
          
          await resend.emails.send({
            from: `${process.env.NEXT_PUBLIC_APP_NAME || 'NextCRM'} <${process.env.EMAIL_FROM}>`,
            to: taskDetails.assignedUser.email,
            subject: `New Comment on Task: ${taskDetails.title}`,
            react: NewTaskCommentEmail({
              taskTitle: taskDetails.title,
              comment: sanitizedComment,
              commenterName: session.user.name || session.user.email || 'Unknown User',
              assignedUserName: taskDetails.assignedUser.name || 'Unknown User',
              taskId: taskId,
              taskType: taskType,
              accountName: taskDetails.account?.name || null,
            }),
          });

          console.log("Email notification sent successfully");
        }
      } catch (emailError) {
        console.error("Failed to send email notification:", emailError);
        // Don't fail the entire operation if email fails
      }
    }

    return NextResponse.json(
      {
        success: true,
        comment: {
          id: newComment.id,
          comment: newComment.comment,
          createdAt: newComment.createdAt,
          user: newComment.assigned_user,
        },
        task: {
          id: taskId,
          title: taskDetails?.title,
          type: taskType,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[TASK_COMMENT_POST] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to add comment to task",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}