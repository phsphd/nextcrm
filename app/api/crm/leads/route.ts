// file: nextcrm/app/api/crm/leads/route.ts
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sendEmail from "@/lib/sendmail";

//Create a new lead route
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
      first_name,
      last_name,
      company,
      jobTitle,
      email,
      phone,
      description,
      lead_source,
      refered_by,
      campaign,
      assigned_to,
      accountIDs,
      // 🔴 ADDED: Support for document relationships
      documentIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle potential document relationships
    const newLead = await prismadb.$transaction(async (tx) => {
      // Create the lead
      const lead = await tx.crm_Leads.create({
        data: {
          v: 0, // 🔴 CHANGED: Updated version field for consistency (was v: 1)
          createdBy: userId,
          updatedBy: userId,
          firstName: first_name,
          lastName: last_name,
          company,
          jobTitle,
          email,
          phone,
          description,
          lead_source,
          refered_by,
          campaign,
          assigned_to: assigned_to || userId,
          accountsIDs: accountIDs, // 🔴 UNCHANGED: Direct field assignment (already correct for PostgreSQL)
          status: "NEW",
          type: "DEMO",
        },
      });

      // 🔴 ADDED: Create document relationships if provided
      if (documentIds.length > 0) {
        await tx.documentLeads.createMany({
          data: documentIds.map((documentId: string) => ({
            leadId: lead.id,
            documentId,
          })),
        });
      }

      return lead;
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
            ? `New lead ${first_name} ${last_name} has been added to the system and assigned to you.`
            : `Nová příležitost ${first_name} ${last_name} byla přidána do systému a přidělena vám.`,
        text:
          notifyRecipient.userLanguage === "en"
            ? `New lead ${first_name} ${last_name} has been added to the system and assigned to you. You can click here for detail: ${process.env.NEXT_PUBLIC_APP_URL}/crm/leads/${newLead.id}` // 🔴 FIXED: URL path (was /opportunities/, now /leads/)
            : `Nová příležitost ${first_name} ${last_name} byla přidána do systému a přidělena vám. Detaily naleznete zde: ${process.env.NEXT_PUBLIC_APP_URL}/crm/leads/${newLead.id}`, // 🔴 FIXED: URL path
      });
    }

    return NextResponse.json({ newLead }, { status: 200 });
  } catch (error) {
    console.log("[NEW_LEAD_POST]", error);
    return new NextResponse("Failed to create lead", { status: 500 });
  }
}

//Update a lead route
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
      firstName,
      lastName,
      company,
      jobTitle,
      email,
      phone,
      description,
      lead_source,
      refered_by,
      campaign,
      assigned_to,
      accountIDs,
      status,
      type,
      // 🔴 ADDED: Support for updating document relationships
      documentIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle document relationship updates
    const updatedLead = await prismadb.$transaction(async (tx) => {
      // Update the lead
      const lead = await tx.crm_Leads.update({
        where: {
          id,
        },
        data: {
          v: 0, // 🔴 CHANGED: Updated version field for consistency (was v: 1)
          updatedBy: userId,
          firstName,
          lastName,
          company,
          jobTitle,
          email,
          phone,
          description,
          lead_source,
          refered_by,
          campaign,
          assigned_to: assigned_to || userId,
          accountsIDs: accountIDs, // 🔴 UNCHANGED: Direct field assignment (already correct for PostgreSQL)
          status,
          type,
        },
      });

      // 🔴 ADDED: Update document relationships
      if (documentIds.length >= 0) {
        // Remove existing document relationships
        await tx.documentLeads.deleteMany({
          where: {
            leadId: id,
          },
        });

        // Add new document relationships
        if (documentIds.length > 0) {
          await tx.documentLeads.createMany({
            data: documentIds.map((documentId: string) => ({
              leadId: id,
              documentId,
            })),
          });
        }
      }

      return lead;
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
            ? `Lead ${firstName} ${lastName} has been updated and assigned to you.` // 🔴 IMPROVED: More accurate message for updates
            : `Příležitost ${firstName} ${lastName} byla aktualizována a přidělena vám.`, // 🔴 IMPROVED: More accurate message for updates
        text:
          notifyRecipient.userLanguage === "en"
            ? `Lead ${firstName} ${lastName} has been updated and assigned to you. You can click here for detail: ${process.env.NEXT_PUBLIC_APP_URL}/crm/leads/${updatedLead.id}` // 🔴 FIXED: URL path
            : `Příležitost ${firstName} ${lastName} byla aktualizována a přidělena vám. Detaily naleznete zde: ${process.env.NEXT_PUBLIC_APP_URL}/crm/leads/${updatedLead.id}`, // 🔴 FIXED: URL path
      });
    }

    return NextResponse.json({ updatedLead }, { status: 200 });
  } catch (error) {
    console.log("[UPDATED_LEAD_PUT]", error);
    return new NextResponse("Failed to update lead", { status: 500 });
  }
}

// 🔴 ADDED: GET route to fetch all leads with relationships
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  try {
    const leads = await prismadb.crm_Leads.findMany({
      include: {
        assigned_to_user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assigned_accounts: {
          select: {
            id: true,
            name: true,
            email: true,
            website: true,
          },
        },
        // 🔴 ADDED: Include documents through junction table
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
        // 🔴 ADDED: Include counts of related data
        _count: {
          select: {
            documents: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(leads, { status: 200 });
  } catch (error) {
    console.log("[LEADS_GET]", error);
    return new NextResponse("Failed to fetch leads", { status: 500 });
  }
}