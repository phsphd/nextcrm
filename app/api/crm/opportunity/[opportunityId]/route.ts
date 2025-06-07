// file: nextcrm/app/api/crm/opportunity/[opportunityId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { prismadb } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

export async function PUT(req: Request, props: { params: Promise<{ opportunityId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.opportunityId) {
    return new NextResponse("Opportunity ID is required", { status: 400 });
  }

  const body = await req.json();

  const { 
    destination, // For sales stage updates
    // 🔴 ADDED: Support for full opportunity updates
    name,
    description,
    budget,
    expected_revenue,
    close_date,
    status,
    assigned_to,
    account,
    campaign,
    currency,
    next_step,
    type,
    // 🔴 ADDED: Support for junction table relationships
    contactIds = [],
    documentIds = [],
  } = body;

  try {
    // 🔴 MODIFIED: Use transaction to handle junction table relationships
    const updatedOpportunity = await prismadb.$transaction(async (tx) => {
      // Update the opportunity
      const opportunity = await tx.crm_Opportunities.update({
        where: {
          id: params.opportunityId,
        },
        data: {
          // 🔴 ENHANCED: Support both simple sales stage update and full update
          ...(destination && { sales_stage: destination }),
          ...(name && { name }),
          ...(description && { description }),
          ...(budget !== undefined && { budget }),
          ...(expected_revenue !== undefined && { expected_revenue }),
          ...(close_date && { close_date: new Date(close_date) }),
          ...(status && { status }),
          ...(assigned_to && { assigned_to }),
          ...(account && { account }),
          ...(campaign && { campaign }),
          ...(currency && { currency }),
          ...(next_step && { next_step }),
          ...(type && { type }),
          updatedBy: session.user.id,
        },
      });

      // 🔴 ADDED: Update contact relationships through junction table
      if (contactIds.length >= 0) {
        // Remove existing contact relationships
        await tx.contactOpportunities.deleteMany({
          where: {
            opportunityId: params.opportunityId,
          },
        });

        // Add new contact relationships
        if (contactIds.length > 0) {
          await tx.contactOpportunities.createMany({
            data: contactIds.map((contactId: string) => ({
              opportunityId: params.opportunityId,
              contactId,
            })),
          });
        }
      }

      // 🔴 ADDED: Update document relationships through junction table
      if (documentIds.length >= 0) {
        // Remove existing document relationships
        await tx.documentOpportunities.deleteMany({
          where: {
            opportunityId: params.opportunityId,
          },
        });

        // Add new document relationships
        if (documentIds.length > 0) {
          await tx.documentOpportunities.createMany({
            data: documentIds.map((documentId: string) => ({
              opportunityId: params.opportunityId,
              documentId,
            })),
          });
        }
      }

      return opportunity;
    });

    // 🔴 ENHANCED: Return updated opportunities with relationships
    const data = await prismadb.crm_Opportunities.findMany({
      include: {
        assigned_to_user: {
          select: {
            id: true, // 🔴 ADDED: Include user ID
            avatar: true,
            name: true,
            email: true, // 🔴 ADDED: Include email
          },
        },
        // 🔴 ADDED: Include account information
        assigned_account: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        // 🔴 ADDED: Include sales stage information
        assigned_sales_stage: {
          select: {
            id: true,
            name: true,
            probability: true,
          },
        },
        // 🔴 ADDED: Include opportunity type
        assigned_type: {
          select: {
            id: true,
            name: true,
          },
        },
        // 🔴 ADDED: Include contacts through junction table
        contacts: {
          include: {
            contact: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
              },
            },
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
      },
      orderBy: {
        updatedAt: 'desc', // 🔴 ADDED: Order by most recently updated
      },
    });

    return NextResponse.json(
      { 
        message: "Opportunity updated successfully", 
        data,
        updatedOpportunity 
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("[OPPORTUNITY_UPDATE]", error);
    return new NextResponse("Failed to update opportunity", { status: 500 });
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ opportunityId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.opportunityId) {
    return new NextResponse("Opportunity ID is required", { status: 400 });
  }

  try {
    // 🔴 MODIFIED: Use transaction to handle junction table cleanup
    await prismadb.$transaction(async (tx) => {
      // 🔴 ADDED: Delete related junction table records first
      await tx.contactOpportunities.deleteMany({
        where: {
          opportunityId: params.opportunityId,
        },
      });

      await tx.documentOpportunities.deleteMany({
        where: {
          opportunityId: params.opportunityId,
        },
      });

      // 🔴 MODIFIED: Then delete the opportunity itself
      await tx.crm_Opportunities.delete({
        where: {
          id: params.opportunityId,
        },
      });
    });

    return NextResponse.json(
      { message: "Opportunity deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.log("[OPPORTUNITY_DELETE]", error);
    return new NextResponse("Failed to delete opportunity", { status: 500 });
  }
}

// 🔴 ADDED: GET route to fetch single opportunity with all relationships
export async function GET(req: Request, props: { params: Promise<{ opportunityId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.opportunityId) {
    return new NextResponse("Opportunity ID is required", { status: 400 });
  }

  try {
    const opportunity = await prismadb.crm_Opportunities.findUnique({
      where: {
        id: params.opportunityId,
      },
      include: {
        assigned_to_user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        created_by_user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assigned_account: {
          select: {
            id: true,
            name: true,
            email: true,
            website: true,
          },
        },
        assigned_sales_stage: {
          select: {
            id: true,
            name: true,
            probability: true,
            order: true,
          },
        },
        assigned_type: {
          select: {
            id: true,
            name: true,
            order: true,
          },
        },
        assigned_campaings: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        // 🔴 ADDED: Include contacts through junction table
        contacts: {
          include: {
            contact: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                office_phone: true,
                position: true,
              },
            },
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

    if (!opportunity) {
      return new NextResponse("Opportunity not found", { status: 404 });
    }

    return NextResponse.json(opportunity, { status: 200 });
  } catch (error) {
    console.log("[OPPORTUNITY_GET]", error);
    return new NextResponse("Failed to fetch opportunity", { status: 500 });
  }
}