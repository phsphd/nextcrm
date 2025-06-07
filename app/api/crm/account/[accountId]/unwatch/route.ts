// file: nextcrm/app/api/crm/account/[accountId]/unwatch/route.ts
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
    // 🔴 MODIFIED: Use junction table instead of disconnect
    await prismadb.userWatchingAccounts.deleteMany({
      where: {
        userId: session.user.id,
        accountId: accountId,
      },
    });

    // 🔴 MODIFIED: Fixed success message (was incorrectly saying "Board watched")
    return NextResponse.json({ message: "Account unwatched" }, { status: 200 });
  } catch (error) {
    console.log("[ACCOUNT_UNWATCH_POST]", error);
    // 🔴 ADDED: Better error response
    return NextResponse.json({ error: "Failed to unwatch account" }, { status: 500 });
  }
}