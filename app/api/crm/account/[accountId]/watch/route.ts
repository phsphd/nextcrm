// file: nextcrm/app/api/crm/account/[accountId]/watch/route.ts
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST(req: Request, props: { params: Promise<{ accountId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  if (!params.accountId) {
    return new NextResponse("Missing account ID", { status: 400 });
  }

  const accountId = params.accountId;

  try {
    // 🔴 MODIFIED: Use junction table instead of direct connect
    await prismadb.userWatchingAccounts.upsert({
      where: {
        userId_accountId: {
          userId: session.user.id,
          accountId: accountId,
        },
      },
      update: {
        // Record already exists, no need to update anything
      },
      create: {
        userId: session.user.id,
        accountId: accountId,
      },
    });

    // 🔴 MODIFIED: Updated success message
    return NextResponse.json({ message: "Account watched" }, { status: 200 });
  } catch (error) {
    console.log("[ACCOUNT_WATCH_POST]", error);
    // 🔴 ADDED: Better error response
    return NextResponse.json({ error: "Failed to watch account" }, { status: 500 });
  }
}

// 🔴 ADDED: DELETE route to unwatch account
export async function DELETE(req: Request, props: { params: Promise<{ accountId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  if (!params.accountId) {
    return new NextResponse("Missing account ID", { status: 400 });
  }

  const accountId = params.accountId;

  try {
    // 🔴 ADDED: Remove watcher relationship from junction table
    await prismadb.userWatchingAccounts.deleteMany({
      where: {
        userId: session.user.id,
        accountId: accountId,
      },
    });

    return NextResponse.json({ message: "Account unwatched" }, { status: 200 });
  } catch (error) {
    console.log("[ACCOUNT_UNWATCH_DELETE]", error);
    return NextResponse.json({ error: "Failed to unwatch account" }, { status: 500 });
  }
}

// 🔴 ADDED: GET route to check if user is watching account
export async function GET(req: Request, props: { params: Promise<{ accountId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  if (!params.accountId) {
    return new NextResponse("Missing account ID", { status: 400 });
  }

  const accountId = params.accountId;

  try {
    // 🔴 ADDED: Check if user is watching this account
    const watchRecord = await prismadb.userWatchingAccounts.findUnique({
      where: {
        userId_accountId: {
          userId: session.user.id,
          accountId: accountId,
        },
      },
    });

    return NextResponse.json({ 
      isWatching: !!watchRecord,
      watchRecord 
    }, { status: 200 });
  } catch (error) {
    console.log("[ACCOUNT_WATCH_GET]", error);
    return NextResponse.json({ error: "Failed to check watch status" }, { status: 500 });
  }
}