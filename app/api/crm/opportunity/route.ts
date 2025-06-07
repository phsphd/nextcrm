// file: nextcrm/app/api/crm/opportunity/route.ts
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sendEmail from "@/lib/sendmail";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    const body = await req.json();
    const userId = session.user.id;

    if (!body) {
      return new NextResponse("No form data", { status: 400 });
    }

    const {
      account,
      assigned_to,
      budget,
      campaign,
      close_date,
      contact,
      currency,
      description,
      expected_revenue,
      name,
      next_step,
      sales_stage,
      type,
      // 🔴 ADDED: Support for junction table relationships
      contactIds = [],
      documentIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle junction table relationships
    const newOpportunity = await prismadb.$transaction(async (tx) => {
      // Create the opportunity
      const opportunity = await tx.crm_Opportunities.create({
        data: {
          v: 0, // 🔴 ADDED: Version field for consistency
          account: account,
          assigned_to: assigned_to,
          budget: Number(budget),
          campaign: campaign,
          close_date: close_date ? new Date(close_date) : null, // 🔴 ENHANCED: Proper date handling
          contact: contact, // 🔴 NOTE: This is the legacy single contact field
          created_by: userId,
          createdBy: userId, // 🔴 ADDED: Additional creator field
          last_activity_by: userId,
          updatedBy: userId,
          currency: currency,
          description: description,
          expected_revenue: Number(expected_revenue),
          name: name,
          next_step: next_step,
          sales_stage: sales_stage,
          status: "ACTIVE",
          type: type,
        },
      });

      // 🔴 ADDED: Create contact relationships through junction table
      if (contactIds.length > 0) {
        await tx.contactOpportunities.createMany({
          data: contactIds.map((contactId: string) => ({
            opportunityId: opportunity.id,
            contactId,
          })),
        });
      }

      // 🔴 ADDED: Create document relationships through junction table
      if (documentIds.length > 0) {
        await tx.documentOpportunities.createMany({
          data: documentIds.map((documentId: string) => ({
            opportunityId: opportunity.id,
            documentId,
          })),
        });
      }

      return opportunity;
    });

    // 🔴 UNCHANGED: Email notification logic (works with both MongoDB and PostgreSQL)
    if (assigned_to !== userId) {
      const notifyRecipient = await prismadb.users.findFirst({
        where: {
          id: assigned_to,
        },
      });

      if (!notifyRecipient) {
        return new NextResponse("No user found", { status: 400 });
      }

      await sendEmail({
        from: process.env.EMAIL_FROM as string,
        to: notifyRecipient.email || "info@softbase.cz",
        subject:
          notifyRecipient.userLanguage === "en"
            ? `New opportunity ${name} has been added to the system and assigned to you.`
            : `Nová příležitost ${name} byla přidána do systému a přidělena vám.`,
        text:
          notifyRecipient.userLanguage === "en"
            ? `New opportunity ${name} has been added to the system and assigned to you. You can click here for detail: ${process.env.NEXT_PUBLIC_APP_URL}/crm/opportunities/${newOpportunity.id}`
            : `Nová příležitost ${name} byla přidána do systému a přidělena vám. Detaily naleznete zde: ${process.env.NEXT_PUBLIC_APP_URL}/crm/opportunities/${newOpportunity.id}`,
      });
    }

    return NextResponse.json({ newOpportunity }, { status: 200 });
  } catch (error) {
    console.log("[NEW_OPPORTUNITY_POST]", error);
    return new NextResponse("Failed to create opportunity", { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    const body = await req.json();
    const userId = session.user.id;

    if (!body) {
      return new NextResponse("No form data", { status: 400 });
    }

    const {
      id,
      account,
      assigned_to,
      budget,
      campaign,
      close_date,
      contact,
      currency,
      description,
      expected_revenue,
      name,
      next_step,
      sales_stage,
      type,
      // 🔴 ADDED: Support for updating junction table relationships
      contactIds = [],
      documentIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle junction table relationship updates
    const updatedOpportunity = await prismadb.$transaction(async (tx) => {
      // Update the opportunity
      const opportunity = await tx.crm_Opportunities.update({
        where: { id },
        data: {
          v: 0, // 🔴 ADDED: Version field for consistency
          account: account,
          assigned_to: assigned_to,
          budget: Number(budget),
          campaign: campaign,
          close_date: close_date ? new Date(close_date) : null, // 🔴 ENHANCED: Proper date handling
          contact: contact,
          updatedBy: userId,
          currency: currency,
          description: description,
          expected_revenue: Number(expected_revenue),
          name: name,
          next_step: next_step,
          sales_stage: sales_stage,
          status: "ACTIVE",
          type: type,
        },
      });

      // 🔴 ADDED: Update contact relationships
      if (contactIds.length >= 0) {
        // Remove existing contact relationships
        await tx.contactOpportunities.deleteMany({
          where: {
            opportunityId: id,
          },
        });

        // Add new contact relationships
        if (contactIds.length > 0) {
          await tx.contactOpportunities.createMany({
            data: contactIds.map((contactId: string) => ({
              opportunityId: id,
              contactId,
            })),
          });
        }
      }

      // 🔴 ADDED: Update document relationships
      if (documentIds.length >= 0) {
        // Remove existing document relationships
        await tx.documentOpportunities.deleteMany({
          where: {
            opportunityId: id,
          },
        });

        // Add new document relationships
        if (documentIds.length > 0) {
          await tx.documentOpportunities.createMany({
            data: documentIds.map((documentId: string) => ({
              opportunityId: id,
              documentId,
            })),
          });
        }
      }

      return opportunity;
    });

    // 🔴 ADDED: Optional email notification for updates (currently commented out in original)
    // Uncomment if you want to enable update notifications
    /*
    if (assigned_to !== userId) {
      const notifyRecipient = await prismadb.users.findFirst({
        where: {
          id: assigned_to,
        },
      });

      if (notifyRecipient) {
        await sendEmail({
          from: process.env.EMAIL_FROM as string,
          to: notifyRecipient.email || "info@softbase.cz",
          subject:
            notifyRecipient.userLanguage === "en"
              ? `Opportunity ${name} has been updated and assigned to you.`
              : `Příležitost ${name} byla aktualizována a přidělena vám.`,
          text:
            notifyRecipient.userLanguage === "en"
              ? `Opportunity ${name} has been updated and assigned to you. You can click here for detail: ${process.env.NEXT_PUBLIC_APP_URL}/crm/opportunities/${updatedOpportunity.id}`
              : `Příležitost ${name} byla aktualizována a přidělena vám. Detaily naleznete zde: ${process.env.NEXT_PUBLIC_APP_URL}/crm/opportunities/${updatedOpportunity.id}`,
        });
      }
    }
    */

    return NextResponse.json({ updatedOpportunity }, { status: 200 });
  } catch (error) {
    console.log("[UPDATED_OPPORTUNITY_PUT]", error);
    return new NextResponse("Failed to update opportunity", { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  try {
    // 🔴 ENHANCED: Add better error handling and more selective field fetching
    const [users, accounts, contacts, saleTypes, saleStages, campaigns, industries] = await Promise.all([
      prismadb.users.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
        where: {
          userStatus: "ACTIVE", // 🔴 ADDED: Only active users
        },
      }),
      prismadb.crm_Accounts.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          website: true,
          status: true,
        },
        where: {
          status: "Active", // 🔴 ADDED: Only active accounts
        },
      }),
      prismadb.crm_Contacts.findMany({
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          position: true,
          accountsIDs: true, // 🔴 ADDED: Account relationship
        },
        where: {
          status: true, // 🔴 ADDED: Only active contacts
        },
      }),
      prismadb.crm_Opportunities_Type.findMany({
        orderBy: {
          order: 'asc', // 🔴 ADDED: Proper ordering
        },
      }),
      prismadb.crm_Opportunities_Sales_Stages.findMany({
        orderBy: {
          order: 'asc', // 🔴 ADDED: Proper ordering
        },
      }),
      prismadb.crm_campaigns.findMany({
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
        },
      }),
      prismadb.crm_Industry_Type.findMany({
        orderBy: {
          name: 'asc', // 🔴 ADDED: Alphabetical ordering
        },
      }),
    ]);

    const data = {
      users,
      accounts,
      contacts,
      saleTypes,
      saleStages,
      campaigns,
      industries,
    };

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.log("[GET_OPPORTUNITIES_DATA]", error);
    return new NextResponse("Failed to fetch opportunity data", { status: 500 });
  }
}