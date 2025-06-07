// file: nextcrm/app/api/crm/leads/[leadId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { prismadb } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

export async function DELETE(req: Request, props: { params: Promise<{ leadId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.leadId) {
    return new NextResponse("Lead ID is required", { status: 400 });
  }

  try {
    // 🔴 MODIFIED: Use transaction to handle related junction table data
    await prismadb.$transaction(async (tx) => {
      // 🔴 ADDED: Delete related junction table records first
      await tx.documentLeads.deleteMany({
        where: {
          leadId: params.leadId,
        },
      });

      // 🔴 MODIFIED: Then delete the lead itself
      await tx.crm_Leads.delete({
        where: {
          id: params.leadId,
        },
      });
    });

    return NextResponse.json({ message: "Lead deleted successfully" }, { status: 200 });
  } catch (error) {
    console.log("[LEAD_DELETE]", error);
    return new NextResponse("Failed to delete lead", { status: 500 });
  }
}

// 🔴 ADDED: GET route to fetch single lead with all relationships
export async function GET(req: Request, props: { params: Promise<{ leadId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.leadId) {
    return new NextResponse("Lead ID is required", { status: 400 });
  }

  try {
    const lead = await prismadb.crm_Leads.findUnique({
      where: {
        id: params.leadId,
      },
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
                document_file_mimeType: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return new NextResponse("Lead not found", { status: 404 });
    }

    return NextResponse.json(lead, { status: 200 });
  } catch (error) {
    console.log("[LEAD_GET]", error);
    return new NextResponse("Failed to fetch lead", { status: 500 });
  }
}

// 🔴 ADDED: PUT route to update lead
export async function PUT(req: Request, props: { params: Promise<{ leadId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.leadId) {
    return new NextResponse("Lead ID is required", { status: 400 });
  }

  try {
    const body = await req.json();
    const {
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
      status,
      type,
      assigned_to,
      accountsIDs,
      // 🔴 ADDED: Support for updating document relationships
      documentIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle junction table updates
    const updatedLead = await prismadb.$transaction(async (tx) => {
      // Update the lead
      const lead = await tx.crm_Leads.update({
        where: {
          id: params.leadId,
        },
        data: {
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
          status,
          type,
          assigned_to,
          accountsIDs,
          updatedBy: session.user.id,
        },
      });

      // 🔴 ADDED: Update document relationships
      if (documentIds.length >= 0) {
        // Remove existing document relationships
        await tx.documentLeads.deleteMany({
          where: {
            leadId: params.leadId,
          },
        });

        // Add new document relationships
        if (documentIds.length > 0) {
          await tx.documentLeads.createMany({
            data: documentIds.map((documentId: string) => ({
              leadId: params.leadId,
              documentId,
            })),
          });
        }
      }

      return lead;
    });

    return NextResponse.json(updatedLead, { status: 200 });
  } catch (error) {
    console.log("[LEAD_PUT]", error);
    return new NextResponse("Failed to update lead", { status: 500 });
  }
}