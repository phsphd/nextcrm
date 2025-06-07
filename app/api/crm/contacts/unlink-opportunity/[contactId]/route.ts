// file: nextcrm/app/api/crm/contacts/unlink-opportunity/[contactId]/route.ts
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

//Route to unlink contact from opportunity
export async function PUT(req: Request, props: { params: Promise<{ contactId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.contactId) {
    return new NextResponse("contact ID is required", { status: 400 });
  }

  const body = await req.json();

  const { opportunityId } = body;

  console.log(params.contactId, "contactId");
  console.log(opportunityId, "opportunityId");

  if (!opportunityId) {
    return new NextResponse("opportunity ID is required", { status: 400 });
  }

  try {
    // 🔴 MODIFIED: Use junction table instead of disconnect operation
    const deleteResult = await prismadb.contactOpportunities.deleteMany({
      where: {
        contactId: params.contactId,
        opportunityId: opportunityId,
      },
    });

    // 🔴 ADDED: Check if the relationship actually existed
    if (deleteResult.count === 0) {
      return NextResponse.json(
        { 
          message: "No relationship found between contact and opportunity",
          contactId: params.contactId,
          opportunityId: opportunityId 
        }, 
        { status: 404 }
      );
    }

    // 🔴 MODIFIED: Return meaningful success response
    return NextResponse.json(
      { 
        message: "Contact successfully unlinked from opportunity",
        contactId: params.contactId,
        opportunityId: opportunityId,
        deletedCount: deleteResult.count
      }, 
      { status: 200 }
    );

  } catch (error) {
    console.log("[CONTACTS_UNLINK_OPPORTUNITY_ERROR]", error);
    return NextResponse.json(
      { 
        error: "Failed to unlink contact from opportunity",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

// 🔴 ADDED: DELETE method as alternative (more RESTful)
export async function DELETE(req: Request, props: { params: Promise<{ contactId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.contactId) {
    return new NextResponse("contact ID is required", { status: 400 });
  }

  const body = await req.json();
  const { opportunityId } = body;

  if (!opportunityId) {
    return new NextResponse("opportunity ID is required", { status: 400 });
  }

  try {
    // 🔴 ADDED: Same logic as PUT but using DELETE method
    const deleteResult = await prismadb.contactOpportunities.deleteMany({
      where: {
        contactId: params.contactId,
        opportunityId: opportunityId,
      },
    });

    if (deleteResult.count === 0) {
      return NextResponse.json(
        { 
          message: "No relationship found between contact and opportunity",
          contactId: params.contactId,
          opportunityId: opportunityId 
        }, 
        { status: 404 }
      );
    }

    return NextResponse.json(
      { 
        message: "Contact successfully unlinked from opportunity",
        contactId: params.contactId,
        opportunityId: opportunityId,
        deletedCount: deleteResult.count
      }, 
      { status: 200 }
    );

  } catch (error) {
    console.log("[CONTACTS_UNLINK_OPPORTUNITY_DELETE_ERROR]", error);
    return NextResponse.json(
      { 
        error: "Failed to unlink contact from opportunity",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

// 🔴 ADDED: GET method to check if relationship exists
export async function GET(req: Request, props: { params: Promise<{ contactId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.contactId) {
    return new NextResponse("contact ID is required", { status: 400 });
  }

  // Get opportunityId from query parameters
  const url = new URL(req.url);
  const opportunityId = url.searchParams.get('opportunityId');

  if (!opportunityId) {
    return new NextResponse("opportunity ID is required as query parameter", { status: 400 });
  }

  try {
    // 🔴 ADDED: Check if relationship exists
    const relationship = await prismadb.contactOpportunities.findUnique({
      where: {
        contactId_opportunityId: {
          contactId: params.contactId,
          opportunityId: opportunityId,
        },
      },
    });

    return NextResponse.json(
      { 
        exists: !!relationship,
        relationship: relationship,
        contactId: params.contactId,
        opportunityId: opportunityId
      }, 
      { status: 200 }
    );

  } catch (error) {
    console.log("[CONTACTS_OPPORTUNITY_RELATIONSHIP_CHECK_ERROR]", error);
    return NextResponse.json(
      { 
        error: "Failed to check relationship",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}