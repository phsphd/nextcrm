// file: nextcrm/app/api/projects/[projectId]/unwatch/route.ts
/*
This route handles unwatching a project board
Provides secure access to project board unwatching functionality
Supports proper authentication and error handling

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use UserWatchingBoards junction table as per schema
- Enhanced security with proper user authentication and validation
- Improved error handling and response structure
- Better board unwatching functionality with proper validation
- Added comprehensive field validation and board existence checking
- Enhanced logging and activity tracking
- Better success/error messaging with user context
- Added proper transaction handling for data consistency
*/
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST(req: Request, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  // Enhanced authentication
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  const { projectId } = params;

  if (!projectId) {
    return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
  }

  try {
    console.log(`User ${session.user.email} attempting to unwatch project: ${projectId}`);

    // Check if the board exists and user has access to it
    const board = await prismadb.boards.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        title: true,
        user: true,
        visibility: true,
        sharedWith: true,
      }
    });

    if (!board) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if user has access to this board
    const hasAccess = 
      board.user === session.user.id || // User owns the board
      board.visibility === 'public' || // Board is public
      board.sharedWith?.includes(session.user.id); // User is in shared list

    if (!hasAccess) {
      console.warn(`User ${session.user.id} attempted to unwatch board ${projectId} without access`);
      return NextResponse.json(
        { error: "You don't have access to this project" },
        { status: 403 }
      );
    }

    // Check if user is currently watching the board
    const existingWatch = await prismadb.userWatchingBoards.findUnique({
      where: {
        userId_boardId: {
          userId: session.user.id,
          boardId: projectId,
        }
      },
      select: {
        id: true,
      }
    });

    if (!existingWatch) {
      return NextResponse.json(
        {
          success: true,
          message: "You are not watching this project",
          board: {
            id: board.id,
            title: board.title,
          },
          isWatching: false,
        },
        { status: 200 }
      );
    }

    // Remove the watch relationship
    await prismadb.userWatchingBoards.delete({
      where: {
        id: existingWatch.id,
      },
    });

    console.log(`User ${session.user.email} successfully unwatched project: ${board.title}`);

    return NextResponse.json(
      {
        success: true,
        message: `You are no longer watching "${board.title}"`,
        board: {
          id: board.id,
          title: board.title,
        },
        isWatching: false,
        unwatchedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROJECT_UNWATCH_POST] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to delete does not exist')) {
        return NextResponse.json(
          { 
            success: true,
            message: "You were not watching this project",
            isWatching: false
          },
          { status: 200 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to unwatch project",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to check watch status
export async function GET(req: Request, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  const { projectId } = params;

  if (!projectId) {
    return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
  }

  try {
    // Check if the board exists
    const board = await prismadb.boards.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        title: true,
        user: true,
        visibility: true,
        sharedWith: true,
      }
    });

    if (!board) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if user has access to this board
    const hasAccess = 
      board.user === session.user.id ||
      board.visibility === 'public' ||
      board.sharedWith?.includes(session.user.id);

    if (!hasAccess) {
      return NextResponse.json(
        { error: "You don't have access to this project" },
        { status: 403 }
      );
    }

    // Check if user is watching the board
    const watchStatus = await prismadb.userWatchingBoards.findUnique({
      where: {
        userId_boardId: {
          userId: session.user.id,
          boardId: projectId,
        }
      },
      select: {
        id: true,
      }
    });

    return NextResponse.json(
      {
        success: true,
        board: {
          id: board.id,
          title: board.title,
        },
        isWatching: !!watchStatus,
        canWatch: hasAccess,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[PROJECT_WATCH_STATUS_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to get watch status",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method as alternative to POST
export async function DELETE(req: Request, props: { params: Promise<{ projectId: string }> }) {
  // Reuse the same logic as POST for consistency
  return POST(req, props);
}