// file: nextcrm/app/api/crm/account/route.ts
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

//Create new account route
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    const body = await req.json();
    const {
      name,
      office_phone,
      website,
      fax,
      company_id,
      vat,
      email,
      billing_street,
      billing_postal_code,
      billing_city,
      billing_state,
      billing_country,
      shipping_street,
      shipping_postal_code,
      shipping_city,
      shipping_state,
      shipping_country,
      description,
      assigned_to,
      status,
      annual_revenue,
      member_of,
      industry,
      // 🔴 ADDED: Support for watcher users
      watchers = [], // Array of user IDs who should watch this account
    } = body;

    // 🔴 MODIFIED: Create account with transaction to handle watchers
    const newAccount = await prismadb.$transaction(async (tx) => {
      // Create the account first
      const account = await tx.crm_Accounts.create({
        data: {
          v: 0,
          createdBy: session.user.id,
          updatedBy: session.user.id,
          name,
          office_phone,
          website,
          fax,
          company_id,
          vat,
          email,
          billing_street,
          billing_postal_code,
          billing_city,
          billing_state,
          billing_country,
          shipping_street,
          shipping_postal_code,
          shipping_city,
          shipping_state,
          shipping_country,
          description,
          assigned_to,
          status: "Active",
          annual_revenue,
          member_of,
          industry,
        },
      });

      // 🔴 ADDED: Create watcher relationships in junction table
      if (watchers.length > 0) {
        await tx.userWatchingAccounts.createMany({
          data: watchers.map((userId: string) => ({
            userId,
            accountId: account.id,
          })),
        });
      }

      return account;
    });

    return NextResponse.json({ newAccount }, { status: 200 });
  } catch (error) {
    console.log("[NEW_ACCOUNT_POST]", error);
    return new NextResponse("Initial error", { status: 500 });
  }
}

//Update account route
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    const body = await req.json();
    const {
      id,
      name,
      office_phone,
      website,
      fax,
      company_id,
      vat,
      email,
      billing_street,
      billing_postal_code,
      billing_city,
      billing_state,
      billing_country,
      shipping_street,
      shipping_postal_code,
      shipping_city,
      shipping_state,
      shipping_country,
      description,
      assigned_to,
      status,
      annual_revenue,
      member_of,
      industry,
      // 🔴 ADDED: Support for updating watchers
      watchers = [], // Array of user IDs who should watch this account
    } = body;

    // 🔴 MODIFIED: Update account with transaction to handle watchers
    const newAccount = await prismadb.$transaction(async (tx) => {
      // Update the account
      const account = await tx.crm_Accounts.update({
        where: {
          id,
        },
        data: {
          v: 0,
          updatedBy: session.user.id,
          name,
          office_phone,
          website,
          fax,
          company_id,
          vat,
          email,
          billing_street,
          billing_postal_code,
          billing_city,
          billing_state,
          billing_country,
          shipping_street,
          shipping_postal_code,
          shipping_city,
          shipping_state,
          shipping_country,
          description,
          assigned_to,
          status: status,
          annual_revenue,
          member_of,
          industry,
        },
      });

      // 🔴 ADDED: Update watcher relationships
      // First, remove all existing watchers
      await tx.userWatchingAccounts.deleteMany({
        where: {
          accountId: id,
        },
      });

      // Then, add new watchers
      if (watchers.length > 0) {
        await tx.userWatchingAccounts.createMany({
          data: watchers.map((userId: string) => ({
            userId,
            accountId: id,
          })),
        });
      }

      return account;
    });

    return NextResponse.json({ newAccount }, { status: 200 });
  } catch (error) {
    console.log("[UPDATE_ACCOUNT_PUT]", error);
    return new NextResponse("Initial error", { status: 500 });
  }
}

//GET all accounts route
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    // 🔴 MODIFIED: Include watchers and other relationships using junction tables
    const accounts = await prismadb.crm_Accounts.findMany({
      include: {
        assigned_to_user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        industry_type: {
          select: {
            id: true,
            name: true,
          },
        },
        // 🔴 ADDED: Include watchers through junction table
        watchers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        // 🔴 ADDED: Include document relationships through junction table
        documents: {
          include: {
            document: {
              select: {
                id: true,
                document_name: true,
                document_file_url: true,
              },
            },
          },
        },
        // 🔴 ADDED: Include related data counts
        _count: {
          select: {
            contacts: true,
            opportunities: true,
            invoices: true,
            leads: true,
          },
        },
      },
    });

    return NextResponse.json(accounts, { status: 200 });
  } catch (error) {
    console.log("[ACCOUNTS_GET]", error);
    return new NextResponse("Initial error", { status: 500 });
  }
}